import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { AgentInstall } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CodeLine,
  TrustedIpsField,
  useTrustedIps,
} from "@/components/server-ui";
import { tx } from "@/lib/i18n";

/** Single-quote for the shell; refuse what cannot be quoted safely. */
function shellQuote(value: string): string | null {
  return value.includes("'") ? null : `'${value}'`;
}

/**
 * Download, verify against the checksum the app computed, run — the same
 * pattern as the agent installer, so nothing runs as root unchecked.
 */
function scriptCommand(
  install: AgentInstall,
  name: string,
  args: string[]
): string | null {
  const s = install.setupScripts.find((x) => x.name === name);
  if (!s?.sha256) return null;
  const file = `/tmp/${name}`;
  return [
    `curl -fsSL ${s.url} -o ${file}`,
    `echo "${s.sha256}  ${file}" | sha256sum -c -`,
    `sudo bash ${file}${args.length ? ` ${args.join(" ")}` : ""}`,
  ].join(" && ");
}

const SSH_KEY =
  /^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]+( .*)?$/;

export function HardenStep({ install }: { install: AgentInstall }) {
  const [key, setKey] = useState("");
  const [keepSsh, setKeepSsh] = useState(false);
  const [ports, setPorts] = useState("");
  const [sshPort, setSshPort] = useState("");
  const trusted = useTrustedIps();

  const trimmedKey = key.trim();
  const keyOk = !trimmedKey || SSH_KEY.test(trimmedKey);
  const quotedKey = trimmedKey ? shellQuote(trimmedKey) : null;
  const portList = ports
    .split(/[\s,]+/)
    .filter((p) => /^\d{1,5}$/.test(p) && Number(p) < 65536);
  const args = [
    ...(keepSsh ? ["--skip-ssh-key"] : quotedKey ? ["--key", quotedKey] : []),
    ...(/^\d{1,5}$/.test(sshPort) && sshPort !== "22"
      ? ["--ssh-port", sshPort]
      : []),
    ...(portList.length ? ["--allow-port", portList.join(",")] : []),
    ...(trusted.arg ? [trusted.arg] : []),
  ];
  const command =
    keyOk && trusted.valid
      ? scriptCommand(install, "harden-server.sh", args)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("1. Harden the server")}</CardTitle>
        <CardDescription>
          {tx(
            "UFW firewall (SSH, 80, 443 plus your ports), fail2ban, swap if none is set, SSH with keys only, Docker log rotate (10 MB × 3) and truncate oversized container logs without restarting Docker. On a server that already has firewall rules or swap, existing setup is only shown, never replaced."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription>
            {tx(
              "Keep a second SSH session open while it runs, and test logging in with your key before closing the first — password login is turned off once a key is in place."
            )}
          </AlertDescription>
        </Alert>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={keepSsh}
            onCheckedChange={(v) => setKeepSsh(v === true)}
          />
          {tx(
            "Only firewall, fail2ban, swap and Docker logs — leave SSH authentication as it is"
          )}
        </label>
        {!keepSsh && (
          <div className="grid gap-2">
            <Label htmlFor="harden-key">
              {tx(
                "Your public SSH key (optional — an existing authorized_keys is used otherwise)"
              )}
            </Label>
            <Textarea
              id="harden-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={tx("ssh-ed25519 AAAA… you@laptop")}
              className="min-h-16 font-mono text-xs"
            />
            {!keyOk && (
              <p className="text-xs text-destructive">
                {tx(
                  "That does not look like a public key (ssh-ed25519 / ssh-rsa / ecdsa…)."
                )}
              </p>
            )}
            {trimmedKey && keyOk && !quotedKey && (
              <p className="text-xs text-destructive">
                {tx("The key comment contains a quote — remove it.")}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="harden-ports">{tx("Extra open ports")}</Label>
            <Input
              id="harden-ports"
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              placeholder="e.g. 3000"
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="harden-ssh-port">{tx("SSH port")}</Label>
            <Input
              id="harden-ssh-port"
              inputMode="numeric"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              placeholder="22"
              className="font-mono"
            />
          </div>
        </div>
        <TrustedIpsField id="harden-trusted-ips" trusted={trusted} />
        {command ? (
          <CodeLine text={command} label={tx("hardening command")} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {tx("Fix the input above to get the command.")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {tx(
            "Docker publishes container ports past UFW — the external port check (server address under Settings) shows what is really reachable."
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function AutoUpdateStep({ install }: { install: AgentInstall }) {
  const [time, setTime] = useState("04:00");
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const command = valid
    ? scriptCommand(install, "auto-update.sh", [time])
    : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("2. Automatic updates")}</CardTitle>
        <CardDescription>
          {tx(
            "Security updates at 03:00 and 12:00, a reboot only at night when one is needed, Docker packages excluded, containers set to come back up after the reboot."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid max-w-xs gap-2">
          <Label htmlFor="reboot-time">
            {tx("Reboot time (server time, usually UTC)")}
          </Label>
          <Input
            id="reboot-time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="font-mono"
          />
        </div>
        {command ? (
          <CodeLine text={command} label={tx("auto-update command")} />
        ) : (
          <p className="text-xs text-destructive">
            {tx("Use HH:MM, e.g. 04:00.")}
          </p>
        )}
        <div className="space-y-2 border-t pt-4">
          <p className="font-medium">{tx("Run the updates now")}</p>
          <p className="text-xs text-muted-foreground">
            {tx(
              "Installs pending security updates right away instead of at 03:00 — same rules, Docker packages stay excluded. If a reboot is needed it still waits for the reboot time."
            )}
          </p>
          <CodeLine
            text="sudo apt-get update -q && sudo unattended-upgrade -v"
            label={tx("update-now command")}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Optional, for a build server: a GitHub Actions runner that builds pull
 * requests — with an empty database — where Moatline cannot.
 */
export function BuildRunnerStep({ install }: { install: AgentInstall }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [memory, setMemory] = useState("");
  const urlOk =
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?\/?$/.test(
      url.trim()
    );
  const tokenOk = /^[A-Za-z0-9]{20,}$/.test(token.trim());
  const memoryOk = !memory.trim() || /^\d+[MG]$/.test(memory.trim());
  const command =
    urlOk && tokenOk && memoryOk
      ? scriptCommand(install, "setup-github-runner.sh", [
          "--url",
          url.trim(),
          "--token",
          token.trim(),
          ...(memory.trim() ? ["--memory", memory.trim()] : []),
        ])
      : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("Optional: build server for GitHub Actions")}</CardTitle>
        <CardDescription>
          {tx(
            "Only on a server meant for builds (e.g. your Dokploy build server). Installs a self-hosted runner that builds every pull request with an empty throwaway database — what Moatline cannot do for Payload/Next.js apps. Set the repository's check to “None” and add the workflow from its settings; auto-merge then waits for it."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription>
            {tx(
              "Private repositories only: on a public one, anyone could run code on this server with a pull request. The runner is in the docker group (needed for the build database) — root on this server."
            )}
          </AlertDescription>
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="runner-url">
              {tx("GitHub organization or repository")}
            </Label>
            <Input
              id="runner-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/your-org"
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="runner-token">{tx("Registration token")}</Label>
            <Input
              id="runner-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="A…"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="runner-memory">{tx("Memory cap (optional)")}</Label>
            <Input
              id="runner-memory"
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              placeholder={tx("half the RAM, e.g. 6G")}
              className="font-mono"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {tx(
            "Token: GitHub → organization (or repository) → Settings → Actions → Runners → New self-hosted runner → the value after"
          )}{" "}
          <code className="font-mono">--token</code>
          {tx(". Valid for one hour, used once, never stored here.")}
        </p>
        {command ? (
          <CodeLine text={command} label={tx("runner install command")} />
        ) : (
          (url || token) && (
            <p className="text-xs text-destructive">
              {!urlOk
                ? tx(
                    "Use https://github.com/ORG or https://github.com/ORG/REPO."
                  )
                : !tokenOk
                  ? tx("That does not look like a registration token.")
                  : tx("Memory: e.g. 6G or 4096M.")}
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
