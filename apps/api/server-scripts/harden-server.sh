#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

SSH_PORT=22
SSH_KEY=""
SSH_KEY_FILE=""
TARGET_USER=""
SKIP_SSH_KEY=false
SSHD_CONFIG="/etc/ssh/sshd_config"
AUTHORIZED_KEYS_DIR=""
FAIL2BAN_BANTIME="1w"
FAIL2BAN_FINDTIME="10m"
FAIL2BAN_MAXRETRY=3
EXTRA_PORTS=()
TRUSTED_IPS=()
SKIP_SWAP=false
# Empty = size from RAM (see recommended_swap_mb). Examples: 2G, 4096M.
SWAP_SIZE=""
SWAPFILE="/swapfile"
# Same files as the monitoring agent (pc-agent --trust-ip).
TRUSTED_FAIL2BAN="/etc/fail2ban/jail.d/trusted-ips.local"
TRUSTED_CROWDSEC="/etc/crowdsec/parsers/s02-enrich/trusted-ips.yaml"

usage() {
    cat << 'EOF'
Usage: sudo ./harden-server.sh [OPTIONS]

Secures the server: UFW firewall, SSH key-only auth (optional), fail2ban, swap.
Safe for existing servers: UFW not installed → install and set desired ports; UFW
installed with no rules → add desired ports; UFW already has rules → show only.
Swap: none active → create /swapfile from RAM size; already active → show only.
SSH: if key passed, add and disable password; if key present, disable password;
if no key, leave password login enabled.

OPTIONS:
  --key "ssh-rsa AAAA..."     Add this public key and disable password login
  --key-file /path/to/key.pub Use public key from file (disables password login)
  --user USER                 User for authorized_keys (default: $SUDO_USER or root)
  --ssh-port PORT             SSH port (default: 22). Allow this port in firewall.
  --skip-ssh-key              Only set up firewall, fail2ban and swap; do not change SSH auth
  --skip-swap                 Do not create or change swap
  --swap-size SIZE            Swap file size (default: from RAM). Examples: 2G, 4096M
  --allow-port PORT[,PORT...] Allow extra TCP port(s) in UFW (standard: 80, 443)
  --bantime TIME              fail2ban bantime (default: 1w). Examples: 1h, 1d, 1w
  --maxretry N                fail2ban maxretry (default: 3)
  --trust-ip IP[,IP...]       Never ban these addresses (your office) in fail2ban
                              and CrowdSec; networks up to /24 (IPv4) or /48 (IPv6)
  -h, --help                  Show this help

Examples:
  sudo ./harden-server.sh --key-file ~/.ssh/id_ed25519.pub --user deploy
  sudo ./harden-server.sh --allow-port 3000
  sudo ./harden-server.sh --key "$(cat ~/.ssh/id_ed25519.pub)" --ssh-port 2222
  sudo ./harden-server.sh --skip-ssh-key --trust-ip 203.0.113.7
  sudo ./harden-server.sh --swap-size 2G
EOF
}

require_root() {
    if [[ ${EUID:-0} -ne 0 ]]; then
        echo "Dieses Skript muss als root ausgeführt werden (z.B. sudo)." >&2
        exit 1
    fi
}

detect_platform() {
    if command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v yum &>/dev/null; then
        echo "yum"
    else
        echo "Unbekannte Plattform. Nur apt/dnf/yum werden unterstützt." >&2
        exit 1
    fi
}

install_pkg() {
    local platform="$1"
    shift
    case "$platform" in
        apt) DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y -qq "$@" ;;
        dnf) dnf install -y "$@" ;;
        yum) yum install -y "$@" ;;
        *) exit 1 ;;
    esac
}

ufw_installed() {
    command -v ufw &>/dev/null || dpkg -l ufw &>/dev/null || rpm -q ufw &>/dev/null
}

ufw_has_rules() {
    ufw status 2>/dev/null | grep -E '[0-9]+/tcp|[0-9]+/udp' | grep -q ALLOW
}

get_ports_list() {
    local port="$1"
    local list="$port 80 443"
    local p
    for p in "${EXTRA_PORTS[@]}"; do
        [[ -n "$p" ]] && list="$list ${p// }"
    done
    echo "$list"
}

