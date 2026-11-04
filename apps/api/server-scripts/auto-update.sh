#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
REBOOT_TIME="${1:-04:00}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q unattended-upgrades apt-listchanges

# Tägliche Updates aktivieren
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# Eigene Einstellungen
cat > /etc/apt/apt.conf.d/52unattended-upgrades-local <<EOF
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
    "docker.io";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "${REBOOT_TIME}";
Unattended-Upgrade::SyslogEnable "true";
EOF

# Updates um 03:00 statt morgens, damit der Reboot in derselben Nacht folgt.
# Zusätzlich um 12:00: Sicherheits-Fixes, die tagsüber erscheinen, warten so
# höchstens einen halben Tag statt bis zur nächsten Nacht. Der Lauf startet
# trotzdem keinen Reboot – Automatic-Reboot-Time plant ihn für die nächste
# ${REBOOT_TIME} ein, also in der folgenden Nacht.
mkdir -p /etc/systemd/system/apt-daily-upgrade.timer.d
cat > /etc/systemd/system/apt-daily-upgrade.timer.d/override.conf <<'EOF'
[Timer]
OnCalendar=
OnCalendar=*-*-* 03:00
OnCalendar=*-*-* 12:00
RandomizedDelaySec=15m
EOF

# Vor jedem Lauf die Paketlisten aktualisieren – sonst sieht der Mittagslauf
# nur, was apt-daily.timer irgendwann am Vormittag geladen hat.
mkdir -p /etc/systemd/system/apt-daily-upgrade.service.d
cat > /etc/systemd/system/apt-daily-upgrade.service.d/refresh-lists.conf <<'EOF'
[Service]
ExecStartPre=-/usr/bin/apt-get -qq -o DPkg::Lock::Timeout=300 update
EOF
# Docker-Container ohne Restart-Policy auf "unless-stopped" setzen, damit sie nach
# dem automatischen Reboot wieder hochkommen. Swarm-Tasks werden von Swarm selbst
# neu gestartet und daher übersprungen. Opt-out per Label: restart-policy-fix.ignore=true
cat > /usr/local/sbin/docker-restart-policy-fix <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
command -v docker &>/dev/null || exit 0
docker info &>/dev/null || exit 0

fixed=0
for id in $(docker ps -q); do
    IFS='|' read -r name policy autoremove swarm ignore < <(docker inspect --format \
        '{{.Name}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.AutoRemove}}|{{with .Config.Labels}}{{index . "com.docker.swarm.service.id"}}|{{index . "restart-policy-fix.ignore"}}{{else}}|{{end}}' "$id")
    name="${name#/}"
    [[ -n "$swarm" ]] && continue
    [[ "$autoremove" == "true" ]] && continue
    [[ "$ignore" == "true" ]] && continue
    if [[ -z "$policy" || "$policy" == "no" ]]; then
        if docker update --restart unless-stopped "$id" >/dev/null; then
            echo "Restart-Policy gesetzt: $name -> unless-stopped"
            fixed=$((fixed + 1))
        else
            echo "Fehler beim Setzen der Restart-Policy: $name" >&2
        fi
    fi
done
echo "Geprüft, angepasst: $fixed Container"
EOF
chmod 755 /usr/local/sbin/docker-restart-policy-fix

cat > /etc/systemd/system/docker-restart-policy-fix.service <<'EOF'
[Unit]
Description=Docker-Container ohne Restart-Policy auf unless-stopped setzen
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/docker-restart-policy-fix
EOF

# Stündlich prüfen (fängt Redeploys ab) ...
cat > /etc/systemd/system/docker-restart-policy-fix.timer <<'EOF'
[Unit]
Description=Stündliche Prüfung der Docker-Restart-Policies

[Timer]
OnBootSec=10min
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

# ... und immer direkt vor den Updates (und damit vor einem möglichen Reboot)
mkdir -p /etc/systemd/system/apt-daily-upgrade.service.d
cat > /etc/systemd/system/apt-daily-upgrade.service.d/docker-restart-policy.conf <<'EOF'
[Service]
ExecStartPre=-/usr/local/sbin/docker-restart-policy-fix
EOF

