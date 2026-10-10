#!/usr/bin/env python3
# SPDX-License-Identifier: MIT — see LICENSE next to this file.
"""
Moatline server agent.

Collects what only the server itself can see and pushes it to Moatline:

  * load, memory and disk usage                      (every 5 minutes)
  * pending OS updates, security updates, reboot     (every 5 minutes)
  * CrowdSec health: LAPI, bouncers, attacks blocked (every 5 minutes)
  * Trivy: vulnerabilities in the OS packages and in
    the images of the running containers             (daily)
  * object storage (MinIO, Garage, SeaweedFS, …) and
    folders to watch: size, biggest buckets          (hourly)

Design rules, because this runs as root on production servers:

  * Push only. The agent opens no port and accepts no commands; the server it
    reports to cannot make it do anything. Its token can only submit reports.
  * Standard library only (Python 3.8+). Nothing to install, nothing to audit
    beyond this file. The installer prints its SHA-256 so it can be compared
    with the copy in the repository.
  * TLS is verified. Plain http is refused, except to a Tailscale address
    (100.64.0.0/10, *.ts.net): that traffic is already WireGuard-encrypted.
  * The systemd units drop every capability except reading files, make the
    system read-only, and cap CPU/memory so monitoring never becomes the load.

Usage:
  curl -fsSL <url>/api/agent/install.sh | sudo bash -s -- --enroll pce_… --trivy --crowdsec --auto-updates
  sudo python3 pc-agent.py install --url https://checker.example.com [--enroll pce_…]
  curl -fsSL <url>/api/agent/install.sh | sudo bash      (update: keeps token and settings)
  python3 pc-agent.py report metrics|full [--dry-run]
  sudo python3 pc-agent.py uninstall
"""

import argparse
import fcntl
import getpass
import hashlib
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone

VERSION = "1.18.0"
CONFIG_PATH = "/etc/pc-agent/config.json"
INSTALL_DIR = "/usr/local/lib/pc-agent"
CACHE_DIR = "/var/cache/pc-agent"
UNIT_DIR = "/etc/systemd/system"
MAX_BODY = 7 * 1024 * 1024  # the API accepts 8 MB
DEFAULT_SEVERITY = "MEDIUM,HIGH,CRITICAL"

# Filesystems that hold data. Everything else in /proc/mounts (proc, tmpfs,
# overlay layers of containers, squashfs snaps) is either virtual or a copy.
REAL_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "jfs", "reiserfs", "vfat", "exfat", "ntfs3"}
SKIP_MOUNT_PREFIXES = ("/snap/", "/var/lib/docker/", "/var/lib/containerd/", "/run/", "/proc/", "/sys/")


def log(msg):
    print(f"[pc-agent] {msg}", file=sys.stderr)


def run(cmd, timeout=120, ok_codes=(0,)):
    """Run a command; return (returncode, stdout, stderr). Never raises."""
    try:
        p = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env={**os.environ, "LC_ALL": "C", "LANG": "C"},
        )
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, "", f"{cmd[0]} timed out after {timeout}s"
    except Exception as e:  # noqa: BLE001 – a collector must never crash the report
        return 1, "", str(e)


def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def clip(s, n):
    if s is None:
        return None
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- host


def os_name():
    data = read("/etc/os-release") or ""
    m = re.search(r'^PRETTY_NAME="?([^"\n]*)"?', data, re.M)
    return m.group(1) if m else platform.platform()


def meminfo():
    data = read("/proc/meminfo") or ""
    vals = {}
    for line in data.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            vals[parts[0].rstrip(":")] = int(parts[1]) * 1024
    return vals


def disks():
    out, seen = [], set()
    for line in (read("/proc/mounts") or "").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        device, mount, fstype = parts[0], parts[1].replace("\\040", " "), parts[2]
        if fstype not in REAL_FS or mount.startswith(SKIP_MOUNT_PREFIXES) or device in seen:
            continue
        # Bind mounts of single files (containers, /etc/hosts) are not disks.
        if not os.path.isdir(mount):
            continue
        seen.add(device)
        try:
            st = os.statvfs(mount)
        except OSError:
            continue
        used = (st.f_blocks - st.f_bfree) * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        # Same basis as `df`: the blocks reserved for root do not count as
        # free, because a full disk for every service is full in practice.
        total = used + avail
        if total <= 0:
            continue
        out.append({"mount": clip(mount, 300), "fsType": fstype, "totalBytes": total, "usedBytes": used})
    return out[:100]


CPU_SNAPSHOT = os.path.join(CACHE_DIR, "cpu.json")


def cpu_times():
    """Aggregate jiffies from /proc/stat: (total, idle, iowait, steal)."""
    first = (read("/proc/stat") or "").split("\n", 1)[0].split()
    if len(first) < 5 or first[0] != "cpu":
        return None
    vals = [int(v) for v in first[1:9] if v.isdigit()]
    vals += [0] * (8 - len(vals))
    # user nice system idle iowait irq softirq steal (guest is inside user)
    return sum(vals), vals[3], vals[4], vals[7]


def cpu_usage():
    """
    Real CPU utilization across all cores since the last report (~5 min),
    as % of the whole machine. The load average is not that: it counts
    processes waiting for the disk too, so a backup or an image pull shows
    as 150 % "CPU" on an idle machine.
    """
    now = cpu_times()
    if not now:
        return None
    prev = None
    try:
        with open(CPU_SNAPSHOT, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if time.time() - saved.get("at", 0) < 3600:
            prev = saved.get("times")
    except (OSError, ValueError):
        pass
    if not prev or now[0] - prev[0] <= 0:
        time.sleep(1)
        prev, now = now, cpu_times() or now
    try:
        fd = os.open(CPU_SNAPSHOT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"at": time.time(), "times": list(now)}, f)
    except OSError:
        pass
    total = now[0] - prev[0]
    if total <= 0:
        return None
    idle, iowait, steal = (now[i] - prev[i] for i in (1, 2, 3))
    return {
        "usagePct": round(max(0.0, (total - idle - iowait) / total * 100), 1),
        "iowaitPct": round(max(0.0, iowait / total * 100), 1),
        "stealPct": round(max(0.0, steal / total * 100), 1),
    }


def collect_host():
    mem = meminfo()
    uptime = read("/proc/uptime")
    try:
        load = list(os.getloadavg())
    except OSError:
        load = [0.0, 0.0, 0.0]
    return {
        "hostname": clip(socket.gethostname(), 255),
        "os": clip(os_name(), 255),
        "kernel": clip(platform.release(), 255),
        "uptimeSeconds": float(uptime.split()[0]) if uptime else None,
        "cpuCount": os.cpu_count() or 1,
        "load": load,
        "cpu": cpu_usage(),
        "memory": {"totalBytes": mem.get("MemTotal", 0), "availableBytes": mem.get("MemAvailable", mem.get("MemFree", 0))},
        "swap": {"totalBytes": mem.get("SwapTotal", 0), "freeBytes": mem.get("SwapFree", 0)} if mem else None,
        "disks": disks(),
        "dockerVersion": docker_version(),
        "oom": collect_oom(),
    }


OOM_VICTIM = re.compile(r"Killed process (\d+) \(([^)]{1,64})\)")


def collect_oom():
    """
    The kernel's OOM kills: the counter since boot (/proc/vmstat, readable by
    anyone) and the processes it killed in the last quarter hour (the
    kernel log, when readable). A full server kills whatever is biggest —
    often the app while a build eats the memory.
    """
    count = None
    for line in (read("/proc/vmstat") or "").splitlines():
        if line.startswith("oom_kill "):
            try:
                count = int(line.split()[1])
            except ValueError:
                pass
    victims = []
    if shutil.which("journalctl"):
        code, out, _ = run(["journalctl", "-k", "--since", "-15min", "--no-pager", "-o", "short-iso"], timeout=20)
        if code == 0:
            for line in out.splitlines():
                m = OOM_VICTIM.search(line)
                if m:
                    victims.append({"at": clip(line.split(" ", 1)[0], 40), "pid": int(m.group(1)), "process": clip(m.group(2), 64)})
    return {"kills": count, "victims": victims[-20:]}


def docker_version():
    """Docker Engine version, for the server version overview."""
    if not shutil.which("docker"):
        return None
    code, out, _ = run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=15)
    return clip(out.strip(), 50) if code == 0 and out.strip() else None


# ---------------------------------------------------------------- updates


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


UU_LOG = "/var/log/unattended-upgrades/unattended-upgrades.log"


def next_timer_run(unit):
    """Next elapse of a systemd timer as ISO time, or None."""
    code, out, _ = run(["systemctl", "list-timers", unit, "--all", "--no-pager", "-o", "json"], timeout=15)
    if code == 0:
        try:
            for t in json.loads(out or "[]"):
                if t.get("unit") == unit and t.get("next"):
                    return iso(int(t["next"]) / 1_000_000)
        except (ValueError, TypeError):
            pass
    # systemd < 251 has no JSON output: parse "Fri 2026-10-02 03:02:11 UTC".
    code, out, _ = run(["systemctl", "show", unit, "-p", "NextElapseUSecRealtime", "--value"], timeout=15)
    m = re.search(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+)", out or "")
    if code == 0 and m and m.group(2) == "UTC":
        return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
    return None


