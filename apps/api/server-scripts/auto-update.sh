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
# Merken, welche Services schon vor dem Reboot nicht liefen: die Prüfung nach
# dem Boot (docker-layer-cleanup verify) soll nicht ihretwegen zurückrollen.
docker service ls --format '{{.Name}} {{.Replicas}}' \
    | awk '$0 !~ /completed/ {split($2, a, "/"); if (a[1] + 0 < a[2] + 0) print $1}' \
    > /var/lib/docker-reboot-guard/down-before || true
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

# Verwaiste Layer beim Boot aussortieren. Bricht dockerd mitten im Löschen eines
# Images ab (Reboot, Absturz, volle Platte), ist das Image weg, seine Layer
# stehen aber noch in der Layer-Datenbank. Docker räumt sie nie mehr auf, und
# "docker system df" zählt sie nicht – auf md-application-server-1 waren das
# 83 GB. Im laufenden Betrieb darf man sie nicht löschen: dockerd hält die
# Layer-Liste im Speicher und würde sie bei einem späteren Pull wiederverwenden.
#
# Deshalb läuft das beim Hochfahren, bevor dockerd startet (kostet also keine
# zusätzliche Downtime), und verschiebt die Layer nur nach
# /var/lib/docker-trash/<Zeitpunkt> – das geht auf derselben Platte sofort.
# Ein täglicher Timer löscht den Papierkorb erst nach zwei Tagen endgültig.
# Bis dahin holt "docker-layer-cleanup restore" (Docker gestoppt) alles zurück.
# Das passiert auch automatisch: hat der Boot Layer verschoben, wartet
# docker-layer-verify bis zu 15 min, bis alle Swarm-Services wieder laufen.
# Klappt das nicht, stoppt es Docker, holt die Layer zurück, startet Docker neu
# und schaltet das Aussortieren ab, bis jemand nachgesehen hat – nachts um
# 04:00 muss also niemand reagieren.
# Den BuildKit-Cache schiebt es mit in den Papierkorb, weil er auf Layer
# zeigen kann, die zu keinem Image gehören; der nächste Build ist dann
# ungecacht.
cat > /usr/local/sbin/docker-layer-cleanup <<'EOF'
#!/usr/bin/env python3
"""
  docker-layer-cleanup move     Docker GESTOPPT. Verschiebt verwaiste Layer in den Papierkorb.
  docker-layer-cleanup plan     Wie move, ändert aber nichts.
  docker-layer-cleanup restore  Docker GESTOPPT. Holt den jüngsten Papierkorb zurück.
  docker-layer-cleanup purge    Löscht Papierkörbe, die älter als zwei Tage sind.
  docker-layer-cleanup verify   Nach dem Boot: laufen nicht alle Services, Layer automatisch zurückholen.
"""
import hashlib, json, os, re, shutil, subprocess, sys, time

KEEP_S = 2 * 86400
VERIFY_S = 15 * 60
# /run ist bei jedem Boot leer: die Datei gibt es nur, wenn dieser Boot verschoben hat.
MOVED = "/run/docker-layer-cleanup.moved"
STATE = "/var/lib/docker-layer-cleanup"
DISABLED = f"{STATE}/disabled"
DOWN_BEFORE = "/var/lib/docker-reboot-guard/down-before"


def read(path):
    with open(path) as f:
        return f.read().strip()


def config():
    try:
        return json.load(open("/etc/docker/daemon.json"))
    except (OSError, ValueError):
        return {}


CFG = config()
D = CFG.get("data-root") or CFG.get("graph") or "/var/lib/docker"
D = D.rstrip("/")
TRASH = D + "-trash"
L = f"{D}/image/overlay2/layerdb"
BASE = f"{L}/sha256"


def docker_running():
    for unit in ("docker.service", "docker.socket"):
        if subprocess.run(["systemctl", "is-active", "--quiet", unit]).returncode == 0:
            return True
    return False


def skip(msg):
    print("Nichts verschoben:", msg)
    sys.exit(0)


def parent_of(h):
    try:
        return read(f"{BASE}/{h}/parent").split(":")[1]
    except (OSError, IndexError):
        return None