ufw_add_desired_ports() {
    local port="$1"
    ufw allow "$port"/tcp comment 'SSH'
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    local p
    for p in "${EXTRA_PORTS[@]}"; do
        [[ -z "$p" ]] && continue
        ufw allow "${p// }"/tcp comment "App port $p"
    done
}

setup_ufw() {
    local port="$1"
    if ! ufw_installed; then
        echo "[*] UFW war nicht installiert – installieren und gewünschte Ports setzen ..."
        install_pkg "$PLATFORM" ufw 2>/dev/null || true
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow from 127.0.0.1
        ufw_add_desired_ports "$port"
        ufw --force enable
        ufw status verbose
        echo "[*] UFW installiert und Ports eingerichtet: $(get_ports_list "$port")"
        return 0
    fi
    if ufw_has_rules; then
        echo "[*] UFW ist installiert und hat bereits Regeln – nur Anzeige (keine Änderung):"
        ufw status verbose
        return 0
    fi
    echo "[*] UFW vorhanden, noch keine Ports – gewünschte Ports freigeben ..."
    ufw_add_desired_ports "$port"
    ufw --force enable 2>/dev/null || true
    ufw status verbose
    echo "[*] UFW-Ports eingerichtet: $(get_ports_list "$port")"
}

read_ssh_key() {
    if [[ -n "$SSH_KEY" ]]; then
        echo "$SSH_KEY"
        return
    fi
    if [[ -n "$SSH_KEY_FILE" ]] && [[ -f "$SSH_KEY_FILE" ]]; then
        cat "$SSH_KEY_FILE"
        return
    fi
    echo ""
}

has_ssh_key() {
    local user="${1:-}"
    [[ -z "$user" ]] && return 1
    local home
    home="$(getent passwd "$user" 2>/dev/null | cut -d: -f6)"
    [[ -z "$home" ]] && return 1
    local auth_keys="$home/.ssh/authorized_keys"
    [[ ! -f "$auth_keys" ]] && return 1
    grep -E "^[^#]" "$auth_keys" 2>/dev/null | grep -q . || return 1
    return 0
}