def unattended_status():
    """
    When unattended-upgrades last ran and how it went, and when it runs next.
    Without this, "security updates pending" cannot tell "will be installed
    tonight" from "automatic updates have been broken for a week".
    """
    status = {"lastRunAt": None, "lastResult": "unknown", "lastError": None, "nextRunAt": None, "rebootScheduledAt": None}
    log_text = read(UU_LOG)
    if log_text:
        lines = log_text.splitlines()[-2000:]
        starts = [i for i, l in enumerate(lines) if "Starting unattended upgrades script" in l]
        if starts:
            last = lines[starts[-1]:]
            m = re.match(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", last[0])
            if m:
                # The log is written in the server's local time.
                local = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").astimezone()
                status["lastRunAt"] = local.astimezone(timezone.utc).isoformat()
            errors = [l for l in last if " ERROR " in l or "Traceback" in l]
            status["lastResult"] = "error" if errors else "ok"
            if errors:
                status["lastError"] = clip(" | ".join(e.split(" ERROR ", 1)[-1] for e in errors[:3]), 500)
    status["nextRunAt"] = next_timer_run("apt-daily-upgrade.timer")
    # A reboot that unattended-upgrades scheduled (shutdown -r HH:MM).
    sched = read("/run/systemd/shutdown/scheduled")
    m = re.search(r"^USEC=(\d+)", sched or "", re.M)
    if m:
        status["rebootScheduledAt"] = iso(int(m.group(1)) / 1_000_000)
    return status


def apt_updates():
    # A simulated dist-upgrade lists every package that would change, with the
    # archive it comes from. No lock, no cache file written: this works on a
    # read-only filesystem and never interferes with a running apt.
    code, out, err = run(
        [
            "apt-get", "-s", "-q", "-o", "Debug::NoLocking=true",
            "-o", "Dir::Cache::pkgcache=", "-o", "Dir::Cache::srcpkgcache=",
            "dist-upgrade",
        ],
        timeout=180,
    )
    result = {"manager": "apt", "pending": 0, "security": 0, "packages": []}
    if code != 0:
        result["error"] = clip(err.strip() or f"apt-get exited with {code}", 500)
    for line in out.splitlines():
        m = re.match(r"^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+) (.*)\)", line)
        if not m:
            continue
        name, current, candidate, origin = m.groups()
        security = "security" in origin.lower()
        result["pending"] += 1
        if security:
            result["security"] += 1
        if len(result["packages"]) < 500:
            result["packages"].append({"name": clip(name, 200), "current": clip(current, 100), "candidate": clip(candidate, 100), "security": security})
    result["rebootRequired"] = os.path.exists("/var/run/reboot-required")
    if result["rebootRequired"]:
        try:
            result["rebootRequiredSince"] = iso(os.path.getmtime("/var/run/reboot-required"))
        except OSError:
            pass
        pkgs = (read("/var/run/reboot-required.pkgs") or "").split()
        result["rebootPackages"] = [clip(p, 200) for p in dict.fromkeys(pkgs)][:50]
    result["unattended"] = unattended_status()
    code, out, _ = run(["apt-config", "dump"], timeout=30)
    if code == 0:
        m = re.search(r'^APT::Periodic::Unattended-Upgrade "(\d+)";', out, re.M)
        result["autoUpdates"] = bool(m and m.group(1) != "0")
        # Whether unattended-upgrades may reboot by itself — without it a
        # needed reboot waits forever, and "reboot required" never clears.
        def flag(name):
            m = re.search(r'^Unattended-Upgrade::%s "([^"]*)";' % name, out, re.M)
            return m.group(1) if m else None
        result["autoReboot"] = {
            "enabled": (flag("Automatic-Reboot") or "false").lower() == "true",
            "time": flag("Automatic-Reboot-Time"),
            "withUsers": (flag("Automatic-Reboot-WithUsers") or "true").lower() == "true",
        }
        # Logged-in users block the reboot when WithUsers is false.
        if not result["autoReboot"]["withUsers"]:
            code_w, who, _ = run(["who"], timeout=10)
            result["autoReboot"]["usersLoggedIn"] = len([l for l in who.splitlines() if l.strip()]) if code_w == 0 else None
    stamp = "/var/lib/apt/periodic/update-success-stamp"
    lists = "/var/lib/apt/lists"
    try:
        mtime = os.path.getmtime(stamp) if os.path.exists(stamp) else max(
            os.path.getmtime(os.path.join(lists, f)) for f in os.listdir(lists) if f.endswith("Packages") or f.endswith("Release")
        )
        result["listsAgeHours"] = max(0.0, (time.time() - mtime) / 3600)
    except (OSError, ValueError):
        pass
    return result


def dnf_updates():
    tool = "dnf" if shutil.which("dnf") else "yum"
    # -C: answer from the cache, no network and no metadata writes.
    code, out, err = run([tool, "-q", "-C", "check-update"], timeout=180)
    result = {"manager": tool, "pending": 0, "security": 0, "packages": []}
    if code not in (0, 100):
        result["error"] = clip(err.strip() or f"{tool} exited with {code}", 500)
    names = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 3 and "." in parts[0] and not line.startswith(" "):
            names.append((parts[0].rsplit(".", 1)[0], parts[1]))
    _, sec_out, _ = run([tool, "-q", "-C", "updateinfo", "list", "--security"], timeout=180)
    sec_pkgs = set()
    for line in sec_out.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            sec_pkgs.add(re.sub(r"-[^-]+-[^-]+$", "", parts[-1]))
    for name, candidate in names:
        security = name in sec_pkgs
        result["pending"] += 1
        result["security"] += 1 if security else 0
        if len(result["packages"]) < 500:
            result["packages"].append({"name": clip(name, 200), "candidate": clip(candidate, 100), "security": security})
    if shutil.which("needs-restarting"):
        code, _, _ = run(["needs-restarting", "-r"], timeout=60)
        result["rebootRequired"] = code == 1
    result["autoUpdates"] = run(["systemctl", "is-enabled", "dnf-automatic.timer"], timeout=10)[0] == 0
    return result


def collect_updates():
    if shutil.which("apt-get"):
        return apt_updates()
    if shutil.which("dnf") or shutil.which("yum"):
        return dnf_updates()
    return None


# ---------------------------------------------------------------- crowdsec


def cscli_json(args, timeout=60):
    code, out, err = run(["cscli", *args, "-o", "json"], timeout=timeout)
    if code != 0:
        return None, clip(err.strip() or f"cscli {' '.join(args)} exited with {code}", 300)
    try:
        return json.loads(out or "null"), None
    except ValueError:
        return None, f"cscli {' '.join(args)} returned no JSON"


def collect_crowdsec():
    if not shutil.which("cscli"):
        return {"available": False, "error": "cscli not found – CrowdSec is not installed on this server."}
    code, _, err = run(["cscli", "lapi", "status"], timeout=30)
    if code != 0:
        port = lapi_port()
        owner = port_owner(port)
        hint = (
            f" Port {port} is used by {owner}, not CrowdSec — run the agent install with --crowdsec again, it moves the local API to a free port."
            if owner and "crowdsec" not in owner
            else ""
        )
        return {"available": False, "error": clip(f"CrowdSec local API not reachable: {err.strip()}{hint}", 500)}
    errors = []
    alerts, e = cscli_json(["alerts", "list", "--since", "24h", "--limit", "0"])
    if e:
        errors.append(e)
    decisions, e = cscli_json(["decisions", "list", "--limit", "0"])
    if e:
        errors.append(e)
    bouncers, e = cscli_json(["bouncers", "list"])
    if e:
        errors.append(e)
    scenarios = Counter(a.get("scenario") or "unknown" for a in (alerts or []))
    active = sum(len(a.get("decisions") or []) for a in (decisions or []))
    return {
        "available": True,
        "error": "; ".join(errors)[:500] if errors else None,
        "bouncers": [
            {
                "name": clip(b.get("name"), 200) or "unnamed",
                "type": clip(b.get("type"), 200),
                "lastPull": clip(b.get("last_pull"), 50),
                "valid": b.get("revoked") is not True if "revoked" in b else b.get("valid"),
            }
            for b in (bouncers or [])[:100]
        ],
        "activeDecisions": active,
        "alerts24h": len(alerts or []),
        "topScenarios": [{"scenario": clip(s, 200), "count": n} for s, n in scenarios.most_common(10)],
    }


# ---------------------------------------------------------------- containers & trivy


SIZE_UNITS = {"b": 1, "kb": 1e3, "kib": 1024, "mb": 1e6, "mib": 1024 ** 2, "gb": 1e9, "gib": 1024 ** 3, "tb": 1e12, "tib": 1024 ** 4}


def parse_size(text):
    """'512.3MiB' -> bytes."""
    m = re.match(r"^\s*([\d.]+)\s*([a-zA-Z]*)", text or "")
    if not m:
        return None
    try:
        return int(float(m.group(1)) * SIZE_UNITS.get((m.group(2) or "b").lower(), 1))
    except ValueError:
        return None


def container_stats():
    """Memory (without page cache) and CPU per container, one sample."""
    code, out, _ = run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=60)
    stats = {}
    if code != 0:
        return stats
    for line in out.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        try:
            cpu = float(str(row.get("CPUPerc", "")).rstrip("%"))
        except ValueError:
            cpu = None
        stats[row.get("Name")] = {
            "memBytes": parse_size(str(row.get("MemUsage", "")).split("/")[0]),
            "cpuPct": cpu,
        }
    return stats


def app_of(labels, name):
    """The app a container belongs to, stable across redeploys."""
    service = labels.get("com.docker.swarm.service.name")
    if service:
        return service
    project = labels.get("com.docker.compose.project")
    if project:
        return f"{project}-{labels.get('com.docker.compose.service') or name}"
    return name


def collect_containers():
    """
    Running containers: state and health check, plus memory, CPU, memory
    limit, restarts and whether the kernel killed it for running out of
    memory — the signs of an app leaking or spinning.
    """
    if not shutil.which("docker"):
        return None
    code, out, _ = run(["docker", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.ID}}"], timeout=30)
    if code != 0:
        return None
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[2] if len(parts) > 2 else ""
        health = "unhealthy" if "(unhealthy)" in status else "healthy" if "(healthy)" in status else "starting" if "health: starting" in status else None
        rows.append({
            "name": clip(parts[0], 200),
            "image": clip(parts[1], 500),
            "status": clip(status, 200),
            "state": clip(parts[3] if len(parts) > 3 else None, 50),
            "health": health,
            "_id": parts[4] if len(parts) > 4 else None,
        })
    rows = rows[:500]
    ids = [r["_id"] for r in rows if r["_id"]][:300]
    details = {}
    if ids:
        code, out, _ = run(["docker", "inspect", *ids], timeout=60)
        try:
            for c in json.loads(out) if code == 0 else []:
                details[(c.get("Name") or "").lstrip("/")] = c
        except ValueError:
            pass
    stats = container_stats()
    images = image_details([c.get("Image") for c in details.values()])
    for r in rows:
        r.pop("_id", None)
        c = details.get(r["name"]) or {}
        state = c.get("State") or {}
        limit = int((c.get("HostConfig") or {}).get("Memory") or 0)
        st = stats.get(r["name"]) or {}
        r.update({
            "app": clip(app_of((c.get("Config") or {}).get("Labels") or {}, r["name"]), 200),
            "memBytes": st.get("memBytes"),
            "memLimit": limit or None,
            "cpuPct": st.get("cpuPct"),
            "oomKilled": bool(state.get("OOMKilled")),
            "restartCount": c.get("RestartCount"),
            "startedAt": state.get("StartedAt"),
        })
        img = images.get(c.get("Image")) or {}
        r["imageCreated"] = img.get("created")
        r["imageDigest"] = img.get("digest")
    return rows


def image_details(ids):
    """
    Build date and registry digest of each image. The digest is what the
    registry calls this build — compared with the registry's current one it
    tells whether a newer image for the same tag exists. Built locally
    (never pulled) → no digest.
    """
    ids = sorted({i for i in ids if i})[:300]
    if not ids:
        return {}
    code, out, _ = run(["docker", "image", "inspect", *ids], timeout=60)
    result = {}
    try:
        for img in json.loads(out) if code == 0 else []:
            digests = img.get("RepoDigests") or []
            digest = digests[0].split("@", 1)[1] if digests and "@" in digests[0] else None
            result[img.get("Id")] = {"created": clip(img.get("Created"), 50), "digest": clip(digest, 100)}
    except ValueError:
        pass
    return result


def collect_services():
    """
    Swarm services (Dokploy deploys apps as services) with running vs.
    desired replicas — a service at 0/1 is an app that is down, which no
    container list shows. Only answers on a swarm manager.
    """
    if not shutil.which("docker"):
        return None
    code, out, _ = run(["docker", "service", "ls", "--format", "{{.Name}}\t{{.Replicas}}\t{{.Mode}}"], timeout=30)
    if code != 0:
        return None
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        m = re.match(r"^(\d+)/(\d+)", parts[1])
        if not m:
            continue
        rows.append({"name": clip(parts[0], 200), "running": int(m.group(1)), "desired": int(m.group(2)), "mode": clip(parts[2] if len(parts) > 2 else None, 50)})
    return rows[:500]


# ---------------------------------------------------------------- hardening


def sshd_settings():
    """Effective sshd settings (`sshd -T`), falling back to the config files."""
    keys = ("passwordauthentication", "permitrootlogin", "kbdinteractiveauthentication", "pubkeyauthentication", "port", "permitemptypasswords")
    out = {}
    if shutil.which("sshd"):
        code, text, _ = run(["sshd", "-T"], timeout=20)
        if code == 0:
            for line in text.splitlines():
                parts = line.split(None, 1)
                if len(parts) == 2 and parts[0] in keys and parts[0] not in out:
                    out[parts[0]] = parts[1].strip()
            return out, "sshd -T"
    # Fallback: first value wins, drop-ins first (that is sshd's own order).
    files = sorted(globmod_glob("/etc/ssh/sshd_config.d/*.conf")) + ["/etc/ssh/sshd_config"]
    for f in files:
        for line in (read(f) or "").splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and not parts[0].startswith("#"):
                k = parts[0].lower()
                if k in keys and k not in out:
                    out[k] = parts[1].strip()
    return (out, "config files") if out else (None, None)


