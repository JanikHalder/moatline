import type { ServerFinding } from "./api";
import { formatRelative } from "./schedule";
import { tx } from "./i18n";

/**
 * Findings in plain words, for people who run sites but not servers: what
 * happened, what it can lead to, what to do. The API keeps its precise,
 * technical titles (they go into notifications, exports and the MCP); this
 * is the layer the interface reads. Unknown kinds fall back to the API's
 * title, so a new finding type shows up before it has an explanation.
 */

/** Where in the app the fix is, or what one click does. */
export type FixAction =
  | { kind: "redeploy"; app: string }
  | { kind: "tab"; tab: "maintenance" | "agent" | "security" | "apps" }
  | { kind: "settings" };

export type Explanation = {
  title: string;
  /** What it means and what can happen; null when the title says it all. */
  meaning: string | null;
  /** What to do. */
  action: string | null;
  /** Nothing to do: the server's own automation takes care of it. */
  selfResolving: boolean;
  fix: FixAction | null;
};

type F = Pick<
  ServerFinding,
  | "source"
  | "fingerprint"
  | "title"
  | "severity"
  | "target"
  | "fixAvailable"
  | "autoFixAt"
>;

/** "mongo-db-z3.1.ghi" → "mongo-db-z3": Swarm's task suffix means nothing to people. */
export function appName(container: string): string {
  return container.replace(/\.\d+\.[a-z0-9]{6,}$/i, "");
}

const after = (fp: string, prefix: string) => fp.slice(prefix.length);
const firstNumber = (s: string) => s.match(/\d+(?:\.\d+)?/)?.[0] ?? "";
const date = (s: string) => s.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";

function e(
  title: string,
  meaning: string | null,
  action: string | null,
  extra: Partial<Pick<Explanation, "selfResolving" | "fix">> = {}
): Explanation {
  return {
    title,
    meaning,
    action,
    selfResolving: extra.selfResolving ?? false,
    fix: extra.fix ?? null,
  };
}

const MAINTENANCE: FixAction = { kind: "tab", tab: "maintenance" };
const SETUP: FixAction = { kind: "tab", tab: "agent" };