# Docker vor einem Reboot (Sicherheits-Kernel um ${REBOOT_TIME}) geordnet
# herunterfahren. Ohne das stoppt systemd dockerd mitten im Abbau der Swarm-
# Tasks: dockerd schließt seine Datenbank, während es noch Container entfernt
# ("Error removing volumes: … database not open"), und die halb entfernten
# Layer bleiben unsichtbar in /var/lib/docker/overlay2 liegen.
#
# Der Guard hängt sich in den Shutdown (ExecStop) und
#   1. wartet, bis kein Pull/Build mehr läuft (höchstens 10 min),
#   2. setzt den Swarm-Knoten auf "drain": Swarm stoppt und entfernt die Tasks
#      selbst, solange dockerd noch voll läuft (höchstens 5 min),
#   3. merkt sich das in einer Marker-Datei.
# Nach dem Boot setzt docker-swarm-reactivate den Knoten wieder auf "active" –
# aber nur, wenn der Guard ihn gedraint hat, nie einen von Hand gedrainten.
#
# ACHTUNG: "systemctl stop docker-reboot-guard" führt den Guard aus und drainet
# den Knoten, also stoppt alle Swarm-Services. Danach von Hand
# /usr/local/sbin/docker-swarm-reactivate ausführen.
mkdir -p /var/lib/docker-reboot-guard
cat > /usr/local/sbin/docker-reboot-guard <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
MARKER=/var/lib/docker-reboot-guard/drained

docker info &>/dev/null || { echo "Docker läuft nicht, nichts zu tun."; exit 0; }

# 1. Laufende Image-Operationen abwarten.
deadline=$(( $(date +%s) + 600 ))
while pgrep -f 'docker (pull|build|buildx|load|push)' >/dev/null \
      || docker ps -a --filter status=created --filter status=restarting -q | grep -q .; do
    if (( $(date +%s) >= deadline )); then
        echo "Image-Operation läuft nach 10 min noch, Reboot geht trotzdem weiter." >&2
        break
    fi
    sleep 10
done

# 2. Swarm-Tasks geordnet abbauen. Nur auf einem Manager, und nur wenn der
#    Knoten aktiv ist (ein von Hand gedrainter Knoten bleibt, wie er ist).
read -r state manager node < <(docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}} {{.Swarm.NodeID}}')
if [[ "$state" != "active" || "$manager" != "true" ]]; then
    echo "Kein Swarm-Manager, kein Drain."
    exit 0
fi
if [[ "$(docker node inspect "$node" --format '{{.Spec.Availability}}')" != "active" ]]; then
    echo "Knoten ist nicht aktiv, kein Drain."
    exit 0
fi
touch "$MARKER"
docker node update --availability drain "$node" >/dev/null || { echo "Drain fehlgeschlagen." >&2; rm -f "$MARKER"; exit 0; }
echo "Knoten gedraint, warte auf das Ende der Swarm-Tasks."
deadline=$(( $(date +%s) + 300 ))
while docker ps -q --filter label=com.docker.swarm.task.id | grep -q .; do
    if (( $(date +%s) >= deadline )); then
        echo "Swarm-Tasks laufen nach 5 min noch, Reboot geht trotzdem weiter." >&2
        exit 0
    fi
    sleep 5
done
echo "Alle Swarm-Tasks beendet, Reboot geht weiter."
EOF
chmod 755 /usr/local/sbin/docker-reboot-guard

cat > /usr/local/sbin/docker-swarm-reactivate <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
MARKER=/var/lib/docker-reboot-guard/drained
[[ -f "$MARKER" ]] || exit 0
# dockerd und Swarm brauchen nach dem Boot einen Moment.
for _ in $(seq 60); do
    node=$(docker info --format '{{.Swarm.NodeID}}' 2>/dev/null)
    if [[ -n "$node" ]] && docker node update --availability active "$node" >/dev/null 2>&1; then
        rm -f "$MARKER"
        echo "Swarm-Knoten wieder aktiv."
        exit 0
    fi
    sleep 5
done
echo "Swarm-Knoten konnte nicht reaktiviert werden – von Hand: docker node update --availability active <node>" >&2
exit 1
EOF
chmod 755 /usr/local/sbin/docker-swarm-reactivate

cat > /etc/systemd/system/docker-reboot-guard.service <<'EOF'
[Unit]
Description=Docker vor dem Reboot geordnet herunterfahren (Swarm-Drain)
DefaultDependencies=no
After=docker.service
Before=shutdown.target reboot.target halt.target
Conflicts=shutdown.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
ExecStop=/usr/local/sbin/docker-reboot-guard
TimeoutStopSec=1000

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/docker-swarm-reactivate.service <<'EOF'
[Unit]
Description=Swarm-Knoten nach dem Reboot wieder aktivieren
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/docker-swarm-reactivate

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart apt-daily-upgrade.timer
systemctl enable --now docker-restart-policy-fix.timer
systemctl enable --now docker-reboot-guard.service
systemctl enable docker-swarm-reactivate.service
/usr/local/sbin/docker-restart-policy-fix || true

echo "Fertig auf $(hostname), Reboot-Zeit: ${REBOOT_TIME}"
systemctl list-timers apt-daily-upgrade.timer docker-restart-policy-fix.timer --no-pager