def globmod_glob(pattern):
    import glob as globmod
    return globmod.glob(pattern)


def service_state(unit):
    code, out, _ = run(["systemctl", "is-active", unit], timeout=10)
    state = out.strip() or "unknown"
    if state in ("inactive", "unknown"):
        code2, _, _ = run(["systemctl", "cat", unit], timeout=10)
        if code2 != 0:
            return "not installed"
    return state


def collect_hardening():
    ssh, source = sshd_settings()
    ufw = None
    conf = read("/etc/ufw/ufw.conf")
    if conf is not None:
        m = re.search(r"^ENABLED=(\w+)", conf, re.M)
        ufw = "active" if m and m.group(1).lower() == "yes" else "inactive"
    elif not shutil.which("ufw"):
        ufw = "not installed"
    return {
        "ssh": ssh,
        "sshSource": source,
        "ufw": ufw,
        "fail2ban": service_state("fail2ban") if shutil.which("systemctl") else None,
    }


# ---------------------------------------------------------------- access


def key_fingerprint(line):
    """'ssh-ed25519 AAAA… comment' → type, SHA256 fingerprint like ssh-keygen, comment."""
    import base64
    import hashlib
    parts = line.split()
    for i, p in enumerate(parts):
        if p.startswith(("ssh-", "ecdsa-", "sk-")) and i + 1 < len(parts):
            try:
                raw = base64.b64decode(parts[i + 1].encode(), validate=True)
            except (ValueError, TypeError):
                return None
            fp = base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
            return {"type": p, "fingerprint": f"SHA256:{fp}", "comment": clip(" ".join(parts[i + 2:]), 100) or None}
    return None


def collect_access():
    """
    Who can get in and who is root-equivalent: SSH keys, sudo/admin/wheel
    and docker group members, uid-0 accounts. Moatline compares this
    with an accepted baseline — a key an attacker adds shows up as new.
    """
    keys = []
    homes = [("root", "/root")]
    for line in (read("/etc/passwd") or "").splitlines():
        f = line.split(":")
        if len(f) >= 7 and f[5].startswith("/home/"):
            homes.append((f[0], f[5]))
    for user, home in homes[:200]:
        for name in ("authorized_keys", "authorized_keys2"):
            for line in (read(os.path.join(home, ".ssh", name)) or "").splitlines()[:200]:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                fp = key_fingerprint(line)
                if fp:
                    keys.append({"user": clip(user, 64), **fp})
    groups = {}
    for line in (read("/etc/group") or "").splitlines():
        f = line.split(":")
        if len(f) >= 4 and f[0] in ("sudo", "admin", "wheel", "docker"):
            groups[f[0]] = sorted(u for u in f[3].split(",") if u)
    uid0 = [l.split(":")[0] for l in (read("/etc/passwd") or "").splitlines() if l.count(":") >= 3 and l.split(":")[2] == "0"]
    return {
        "sshKeys": keys[:500],
        "privilegedGroups": groups,
        "uid0": uid0[:20],
    }


# ---------------------------------------------------------------- stale libs


def collect_stale_libraries():
    """
    Processes still mapping a library that an update replaced: the fix is
    installed but not running until the service restarts. Grouped by systemd
    unit; container processes are left out (their libraries are the image's).
    Processes of other users may be unreadable — reported as partial.
    """
    units = {}
    unreadable = 0
    try:
        pids = [p for p in os.listdir("/proc") if p.isdigit()]
    except OSError:
        return None
    for pid in pids:
        maps = read(f"/proc/{pid}/maps")
        if maps is None:
            unreadable += 1
            continue
        stale = set()
        for line in maps.splitlines():
            if line.endswith(" (deleted)") and ".so" in line and "/memfd:" not in line:
                path = line.split(None, 5)[-1].replace(" (deleted)", "")
                if path.startswith(("/usr/", "/lib")):
                    stale.add(os.path.basename(path))
        if not stale:
            continue
        cg = read(f"/proc/{pid}/cgroup") or ""
        if "docker" in cg or "containerd" in cg or "/kubepods" in cg:
            continue
        m = re.search(r"/([^/]+\.service)", cg)
        unit = m.group(1) if m else "session or other"
        entry = units.setdefault(unit, {"unit": unit, "processes": 0, "libraries": set()})
        entry["processes"] += 1
        entry["libraries"].update(stale)
    return {
        "units": [
            {"unit": clip(u["unit"], 200), "processes": u["processes"], "libraries": sorted(u["libraries"])[:10]}
            for u in sorted(units.values(), key=lambda x: x["unit"])
        ][:100],
        "partial": unreadable > 0,
    }


# ---------------------------------------------------------------- listeners


def _proc_net_listeners(path, v6):
    rows = []
    for line in (read(path) or "").splitlines()[1:]:
        f = line.split()
        if len(f) < 10 or f[3] != "0A":  # 0A = LISTEN
            continue
        hexaddr, hexport = f[1].split(":")
        port = int(hexport, 16)
        if v6:
            raw = bytes.fromhex(hexaddr)
            # /proc stores each 32-bit word in host (little-endian) order.
            words = b"".join(raw[i:i + 4][::-1] for i in range(0, 16, 4))
            import ipaddress
            addr = str(ipaddress.IPv6Address(words))
        else:
            addr = ".".join(str(b) for b in bytes.fromhex(hexaddr)[::-1])
        rows.append((addr, port, f[9]))
    return rows


def _inode_owners():
    """socket inode → process name, for the processes we may look into."""
    owners = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            fds = os.listdir(f"/proc/{pid}/fd")
        except OSError:
            continue
        name = (read(f"/proc/{pid}/comm") or "").strip()
        for fd in fds:
            try:
                target = os.readlink(f"/proc/{pid}/fd/{fd}")
            except OSError:
                continue
            if target.startswith("socket:["):
                owners.setdefault(target[8:-1], name)
    return owners


def collect_listeners():
    """
    TCP ports listening on the host, read from /proc/net (no netlink needed,
    which the hardened unit does not allow). The owning process is filled in
    where /proc lets us see it.
    """
    rows = _proc_net_listeners("/proc/net/tcp", False) + _proc_net_listeners("/proc/net/tcp6", True)
    if not rows:
        return None
    owners = _inode_owners()
    out, seen = [], set()
    for addr, port, inode in rows:
        if (addr, port) in seen:
            continue
        seen.add((addr, port))
        out.append({"address": addr, "port": port, "process": clip(owners.get(inode), 64)})
    return sorted(out, key=lambda r: (r["port"], r["address"]))[:300]


# ---------------------------------------------------------------- compromise


MINER_NAMES = re.compile(r"^(xmrig|xmr-stak|minerd|cpuminer|kinsing|kdevtmpfsi|kthreaddi|watchbog|sysupdate|networkservice|dbused|xmrigdaemon|t-rex|nbminer|lolminer|phoenixminer|cryptonight|\.?kswapd0x?)$", re.I)
POOL_PORTS = {3333, 4444, 5555, 6666, 7777, 8888, 9999, 14433, 14444, 45560, 45700}
TEMP_DIRS = ("/tmp/", "/dev/shm/", "/var/tmp/", "/run/shm/")


def _established_remote_ports():
    ports = {}
    for path in ("/proc/net/tcp", "/proc/net/tcp6"):
        for line in (read(path) or "").splitlines()[1:]:
            f = line.split()
            if len(f) >= 10 and f[3] == "01":  # ESTABLISHED
                ports[f[9]] = int(f[2].split(":")[1], 16)
    return ports


PF_KTHREAD = 0x00200000


def is_kernel_thread(pid):
    """
    Kernel threads (kswapd0, kworker/…) carry PF_KTHREAD in /proc/<pid>/stat.
    Miners borrow their names, but cannot set this flag from user space.
    """
    stat = read(f"/proc/{pid}/stat") or ""
    fields = stat.rpartition(")")[2].split()
    try:
        return int(fields[6]) & PF_KTHREAD != 0
    except (IndexError, ValueError):
        return False


def _kernel_spawned(pid):
    """
    Started by the kernel itself: its parent is kthreadd (PID 2). User mode
    drivers (bpfilter and the like) run like that — from a blob in a private,
    already detached mount, so their binary reads as "/ (deleted)". A process
    from user space can never get kthreadd as its parent.
    """
    m = re.search(r"^PPid:\s*(\d+)", read(f"/proc/{pid}/status") or "", re.M)
    return bool(m) and m.group(1) == "2"


def _start_time(pid):
    """Start time of a process (clock ticks since boot) — tells a reused PID apart."""
    stat = read(f"/proc/{pid}/stat") or ""
    fields = stat.rpartition(")")[2].split()
    return fields[19] if len(fields) > 19 else None


def _still_running(pid, exe, started):
    """The same process, with the same binary, a moment later."""
    try:
        return os.readlink(f"/proc/{pid}/exe") == exe and _start_time(pid) == started
    except OSError:
        return False


def collect_compromise():
    """
    Classic signs of a compromised host — cryptominers and droppers:
    known miner process names, programs running from temp directories or
    whose binary was deleted, connections to typical pool ports, a global
    LD_PRELOAD hook, and cron jobs that download and execute. Read-only:
    nothing is killed or removed.
    """
    hits = []
    # Processes from temp dirs or deleted binaries are only reported when they
    # are still running a moment later. Docker starts short-lived helpers
    # from a sealed, already-unlinked copy of runc for every container start,
    # `docker exec` and health check — gone within a second. A miner or
    # dropper keeps running.
    suspects = []
    remote = _established_remote_ports()
    owners = None
    for pid in os.listdir("/proc"):
        if not pid.isdigit() or pid == str(os.getpid()):
            continue
        name = (read(f"/proc/{pid}/comm") or "").strip()
        try:
            exe = os.readlink(f"/proc/{pid}/exe")
        except OSError:
            exe = None
        cg = read(f"/proc/{pid}/cgroup") or ""
        container = "docker" in cg or "containerd" in cg
        where = " (in a container)" if container else ""
        if MINER_NAMES.match(name) and not is_kernel_thread(pid):
            hits.append({"kind": "miner-process", "detail": clip(f"process '{name}' (pid {pid}){where}", 300)})
        if exe and not container:
            if exe.startswith(TEMP_DIRS):
                suspects.append((pid, exe, _start_time(pid), {"kind": "temp-executable", "detail": clip(f"'{name}' runs from {exe} (pid {pid})", 300)}))
            elif exe.endswith(" (deleted)") and not exe.startswith(("/usr/", "/lib", "/opt/")) and not _kernel_spawned(pid):
                suspects.append((pid, exe, _start_time(pid), {"kind": "deleted-executable", "detail": clip(f"'{name}' runs a deleted binary {exe} (pid {pid})", 300)}))
    if suspects:
        time.sleep(3)
        hits.extend(hit for pid, exe, started, hit in suspects if _still_running(pid, exe, started))
    # Connections to mining-pool ports, attributed where possible.
    pool = {inode: port for inode, port in remote.items() if port in POOL_PORTS}
    if pool:
        owners = _inode_owners()
        for inode, port in list(pool.items())[:20]:
            hits.append({"kind": "pool-connection", "detail": clip(f"outbound connection to port {port} by '{owners.get(inode, 'unknown')}'", 300)})
    preload = read("/etc/ld.so.preload")
    if preload and preload.strip():
        hits.append({"kind": "ld-preload", "detail": clip(f"/etc/ld.so.preload loads: {preload.strip()}", 300)})
    cron_files = ["/etc/crontab"] + globmod_glob("/etc/cron.d/*") + globmod_glob("/var/spool/cron/crontabs/*")
    pattern = re.compile(r"(curl|wget)[^|;#\n]*\|\s*(ba)?sh|base64\s+-d[^|]*\|\s*(ba)?sh|/dev/tcp/", re.I)
    for f in cron_files[:200]:
        for line in (read(f) or "").splitlines():
            if not line.strip().startswith("#") and pattern.search(line):
                hits.append({"kind": "cron-download-exec", "detail": clip(f"{f}: {line.strip()}", 300)})
    return {"hits": hits[:50]}