function host(f: F): Explanation | null {
  const fp = f.fingerprint;
  if (fp.startsWith("os-eol:")) {
    const os = after(fp, "os-eol:");
    return f.title.includes(" gets no ")
      ? e(
          tx("The operating system no longer gets security updates"),
          tx(
            "{os} has been out of support since {date}. New security holes in it are not fixed anymore, so the server gets easier to attack every month.",
            { os, date: date(f.title) }
          ),
          tx(
            "Move the server to a supported version (Ubuntu 24.04 LTS). The guide walks you through it, including keeping the IP address."
          )
        )
      : e(
          tx("Support for the operating system ends soon"),
          tx("{os} gets security updates only until {date}.", {
            os,
            date: date(f.title),
          }),
          tx("Plan the move to a supported version before then.")
        );
  }
  if (fp === "tailscale:down")
    return e(
      tx("The server is not connected to Tailscale"),
      tx(
        "It cannot be reached over your private network. If SSH is only allowed over Tailscale, SSH is closed too."
      ),
      tx(
        "Log in through your provider's web console and run: sudo tailscale up"
      )
    );
  if (fp === "tailscale:key-expiry")
    return e(
      f.title.includes("expired")
        ? tx("The Tailscale key has expired")
        : tx("The Tailscale key expires soon"),
      tx("When it expires, the server drops off your private network."),
      tx("Turn off key expiry for this machine in the Tailscale admin console.")
    );
  if (fp === "tailscale:ssh")
    return e(
      tx("Tailscale SSH is on: SSH keys no longer let anyone in"),
      tx(
        "Over Tailscale, Tailscale itself now decides who may log in — not the SSH keys on the server. You on your laptop still get in, but tools that log in with a key are refused: Dokploy and Coolify for their remote servers, deploys from GitHub Actions. That is usually why Dokploy suddenly cannot reach this server."
      ),
      tx(
        'Option A (simplest): on the server run "sudo tailscale set --ssh=false". The keys count again, and SSH still only goes over Tailscale. The machine running Dokploy or Coolify must be in your tailnet; connect it to the server\'s 100.x address. Option B (keep Tailscale SSH): in the Tailscale admin console under Access controls, add an SSH rule that lets the Dokploy or Coolify machine log in as root with "action": "accept" — "check" asks for a browser login, which no tool can do.'
      )
    );
  if (fp === "tailscale:ssh-tailnet-only")
    return e(
      tx("SSH is open only over Tailscale"),
      tx(
        "The firewall no longer lets SSH in from the internet — only over your tailnet. Tools that connect to the server's public IP stop working: Dokploy, Coolify, deploys from GitHub Actions."
      ),
      tx(
        'Add the machine running Dokploy or Coolify to your tailnet (install Tailscale there and run "sudo tailscale up"), then change the server\'s address in Dokploy or Coolify to its 100.x Tailscale address.'
      )
    );
  if (fp === "load")
    return e(
      tx("The server is overloaded"),
      tx(
        "The processor is fully busy. Sites on this server get slow or stop answering."
      ),
      tx(
        "See on the Apps tab which app uses the processor. A bigger server or moving an app helps."
      ),
      { fix: { kind: "tab", tab: "apps" } }
    );
  if (fp === "iowait")
    return e(
      tx("The disk slows the server down"),
      tx(
        "Programs keep waiting for the disk — often a database or a backup doing heavy work."
      ),
      tx(
        "Check which app is busy. If it lasts, a server with a faster disk helps."
      )
    );
  if (fp === "steal")
    return e(
      tx("Other machines on the same hardware slow this server down"),
      tx(
        "Your provider shares the hardware, and others take part of the processor time."
      ),
      tx(
        "If it lasts, switch to a plan with dedicated CPU or ask the provider to move the server."
      )
    );
  if (fp === "memory")
    return e(
      tx("The server is running out of memory"),
      tx(
        "When memory runs out, Linux stops programs to save itself — usually the biggest one, often a database."
      ),
      tx(
        "See on the Apps tab what uses the most memory. Set memory limits or move to a bigger server."
      ),
      { fix: { kind: "tab", tab: "apps" } }
    );
  if (fp.startsWith("disk:"))
    return e(
      tx("The disk is almost full ({pct})", {
        pct: f.title.match(/\d+(?:\.\d+)?\s?%/)?.[0] ?? "",
      }),
      tx(
        "When it is full, databases stop saving, deploys fail and sites go down."
      ),
      tx(
        "Free up space. Deleting Docker's unused build cache and images on the Maintenance tab is often enough."
      ),
      { fix: MAINTENANCE }
    );
  if (fp === "oom:build")
    return e(
      tx("A deploy ran the server out of memory"),
      tx(
        "Dokploy and Coolify build on the server the sites run on. A big build took the memory, and the kernel killed the biggest process to survive — often the running app."
      ),
      tx(
        "Build on a separate build server, or give builds a memory limit and add swap. The finding goes away a day after the last kill."
      )
    );
  if (fp === "oom:host")
    return e(
      tx("The server ran out of memory"),
      tx(
        "The kernel had to kill processes to keep the server alive. Whatever was killed stopped working until it was restarted."
      ),
      tx(
        "Give the apps memory limits (and NODE_OPTIONS=--max-old-space-size for Node apps), add swap, or move work to another server."
      )
    );
  if (fp.startsWith("disk-forecast:"))
    return e(
      tx("The disk will be full soon ({when})", {
        when: f.title.replace(/^.* full /, ""),
      }),
      tx(
        "It keeps filling up at the same pace as over the last week. When it is full, databases stop saving, deploys fail and sites go down."
      ),
      tx(
        "Look at what grows on the Maintenance tab — often backups or uploads in S3 storage. Delete what is no longer needed, or give the disk more space."
      ),
      { fix: MAINTENANCE }
    );
  if (fp.startsWith("storage:limit:"))
    return e(
      f.severity === "high"
        ? tx("A storage is bigger than its limit")
        : tx("A storage is almost at its limit"),
      tx(
        "You set a limit for this storage so it does not take the whole disk. It is now at or close to that limit."
      ),
      tx(
        "See the biggest buckets on the Maintenance tab. Let old backups expire automatically, delete what is no longer needed, or raise the limit."
      ),
      { fix: MAINTENANCE }
    );
  if (fp.startsWith("storage:forecast:"))
    return e(
      tx("A storage will reach its limit soon"),
      tx(
        "At the pace of the last week, this storage outgrows the limit you set within two weeks."
      ),
      tx(
        "See what grows on the Maintenance tab and let old data expire, or raise the limit."
      ),
      { fix: MAINTENANCE }
    );
  if (fp.startsWith("storage:error:"))
    return e(
      tx("A storage could not be measured"),
      tx(
        "The agent could not find or measure the folder, so it cannot warn you when it gets too big."
      ),
      tx(
        "Check the folder on the Maintenance tab — it may have moved. Fix the path or stop watching it."
      ),
      { fix: MAINTENANCE }
    );
  if (fp === "docker:reclaimable")
    return e(
      tx("Old build files take up {size}", {
        size: f.title.match(/\d+(?:\.\d+)?\s?[KMGT]B/)?.[0] ?? "",
      }),
      tx(
        "Every deploy leaves build cache and an old image behind. Deleting them is safe — running apps are not touched."
      ),
      tx("Delete them with one click on the Maintenance tab."),
      { fix: MAINTENANCE }
    );
  if (fp === "updates:error")
    return e(
      tx("Available updates could not be checked"),
      tx("The server could not read which updates are available."),
      tx("Run sudo apt-get update on the server and look at the error.")
    );
  if (fp === "updates:security") {
    const n = firstNumber(f.title);
    return f.autoFixAt
      ? e(
          tx("{n} security updates waiting — installed automatically", { n }),
          tx("They close known security holes."),
          tx("Nothing to do: automatic updates install them {when}.", {
            when: formatRelative(f.autoFixAt) ?? "",
          }),
          { selfResolving: true }
        )
      : e(
          tx("{n} security updates waiting", { n }),
          tx(
            "They close known security holes, and nothing installs them automatically."
          ),
          tx(
            "Turn on automatic updates on the Setup tab, or install them now with the command there."
          ),
          { fix: SETUP }
        );
  }
  if (fp === "updates:stuck")
    return e(
      tx("Security updates have been waiting for days"),
      tx(
        "Automatic updates should have installed them by now — something is blocking them."
      ),
      tx("Run the update command from the Setup tab and read its output."),
      { fix: SETUP }
    );
  if (fp.startsWith("unattended:"))
    return e(
      tx("Automatic updates are not working"),
      fp === "unattended:never"
        ? tx("They are switched on, but have never run.")
        : fp === "unattended:silent"
          ? tx("They have not run for days.")
          : tx("The last run failed."),
      tx(
        "Set up automatic updates again with the command on the Setup tab. It repairs the configuration."
      ),
      { fix: SETUP }
    );
  if (fp === "updates:pending")
    return e(
      tx("{n} regular updates available", { n: firstNumber(f.title) }),
      tx("Newer versions without security fixes. Not urgent."),
      tx("Install them at your next maintenance.")
    );
  if (fp === "reboot-required") {
    if (f.autoFixAt)
      return e(
        tx("Restart scheduled"),
        tx("An update only takes effect after a restart."),
        tx(
          "Nothing to do: the server restarts by itself {when}, and the apps start again.",
          { when: formatRelative(f.autoFixAt) ?? "" }
        ),
        { selfResolving: true }
      );
    return f.title.includes("pending for")
      ? e(
          tx("The server has been waiting days for a restart"),
          tx(
            "An installed update (usually the kernel) is not active until the server restarts."
          ),
          tx(
            "Restart it at a quiet time with sudo reboot — the apps start again by themselves. Or set a nightly restart time on the Setup tab."
          ),
          { fix: SETUP }
        )
      : e(
          tx("The server needs a restart"),
          tx(
            "An installed update (usually the kernel) is not active until the server restarts."
          ),
          tx(
            "Restart it at a quiet time, or set a nightly restart time on the Setup tab."
          ),
          { fix: SETUP }
        );
  }
  if (fp === "auto-updates-off")
    return e(
      tx("Automatic security updates are off"),
      tx("Security fixes are installed only when someone does it by hand."),
      tx("Turn them on with the command on the Setup tab."),
      { fix: SETUP }
    );
  if (fp === "updates:stale-lists")
    return e(
      tx("The server has not looked for updates in a while"),
      null,
      tx(
        "Run sudo apt-get update. With automatic updates on, this happens by itself."
      ),
      { fix: SETUP }
    );
  if (fp.startsWith("container:unhealthy:")) {
    const app = appName(after(fp, "container:unhealthy:"));
    return e(
      tx("{app} runs, but is not healthy", { app }),
      tx("Its own health check fails — it may not answer requests."),
      tx("Look at its logs. A redeploy often helps."),
      { fix: { kind: "redeploy", app } }
    );
  }
  if (fp.startsWith("container:restarting:")) {
    const app = appName(after(fp, "container:restarting:"));
    return e(
      tx("{app} keeps crashing and restarting", { app }),
      tx(
        "It never stays up. Everything that depends on it — a site that needs this database, for example — fails too."
      ),
      tx("Look at its logs for the reason. A redeploy often fixes it."),
      { fix: { kind: "redeploy", app } }
    );
  }
  if (fp.startsWith("service:")) {
    const name = after(fp, "service:");
    return e(
      f.title.includes(" is down")
        ? tx("{app} is down", { app: name })
        : tx("{app} runs only partly", { app: name }),
      tx("Fewer copies run than should."),
      tx("Redeploy it and look at its logs."),
      { fix: { kind: "redeploy", app: name } }
    );
  }
  if (fp.startsWith("backup:"))
    return e(
      f.title.includes("hours old")
        ? tx("A backup is too old")
        : tx("A backup is missing"),
      tx(
        "If something breaks now, everything since the last good backup is lost."
      ),
      tx("Check the backup job that writes to this folder.")
    );
  if (fp.startsWith("usage:")) {
    const [, kind, raw = ""] = fp.split(":");
    const app = appName(raw);
    const redeploy: FixAction = { kind: "redeploy", app };
    if (kind === "oom")
      return e(
        tx("{app} crashed because it ran out of memory", { app }),
        tx("Linux stopped it to protect the server."),
        tx(
          "Raise the memory limit, set NODE_OPTIONS=--max-old-space-size to ~75% of it, and check the Next.js checklist: unbounded caches, Payload/media in RAM, image optimization. A heap snapshot shows what grew."
        ),
        { fix: redeploy }
      );
    if (kind === "limit")
      return e(
        tx("{app} is close to its memory limit", { app }),
        tx("At the limit it is stopped and restarted."),
        tx(
          "Raise the limit in Dokploy or Coolify, or shrink usage — set NODE_OPTIONS=--max-old-space-size so Node dies before the host does. See Memory on the repository or Apps tab."
        )
      );
    if (kind === "memory")
      return e(
        tx("{app} uses much more memory than usual", { app }),
        tx(
          "Growing between deploys usually means a leak (caches, listeners, Payload). A Next.js app often settles after warm-up — a line that only climbs is the problem."
        ),
        tx(
          "Redeploy frees memory for now. Then set a limit + NODE_OPTIONS, open the memory chart, and take a heap snapshot if it climbs again."
        ),
        { fix: redeploy }
      );
    if (kind === "share")
      return e(
        tx("{app} takes a large share of the server's memory", { app }),
        tx("Without a limit it can starve the other apps on the server."),
        tx(
          "Set a memory limit (and NODE_OPTIONS=--max-old-space-size at ~75% of it) in Dokploy or Coolify. Then check why the Next.js/Node process needs that much."
        )
      );
    if (kind === "cpu")
      return e(
        tx("{app} keeps the processor busy", { app }),
        tx("The other apps on the server get less processor time."),
        tx(
          "Check whether that is expected (an import, for example). Otherwise look at its logs."
        )
      );
  }
  return null;
}