def orphans():
    if CFG.get("features", {}).get("containerd-snapshotter"):
        skip("containerd-Image-Store aktiv, die Layer-Datenbank gilt hier nicht.")
    if CFG.get("storage-driver", "overlay2") != "overlay2" or not os.path.isdir(BASE):
        skip("kein overlay2.")
    hashes = [h for h in os.listdir(BASE) if not h.endswith("-removing")]
    if not hashes:
        skip("keine Layer.")

    # Layer, die zu einem Image gehören (chainID wie in der OCI-Spezifikation).
    used = set()
    imagedb = f"{D}/image/overlay2/imagedb/content/sha256"
    images = os.listdir(imagedb) if os.path.isdir(imagedb) else []
    if not images:
        skip("keine Images gefunden, die Prüfung wäre nicht verlässlich.")
    for f in images:
        try:
            diff_ids = json.load(open(f"{imagedb}/{f}"))["rootfs"]["diff_ids"]
        except (OSError, ValueError, KeyError, TypeError) as e:
            skip(f"Image {f[:12]} nicht lesbar ({e}).")
        chain = None
        for diff in diff_ids:
            chain = diff if chain is None else "sha256:" + hashlib.sha256(f"{chain} {diff}".encode()).hexdigest()
            used.add(chain.split(":")[1])
    # Container brauchen ihren Basis-Layer, auch wenn ihr Image schon weg ist.
    mounts = f"{L}/mounts"
    for m in os.listdir(mounts) if os.path.isdir(mounts) else []:
        p = None
        try:
            p = read(f"{mounts}/{m}/parent").split(":")[1]
        except (OSError, IndexError):
            pass
        if p:
            used.add(p)
    # Alles unter einem genutzten Layer ist auch genutzt.
    for h in list(used):
        p = parent_of(h)
        while p and p not in used:
            used.add(p)
            p = parent_of(p)

    rows = []
    for h in hashes:
        if h in used:
            continue
        try:
            rows.append((h, read(f"{BASE}/{h}/cache-id")))
        except OSError:
            rows.append((h, ""))
    orph = {h for h, _ in rows}
    cids = {c for _, c in rows if c}

    # Nichts, was bleibt, darf von etwas abhängen, das geht.
    for h in hashes:
        if h in orph:
            continue
        if parent_of(h) in orph:
            skip(f"Layer {h[:12]} hat einen verwaisten Layer als Eltern.")
        try:
            if read(f"{BASE}/{h}/cache-id") in cids:
                skip(f"Layer {h[:12]} teilt ein Verzeichnis mit einem verwaisten Layer.")
        except OSError:
            pass
    for m in os.listdir(mounts) if os.path.isdir(mounts) else []:
        for name in ("mount-id", "init-id"):
            try:
                if read(f"{mounts}/{m}/{name}") in cids:
                    skip(f"Container {m[:12]} nutzt ein verwaistes Verzeichnis.")
            except OSError:
                pass
    return rows


def size_gb(rows):
    total = 0
    for h, _ in rows:
        try:
            total += int(read(f"{BASE}/{h}/size") or 0)
        except (OSError, ValueError):
            pass
    return total / 1e9


def move(dry):
    if docker_running():
        skip("Docker läuft. Erst: systemctl stop docker.socket docker")
    if os.path.exists(DISABLED) and not dry:
        skip(f"abgeschaltet ({read(DISABLED)}). Nach dem Nachsehen: rm {DISABLED}")
    rows = orphans()
    if not rows:
        print("Keine verwaisten Layer.")
        return
    print(f"{len(rows)} verwaiste Layer, ca. {size_gb(rows):.1f} GB.")
    if dry:
        print("Probelauf, nichts geändert.")
        return
    dest = f"{TRASH}/{time.strftime('%Y%m%dT%H%M%S')}"
    os.makedirs(f"{dest}/layerdb", exist_ok=True)
    os.makedirs(f"{dest}/overlay2", exist_ok=True)
    if os.stat(dest).st_dev != os.stat(D).st_dev:
        shutil.rmtree(dest)
        skip(f"{TRASH} liegt nicht auf derselben Platte wie {D}.")
    if os.path.isdir(f"{D}/buildkit"):
        os.rename(f"{D}/buildkit", f"{dest}/buildkit")
    for h, cid in rows:
        # Erst der Datenbank-Eintrag: bricht der Lauf ab, bleibt nur ein
        # Verzeichnis liegen, das niemand mehr kennt.
        os.rename(f"{BASE}/{h}", f"{dest}/layerdb/{h}")
        if cid and os.path.isdir(f"{D}/overlay2/{cid}"):
            try:
                os.remove(f"{D}/overlay2/l/{read(f'{D}/overlay2/{cid}/link')}")
            except OSError:
                pass
            os.rename(f"{D}/overlay2/{cid}", f"{dest}/overlay2/{cid}")
    with open(MOVED, "w") as f:
        f.write(dest)
    print(f"Verschoben nach {dest}. Endgültig gelöscht wird nach zwei Tagen.")


def restore(src=None):
    if docker_running():
        sys.exit("Docker läuft. Erst: systemctl stop docker.socket docker")
    if src is None:
        runs = sorted(os.listdir(TRASH)) if os.path.isdir(TRASH) else []
        if not runs:
            sys.exit("Kein Papierkorb vorhanden.")
        src = f"{TRASH}/{runs[-1]}"
    for h in os.listdir(f"{src}/layerdb"):
        os.rename(f"{src}/layerdb/{h}", f"{BASE}/{h}")
    for cid in os.listdir(f"{src}/overlay2"):
        os.rename(f"{src}/overlay2/{cid}", f"{D}/overlay2/{cid}")
        try:
            os.symlink(f"../{cid}/diff", f"{D}/overlay2/l/{read(f'{D}/overlay2/{cid}/link')}")
        except OSError:
            pass
    if os.path.isdir(f"{src}/buildkit") and not os.path.exists(f"{D}/buildkit"):
        os.rename(f"{src}/buildkit", f"{D}/buildkit")
    shutil.rmtree(src)
    print(f"Zurückgeholt aus {src}.")