# ---------------------------------------------------------------- docker risks


SENSITIVE_MOUNTS = {"", "/etc", "/root", "/boot", "/usr", "/bin", "/sbin", "/lib", "/var/lib/docker", "/home", "/var/run", "/run"}


def collect_docker_risks():
    """
    Containers that weaken the host: privileged, the Docker socket mounted
    (= root on the host), host networking, and ports published on all
    interfaces — which Docker opens past UFW. Plus Swarm services' published
    ports (Dokploy), which the ingress opens the same way. And who shares a
    network with whom: one compromised app reaches every database on its
    networks.
    """
    if not shutil.which("docker"):
        return None
    code, ids, _ = run(["docker", "ps", "-q"], timeout=30)
    if code != 0:
        return None
    containers = []
    id_list = ids.split()[:200]
    if id_list:
        code, out, _ = run(["docker", "inspect", *id_list], timeout=60)
        try:
            data = json.loads(out) if code == 0 else []
        except ValueError:
            data = []
        for c in data:
            hc = c.get("HostConfig") or {}
            mounts = c.get("Mounts") or []
            labels = (c.get("Config") or {}).get("Labels") or {}
            nets = list(((c.get("NetworkSettings") or {}).get("Networks") or {}).keys())
            # Writable host paths that hand over the host.
            host_mounts = [
                {"source": clip(m.get("Source"), 200), "rw": bool(m.get("RW"))}
                for m in mounts
                if m.get("Type") == "bind" and str(m.get("Source", "")).rstrip("/") in SENSITIVE_MOUNTS
            ]
            published = []
            for cport, binds in ((c.get("NetworkSettings") or {}).get("Ports") or {}).items():
                for b in binds or []:
                    published.append({"hostIp": b.get("HostIp") or "", "hostPort": int(b.get("HostPort") or 0), "containerPort": cport})
            containers.append({
                "name": clip((c.get("Name") or "").lstrip("/"), 200),
                "image": clip((c.get("Config") or {}).get("Image"), 300),
                "privileged": bool(hc.get("Privileged")),
                "dockerSocket": any(str(m.get("Source", "")).endswith("docker.sock") for m in mounts),
                "hostNetwork": hc.get("NetworkMode") == "host",
                "capAdd": [str(x) for x in (hc.get("CapAdd") or [])][:20],
                "published": published[:50],
                "networks": [clip(n, 100) for n in nets][:20],
                "project": clip(
                    labels.get("com.docker.compose.project")
                    or labels.get("com.docker.stack.namespace")
                    or labels.get("com.docker.swarm.service.name"),
                    200,
                ),
                "hostMounts": host_mounts[:10],
            })
    services = []
    code, out, _ = run(["docker", "service", "ls", "--format", "{{.Name}}\t{{.Ports}}"], timeout=30)
    if code == 0:
        for line in out.splitlines():
            name, _, ports = line.partition("\t")
            for m in re.finditer(r"\*:(\d+)->(\d+)/(tcp|udp)", ports):
                services.append({"name": clip(name, 200), "hostPort": int(m.group(1)), "containerPort": f"{m.group(2)}/{m.group(3)}"})
    networks = []
    code, ids, _ = run(["docker", "network", "ls", "-q"], timeout=30)
    if code == 0 and ids.split():
        code, out, _ = run(["docker", "network", "inspect", *ids.split()[:100]], timeout=60)
        try:
            data = json.loads(out) if code == 0 else []
        except ValueError:
            data = []
        for n in data:
            opts = n.get("Options") or {}
            networks.append({
                "name": clip(n.get("Name"), 100),
                "driver": clip(n.get("Driver"), 40),
                "internal": bool(n.get("Internal")),
                "icc": opts.get("com.docker.network.bridge.enable_icc", "true") != "false",
            })
    return {"containers": containers, "servicePorts": services[:200], "networks": networks}


REMOTE_CONFIG = os.path.join(CACHE_DIR, "checks.json")