function crowdsec(f: F): Explanation | null {
  const fix = SETUP;
  switch (f.fingerprint) {
    case "unavailable":
      return e(
        tx("Attack protection (CrowdSec) is not running"),
        tx(
          "Password guessing and attacks on the sites are no longer blocked automatically."
        ),
        tx("Run the agent install again with CrowdSec selected (Setup tab)."),
        { fix }
      );
    case "error":
      return e(
        tx("Attack protection could not be checked completely"),
        null,
        tx(
          "Usually temporary. If it stays, run sudo cscli metrics on the server."
        )
      );
    case "no-bouncer":
      return e(
        tx("Attack protection detects attacks, but blocks nothing"),
        tx(
          "CrowdSec recognizes attackers, but no firewall bouncer turns that into blocks."
        ),
        tx(
          "Run the agent install again with CrowdSec selected — it adds the firewall bouncer."
        ),
        { fix }
      );
  }
  if (f.fingerprint.startsWith("bouncer:"))
    return e(
      tx("Attack protection has stopped blocking"),
      tx("The firewall bouncer no longer picks up new blocks."),
      tx(
        "Restart it on the server: sudo systemctl restart crowdsec-firewall-bouncer"
      )
    );
  return null;
}

function trivy(f: F): Explanation | null {
  if (f.fingerprint === "unavailable" || f.fingerprint === "error")
    return e(
      tx("The vulnerability scan did not run"),
      tx(
        "Known security holes in this server's software are unknown right now."
      ),
      tx("Run the agent install again with Trivy selected (Setup tab)."),
      { fix: SETUP }
    );
  const parts = f.fingerprint.split("|");
  if (parts.length < 4) return null;
  const [kind, target = "", pkg = ""] = parts;
  const meaning =
    f.severity === "critical"
      ? tx("Rated critical: attackers can likely exploit it from the internet.")
      : f.severity === "high"
        ? tx("Rated high: exploitable under common conditions.")
        : tx("Rated low to medium: exploitable only under special conditions.");
  if (kind === "host") {
    const title = tx("Known security hole in the system package {pkg}", {
      pkg,
    });
    if (f.fixAvailable && f.autoFixAt)
      return e(
        title,
        meaning,
        tx("Nothing to do: automatic updates install the fix {when}.", {
          when: formatRelative(f.autoFixAt) ?? "",
        }),
        { selfResolving: true }
      );
    return f.fixAvailable
      ? e(
          title,
          meaning,
          tx(
            "A fix exists. Install the updates (Setup tab → run updates now)."
          ),
          { fix: SETUP }
        )
      : e(
          title,
          meaning,
          tx(
            "No fix exists yet. Nothing to do now — it closes by itself once the update ships."
          ),
          { selfResolving: true }
        );
  }
  const image = target;
  const app = f.target?.match(/\(([^,)]+)/)?.[1];
  const title = tx("Known security hole in {pkg}, inside {image}", {
    pkg,
    image,
  });
  return f.fixAvailable
    ? e(
        title,
        meaning,
        tx(
          "A fixed version exists. Redeploy the app so it is rebuilt; if the image version is pinned, raise it."
        ),
        app ? { fix: { kind: "redeploy", app: appName(app) } } : {}
      )
    : e(
        title,
        meaning,
        tx(
          "No fixed version yet. Check whether a newer image exists; otherwise wait for one."
        )
      );
}