apply_ssh_harden_disable_password() {
    cp -a "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
    local tmp_config
    tmp_config="$(mktemp)"
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*#.*(Port|PasswordAuthentication|PubkeyAuthentication|PermitRootLogin|ChallengeResponseAuthentication|UsePAM|KbdInteractiveAuthentication) ]]; then
            continue
        fi
        if [[ "$line" =~ ^[[:space:]]*(Port|PasswordAuthentication|PubkeyAuthentication|PermitRootLogin|ChallengeResponseAuthentication|UsePAM|KbdInteractiveAuthentication)[[:space:]]+ ]]; then
            continue
        fi
        echo "$line"
    done < "$SSHD_CONFIG" > "$tmp_config"

    cat >> "$tmp_config" << SSHD_EXTRA

# Hardened by harden-server.sh
Port $SSH_PORT
PubkeyAuthentication yes
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitRootLogin prohibit-password
SSHD_EXTRA

    local backup
    backup="$(ls -1t "${SSHD_CONFIG}".bak.* | head -n1)"
    mv "$tmp_config" "$SSHD_CONFIG"
    chmod 600 "$SSHD_CONFIG"

    # Ubuntu/Debian include /etc/ssh/sshd_config.d/*.conf at the top of
    # sshd_config, and sshd keeps the FIRST value it reads. Cloud images
    # ship drop-ins like 50-cloud-init.conf with "PasswordAuthentication yes"
    # that would beat the lines above — so the same settings go into a
    # drop-in that sorts first.
    local dropin=""
    if [[ -d /etc/ssh/sshd_config.d ]] && grep -qiE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' "$SSHD_CONFIG"; then
        dropin="/etc/ssh/sshd_config.d/00-harden-server.conf"
        cat > "$dropin" << SSHD_DROPIN
# Hardened by harden-server.sh — loaded before every other drop-in.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
SSHD_DROPIN
        chmod 644 "$dropin"
        local other
        for other in /etc/ssh/sshd_config.d/*.conf; do
            [[ "$other" == "$dropin" ]] && continue
            if grep -qiE '^[[:space:]]*(PasswordAuthentication[[:space:]]+yes|PermitRootLogin[[:space:]]+yes)' "$other" 2>/dev/null; then
                echo "[*] $other erlaubt Passwörter/Root — wird von $dropin übersteuert."
            fi
        done
    fi

    if sshd -t 2>/dev/null; then
        systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh restart
        local effective
        effective="$(sshd -T 2>/dev/null | grep -iE '^(passwordauthentication|permitrootlogin) ' | tr '\n' ' ')"
        echo "[*] SSH: Nur Schlüssel-Login, Passwort-Login deaktiviert. Wirksam: ${effective:-unbekannt}"
    else
        echo "[!] sshd -t fehlgeschlagen. Stelle Backup wieder her." >&2
        [[ -n "$dropin" ]] && rm -f "$dropin"
        [[ -n "$backup" ]] && cp -a "$backup" "$SSHD_CONFIG"
        exit 1
    fi
}

setup_ssh_key_and_disable_password() {
    if [[ -z "$TARGET_USER" ]]; then
        TARGET_USER="${SUDO_USER:-root}"
    fi

    local key_content
    key_content="$(read_ssh_key)"
    local add_key=false
    local do_harden=false

    if [[ -n "$key_content" ]]; then
        add_key=true
        do_harden=true
    elif has_ssh_key "$TARGET_USER"; then
        do_harden=true
    else
        echo "[*] Kein SSH-Schlüssel übergeben und keiner für $TARGET_USER vorhanden. Passwort-Login bleibt aktiv."
        return 0
    fi

    local home
    home="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    AUTHORIZED_KEYS_DIR="$home/.ssh"
    local auth_keys="$AUTHORIZED_KEYS_DIR/authorized_keys"

    if [[ "$add_key" == true ]]; then
        mkdir -p "$AUTHORIZED_KEYS_DIR"
        chown "$TARGET_USER:$TARGET_USER" "$AUTHORIZED_KEYS_DIR"
        chmod 700 "$AUTHORIZED_KEYS_DIR"
        if [[ -f "$auth_keys" ]]; then
            if grep -qF "$key_content" "$auth_keys" 2>/dev/null; then
                echo "[*] Schlüssel bereits in $auth_keys vorhanden."
            else
                echo "$key_content" >> "$auth_keys"
                chown "$TARGET_USER:$TARGET_USER" "$auth_keys"
                chmod 600 "$auth_keys"
                echo "[*] Schlüssel zu $auth_keys hinzugefügt."
            fi
        else
            echo "$key_content" >> "$auth_keys"
            chown "$TARGET_USER:$TARGET_USER" "$auth_keys"
            chmod 600 "$auth_keys"
            echo "[*] $auth_keys erstellt und Schlüssel hinzugefügt."
        fi
        echo ""
        echo "*** WICHTIG: Behalte diese Sitzung offen und teste in einem NEUEN Terminal: ssh -p $SSH_PORT $TARGET_USER@<server> ***"
        echo ""
    fi

    if [[ "$do_harden" == true ]]; then
        apply_ssh_harden_disable_password
    fi
}

setup_fail2ban() {
    echo "[*] Fail2ban einrichten ..."
    install_pkg "$PLATFORM" fail2ban 2>/dev/null || true

    local jail_d="/etc/fail2ban/jail.d"
    local override="$jail_d/harden-server.conf"
    mkdir -p "$jail_d"
    cat > "$override" << EOF
[DEFAULT]
bantime = $FAIL2BAN_BANTIME
findtime = $FAIL2BAN_FINDTIME
maxretry = $FAIL2BAN_MAXRETRY

[sshd]
enabled = true
port = $SSH_PORT
filter = sshd
logpath = %(sshd_log)s
backend = %(sshd_backend)s
EOF

    if [[ ${#TRUSTED_IPS[@]} -gt 0 ]]; then
        printf '[DEFAULT]\nignoreip = 127.0.0.1/8 ::1 %s\n' "${TRUSTED_IPS[*]}" > "$TRUSTED_FAIL2BAN"
    fi

    systemctl enable fail2ban 2>/dev/null || true
    systemctl restart fail2ban 2>/dev/null || service fail2ban restart
    echo "[*] Fail2ban aktiv (sshd, bantime=$FAIL2BAN_BANTIME, maxretry=$FAIL2BAN_MAXRETRY)."
    if [[ ${#TRUSTED_IPS[@]} -gt 0 ]]; then
        for ip in "${TRUSTED_IPS[@]}"; do
            [[ "$ip" == */* ]] || fail2ban-client unban "$ip" &>/dev/null || true
        done
        echo "[*] Fail2ban sperrt nie: ${TRUSTED_IPS[*]}"
    fi
}