def remote_checks():
    """
    Check definitions Moatline sent with its last answer (backup paths
    to watch). Declarative only: the agent stats the paths, it never runs
    anything it is told to.
    """
    try:
        with open(REMOTE_CONFIG, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_remote_checks(checks):
    if not isinstance(checks, dict):
        return
    try:
        fd = os.open(REMOTE_CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(checks, f)
    except OSError:
        pass


def newest_file(path, limit=20000):
    """Newest mtime (and its size) under a file, glob or directory (depth 3)."""
    import glob as globmod
    targets = globmod.glob(path) if any(ch in path for ch in "*?[") else [path]
    newest, size, seen = None, None, 0
    for t in targets:
        if os.path.isfile(t):
            candidates = [t]
        elif os.path.isdir(t):
            candidates = []
            base_depth = t.rstrip("/").count("/")
            for root, dirs, files in os.walk(t):
                if root.count("/") - base_depth >= 3:
                    dirs[:] = []
                for f in files:
                    candidates.append(os.path.join(root, f))
                    seen += 1
                    if seen >= limit:
                        break
                if seen >= limit:
                    break
        else:
            continue
        for c in candidates:
            try:
                st = os.stat(c)
            except OSError:
                continue
            if newest is None or st.st_mtime > newest:
                newest, size = st.st_mtime, st.st_size
    return newest, size, bool(targets) and any(os.path.exists(t) for t in targets)


def collect_backups():
    out = []
    for b in (remote_checks().get("backups") or [])[:20]:
        path = str(b.get("path", ""))
        name = clip(str(b.get("name", path)), 100)
        if not path.startswith("/") or "\x00" in path or "/../" in path + "/":
            out.append({"name": name, "path": clip(path, 500), "error": "path must be absolute"})
            continue
        newest, size, exists = newest_file(path)
        out.append({
            "name": name,
            "path": clip(path, 500),
            "newestAt": iso(newest) if newest else None,
            "sizeBytes": size,
            "error": None if exists else "path not found",
        })
    return out


def trivy_vulns(doc):
    out = []
    for result in (doc or {}).get("Results") or []:
        for v in result.get("Vulnerabilities") or []:
            out.append(
                {
                    "id": clip(v.get("VulnerabilityID"), 100) or "unknown",
                    "pkg": clip(v.get("PkgName"), 200) or "unknown",
                    "installed": clip(v.get("InstalledVersion"), 100),
                    "fixed": clip(v.get("FixedVersion"), 300),
                    "severity": (v.get("Severity") or "UNKNOWN")[:20],
                    "title": clip(v.get("Title"), 500),
                    "url": clip(v.get("PrimaryURL"), 1000),
                }
            )
    return out


def trivy_scan(args, cfg, timeout):
    severity = cfg.get("severity", DEFAULT_SEVERITY)
    cache = os.path.join(CACHE_DIR, "trivy")
    os.makedirs(cache, mode=0o700, exist_ok=True)
    cmd = ["trivy", *args[:1], "--scanners", "vuln", "--format", "json", "--quiet", "--cache-dir", cache, "--severity", severity, "--timeout", f"{timeout // 60}m", *args[1:]]
    code, out, err = run(cmd, timeout=timeout + 60)
    if code != 0:
        return None, clip(err.strip().splitlines()[-1] if err.strip() else f"trivy exited with {code}", 500)
    try:
        return json.loads(out), None
    except ValueError:
        return None, "trivy returned no JSON"


def collect_trivy(cfg, containers):
    tcfg = cfg.get("trivy", {})
    if not shutil.which("trivy"):
        return {"available": False, "error": "trivy not found – install it from https://trivy.dev (apt repository) so this server is checked for vulnerabilities."}
    results, errors = [], []
    skip = ",".join(["/proc", "/sys", "/dev", "/run", "/tmp", "/snap", "/var/lib/docker", "/var/lib/containerd", CACHE_DIR] + tcfg.get("skipDirs", []))
    # OS packages of the host itself. Language lockfiles scattered over the
    # disk are left to the image scan below, where they belong to an app.
    doc, err = trivy_scan(["rootfs", "--pkg-types", "os", "--skip-dirs", skip, "/"], tcfg, 1800)
    if err and "unknown flag" in err:
        doc, err = trivy_scan(["rootfs", "--vuln-type", "os", "--skip-dirs", skip, "/"], tcfg, 1800)
    if err:
        errors.append(f"host: {err}")
    else:
        results.append({"target": "rootfs", "kind": "host", "containers": [], "vulnerabilities": trivy_vulns(doc)[:5000]})

    # What is actually live: the images of the running containers.
    if tcfg.get("scanImages", True) and containers:
        by_image = {}
        for c in containers:
            by_image.setdefault(c["image"], []).append(c["name"])
        for image, names in list(by_image.items())[: tcfg.get("maxImages", 30)]:
            doc, err = trivy_scan(["image", image], tcfg, 1200)
            if err:
                errors.append(f"{image}: {err}")
                continue
            results.append({"target": clip(image, 500), "kind": "image", "containers": names[:100], "vulnerabilities": trivy_vulns(doc)[:5000]})
    return {"available": True, "error": clip("; ".join(errors), 1000) if errors else None, "results": results[:100]}


# ---------------------------------------------------------------- report


_DF_UNITS = {"b": 1, "kb": 1e3, "mb": 1e6, "gb": 1e9, "tb": 1e12}


def _df_bytes(text):
    """'1.2GB (40%)' → 1200000000. Docker prints decimal units."""
    m = re.match(r"\s*([\d.]+)\s*([kKmMgGtT]?[bB])", text or "")
    return int(float(m.group(1)) * _DF_UNITS[m.group(2).lower()]) if m else 0


def collect_docker_disk():
    """
    What Docker keeps on disk — images, build cache, containers, volumes —
    and how much of it is unused. Measured at most hourly: `docker system df`
    walks every layer.
    """
    if not shutil.which("docker"):
        return None
    cache = os.path.join(CACHE_DIR, "docker-df.json")
    try:
        if time.time() - os.path.getmtime(cache) < 3600:
            return json.loads(read(cache) or "null")
    except (OSError, ValueError):
        pass
    code, out, _ = run(["docker", "system", "df", "--format", "{{json .}}"], timeout=120)
    if code != 0:
        return None
    keys = {"Images": "images", "Build Cache": "buildCache", "Containers": "containers", "Local Volumes": "volumes"}
    result = {}
    for line in out.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        key = keys.get(row.get("Type"))
        if key:
            result[key] = {"sizeBytes": _df_bytes(row.get("Size")), "reclaimableBytes": _df_bytes(row.get("Reclaimable"))}
    # Layers on disk, including orphans that `docker system df` does not list.
    # The server compares this with the sum above to find the hidden part.
    overlay_total, _, _ = measure_dir("/var/lib/docker/overlay2", timeout=180)
    if overlay_total is not None:
        result["overlay2Bytes"] = overlay_total
    result["measuredAt"] = datetime.now(timezone.utc).isoformat()
    try:
        os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
        write(cache, json.dumps(result), 0o600)
    except OSError:
        pass
    return result


# ---------------------------------------------------------------- storage

# S3-compatible servers, by the last part of their image name.
STORAGE_IMAGES = re.compile(
    r"(?:^|/)(minio|garage|seaweedfs|rustfs|cloudserver|versitygw|ceph|radosgw)(?:[:@]|$)"
)
STORAGE_CACHE = os.path.join(CACHE_DIR, "storage.json")
BUCKET_DIRS = ("minio", "rustfs", "versitygw", "folder")
STORAGE_BUDGET_S = 240  # all measuring per hour; the metrics unit has 10 min


def storage_kind(image):
    m = STORAGE_IMAGES.search((image or "").split("@")[0].lower())
    if not m:
        return None
    return "ceph" if m.group(1) == "radosgw" else m.group(1)


def mount_of(path):
    path = os.path.realpath(path)
    while not os.path.ismount(path) and path != "/":
        path = os.path.dirname(path)
    return path


def measure_dir(path, timeout):
    """Size of a directory and of its top-level entries (MinIO: buckets)."""
    code, out, err = run(["du", "-x", "-B1", "-d1", path], timeout=max(10, int(timeout)), ok_codes=(0, 1))
    if code not in (0, 1) or not out:
        return None, [], clip(err.strip() or "could not measure", 200)
    total, parts = None, []
    base = path.rstrip("/") or "/"
    for line in out.splitlines():
        size, _, p = line.partition("\t")
        if not size.isdigit():
            continue
        if p.rstrip("/") == base:
            total = int(size)
        else:
            parts.append({"name": clip(os.path.basename(p), 200), "sizeBytes": int(size)})
    parts.sort(key=lambda x: -x["sizeBytes"])
    # du exits 1 when some files vanished or were unreadable: the sum is
    # still the best number there is.
    return total, parts, None


def storage_targets(custom):
    """S3 servers in Docker, by image, plus the folders Moatline asked to watch."""
    targets = []
    if shutil.which("docker"):
        code, out, _ = run(["docker", "ps", "--format", "{{.ID}}\t{{.Image}}"], timeout=30)
        ids = [line.split("\t")[0] for line in out.splitlines() if code == 0 and storage_kind(line.partition("\t")[2])]
        if ids:
            code, out, _ = run(["docker", "inspect", *ids[:30]], timeout=60)
            try:
                data = json.loads(out) if code == 0 else []
            except ValueError:
                data = []
            by_app = {}
            for c in data:
                name = (c.get("Name") or "").lstrip("/")
                labels = (c.get("Config") or {}).get("Labels") or {}
                app = app_of(labels, name)
                t = by_app.setdefault(app, {
                    "name": clip(app, 200),
                    "kind": storage_kind((c.get("Config") or {}).get("Image")),
                    "container": clip(name, 200),
                    "paths": [],
                })
                for m in c.get("Mounts") or []:
                    src = str(m.get("Source") or "")
                    if m.get("Type") not in ("volume", "bind") or not os.path.isdir(src):
                        continue
                    if src.rstrip("/") in SENSITIVE_MOUNTS or src.endswith("docker.sock"):
                        continue
                    if src not in t["paths"]:
                        t["paths"].append(src)
            targets.extend(by_app.values())
    for f in custom[:20]:
        path = str(f.get("path") or "")
        name = clip(str(f.get("name") or path), 100)
        if not path.startswith("/") or "\x00" in path or "/../" in path + "/":
            targets.append({"name": name, "kind": "folder", "paths": [], "error": "path must be absolute"})
        elif not os.path.isdir(path):
            targets.append({"name": name, "kind": "folder", "paths": [], "error": "folder not found"})
        else:
            targets.append({"name": name, "kind": "folder", "paths": [path]})
    return targets


def collect_storage():
    """
    How much the object storage on this server holds, which buckets are the
    biggest, and how full the disk under it is. Measured at most hourly with
    `du` (at idle I/O priority) — counting files is slow on a big store, and
    the size changes slowly anyway.
    """
    custom = [c for c in (remote_checks().get("storage") or []) if isinstance(c, dict) and c.get("path")]
    key = hashlib.sha256(json.dumps(custom, sort_keys=True).encode()).hexdigest()[:16]
    cached = None
    try:
        cached = json.loads(read(STORAGE_CACHE) or "null")
        if cached and cached.get("key") == key and time.time() - os.path.getmtime(STORAGE_CACHE) < 3600:
            return cached.get("result")
    except (OSError, ValueError):
        cached = None
    targets = storage_targets(custom)
    if not targets:
        return None
    previous = {i.get("name"): i for i in ((cached or {}).get("result") or {}).get("items") or []}
    deadline = time.time() + STORAGE_BUDGET_S
    items = []
    for t in targets[:30]:
        item = {"name": t["name"], "kind": t["kind"], "container": t.get("container"), "paths": [clip(p, 300) for p in t["paths"][:10]],
                "sizeBytes": None, "folders": [], "disk": None, "error": t.get("error")}
        if t["paths"] and not item["error"]:
            total, folders, errors = 0, {}, []
            for path in t["paths"][:10]:
                left = deadline - time.time()
                if left < 10:
                    errors.append("not measured this hour: the store is too big to count in time")
                    break
                size, parts, err = measure_dir(path, left)
                if err or size is None:
                    errors.append(err or "could not measure")
                    continue
                total += size
                for part in parts:
                    # MinIO keeps its own state next to the buckets.
                    if part["name"] in (".minio.sys", "lost+found"):
                        continue
                    folders[part["name"]] = folders.get(part["name"], 0) + part["sizeBytes"]
            if errors and not total:
                old = previous.get(t["name"]) or {}
                item.update({"sizeBytes": old.get("sizeBytes"), "folders": old.get("folders") or []})
                item["error"] = clip("; ".join(errors), 300)
            else:
                item["sizeBytes"] = total
                # Buckets are top-level folders only where the store keeps
                # plain files; Garage and SeaweedFS shard into hash folders.
                if t["kind"] in BUCKET_DIRS:
                    item["folders"] = [{"name": n, "sizeBytes": b} for n, b in sorted(folders.items(), key=lambda x: -x[1])[:50]]
                item["error"] = clip("; ".join(errors), 300) if errors else None
            try:
                st = os.statvfs(t["paths"][0])
                used = (st.f_blocks - st.f_bfree) * st.f_frsize
                item["disk"] = {"mount": clip(mount_of(t["paths"][0]), 300), "totalBytes": used + st.f_bavail * st.f_frsize, "usedBytes": used}
            except OSError:
                pass
        items.append(item)
    result = {"items": items, "measuredAt": datetime.now(timezone.utc).isoformat()}
    try:
        os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
        write(STORAGE_CACHE, json.dumps({"key": key, "result": result}), 0o600)
    except OSError:
        pass
    return result


# ---------------------------------------------------------------- log errors

LOG_STATE = os.path.join(CACHE_DIR, "logs.json")
LOG_ERROR = re.compile(
    r"\b(ERROR|FATAL|CRITICAL|PANIC)\b"
    r"|\b(?:[A-Z][a-z]+)*(?:Error|Exception):"
    r"|Unhandled(?:Promise)?Rejection|uncaughtException"
    r"|\bE(?:CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|ADDRINUSE)\b"
    r"|heap out of memory|\bOOM\b"
    r'|"level"\s*:\s*(?:"(?:error|fatal)"|50|60)\b'
    r'|"s"\s*:\s*"[EF]"'
)
# What must never leave the server: credentials, tokens, addresses of people.
SCRUB = [
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+"), r"\1 <redacted>"),
    (re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|session)(\W{1,3})[^\s,;&\"']+"), r"\1\2<redacted>"),
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s:/@]+:[^\s@/]+@"), r"\1<redacted>@"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "<email>"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "<ip>"),
    (re.compile(r"\b[A-Za-z0-9_-]{32,}\b"), "<token>"),
]
# Parts that differ between occurrences of the same error.
VARIABLE = [
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"), "<time>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<id>"),
    (re.compile(r"\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b", re.I), "<hex>"),
    (re.compile(r"\d+"), "<n>"),
]


def scrub(line):
    for rx, repl in SCRUB:
        line = rx.sub(repl, line)
    return line


def signature(line):
    sig = line
    for rx, repl in VARIABLE:
        sig = rx.sub(repl, sig)
    return re.sub(r"\s+", " ", sig).strip()[:300]


def collect_log_errors(containers):
    """
    Error lines each container logged since the last report — scrubbed of
    passwords, tokens, e-mail and IP addresses, and grouped: the same error
    a thousand times is one entry with a count. Only error lines are read;
    nothing else of the logs leaves the server.
    """
    if not containers or not shutil.which("docker"):
        return None
    try:
        state = json.loads(read(LOG_STATE) or "{}")
    except ValueError:
        state = {}
    now = time.time()
    groups = {}
    for c in containers[:60]:
        name = c.get("name")
        if not name:
            continue
        since = max(float(state.get(name) or now - 600), now - 3600)
        code, out, err = run(["docker", "logs", "--since", str(int(since)), "--timestamps", "--tail", "3000", name], timeout=15)
        state[name] = now
        if code != 0:
            continue
        for raw in (out + "\n" + err).splitlines():
            ts, _, line = raw.partition(" ")
            if not line or len(line) > 5000 or not LOG_ERROR.search(line):
                continue
            clean = scrub(line.strip())
            app = c.get("app") or name
            key = hashlib.sha1(f"{app}\0{signature(clean)}".encode()).hexdigest()[:20]
            g = groups.get(key)
            if g:
                g["count"] += 1
                g["lastAt"] = ts[:35]
            else:
                groups[key] = {"fingerprint": key, "app": clip(app, 200), "container": clip(name, 200),
                               "sample": clip(clean, 500), "count": 1, "firstAt": ts[:35], "lastAt": ts[:35]}
    # Containers that are gone need no "since" any more.
    alive = {c.get("name") for c in containers}
    state = {k: v for k, v in state.items() if k in alive}
    try:
        write(LOG_STATE, json.dumps(state), 0o600)
    except OSError:
        pass
    top = sorted(groups.values(), key=lambda g: -g["count"])[:200]
    return {"errors": top}


# ---------------------------------------------------------------- tailscale


def tailscale_status():
    """`tailscale status --json`, or None without Tailscale."""
    if not shutil.which("tailscale"):
        return None
    code, out, _ = run(["tailscale", "status", "--json"], timeout=15)
    try:
        return json.loads(out) if code == 0 and out.strip() else {}
    except ValueError:
        return {}


def tailscale_ssh_on():
    """
    Whether Tailscale SSH answers on the tailnet address (`tailscale set
    --ssh`). Then the tailnet's ACLs decide who logs in, not authorized_keys
    — a tool that connects with a key (Dokploy, Coolify, a CI deploy) is
    turned away unless an ACL lets it in. None when it cannot be told.
    """
    code, out, _ = run(["tailscale", "debug", "prefs"], timeout=15)
    if code != 0:
        return None
    try:
        return bool(json.loads(out).get("RunSSH"))
    except ValueError:
        return None


def ssh_tailnet_only():
    """
    Whether ufw lets SSH in only on tailscale0 (the install's
    --tailscale-ssh-only). Then a tool that connects to the public address
    no longer gets through. None without an active ufw.
    """
    if not shutil.which("ufw"):
        return None
    code, out, _ = run(["ufw", "status"], timeout=15)
    if code != 0 or "Status: active" not in out:
        return None
    port = ssh_port()
    rules = [
        l.strip() for l in out.splitlines()
        if re.match(rf"^{port}(/tcp)?(\s|$)", l.strip()) and " ALLOW" in l
    ] + [l.strip() for l in out.splitlines() if l.strip().startswith("OpenSSH ")]
    on_tailnet = any(" on tailscale0" in l for l in rules)
    elsewhere = any(" on tailscale0" not in l for l in rules)
    return on_tailnet and not elsewhere