function security(f: F): Explanation | null {
  const fp = f.fingerprint;
  const harden = tx(
    "Harden the server (Setup tab, step 1). It switches password login off — SSH keys keep working."
  );
  if (fp === "ssh:empty-passwords")
    return e(
      tx("Accounts without a password can log in over SSH"),
      tx("Anyone who finds such an account gets onto the server."),
      harden,
      { fix: SETUP }
    );
  if (fp === "ssh:password-auth")
    return e(
      tx("SSH accepts passwords"),
      tx(
        "Bots try millions of passwords on every server. One weak password is enough to get in."
      ),
      harden,
      { fix: SETUP }
    );
  if (fp === "ssh:root-password")
    return e(
      tx("The admin account (root) can log in with a password"),
      tx("If the password is guessed, the attacker controls the whole server."),
      harden,
      { fix: SETUP }
    );
  if (fp === "firewall:off")
    return e(
      tx("The server has no firewall of its own"),
      tx("Every program that opens a port is reachable from the internet."),
      tx(
        "Harden the server (Setup tab, step 1): it turns on a firewall with only SSH, 80 and 443 open."
      ),
      { fix: SETUP }
    );
  if (fp === "bruteforce:none")
    return e(
      tx("Nothing stops password guessing on SSH"),
      tx("Attackers can try passwords as long as they like."),
      tx(
        "Install CrowdSec with the agent, or fail2ban with the hardening (both on the Setup tab)."
      ),
      { fix: SETUP }
    );
  if (fp.startsWith("access:key:"))
    return e(
      tx("A new SSH key can log in as {user}", { user: f.target ?? "" }),
      tx(
        "Whoever has this key can log into the server. If nobody on your team added it, treat it as a break-in."
      ),
      tx(
        "If it was you or your team, accept it on the Security tab. Otherwise remove it from authorized_keys and change all keys and passwords."
      ),
      { fix: { kind: "tab", tab: "security" } }
    );
  if (fp.startsWith("access:group:"))
    return e(
      tx("{user} got admin rights", { user: f.target ?? "" }),
      tx("If nobody on your team did this, treat it as a break-in."),
      tx(
        "If it was intended, accept it on the Security tab. Otherwise remove the user from the group."
      ),
      { fix: { kind: "tab", tab: "security" } }
    );
  if (fp.startsWith("access:uid0:"))
    return e(
      tx("A second admin account appeared: {user}", { user: f.target ?? "" }),
      tx("This is a classic sign of a break-in."),
      tx(
        "Treat it as a break-in: find out who created it, remove it and change all keys and passwords."
      )
    );
  if (fp === "stale-libraries")
    return e(
      tx("Some services still run old code after an update"),
      tx(
        "The update is installed, but running programs keep the old, vulnerable version until they restart."
      ),
      tx(
        "Restart the services listed in the details, or the whole server at a quiet time."
      )
    );
  const container = (prefix: string) =>
    appName(after(fp, prefix).split(":")[0] ?? "");
  if (fp.startsWith("docker:privileged:"))
    return e(
      tx("{app} has full control over the server", {
        app: container("docker:privileged:"),
      }),
      tx(
        "A privileged container can do anything the server can. If the app is hacked, so is the server."
      ),
      tx("Turn privileged mode off unless the app really needs it.")
    );
  if (fp.startsWith("docker:socket:"))
    return e(
      tx("{app} can control Docker", { app: container("docker:socket:") }),
      tx(
        "Access to the Docker socket is the same as admin rights on the server."
      ),
      f.severity === "low"
        ? tx("Expected for platform tools like Dokploy and Traefik.")
        : tx(
            "Only platform tools (Dokploy, Coolify, Traefik) need this. Remove it from other apps."
          )
    );
  if (fp.startsWith("docker:host-network:"))
    return e(
      tx("{app} shares the server's network", {
        app: container("docker:host-network:"),
      }),
      tx("It bypasses Docker's isolation and can open any port on the server."),
      tx("Use a normal Docker network unless it really needs this.")
    );
  if (fp.startsWith("docker:mount:")) {
    const [name = "", ...path] = after(fp, "docker:mount:").split(":");
    return e(
      tx("{app} can change files on the server ({path})", {
        app: appName(name),
        path: path.join(":"),
      }),
      tx("If the app is hacked, the attacker can change the server's files."),
      tx("Mount the folder read-only, or only the folder the app needs.")
    );
  }
  if (fp.startsWith("docker:cap:"))
    return e(
      tx("{app} has extra system rights", { app: container("docker:cap:") }),
      tx("These rights let a hacked app reach beyond its container."),
      tx("Remove the extra capability unless the app needs it.")
    );
  if (fp.startsWith("docker:published:")) {
    const what =
      f.title.match(/^Port \d+(?: \([^)]*\))?/)?.[0] ??
      `Port ${after(fp, "docker:published:")}`;
    const action = tx(
      "Remove the port mapping, or bind it to 127.0.0.1. Apps reach each other over the internal network, you over Tailscale."
    );
    return f.title.includes("reachable from the internet")
      ? e(
          tx("{what} is open to the internet", { what }),
          tx(
            "Anyone can connect to it. Databases and admin tools should never be public."
          ),
          action
        )
      : e(
          tx("{what} is kept closed only by a firewall", { what }),
          tx(
            "Docker opens ports past the server's own firewall. One wrong firewall change exposes it."
          ),
          action
        );
  }
  if (fp === "docker:default-bridge")
    return e(
      tx("Several containers share Docker's default network"),
      tx("They can all reach each other."),
      tx("Give each project its own network — Dokploy and Coolify do that.")
    );
  if (fp.startsWith("docker:shared-network:"))
    return e(
      tx("Apps share a network with databases"),
      tx("If one app is hacked, it can reach the databases of the others."),
      tx("Give each project its own network.")
    );
  if (fp.startsWith("listener:"))
    return e(
      tx("A service listens on all network interfaces (port {port})", {
        port: after(fp, "listener:"),
      }),
      tx(
        "It is not reachable from outside right now — only the firewall keeps it so."
      ),
      tx("Bind it to 127.0.0.1 if it does not need to be reachable.")
    );
  if (fp.startsWith("compromise:"))
    return e(
      tx("Possible break-in: {what}", { what: tx(f.title) }),
      tx("Moatline saw something attackers typically do."),
      tx(
        "Look at the details now. If you cannot explain it: take the server off the internet, rebuild it from a clean image and change all passwords and keys."
      )
    );
  return null;
}

