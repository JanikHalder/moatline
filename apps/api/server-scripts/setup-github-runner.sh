#!/usr/bin/env bash
# Turns this server into a build server for GitHub Actions: installs a
# self-hosted runner as an unprivileged user, as a systemd service with a
# memory cap and low priority, so a `next build` cannot starve the apps
# running next to it.
#
# The runner fetches jobs from GitHub itself — no port is opened, nothing on
# this server accepts commands from outside. Use it for PRIVATE repositories
# only: on a public repository anyone could run code here with a pull request.
set -euo pipefail

GH_URL=""
TOKEN=""
NAME="$(hostname)-build"
LABELS="self-hosted,linux,build"
MEMORY=""
DOCKER=true
RUNNER_USER="gh-runner"
RUNNER_DIR="/opt/actions-runner"

usage() {
    cat << USAGE
Usage: sudo ./setup-github-runner.sh --url URL --token TOKEN [OPTIONS]

  --url URL        https://github.com/ORG (all repos of the org) or
                   https://github.com/ORG/REPO
  --token TOKEN    Registration token: GitHub → Settings → Actions → Runners →
                   New self-hosted runner (valid for one hour, used once)
  --name NAME      Runner name (default: $NAME)
  --labels LIST    Comma-separated labels (default: $LABELS)
  --memory SIZE    Memory cap for all jobs, e.g. 6G (default: half the RAM)
  --no-docker      Do not add the runner to the docker group. Workflows then
                   cannot start service containers (no database for builds).
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --url) GH_URL="${2:-}"; shift 2 ;;
        --token) TOKEN="${2:-}"; shift 2 ;;
        --name) NAME="${2:-}"; shift 2 ;;
        --labels) LABELS="${2:-}"; shift 2 ;;
        --memory) MEMORY="${2:-}"; shift 2 ;;
        --no-docker) DOCKER=false; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[!] Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { echo "[!] Run as root (sudo)." >&2; exit 1; }
[[ "$GH_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?/?$ ]] || {
    echo "[!] --url must be https://github.com/ORG or https://github.com/ORG/REPO" >&2; exit 1; }
[[ "$TOKEN" =~ ^[A-Za-z0-9]{20,}$ ]] || { echo "[!] --token is missing or malformed." >&2; exit 1; }
[[ "$NAME" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "[!] --name: letters, digits, . _ - only." >&2; exit 1; }
[[ "$LABELS" =~ ^[A-Za-z0-9_.,-]+$ ]] || { echo "[!] --labels: comma-separated words only." >&2; exit 1; }
if [[ -n "$MEMORY" ]] && ! [[ "$MEMORY" =~ ^[0-9]+[MG]$ ]]; then
    echo "[!] --memory: e.g. 6G or 4096M" >&2; exit 1
fi

case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) echo "[!] Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

for tool in curl tar python3 sha256sum; do
    command -v "$tool" > /dev/null || { echo "[!] $tool is required." >&2; exit 1; }
done

echo "[*] Looking up the current runner release…"
RELEASE_JSON="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)"
read -r VERSION SHA << EOF
$(printf '%s' "$RELEASE_JSON" | python3 -c "
import json, re, sys
d = json.load(sys.stdin)
v = d['tag_name'].lstrip('v')
name = 'actions-runner-linux-$ARCH-' + v + '.tar.gz'
sha = next((a.get('digest', '').removeprefix('sha256:') for a in d['assets'] if a['name'] == name), '')
if not sha:
    m = re.search(r'BEGIN SHA linux-$ARCH -->([0-9a-f]{64})', d.get('body', ''))
    sha = m.group(1) if m else ''
print(v, sha)
")
EOF
[[ "$VERSION" =~ ^[0-9.]+$ && "$SHA" =~ ^[0-9a-f]{64}$ ]] || {
    echo "[!] Could not read the release version/checksum." >&2; exit 1; }
TARBALL="actions-runner-linux-$ARCH-$VERSION.tar.gz"

if ! id "$RUNNER_USER" &> /dev/null; then
    useradd --system --create-home --home-dir "/home/$RUNNER_USER" --shell /bin/bash "$RUNNER_USER"
    echo "[*] User $RUNNER_USER created (no sudo)."
fi
if $DOCKER; then
    if getent group docker > /dev/null; then
        usermod -aG docker "$RUNNER_USER"
        echo "[*] $RUNNER_USER is in the docker group — that is root on this server."
        echo "    Fine for a build server with private repositories; never for public ones."
    else
        echo "[!] No docker group — Docker is not installed. Workflows cannot start a database." >&2
    fi
fi

if [[ -f "$RUNNER_DIR/.runner" ]]; then
    echo "[*] A runner is already configured in $RUNNER_DIR — replacing it."
    if [[ -f "$RUNNER_DIR/svc.sh" ]]; then
        (cd "$RUNNER_DIR" && ./svc.sh stop || true; ./svc.sh uninstall || true)
    fi
    rm -f "$RUNNER_DIR/.runner" "$RUNNER_DIR/.credentials" "$RUNNER_DIR/.credentials_rsaparams" "$RUNNER_DIR/.service"
fi

mkdir -p "$RUNNER_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "[*] Downloading runner $VERSION…"
curl -fsSL -o "$TMP/$TARBALL" "https://github.com/actions/runner/releases/download/v$VERSION/$TARBALL"
echo "$SHA  $TMP/$TARBALL" | sha256sum -c - > /dev/null || { echo "[!] Checksum mismatch — aborted." >&2; exit 1; }
tar -xzf "$TMP/$TARBALL" -C "$RUNNER_DIR"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"

echo "[*] Installing runner dependencies…"
"$RUNNER_DIR/bin/installdependencies.sh" > /dev/null

echo "[*] Registering with GitHub as $NAME ($LABELS)…"
sudo -u "$RUNNER_USER" -H bash -c "cd '$RUNNER_DIR' && ./config.sh --unattended --replace \
    --url '$GH_URL' --token '$TOKEN' --name '$NAME' --labels '$LABELS' --work _work"

(cd "$RUNNER_DIR" && ./svc.sh install "$RUNNER_USER" > /dev/null)
SERVICE="$(cat "$RUNNER_DIR/.service")"

# Jobs run inside the service's cgroup: cap their memory and let them yield
# CPU and disk to everything else on the server.
if [[ -z "$MEMORY" ]]; then
    TOTAL_MB="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
    MEMORY="$((TOTAL_MB / 2))M"
fi
mkdir -p "/etc/systemd/system/$SERVICE.d"
cat > "/etc/systemd/system/$SERVICE.d/limits.conf" << LIMITS
[Service]
MemoryHigh=$MEMORY
MemoryMax=$MEMORY
Nice=10
IOSchedulingClass=idle
LIMITS
systemctl daemon-reload
(cd "$RUNNER_DIR" && ./svc.sh start > /dev/null)

echo
echo "[✓] Runner $NAME is online: $SERVICE (memory cap $MEMORY)."
echo "    Workflows use it with: runs-on: [self-hosted, linux, build]"
echo "    Service containers (databases) run in Docker, outside this cap."