def services_down(ignore):
    """Swarm-Services unter Sollwert, oder None, wenn Docker nicht antwortet."""
    r = subprocess.run(["docker", "service", "ls", "--format", "{{.Name}} {{.Replicas}}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    down = []
    for line in r.stdout.splitlines():
        parts = line.split()
        m = re.match(r"(\d+)/(\d+)", parts[1]) if len(parts) > 1 else None
        if m and "completed" not in line and int(m[1]) < int(m[2]) and parts[0] not in ignore:
            down.append(parts[0])
    return down


def verify():
    if not os.path.exists(MOVED):
        return
    dest = read(MOVED)
    ignore = set()
    if os.path.exists(DOWN_BEFORE) and time.time() - os.path.getmtime(DOWN_BEFORE) < 86400:
        ignore = set(read(DOWN_BEFORE).split())
    deadline = time.time() + VERIFY_S
    down = None
    while time.time() < deadline:
        # Falls die Reaktivierung nach dem Drain aufgegeben hat: nochmal.
        if os.path.exists("/var/lib/docker-reboot-guard/drained"):
            subprocess.run(["/usr/local/sbin/docker-swarm-reactivate"], capture_output=True)
        down = services_down(ignore)
        if down == []:
            os.remove(MOVED)
            print("Alle Services laufen, die verschobenen Layer bleiben im Papierkorb.")
            return
        time.sleep(15)
    print(f"Nach {VERIFY_S // 60} min laufen nicht: {down if down is not None else 'Docker antwortet nicht'}.")
    print("Hole die Layer zurück und starte Docker neu.")
    subprocess.run(["systemctl", "stop", "docker.socket", "docker.service"])
    restore(dest)
    os.makedirs(STATE, exist_ok=True)
    with open(DISABLED, "w") as f:
        f.write(f"zurückgeholt am {time.strftime('%Y-%m-%d %H:%M')}")
    os.remove(MOVED)
    subprocess.run(["systemctl", "start", "docker.service"])
    print(f"Aussortieren abgeschaltet. Nach dem Nachsehen: rm {DISABLED}")


def purge():
    if not os.path.isdir(TRASH):
        return
    for run in sorted(os.listdir(TRASH)):
        path = f"{TRASH}/{run}"
        if time.time() - os.path.getmtime(path) > KEEP_S:
            shutil.rmtree(path, ignore_errors=True)
            print("Gelöscht:", path)


if os.geteuid() != 0:
    sys.exit("Bitte als root ausführen.")
mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode in ("move", "plan"):
    move(dry=(mode == "plan"))
elif mode == "restore":
    restore()
elif mode == "purge":
    purge()
elif mode == "verify":
    verify()
else:
    sys.exit(__doc__)
EOF
chmod 755 /usr/local/sbin/docker-layer-cleanup

cat > /etc/systemd/system/docker-layer-cleanup.service <<'EOF'
[Unit]
Description=Verwaiste Docker-Layer vor dem Docker-Start aussortieren
# Früh im Boot, noch vor docker.socket: sonst könnte ein Zugriff auf den
# Socket dockerd starten, während Layer verschoben werden.
DefaultDependencies=no
After=local-fs.target
Before=docker.service docker.socket shutdown.target
Conflicts=shutdown.target

[Service]
Type=oneshot
ExecStart=-/usr/local/sbin/docker-layer-cleanup move
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/docker-layer-verify.service <<'EOF'
[Unit]
Description=Nach dem Aussortieren prüfen, ob alle Services laufen, sonst zurückholen
After=docker.service docker-swarm-reactivate.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/docker-layer-cleanup verify

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/docker-layer-purge.service <<'EOF'
[Unit]
Description=Papierkorb der Docker-Layer nach zwei Tagen leeren

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/docker-layer-cleanup purge
Nice=19
IOSchedulingClass=idle
EOF

cat > /etc/systemd/system/docker-layer-purge.timer <<'EOF'
[Unit]
Description=Täglich alte Papierkörbe der Docker-Layer leeren

[Timer]
OnBootSec=1h
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl restart apt-daily-upgrade.timer
systemctl enable --now docker-restart-policy-fix.timer
systemctl enable --now docker-reboot-guard.service
systemctl enable docker-swarm-reactivate.service
systemctl enable docker-layer-cleanup.service docker-layer-verify.service
systemctl enable --now docker-layer-purge.timer
/usr/local/sbin/docker-restart-policy-fix || true

echo "Fertig auf $(hostname), Reboot-Zeit: ${REBOOT_TIME}"
systemctl list-timers apt-daily-upgrade.timer docker-restart-policy-fix.timer docker-layer-purge.timer --no-pager