function network(f: F): Explanation | null {
  const fp = f.fingerprint;
  const svc = f.title.match(/^(.+?) \(port (\d+)\)/);
  if (fp === "address")
    return e(
      tx("The server address cannot be checked"),
      null,
      tx("Check the address in the server's settings.")
    );
  if (fp === "unreachable")
    return e(
      tx("The server cannot be reached from the internet"),
      tx(
        "No port answers. The server may be off, or a firewall blocks everything."
      ),
      tx("Check in your provider's console whether the server is running.")
    );
  if (fp.startsWith("expected:")) {
    const m = f.title.match(/^Port (\d+) \((.+)\)/);
    return e(
      tx("{service} (port {port}) is not reachable", {
        service: m?.[2] ?? "",
        port: m?.[1] ?? after(fp, "expected:"),
      }),
      tx("Visitors cannot reach what runs on this port."),
      tx("Check that the service runs and the firewall lets the port in.")
    );
  }
  if (fp.startsWith("open:")) {
    const vars = {
      service: svc?.[1] ?? "",
      port: svc?.[2] ?? after(fp, "open:"),
    };
    return f.title.includes("tailnet")
      ? e(
          tx("{service} (port {port}) is reachable over Tailscale", vars),
          tx("Only devices in your private network can reach it."),
          null
        )
      : e(
          tx("{service} (port {port}) is open to the internet", vars),
          tx("Anyone can connect to it."),
          tx("Close the port in the firewall unless it has to be public.")
        );
  }
  if (fp === "tls:handshake" || fp === "tls:invalid")
    return e(
      tx("The HTTPS certificate is not valid"),
      tx("Browsers show a security warning, and visitors leave."),
      tx(
        "Check the domain in Dokploy or Coolify. The certificate comes from Let's Encrypt through Traefik."
      )
    );
  if (fp === "tls:expiry")
    return e(
      f.title.includes("expired")
        ? tx("The HTTPS certificate has expired")
        : tx("The HTTPS certificate expires in {n} days", {
            n: firstNumber(f.title),
          }),
      tx(
        "It normally renews by itself. If it has not, renewal is failing — often because of DNS."
      ),
      tx("Check the domain's DNS and the Traefik logs in Dokploy or Coolify.")
    );
  return null;
}