# Without this, a few failed SSH logins from the office lock it out of SSH
# and — through CrowdSec's bouncer on the Docker ports — every website on
# the server.
trust_ips_in_crowdsec() {
    [[ ${#TRUSTED_IPS[@]} -gt 0 ]] || return 0
    command -v cscli &>/dev/null || return 0
    local ips="" cidrs=""
    for ip in "${TRUSTED_IPS[@]}"; do
        if [[ "$ip" == */* ]]; then cidrs+="    - \"$ip\"\n"; else ips+="    - \"$ip\"\n"; fi
    done
    mkdir -p "$(dirname "$TRUSTED_CROWDSEC")"
    {
        printf 'name: local/trusted-ips\n'
        printf 'description: "Own addresses (--trust-ip) – never ban"\n'
        printf 'whitelist:\n  reason: "trusted (--trust-ip)"\n'
        if [[ -n "$ips" ]]; then printf '  ip:\n%b' "$ips"; fi
        if [[ -n "$cidrs" ]]; then printf '  cidr:\n%b' "$cidrs"; fi
    } > "$TRUSTED_CROWDSEC"
    systemctl reload-or-restart crowdsec 2>/dev/null || true
    for ip in "${TRUSTED_IPS[@]}"; do
        if [[ "$ip" == */* ]]; then
            cscli decisions delete --range "$ip" &>/dev/null || true
        else
            cscli decisions delete --ip "$ip" &>/dev/null || true
        fi
    done
    echo "[*] CrowdSec sperrt nie: ${TRUSTED_IPS[*]}"
}

valid_trusted_ip() {
    local ip="$1"
    [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/(2[4-9]|3[0-2]))?$ ]] && return 0
    [[ "$ip" == *:* && "$ip" =~ ^[0-9a-fA-F:]+(/(4[89]|[5-9][0-9]|1[01][0-9]|12[0-8]))?$ ]] && return 0
    return 1
}

enable_automatic_security_updates() {
    echo "[*] Automatische Sicherheits-Updates (optional) ..."
    if [[ "$PLATFORM" == "apt" ]]; then
        install_pkg apt unattended-upgrades 2>/dev/null || true
        if [[ -d /etc/apt/apt.conf.d ]]; then
            echo 'APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null || true
        fi
    fi
}

# ≤2 GiB RAM → 2× RAM; ≤8 GiB → 1× RAM; above that a fixed 4 GiB is enough
# headroom for builds and spikes without eating the disk on large hosts.
recommended_swap_mb() {
    local ram_kb ram_mb
    ram_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
    ram_mb=$((ram_kb / 1024))
    if ((ram_mb <= 2048)); then
        echo $((ram_mb * 2))
    elif ((ram_mb <= 8192)); then
        echo "$ram_mb"
    else
        echo 4096
    fi
}

# Accepts 2G, 4096M or a bare MiB number.
parse_swap_mb() {
    local s="$1"
    if [[ "$s" =~ ^([0-9]+)[Gg]$ ]]; then
        echo $((BASH_REMATCH[1] * 1024))
    elif [[ "$s" =~ ^([0-9]+)[Mm]$ ]]; then
        echo "${BASH_REMATCH[1]}"
    elif [[ "$s" =~ ^[0-9]+$ ]]; then
        echo "$s"
    else
        return 1
    fi
}

setup_swap() {
    if [[ "$SKIP_SWAP" == true ]]; then
        echo "[*] Swap übersprungen (--skip-swap)."
        return 0
    fi

    if swapon --show --noheadings 2>/dev/null | grep -q .; then
        echo "[*] Swap ist bereits aktiv – nur Anzeige (keine Änderung):"
        swapon --show
        return 0
    fi

    local size_mb
    if [[ -n "$SWAP_SIZE" ]]; then
        if ! size_mb="$(parse_swap_mb "$SWAP_SIZE")"; then
            echo "[!] --swap-size ungültig (z.B. 2G oder 4096M): $SWAP_SIZE — Swap unverändert." >&2
            return 0
        fi
    else
        size_mb="$(recommended_swap_mb)"
    fi
    if ((size_mb < 256)); then
        echo "[!] Swap-Größe ${size_mb} MiB ist zu klein — minimum 256 MiB. Swap unverändert." >&2
        return 0
    fi

    local avail_kb need_kb
    avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
    # Leave ~1 GiB free on / after creating the file.
    need_kb=$((size_mb * 1024 + 1024 * 1024))
    if [[ -n "$avail_kb" ]] && ((avail_kb < need_kb)); then
        echo "[!] Nicht genug freier Speicher auf / für ${size_mb} MiB Swap (plus 1 GiB Reserve) — Swap unverändert." >&2
        return 0
    fi

    echo "[*] Swap einrichten: ${size_mb} MiB in $SWAPFILE ..."
    if [[ -e "$SWAPFILE" ]]; then
        # Leftover from a previous attempt — replace rather than risk a half file.
        swapoff "$SWAPFILE" 2>/dev/null || true
        rm -f "$SWAPFILE"
    fi

    if ! fallocate -l "${size_mb}M" "$SWAPFILE" 2>/dev/null; then
        dd if=/dev/zero of="$SWAPFILE" bs=1M count="$size_mb" status=progress
    fi
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE" >/dev/null
    swapon "$SWAPFILE"

    if ! grep -qE "^[[:space:]]*${SWAPFILE}[[:space:]]" /etc/fstab 2>/dev/null; then
        echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
    fi

    # Prefer RAM; swap is a safety net for spikes and builds, not a second heap.
    sysctl -w vm.swappiness=10 >/dev/null
    mkdir -p /etc/sysctl.d
    echo "vm.swappiness=10" > /etc/sysctl.d/99-harden-server-swap.conf

    swapon --show
    echo "[*] Swap aktiv: ${size_mb} MiB ($SWAPFILE), swappiness=10."
}

main() {
    local args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --key)
                SSH_KEY="${2:-}"
                shift 2
                ;;
            --key-file)
                SSH_KEY_FILE="${2:-}"
                shift 2
                ;;
            --user)
                TARGET_USER="${2:-}"
                shift 2
                ;;
            --ssh-port)
                SSH_PORT="${2:-22}"
                shift 2
                ;;
            --skip-ssh-key)
                SKIP_SSH_KEY=true
                shift
                ;;
            --skip-swap)
                SKIP_SWAP=true
                shift
                ;;
            --swap-size)
                SWAP_SIZE="${2:-}"
                shift 2
                ;;
            --allow-port)
                local ports="${2:-}"
                shift 2
                IFS=',' read -ra PARTS <<< "$ports"
                for p in "${PARTS[@]}"; do
                    p="${p//[[:space:]]/}"
                    [[ -n "$p" ]] && EXTRA_PORTS+=("$p")
                done
                ;;
            --trust-ip)
                local list="${2:-}"
                shift 2
                IFS=', ' read -ra PARTS <<< "$list"
                for ip in "${PARTS[@]}"; do
                    [[ -n "$ip" ]] || continue
                    if ! valid_trusted_ip "$ip"; then
                        echo "--trust-ip: keine gültige Adresse oder zu großes Netz (max. /24 bzw. /48): $ip" >&2
                        exit 1
                    fi
                    TRUSTED_IPS+=("$ip")
                done
                ;;
            --bantime)
                FAIL2BAN_BANTIME="${2:-1w}"
                shift 2
                ;;
            --maxretry)
                FAIL2BAN_MAXRETRY="${2:-3}"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "Unbekannte Option: $1" >&2
                usage
                exit 1
                ;;
        esac
    done

    require_root
    PLATFORM="$(detect_platform)"

    setup_ufw "$SSH_PORT"
    if [[ "$SKIP_SSH_KEY" != true ]]; then
        setup_ssh_key_and_disable_password
    fi
    setup_fail2ban
    trust_ips_in_crowdsec
    enable_automatic_security_updates
    setup_swap

    echo ""
    echo "[*] Grundhärtung abgeschlossen. Prüfe Fail2ban-Status: fail2ban-client status sshd"
}

main "$@"