def collect_tailscale():
    """Whether the server is on the tailnet, until when its key holds, and how SSH reaches it."""
    st = tailscale_status()
    if st is None:
        return None
    me = st.get("Self") or {}
    return {
        "state": clip(st.get("BackendState"), 40),
        "online": bool(me.get("Online")),
        "ips": [clip(ip, 64) for ip in (me.get("TailscaleIPs") or [])][:4],
        "hostname": clip(me.get("HostName"), 120),
        "keyExpiry": clip(me.get("KeyExpiry"), 40),
        "ssh": tailscale_ssh_on(),
        "sshTailnetOnly": ssh_tailnet_only(),
    }


def build_report(kind, cfg):
    containers = collect_containers()
    report = {
        "v": 1,
        "agentVersion": VERSION,
        "kind": kind,
        "host": collect_host(),
        "updates": collect_updates(),
        "crowdsec": collect_crowdsec() if cfg.get("crowdsec", True) else None,
        "containers": containers,
        "services": collect_services(),
        "backups": collect_backups(),
        "hardening": collect_hardening(),
        "access": collect_access(),
        "staleLibraries": collect_stale_libraries(),
        "listeners": collect_listeners(),
        "dockerRisks": collect_docker_risks(),
        "compromise": collect_compromise(),
        "tailscale": collect_tailscale(),
        "dockerDisk": collect_docker_disk(),
        "storage": collect_storage(),
    }
    # Logs only with the 5-minute report: two kinds reading at once would
    # count the same lines twice.
    if kind == "metrics" and cfg.get("logErrors", True):
        report["logErrors"] = collect_log_errors(containers)
    if kind == "full":
        report["trivy"] = collect_trivy(cfg, containers)
    report["sentAt"] = datetime.now(timezone.utc).isoformat()
    return report


def shrink(report):
    """Keep the report under the API's size limit by dropping the least severe findings first."""
    body = json.dumps(report).encode()
    trivy = report.get("trivy") or {}
    for keep in (("MEDIUM", "HIGH", "CRITICAL"), ("HIGH", "CRITICAL"), ("CRITICAL",)):
        if len(body) <= MAX_BODY or not trivy.get("results"):
            break
        for r in trivy["results"]:
            r["vulnerabilities"] = [v for v in r["vulnerabilities"] if v["severity"].upper() in keep]
        note = f"Report too large – only {'/'.join(keep)} findings sent."
        trivy["error"] = f"{trivy['error']}; {note}" if trivy.get("error") else note
        body = json.dumps(report).encode()
    return body


def is_tailnet_url(url):
    """True for Tailscale addresses, whose traffic WireGuard already encrypts."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if host.endswith(".ts.net"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip in ipaddress.ip_network("100.64.0.0/10") or ip in ipaddress.ip_network("fd7a:115c:a1e0::/48")


def require_safe_url(url, allow_http=False):
    if url.startswith("https://") or allow_http or is_tailnet_url(url):
        return
    raise SystemExit(
        "Refusing to send credentials over plain http. Use https://, or a Tailscale address "
        "(100.x.y.z / *.ts.net) — that traffic is encrypted by WireGuard."
    )


def post_json(url, payload, token=None, timeout=60):
    headers = {"Content-Type": "application/json", "User-Agent": f"pc-agent/{VERSION}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as res:
        return json.loads(res.read().decode("utf-8") or "{}")


def send(cfg, body):
    url = cfg["url"].rstrip("/") + "/api/agent/report"
    require_safe_url(url, cfg.get("allowHttp"))
    ctx = ssl.create_default_context()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['token']}", "User-Agent": f"pc-agent/{VERSION}"},
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=ctx) as res:
                try:
                    answer = json.loads(res.read(64 * 1024).decode("utf-8") or "{}")
                    if isinstance(answer.get("checks"), dict):
                        save_remote_checks(answer["checks"])
                except ValueError:
                    pass
                return res.status
        except urllib.error.HTTPError as e:
            detail = e.read(2000).decode("utf-8", "replace")
            if e.code < 500 and e.code != 429:
                raise SystemExit(f"Report rejected (HTTP {e.code}): {detail}")
            last = f"HTTP {e.code}: {detail}"
        except (urllib.error.URLError, OSError) as e:
            last = str(e)
        time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Could not deliver the report: {last}")


def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise SystemExit(f"{CONFIG_PATH} not found – run `install` first.")


def cmd_report(args):
    cfg = load_config() if not args.dry_run or os.access(CONFIG_PATH, os.R_OK) else {}
    lock_dir = CACHE_DIR
    try:
        os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
    except PermissionError:
        if not args.dry_run:
            raise
        lock_dir = tempfile.gettempdir()
    # One run per kind at a time: a slow Trivy scan must not stack up, but
    # it must not block the 5-minute metrics either.
    lock = open(os.path.join(lock_dir, f"pc-agent-{args.kind}.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log(f"another {args.kind} run is still in progress – skipping")
        return
    report = build_report(args.kind, cfg)
    body = shrink(report)
    if args.dry_run:
        print(json.dumps(json.loads(body), indent=2))
        return
    send(cfg, body)
    log(f"{args.kind} report delivered ({len(body)} bytes)")


# ---------------------------------------------------------------- install

HARDENING = """\
# Monitoring must never be the cause of load.
Nice=19
IOSchedulingClass=idle
CPUQuota=50%
MemoryMax=1500M
# Read everything, change nothing: no capabilities beyond reading files,
# /usr, /boot and /etc read-only, no privilege escalation.
CapabilityBoundingSet=CAP_DAC_READ_SEARCH
AmbientCapabilities=
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077
"""


def unit(kind, timeout):
    return f"""[Unit]
Description=Moatline agent ({kind} report)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart={sys.executable} {INSTALL_DIR}/pc-agent.py report {kind}
TimeoutStartSec={timeout}
{HARDENING}"""


TIMERS = {
    "metrics": """[Unit]
Description=Moatline agent – metrics every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
AccuracySec=30s

[Install]
WantedBy=timers.target
""",
    "full": """[Unit]
Description=Moatline agent – daily Trivy scan

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
""",
}


def write(path, content, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(path, mode)


# ---------------------------------------------------------------- tool setup
#
# Optional, and only from the vendors' own package repositories. Each step is
# idempotent (skipped when already in place) and never fatal: a failed Trivy
# install must not leave the server without the agent.

APT_ENV = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
# Fresh servers run apt on first boot; wait for its lock instead of failing.
APT = ["apt-get", "-y", "-q", "-o", "DPkg::Lock::Timeout=600"]


def sh(cmd, timeout=900):
    """Run a setup command, streaming nothing; return (ok, tail of output)."""
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, env=APT_ENV)
        out = p.stdout.decode("utf-8", "replace").strip().splitlines()
        return p.returncode == 0, "\n".join(out[-5:])
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def step(label, ok_detail):
    ok, detail = ok_detail
    log(f"{'✓' if ok else '✗'} {label}" + ("" if ok else f" – {detail}"))
    return ok


def have_apt():
    return shutil.which("apt-get") is not None


def setup_trivy():
    if shutil.which("trivy"):
        log("✓ Trivy already installed")
        return True
    if not have_apt():
        log("✗ Trivy: automatic install only on Debian/Ubuntu – see https://trivy.dev")
        return False
    log("installing Trivy (aquasecurity apt repository) …")
    step("prerequisites", sh(APT + ["install", "wget", "gnupg", "ca-certificates"]))
    ok, detail = sh(["bash", "-c",
        "set -e; wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key"
        " | gpg --dearmor --yes -o /usr/share/keyrings/trivy.gpg;"
        " echo 'deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main'"
        " > /etc/apt/sources.list.d/trivy.list"])
    if not step("Trivy repository", (ok, detail)):
        return False
    sh(APT + ["update"])
    return step("Trivy", sh(APT + ["install", "trivy"]))


def docker_names():
    if not shutil.which("docker"):
        return []
    code, out, _ = run(["docker", "ps", "--format", "{{.Names}}"], timeout=30)
    return out.split() if code == 0 else []


def wait_for_lapi(timeout=90):
    """Wait until CrowdSec's local API answers (it starts asynchronously)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if run(["cscli", "lapi", "status"], timeout=20)[0] == 0:
            return True
        time.sleep(3)
    return False


BOUNCER_CONFIG = "/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
LAPI_CONFIG = "/etc/crowdsec/config.yaml"
LAPI_CREDENTIALS = "/etc/crowdsec/local_api_credentials.yaml"


def lapi_port():
    """The port CrowdSec's local API listens on (8080 unless changed)."""
    m = re.search(r"^\s*listen_uri:\s*\S*:(\d+)\s*$", read(LAPI_CONFIG) or "", re.M)
    return int(m.group(1)) if m else 8080


def port_owner(port):
    """Names of the processes listening on a TCP port; "" when free, None when unknown."""
    if not shutil.which("ss"):
        return None
    code, out, _ = run(["ss", "-ltnpH", f"( sport = :{port} )"], timeout=15)
    if code != 0:
        return None
    if not out.strip():
        return ""
    return ", ".join(sorted(set(re.findall(r'\(\("([^"]+)"', out)))) or "another process"


def free_local_port(start=8081, end=8200):
    for port in range(start, end):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return None


def move_lapi_off_taken_port():
    """
    The local API listens on 127.0.0.1:8080 — a port Docker apps like to
    publish. When something else holds it, CrowdSec cannot start its API
    ("connection reset by peer") and the bouncer blocks nothing. Move the API
    to a free local port and point cscli and the bouncer at it.
    """
    port = lapi_port()
    owner = port_owner(port)
    if not owner or "crowdsec" in owner:
        return False
    new = free_local_port()
    if not new:
        log(f"✗ CrowdSec: port {port} is used by {owner} and no free local port was found.")
        return False
    log(f"port {port} is used by {owner} — moving CrowdSec's local API to 127.0.0.1:{new} …")
    for path, pattern, repl in (
        (LAPI_CONFIG, r"^(\s*listen_uri:\s*)\S+", rf"\g<1>127.0.0.1:{new}"),
        (LAPI_CREDENTIALS, r"^(\s*url:\s*)\S+", rf"\g<1>http://127.0.0.1:{new}"),
        (BOUNCER_CONFIG, r"^(\s*api_url:\s*)\S+", rf"\g<1>http://127.0.0.1:{new}/"),
    ):
        text = read(path)
        if text is None:
            continue
        changed = re.sub(pattern, repl, text, count=1, flags=re.M)
        if changed != text:
            write(path, changed, os.stat(path).st_mode & 0o777)
    run(["systemctl", "restart", "crowdsec"], timeout=120)
    ok = wait_for_lapi()
    if os.path.exists(BOUNCER_CONFIG):
        run(["systemctl", "restart", "crowdsec-firewall-bouncer"], timeout=120)
    step(f"CrowdSec local API on port {new}", (ok, "" if ok else "still not answering — see journalctl -u crowdsec"))
    return ok