function kuma(f: F): Explanation | null {
  const fp = f.fingerprint;
  const name = fp.slice(fp.indexOf(":") + 1);
  if (fp.startsWith("down:"))
    return e(
      tx("{name} is down", { name }),
      tx("Uptime Kuma cannot reach it."),
      tx("Open the app and look at its logs. A restart often helps.")
    );
  if (fp.startsWith("pending:"))
    return e(
      tx("{name} answers unreliably", { name }),
      tx("Uptime Kuma's checks fail and are being retried."),
      tx("Watch it — if it goes down, look at its logs.")
    );
  if (fp.startsWith("cert-invalid:"))
    return e(
      tx("The HTTPS certificate of {name} is not valid", { name }),
      tx("Browsers show a security warning, and visitors leave."),
      tx("Check the domain in Dokploy or Coolify.")
    );
  if (fp.startsWith("cert-expiry:"))
    return e(
      tx("The HTTPS certificate of {name} expires soon", { name }),
      tx(
        "It normally renews by itself. If it has not, renewal is failing — often because of DNS."
      ),
      tx("Check the domain's DNS and the Traefik logs in Dokploy or Coolify.")
    );
  return null;
}

function provider(f: F): Explanation | null {
  const fp = f.fingerprint;
  if (fp === "hetzner:no-firewall")
    return e(
      tx("No Hetzner firewall in front of the server"),
      tx(
        "A firewall at Hetzner protects the server even if its own firewall is set up wrong."
      ),
      tx(
        "Create a firewall in the Hetzner console that allows only SSH, 80 and 443, and apply it to this server."
      )
    );
  if (fp === "hetzner:all-ports")
    return e(
      tx("The Hetzner firewall lets everything in"),
      tx("It protects nothing in this state."),
      tx("Replace the allow-all rule with rules for SSH, 80 and 443.")
    );
  if (fp.startsWith("hetzner:open:"))
    return e(
      tx("The Hetzner firewall opens port {port} to everyone", {
        port: after(fp, "hetzner:open:"),
      }),
      f.title.includes("nothing listens")
        ? tx(
            "Nothing uses the port yet — but anything that starts on it is public at once."
          )
        : tx("Anyone can connect to what runs on this port."),
      tx("Remove the rule, or allow only your own IP addresses.")
    );
  return null;
}

