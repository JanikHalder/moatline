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

systemctl daemon-reload
systemctl restart apt-daily-upgrade.timer
systemctl enable --now docker-restart-policy-fix.timer
/usr/local/sbin/docker-restart-policy-fix || true

echo "Fertig auf $(hostname), Reboot-Zeit: ${REBOOT_TIME}"
systemctl list-timers apt-daily-upgrade.timer docker-restart-policy-fix.timer --no-pager