def protect_docker_traffic():
    """
    By default the bouncer only filters the INPUT chain. Traffic to published
    container ports (Traefik on 80/443 on a Dokploy host) is forwarded and
    never passes INPUT, so a banned IP would still reach every website. Add
    the DOCKER-USER chain, which Docker evaluates for exactly that traffic.
    Returns True when the config was changed.
    """
    if not shutil.which("docker"):
        return False
    text = read(BOUNCER_CONFIG)
    if not text or "DOCKER-USER" in re.sub(r"#.*", "", text):
        return False
    m = re.search(r"^iptables_chains:\s*\n((?:[ \t]*(?:-[^\n]*|#[^\n]*)\n)*)", text, re.M)
    if not m:
        log("ℹ bouncer config has no iptables_chains list – add DOCKER-USER by hand to protect container ports")
        return False
    block = m.group(0)
    # Uncomment an existing "# - DOCKER-USER", otherwise append the entry.
    # Same indentation as the existing entries, or the YAML list breaks.
    first = re.search(r"^([ \t]*)-", block, re.M)
    indent = first.group(1) if first else "  "
    if re.search(r"^[ \t]*#[ \t]*-[ \t]*DOCKER-USER", block, re.M):
        new_block = re.sub(r"^[ \t]*#[ \t]*-[ \t]*DOCKER-USER[^\n]*", f"{indent}- DOCKER-USER", block, flags=re.M)
    else:
        new_block = block + f"{indent}- DOCKER-USER\n"
    write(BOUNCER_CONFIG, text.replace(block, new_block, 1), 0o600)
    log("✓ bouncer now also protects Docker container ports (DOCKER-USER chain)")
    return True


def setup_crowdsec(allowlist):
    if not have_apt():
        log("✗ CrowdSec: automatic install only on Debian/Ubuntu – see https://docs.crowdsec.net")
        return False
    if not shutil.which("cscli"):
        log("installing CrowdSec (packagecloud repository) …")
        ok = step("CrowdSec repository", sh(["bash", "-c", "set -e; curl -fsSL https://install.crowdsec.net | bash"]))
        if not ok:
            return False
        if not step("CrowdSec", sh(APT + ["install", "crowdsec"])):
            return False
    else:
        log("✓ CrowdSec already installed")
    if run(["cscli", "lapi", "status"], timeout=30)[0] != 0:
        move_lapi_off_taken_port()

    # Without a bouncer CrowdSec only watches. The firewall bouncer is what blocks.
    code, out, _ = run(["cscli", "bouncers", "list", "-o", "json"], timeout=60)
    bouncers = []
    try:
        bouncers = json.loads(out or "[]") or []
    except ValueError:
        pass
    if not bouncers:
        pkg = "crowdsec-firewall-bouncer-nftables" if shutil.which("nft") and not shutil.which("iptables") else "crowdsec-firewall-bouncer-iptables"
        # The bouncer's install script registers itself with the local API,
        # which is still starting right after CrowdSec was installed.
        wait_for_lapi()
        ok, detail = sh(APT + ["install", pkg])
        if not ok:
            wait_for_lapi()
            ok, detail = sh(["dpkg", "--configure", "-a"])
        step(f"firewall bouncer ({pkg})", (ok, detail))
    else:
        log(f"✓ bouncer already registered ({len(bouncers)})")
    if protect_docker_traffic():
        step("restart firewall bouncer", sh(["systemctl", "restart", "crowdsec-firewall-bouncer"], timeout=120))

    changed = False
    # Dokploy routes all web traffic through its Traefik container: point
    # CrowdSec at it, so attacks on the apps are seen, not only SSH.
    if "dokploy-traefik" in docker_names():
        acquis = "/etc/crowdsec/acquis.d/dokploy-traefik.yaml"
        if not os.path.exists(acquis):
            os.makedirs(os.path.dirname(acquis), exist_ok=True)
            write(acquis, "source: docker\ncontainer_name:\n  - dokploy-traefik\nlabels:\n  type: traefik\n", 0o644)
            step("CrowdSec Traefik collection", sh(["cscli", "collections", "install", "crowdsecurity/traefik"], timeout=300))
            changed = True
        log("ℹ Dokploy detected – CrowdSec reads the Traefik logs. Enable Traefik access logs in Dokploy for HTTP attacks to show up.")

    # Never ban Moatline's own scanners (Nuclei, port check).
    entries = [a for a in allowlist if a]
    if entries:
        ips = [a for a in entries if "/" not in a]
        cidrs = [a for a in entries if "/" in a]
        path = "/etc/crowdsec/parsers/s02-enrich/package-checker-allowlist.yaml"
        body = (
            "name: package-checker/allowlist\n"
            "description: \"Moatline scanners (Nuclei, external checks) – never ban\"\n"
            "whitelist:\n"
            "  reason: \"Moatline monitoring\"\n"
            + ("  ip:\n" + "".join(f"    - \"{i}\"\n" for i in ips) if ips else "")
            + ("  cidr:\n" + "".join(f"    - \"{c}\"\n" for c in cidrs) if cidrs else "")
        )
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if read(path) != body:
            write(path, body, 0o644)
            changed = True
        log(f"✓ CrowdSec allowlist for the scanner: {', '.join(entries)}")
    if changed:
        step("restart CrowdSec", sh(["systemctl", "restart", "crowdsec"], timeout=120))
    return True


TRUSTED_CROWDSEC = "/etc/crowdsec/parsers/s02-enrich/trusted-ips.yaml"
# Same file as harden-server.sh --trust-ip, so the two never disagree.
TRUSTED_FAIL2BAN = "/etc/fail2ban/jail.d/trusted-ips.local"


def parse_trusted(values, flag="--trust-ip"):
    """
    --trust-ip values (comma or space separated) as normalized addresses or
    networks. Wide ranges are refused: an allowlist that covers a provider
    switches the protection off for everyone in it.
    """
    out = []
    for raw in values or []:
        for item in re.split(r"[\s,]+", raw.strip()):
            if not item or item.lower() == "none":
                continue
            try:
                net = ipaddress.ip_network(item, strict=False)
            except ValueError:
                raise SystemExit(f"{flag}: not an IP address or network: {item}")
            if net.prefixlen < (24 if net.version == 4 else 48):
                raise SystemExit(f"{flag}: {item} is too wide (at most /24 for IPv4, /48 for IPv6)")
            single = net.prefixlen == net.max_prefixlen
            out.append(str(net.network_address) if single else str(net))
    return sorted(set(out))


def ssh_port():
    """The port sshd listens on (hardening may have moved it)."""
    code, out, _ = run(["sshd", "-T"], timeout=15)
    m = re.search(r"^port (\d+)$", out or "", re.M)
    return int(m.group(1)) if code == 0 and m else 22


def setup_tailscale(ssh_only):
    """
    Join the tailnet. The auth key is asked for here (or read from
    TS_AUTHKEY) — never put on the command line, where it would sit in the
    shell history and in `ps`.
    """
    if not shutil.which("tailscale"):
        log("installing Tailscale …")
        code, _, err = run(["sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"], timeout=600)
        if code != 0 or not shutil.which("tailscale"):
            log(f"✗ Tailscale could not be installed: {err.strip()[:300]}")
            return
    st = tailscale_status() or {}
    if st.get("BackendState") != "Running":
        key = os.environ.get("TS_AUTHKEY", "").strip() or getpass.getpass(
            "Tailscale auth key (tskey-auth-…; one-off and pre-approved is best): "
        ).strip()
        if not key.startswith("tskey-"):
            raise SystemExit("That does not look like a Tailscale auth key (tskey-…).")
        fd, keyfile = tempfile.mkstemp(prefix="pc-ts-")
        try:
            os.write(fd, key.encode())
            os.close(fd)
            code, _, err = run(
                ["tailscale", "up", f"--auth-key=file:{keyfile}", f"--hostname={socket.gethostname()}"],
                timeout=180,
            )
        finally:
            os.remove(keyfile)
        if code != 0:
            raise SystemExit(f"tailscale up failed: {err.strip()[:300]}")
    code, out, _ = run(["tailscale", "ip", "-4"], timeout=15)
    ip = out.strip().splitlines()[0] if code == 0 and out.strip() else None
    if not ip:
        log("✗ Tailscale did not report an address — SSH left as it is.")
        return
    log(f"✓ on the tailnet: {ip}")
    if ssh_only:
        restrict_ssh_to_tailscale(ip)


def restrict_ssh_to_tailscale(ip):
    """
    SSH only over the tailnet: allow it on tailscale0, then drop the public
    SSH rules. Only with ufw active and Tailscale up — never a lockout.
    A provider firewall (Hetzner, …) has to be changed there as well.
    """
    code, out, _ = run(["ufw", "status"], timeout=15)
    if code != 0 or "Status: active" not in out:
        log("! SSH stays public: ufw is not active. Turn on a firewall first (harden-server.sh does), then run again.")
        return
    port = ssh_port()
    run(["ufw", "allow", "in", "on", "tailscale0", "to", "any", "port", str(port), "proto", "tcp",
         "comment", "SSH over Tailscale (pc-agent)"], timeout=30)
    for rule in (["OpenSSH"], [f"{port}/tcp"], [str(port)]):
        run(["ufw", "--force", "delete", "allow", *rule], timeout=30)
    code, out, _ = run(["ufw", "status"], timeout=15)
    still = [l for l in out.splitlines() if re.match(rf"^{port}(/tcp)?\s+ALLOW\s+Anywhere", l.strip()) or l.strip().startswith("OpenSSH ")]
    if still:
        log(f"! a public SSH rule is left: {still[0].strip()} — remove it with ufw delete")
    else:
        log(f"✓ SSH (port {port}) only over Tailscale now: ssh <user>@{ip}. Open sessions stay; close the port in your provider's firewall too.")


def ssh_peers(port):
    """Addresses with an open SSH session right now — never locked out."""
    if not shutil.which("ss"):
        return []
    code, out, _ = run(["ss", "-tnH", "state", "established", f"( sport = :{port} )"], timeout=15)
    peers = set()
    for line in (out or "").splitlines() if code == 0 else []:
        parts = line.split()
        if len(parts) >= 4:
            host = parts[-1].rsplit(":", 1)[0].strip("[]")
            if host.startswith("::ffff:"):
                host = host[7:]
            try:
                peers.add(str(ipaddress.ip_address(host)))
            except ValueError:
                pass
    return sorted(peers)


def restrict_ssh_to(sources):
    """
    SSH only from these addresses — the Dokploy or Coolify server, the
    office. Allow them first, then drop the public SSH rules; SSH over
    Tailscale (tailscale0) stays as it is. Whoever is connected right now is
    allowed too, so running this over SSH cannot lock you out. Only with ufw
    active. A provider firewall (Hetzner, …) has to allow them as well.
    """
    code, out, _ = run(["ufw", "status"], timeout=15)
    if code != 0 or "Status: active" not in out:
        log("! SSH stays as it is: ufw is not active. Turn on a firewall first (harden-server.sh does), then run again.")
        return
    port = ssh_port()
    connected = [p for p in ssh_peers(port) if p not in sources]
    for src in sources + connected:
        why = "SSH (pc-agent --ssh-from)" if src in sources else "SSH, connected during install (pc-agent)"
        run(["ufw", "allow", "from", src, "to", "any", "port", str(port), "proto", "tcp", "comment", why], timeout=30)
    for rule in (["OpenSSH"], [f"{port}/tcp"], [str(port)]):
        run(["ufw", "--force", "delete", "allow", *rule], timeout=30)
    code, out, _ = run(["ufw", "status"], timeout=15)
    still = [l for l in out.splitlines() if re.match(rf"^{port}(/tcp)?(\s+\(v6\))?\s+ALLOW\s+(IN\s+)?Anywhere", l.strip()) or l.strip().startswith("OpenSSH ")]
    if still:
        log(f"! a public SSH rule is left: {still[0].strip()} — remove it with ufw delete")
    else:
        log(f"✓ SSH (port {port}) only from: {', '.join(sources)}")
    if connected:
        log(f"ℹ also allowed, connected right now: {', '.join(connected)} — remove with: ufw delete allow from <ip> to any port {port} proto tcp")
    log("ℹ close the port in your provider's firewall too, except for these addresses.")