function wazuh(f: F): Explanation | null {
  if (f.fingerprint === "agent-missing" || f.fingerprint === "agent-status")
    return e(
      tx("The Wazuh agent is not active"),
      tx("Wazuh does not watch this server right now."),
      tx(
        "Check the agent ID in the server's settings and the agent on the server."
      )
    );
  if (f.fingerprint.startsWith("sca:"))
    return e(
      tx("Hardening score: {score}", {
        score: f.title.match(/\d+%/)?.[0] ?? "",
      }),
      tx("Wazuh compares the server's settings against a security baseline."),
      tx("The failed checks are listed in Wazuh, each with its fix.")
    );
  return null;
}

/** Dokploy and Coolify report databases the same way. */
function platformDb(f: F, platform: string): Explanation | null {
  const fp = f.fingerprint;
  const name =
    f.title.match(
      /^Database reachable from the internet: (.+?)(?: on port \d+)?$/
    )?.[1] ??
    f.title.match(/^No backup for database (.+)$/)?.[1] ??
    f.title.match(
      /^Backup of (.+?)(?: \([^)]*\))? (?:is switched off|failed|has not run)/
    )?.[1] ??
    f.target ??
    "";
  const vars = { name, platform };
  if (fp.startsWith("db-exposed|"))
    return e(
      tx("The database {name} is open to the internet", vars),
      tx(
        "Anyone can try to log in. With a weak or leaked password, the data is gone."
      ),
      tx(
        "Remove the external port in {platform}. Your apps reach the database over the internal network.",
        vars
      )
    );
  if (fp.startsWith("db-no-backup|"))
    return e(
      tx("The database {name} has no backup", vars),
      tx("If the server or the data breaks, everything is lost."),
      tx("Add a scheduled backup in {platform} (database → Backups).", vars)
    );
  if (fp.startsWith("db-backup-off|"))
    return e(
      tx("The backup of {name} is switched off", vars),
      tx("No new copies of the data are made."),
      tx("Switch it back on in {platform}.", vars)
    );
  if (fp.startsWith("db-backup-failed|"))
    return e(
      tx("The last backup of {name} failed", vars),
      tx("There is no fresh copy of the data."),
      tx(
        "Open the backup in {platform}, read the error (often the storage destination) and run it again.",
        vars
      )
    );
  if (fp.startsWith("db-backup-late|"))
    return e(
      tx("The backup of {name} has not run in a while", vars),
      tx("The newest copy of the data is old."),
      tx("Check the backup schedule in {platform}.", vars)
    );
  return null;
}

function registry(f: F): Explanation | null {
  const image = f.target ?? f.fingerprint.split("|")[1] ?? "";
  if (f.fingerprint.startsWith("image-unmaintained|"))
    return e(
      tx("{image} is no longer maintained", { image }),
      tx("Nobody fixes security holes in it anymore, so they pile up."),
      tx("Switch to a maintained image that does the same job.")
    );
  if (f.fingerprint.startsWith("image-outdated|"))
    return e(
      tx("A newer build of {image} is available", { image }),
      tx("The same version was rebuilt, usually with security fixes."),
      tx("Redeploy the app to pull the new build.")
    );
  return null;
}

function platform(f: F): Explanation | null {
  if (f.fingerprint === "coolify-running")
    return e(
      tx("Coolify runs on this server, but is not connected"),
      tx("Its apps cannot be seen or redeployed from here."),
      tx("Connect Coolify under Settings."),
      { fix: { kind: "settings" } }
    );
  if (f.fingerprint.startsWith("unmanaged|")) {
    const app = appName(f.fingerprint.split("|")[1] ?? "");
    return e(
      tx("{app} is not managed by Dokploy or Coolify", { app }),
      tx(
        "Moatline cannot redeploy it from here. That is fine for tools you run yourself."
      ),
      tx("Nothing to do if that is intended.")
    );
  }
  return null;
}

function heartbeat(f: F): Explanation | null {
  if (f.fingerprint === "stale")
    return e(
      tx("The server stopped reporting"),
      tx(
        "Moatline sees nothing from it anymore — the server may be down, or the agent stopped."
      ),
      tx(
        "Check whether the server runs. On the server: systemctl status pc-agent-metrics.timer"
      )
    );
  if (f.fingerprint === "never")
    return e(
      tx("The agent has never reported"),
      tx("Moatline knows nothing about this server yet."),
      tx("Run the install command from the Setup tab on the server."),
      { fix: SETUP }
    );
  return null;
}

const BY_SOURCE: Partial<
  Record<ServerFinding["source"], (f: F) => Explanation | null>
> = {
  host,
  crowdsec,
  trivy,
  security,
  network,
  kuma,
  provider,
  wazuh,
  dokploy: (f) => platformDb(f, "Dokploy"),
  coolify: (f) => platformDb(f, "Coolify"),
  registry,
  platform,
  heartbeat,
};

export function explainFinding(f: F): Explanation {
  return (
    BY_SOURCE[f.source]?.(f) ??
    e(tx(f.title), null, null, { selfResolving: !!f.autoFixAt })
  );
}