def apply_trusted_ips(trusted):
    """
    Never ban these addresses (your office): a CrowdSec whitelist and
    fail2ban's ignoreip, and lift bans they already have. Without it, a few
    failed SSH logins lock the office out of SSH and every website on the
    server — CrowdSec's bouncer also guards the Docker ports.
    """
    if shutil.which("cscli"):
        if trusted:
            ips = [t for t in trusted if "/" not in t]
            cidrs = [t for t in trusted if "/" in t]
            body = (
                "name: local/trusted-ips\n"
                "description: \"Own addresses (pc-agent --trust-ip) – never ban\"\n"
                "whitelist:\n"
                "  reason: \"trusted (pc-agent --trust-ip)\"\n"
                + ("  ip:\n" + "".join(f"    - \"{i}\"\n" for i in ips) if ips else "")
                + ("  cidr:\n" + "".join(f"    - \"{c}\"\n" for c in cidrs) if cidrs else "")
            )
            os.makedirs(os.path.dirname(TRUSTED_CROWDSEC), exist_ok=True)
            if read(TRUSTED_CROWDSEC) != body:
                write(TRUSTED_CROWDSEC, body, 0o644)
                step("reload CrowdSec", sh(["systemctl", "reload-or-restart", "crowdsec"], timeout=120))
            for t in trusted:
                run(["cscli", "decisions", "delete", "--range" if "/" in t else "--ip", t], timeout=60)
            log(f"✓ CrowdSec never bans: {', '.join(trusted)}")
        elif os.path.exists(TRUSTED_CROWDSEC):
            os.remove(TRUSTED_CROWDSEC)
            step("reload CrowdSec", sh(["systemctl", "reload-or-restart", "crowdsec"], timeout=120))
            log("✓ CrowdSec trusted addresses removed")
    if shutil.which("fail2ban-client"):
        if trusted:
            body = "[DEFAULT]\nignoreip = 127.0.0.1/8 ::1 " + " ".join(trusted) + "\n"
            if read(TRUSTED_FAIL2BAN) != body:
                os.makedirs(os.path.dirname(TRUSTED_FAIL2BAN), exist_ok=True)
                write(TRUSTED_FAIL2BAN, body, 0o644)
                step("reload fail2ban", sh(["fail2ban-client", "reload"], timeout=120))
            for t in trusted:
                if "/" not in t:
                    run(["fail2ban-client", "unban", t], timeout=30)
            log(f"✓ fail2ban never bans: {', '.join(trusted)}")
        elif os.path.exists(TRUSTED_FAIL2BAN):
            os.remove(TRUSTED_FAIL2BAN)
            step("reload fail2ban", sh(["fail2ban-client", "reload"], timeout=120))


def setup_auto_updates():
    if not have_apt():
        if shutil.which("dnf"):
            return step("dnf-automatic", sh(["bash", "-c",
                "dnf install -y -q dnf-automatic && sed -i 's/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf"
                " && systemctl enable --now dnf-automatic.timer"]))
        return False
    code, out, _ = run(["apt-config", "dump"], timeout=30)
    if 'APT::Periodic::Unattended-Upgrade "1";' in out and shutil.which("unattended-upgrade"):
        log("✓ automatic security updates already on")
        return True
    if not step("unattended-upgrades", sh(APT + ["install", "unattended-upgrades"])):
        return False
    # Security updates only (the distribution's default origins); reboot
    # policy is left to the operator (save-server/auto-update.sh sets it).
    write("/etc/apt/apt.conf.d/20auto-upgrades",
          'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n', 0o644)
    log("✓ automatic security updates enabled")
    return True


def enroll(url, code):
    try:
        res = post_json(url.rstrip("/") + "/api/agent/enroll", {"code": code, "hostname": socket.gethostname()}, timeout=30)
    except urllib.error.HTTPError as e:
        detail = e.read(2000).decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("error", detail)
        except ValueError:
            pass
        raise SystemExit(f"Enrollment failed: {detail}")
    except (urllib.error.URLError, OSError) as e:
        raise SystemExit(f"Moatline not reachable at {url}: {e}")
    token = res.get("token", "")
    if not re.fullmatch(r"pca_[A-Za-z0-9_-]{20,100}", token):
        raise SystemExit("Enrollment answered without a valid token.")
    log(f"✓ enrolled as \"{res.get('serverName', '?')}\"")
    return token, [str(a) for a in res.get("crowdsecAllowlist") or []]


def cmd_install(args):
    if os.geteuid() != 0:
        raise SystemExit("install must run as root (sudo).")
    url = args.url.rstrip("/")
    require_safe_url(url, args.allow_http)
    # Checked before anything is installed: a typo must not get halfway.
    ssh_from = parse_trusted(args.ssh_from, "--ssh-from") if args.ssh_from else []

    existing = None
    if os.path.exists(CONFIG_PATH):
        try:
            existing = json.loads(read(CONFIG_PATH) or "{}")
        except ValueError:
            existing = None

    allowlist = []
    if args.enroll:
        # A one-time code (valid one hour) — exchanged for the real token, so
        # what sits in the shell history is already worthless.
        token, allowlist = enroll(url, args.enroll.strip())
    elif os.environ.get("PC_AGENT_TOKEN"):
        token = os.environ["PC_AGENT_TOKEN"].strip()
    elif existing and existing.get("token") and existing.get("url", "").rstrip("/") == url:
        token = existing["token"]
        allowlist = existing.get("crowdsecAllowlist", [])
        log("re-using the token from the existing installation")
    else:
        # Never from the command line, where it would land in history and `ps`.
        token = getpass.getpass("Agent token (pca_…): ").strip()
    if not re.fullmatch(r"pca_[A-Za-z0-9_-]{20,100}", token):
        raise SystemExit("That does not look like an agent token (pca_…).")

    # Given → replaces the list ("none" clears it); not given → keep.
    trusted = (
        parse_trusted(args.trust_ip)
        if args.trust_ip is not None
        else list((existing or {}).get("trustedIps") or [])
    )

    # An update (same URL, no new flags) keeps what the last install set.
    same = bool(existing) and existing.get("url", "").rstrip("/") == url
    trivy_cfg = {"scanImages": not args.no_images, "severity": DEFAULT_SEVERITY, "maxImages": 30, "skipDirs": []}
    if same and not args.no_images and isinstance(existing.get("trivy"), dict):
        trivy_cfg = {**trivy_cfg, **existing["trivy"]}
    cfg = {
        "url": url,
        "token": token,
        "allowHttp": bool(args.allow_http) or (same and bool(existing.get("allowHttp"))),
        "crowdsec": True,
        "crowdsecAllowlist": allowlist,
        "trustedIps": trusted,
        "trivy": trivy_cfg,
        # Error lines from container logs, scrubbed (see collect_log_errors).
        "logErrors": not args.no_logs and not (same and existing.get("logErrors") is False),
    }
    # Written right away: the enrollment code is spent, so a later failure
    # must still leave a re-runnable installation behind.
    os.makedirs(os.path.dirname(CONFIG_PATH), mode=0o700, exist_ok=True)
    write(CONFIG_PATH, json.dumps(cfg, indent=2) + "\n", 0o600)
    os.makedirs(INSTALL_DIR, mode=0o755, exist_ok=True)
    shutil.copyfile(os.path.abspath(__file__), os.path.join(INSTALL_DIR, "pc-agent.py"))
    os.chmod(os.path.join(INSTALL_DIR, "pc-agent.py"), 0o755)
    os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)

    if args.trivy:
        setup_trivy()
    if args.crowdsec:
        setup_crowdsec(allowlist)
    if args.auto_updates:
        setup_auto_updates()
    if trusted or args.trust_ip is not None:
        apply_trusted_ips(trusted)
    if args.tailscale or args.tailscale_ssh_only:
        setup_tailscale(args.tailscale_ssh_only)
    if ssh_from:
        restrict_ssh_to(ssh_from)

    log("sending a first report to verify URL and token …")
    send(cfg, shrink(build_report("metrics", cfg)))
    log("✓ verified")

    write(f"{UNIT_DIR}/pc-agent-metrics.service", unit("metrics", "10min"), 0o644)
    write(f"{UNIT_DIR}/pc-agent-full.service", unit("full", "3h"), 0o644)
    for kind, body in TIMERS.items():
        write(f"{UNIT_DIR}/pc-agent-{kind}.timer", body, 0o644)
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", "pc-agent-metrics.timer", "pc-agent-full.timer"])
    # First Trivy scan now rather than tomorrow at four.
    run(["systemctl", "start", "--no-block", "pc-agent-full.service"])

    missing = [t for t in ("trivy", "cscli") if not shutil.which(t)]
    log("installed. Timers: pc-agent-metrics.timer (5 min), pc-agent-full.timer (daily, first scan running now).")
    if missing:
        log(f"not installed on this server: {', '.join(missing)} – the dashboard shows that coverage is missing.")


def cmd_uninstall(_args):
    if os.geteuid() != 0:
        raise SystemExit("uninstall must run as root (sudo).")
    run(["systemctl", "disable", "--now", "pc-agent-metrics.timer", "pc-agent-full.timer"])
    for name in ("pc-agent-metrics.service", "pc-agent-full.service", "pc-agent-metrics.timer", "pc-agent-full.timer"):
        try:
            os.remove(f"{UNIT_DIR}/{name}")
        except FileNotFoundError:
            pass
    run(["systemctl", "daemon-reload"])
    shutil.rmtree(INSTALL_DIR, ignore_errors=True)
    shutil.rmtree(os.path.dirname(CONFIG_PATH), ignore_errors=True)
    shutil.rmtree(CACHE_DIR, ignore_errors=True)
    log("removed. Revoke the token in Moatline as well.")


def main():
    p = argparse.ArgumentParser(description="Moatline server agent")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("install", help="install, verify and enable the timers")
    i.add_argument("--url", required=True, help="URL of Moatline as reachable from this server")
    i.add_argument("--enroll", help="one-time install code (pce_…) from Moatline")
    i.add_argument("--trivy", action="store_true", help="install Trivy if missing")
    i.add_argument("--crowdsec", action="store_true", help="install CrowdSec + firewall bouncer if missing")
    i.add_argument("--auto-updates", action="store_true", help="enable automatic security updates")
    i.add_argument("--all", action="store_true", help="--trivy --crowdsec --auto-updates")
    i.add_argument("--no-images", action="store_true", help="do not scan the images of running containers")
    i.add_argument("--no-logs", action="store_true", help="do not send error lines from container logs")
    i.add_argument("--tailscale", action="store_true", help="join the tailnet (asks for an auth key, or TS_AUTHKEY)")
    i.add_argument("--tailscale-ssh-only", action="store_true",
                   help="also allow SSH only over Tailscale (needs ufw active)")
    i.add_argument("--ssh-from", action="append", metavar="IP[,IP…]",
                   help="allow SSH only from these addresses/networks (the Dokploy or Coolify server, your office); needs ufw active")
    i.add_argument("--trust-ip", action="append", metavar="IP[,IP…]",
                   help="never ban these addresses/networks in CrowdSec and fail2ban (your office); 'none' clears")
    i.add_argument("--allow-http", action="store_true", help=argparse.SUPPRESS)
    r = sub.add_parser("report", help="collect and send one report")
    r.add_argument("kind", choices=["metrics", "full"])
    r.add_argument("--dry-run", action="store_true", help="print the report instead of sending it")
    sub.add_parser("uninstall", help="remove timers, config and cache")
    sub.add_parser("version")
    args = p.parse_args()
    if args.cmd == "install" and args.all:
        args.trivy = args.crowdsec = args.auto_updates = True
    if args.cmd == "install":
        cmd_install(args)
    elif args.cmd == "report":
        cmd_report(args)
    elif args.cmd == "uninstall":
        cmd_uninstall(args)
    else:
        print(VERSION)


if __name__ == "__main__":
    main()
