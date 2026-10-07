import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
  AgentInstall,
  AgentStatus,
  ContainerService,
  FindingCounts,
  FindingSource,
  ServerFinding,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SEVERITY_RANK, SeverityBadge } from "@/components/severity-badge";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { tx } from "@/lib/i18n";
import { explainFinding, type FixAction } from "@/lib/explain";
import { RedeployButton } from "@/components/container-redeploy";

export const SOURCE_LABEL: Record<FindingSource, string> = {
  host: "Host",
  trivy: "Trivy",
  crowdsec: "CrowdSec",
  nuclei: "Nuclei",
  kuma: "Uptime Kuma",
  wazuh: "Wazuh",
  heartbeat: "Agent",
  network: "External",
  security: "Security",
  provider: "Hetzner firewall",
  dokploy: "Dokploy",
  registry: "Docker Hub",
  coolify: "Coolify",
  platform: "Platforms",
};

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Whether the agent is talking. "Stale" is the dangerous one: every number on
 * the page is old, and it looks exactly like a quiet, healthy server.
 */
export function AgentStatusBadge({
  status,
  lastReportAt,
}: {
  status: AgentStatus;
  lastReportAt: string | null;
}) {
  if (status === "never") {
    return <Badge variant="outline">{tx("Waiting for agent")}</Badge>;
  }
  const when = lastReportAt ? formatRelative(lastReportAt) : null;
  if (status === "stale") {
    return (
      <Badge
        variant="destructive-soft"
        title={formatDateTime(lastReportAt) ?? undefined}
      >
        {tx("Silent")}
        {when ? ` · ${when}` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="success" title={formatDateTime(lastReportAt) ?? undefined}>
      {tx("Reporting")}
      {when ? ` · ${when}` : ""}
    </Badge>
  );
}

/** A compact usage bar that turns amber near the threshold and red over it. */
export function UsageBar({
  label,
  value,
  threshold,
  className,
}: {
  label: string;
  value: number | null | undefined;
  threshold: number;
  className?: string;
}) {
  if (value == null) {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span>—</span>
        </div>
        <Progress value={0} className="h-1.5" />
      </div>
    );
  }
  const tone =
    value >= threshold
      ? "[&>[data-slot=progress-indicator]]:bg-destructive"
      : value >= threshold - 10
        ? "[&>[data-slot=progress-indicator]]:bg-warning"
        : "[&>[data-slot=progress-indicator]]:bg-success";
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tabular font-medium",
            value >= threshold && "text-destructive"
          )}
        >
          {Math.round(value)}%
        </span>
      </div>
      <Progress
        value={Math.min(100, Math.max(0, value))}
        className={cn("h-1.5", tone)}
      />
    </div>
  );
}

const COUNT_ORDER: Array<keyof FindingCounts> = [
  "critical",
  "high",
  "medium",
  "low",
];

export function FindingCountBadges({ counts }: { counts: FindingCounts }) {
  if (counts.total === 0)
    return <Badge variant="success">{tx("no findings")}</Badge>;
  return (
    <div className="flex flex-wrap gap-1">
      {COUNT_ORDER.map((k) =>
        counts[k] ? (
          <SeverityBadge key={k} severity={k} count={counts[k]} />
        ) : null
      )}
      {counts.info > 0 && counts.total === counts.info && (
        <SeverityBadge severity="info" count={counts.info} />
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(tx("Could not copy — select the text instead."));
        }
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

export function CodeLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <code className="min-w-0 flex-1 break-all font-mono text-xs leading-5">
        {text}
      </code>
      <CopyButton text={text} label={label} />
    </div>
  );
}

/** A multi-line file to copy (workflow, config), scrollable on a phone. */
export function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative rounded-md border bg-muted/50">
      <pre className="max-h-80 overflow-auto px-3 py-2 pr-12 font-mono text-xs leading-5">
        {text}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={text} label={label} />
      </div>
    </div>
  );
}

export type Enrollment = { code: string; expiresAt: string };

const OPTIONS = [
  {
    flag: "--trivy",
    label: "Trivy",
    hint: "vulnerability scanner for OS packages and containers",
  },
  {
    flag: "--crowdsec",
    label: "CrowdSec + firewall bouncer",
    hint: "detects and blocks attacks; reads Dokploy's Traefik automatically",
  },
  {
    flag: "--auto-updates",
    label: "Automatic security updates",
    hint: "unattended-upgrades, security origins only",
  },
  {
    flag: "--tailscale",
    label: "Join Tailscale",
    hint: "asks for an auth key on the server — never put in the command",
  },
  {
    flag: "--tailscale-ssh-only",
    label: "SSH only over Tailscale",
    hint: "closes public SSH in ufw once Tailscale is up; never without a firewall. Dokploy or Coolify must then reach this server over Tailscale (its 100.x address)",
  },
] as const;

/** Off unless chosen: they change how the server is reached. */
const OFF_BY_DEFAULT = new Set(["--tailscale", "--tailscale-ssh-only"]);

function isTailnetUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    if (h.endsWith(".ts.net")) return true;
    const m = h.match(/^100\.(\d{1,3})\./);
    return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
  } catch {
    return false;
  }
}

const TRUSTED_KEY = "pc.trustedIps";
const TRUSTED_RE =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:2[4-9]|3[0-2]))?|[0-9a-f:]*:[0-9a-f:]*(?:\/(?:4[89]|[5-9]\d|1[01]\d|12[0-8]))?)$/i;

/**
 * Addresses CrowdSec and fail2ban never ban (your office). Kept in the
 * browser, so it is typed once for every server's commands. Returns the
 * `--trust-ip` argument, or null while the input is invalid.
 */
export function useTrustedIps() {
  return useIpList(TRUSTED_KEY, "--trust-ip");
}

/** A list of addresses for an install flag, kept in the browser. */
function useIpList(key: string, flag: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? "");
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  const list = value.split(/[\s,]+/).filter(Boolean);
  const valid = list.every((ip) => TRUSTED_RE.test(ip));
  const arg = !valid ? null : list.length ? `${flag} ${list.join(",")}` : "";
  return { value, setValue, valid, arg };
}

/**
 * Addresses SSH stays open for (`--ssh-from`): the Dokploy or Coolify
 * server, the office. Everyone else is shut out in ufw; whoever runs the
 * install is let in as well, so it cannot lock them out.
 */
function SshFromField({
  id,
  sshFrom,
}: {
  id: string;
  sshFrom: ReturnType<typeof useIpList>;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{tx("Allow SSH only from (optional)")}</Label>
      <Input
        id={id}
        value={sshFrom.value}
        onChange={(e) => sshFrom.setValue(e.target.value)}
        placeholder="e.g. 100.64.0.9, 203.0.113.7"
        className="font-mono"
      />
      {sshFrom.valid ? (
        <p className="text-xs text-muted-foreground">
          {tx(
            "The address of your Dokploy or Coolify server (its Tailscale address if it is in your tailnet) and your office. SSH from anywhere else is closed in ufw; your own session during the install stays allowed. Needs an active firewall — allow the same addresses in your provider's firewall."
          )}
        </p>
      ) : (
        <p className="text-xs text-destructive">
          {tx(
            "IP addresses or networks up to /24 (IPv4) or /48 (IPv6), separated by commas."
          )}
        </p>
      )}
    </div>
  );
}

export function TrustedIpsField({
  id,
  trusted,
}: {
  id: string;
  trusted: ReturnType<typeof useTrustedIps>;
}) {
  const [myIp, setMyIp] = useState<string | null>(null);
  useEffect(() => {
    api
      .getMyIp()
      .then((r) => setMyIp(r.ip))
      .catch(() => setMyIp(null));
  }, []);
  const listed = trusted.value.split(/[\s,]+/).includes(myIp ?? "");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{tx("Never block these IPs (your office)")}</Label>
        {myIp && !listed && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() =>
              trusted.setValue(
                [trusted.value.trim(), myIp].filter(Boolean).join(", ")
              )
            }
          >
            {tx("Add my IP (")}
            {myIp})
          </Button>
        )}
      </div>
      <Input
        id={id}
        value={trusted.value}
        onChange={(e) => trusted.setValue(e.target.value)}
        placeholder="e.g. 203.0.113.7"
        className="font-mono"
      />
      {trusted.valid ? (
        <p className="text-xs text-muted-foreground">
          {tx(
            "A few failed SSH logins make CrowdSec ban the address — for SSH and every website on the server. Only fixed addresses: an IP your provider reassigns could be someone else's tomorrow."
          )}
        </p>
      ) : (
        <p className="text-xs text-destructive">
          {tx(
            "IP addresses or networks up to /24 (IPv4) or /48 (IPv6), separated by commas."
          )}
        </p>
      )}
    </div>
  );
}

/**
 * How to put the agent on a server — one pasted line, for a new server as
 * well as one that has been running for years. The line carries a one-time
 * code (valid an hour) that the installer swaps for the real token, so it
 * is safe to sit in shell history.
 */
export function AgentInstallPanel({
  install,
  enrollment,
  onGenerate,
  canGenerate = true,
}: {
  install: AgentInstall;
  enrollment: Enrollment | null;
  onGenerate: () => Promise<void>;
  canGenerate?: boolean;
}) {
  const [flags, setFlags] = useState<Set<string>>(
    () =>
      new Set(OPTIONS.map((o) => o.flag).filter((f) => !OFF_BY_DEFAULT.has(f)))
  );
  const [scanImages, setScanImages] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const trusted = useTrustedIps();
  const sshFrom = useIpList("pc.sshFrom", "--ssh-from");

  const extra = [
    ...OPTIONS.filter((o) => flags.has(o.flag)).map((o) => o.flag),
    ...(scanImages ? [] : ["--no-images"]),
    ...(trusted.arg ? [trusted.arg] : []),
    ...(sshFrom.arg ? [sshFrom.arg] : []),
  ].join(" ");
  const oneLiner = enrollment
    ? `curl -fsSL ${install.bootstrapUrl} | sudo bash -s -- --enroll ${enrollment.code}${extra ? ` ${extra}` : ""}`
    : null;
  const manualInstall = enrollment
    ? `sudo python3 /tmp/pc-agent.py install --url ${install.baseUrl} --enroll ${enrollment.code}${extra ? ` ${extra}` : ""}`
    : (install.commands[2] ?? "");
  const insecureHttp =
    install.baseUrl.startsWith("http://") &&
    !install.baseUrlLocalOnly &&
    !isTailnetUrl(install.baseUrl);
  const expired =
    !!enrollment && new Date(enrollment.expiresAt).getTime() < Date.now();

  const generate = async () => {
    setGenerating(true);
    try {
      await onGenerate();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : tx("Could not create a code")
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {install.baseUrlLocalOnly && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>
            {tx("Servers cannot reach {url}", { url: install.baseUrl })}
          </AlertTitle>
          <AlertDescription>
            <p>
              {tx(
                "Set AGENT_BASE_URL on the API to an address the servers can reach — for example over Tailscale:"
              )}
            </p>
            <p className="font-mono text-xs">
              http://100.x.y.z:3001 · https://checker.your-tailnet.ts.net
            </p>
          </AlertDescription>
        </Alert>
      )}
      {insecureHttp && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>{tx("Plain http outside the tailnet")}</AlertTitle>
          <AlertDescription>
            {tx(
              "The agent refuses to send its token over unencrypted http. Use https, or the Moatline host's Tailscale address."
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <p className="font-medium">{tx("Also set up on the server")}</p>
        <div className="grid gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.flag}
              className="flex cursor-pointer items-start gap-2.5"
            >
              <Checkbox
                className="mt-0.5"
                checked={flags.has(o.flag)}
                onCheckedChange={(v) =>
                  setFlags((s) => {
                    const n = new Set(s);
                    if (v === true) n.add(o.flag);
                    else n.delete(o.flag);
                    return n;
                  })
                }
              />
              <span>
                {tx(o.label)}
                <span className="text-muted-foreground"> — {tx(o.hint)}</span>
              </span>
            </label>
          ))}
          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              className="mt-0.5"
              checked={scanImages}
              onCheckedChange={(v) => setScanImages(v === true)}
            />
            <span>
              {tx("Scan running containers")}
              <span className="text-muted-foreground">
                {" "}
                {tx("— Trivy checks the images that are live")}
              </span>
            </span>
          </label>
        </div>
        <TrustedIpsField id="install-trusted-ips" trusted={trusted} />
        <SshFromField id="install-ssh-from" sshFrom={sshFrom} />
        <p className="text-xs text-muted-foreground">
          {tx(
            "Already installed tools are left alone, so this works on an existing server too. Packages come only from the vendors' official repositories (Debian/Ubuntu)."
          )}
        </p>
      </div>

      {oneLiner && !expired ? (
        <div className="space-y-1.5">
          <p className="font-medium">{tx("Run on the server")}</p>
          <CodeLine text={oneLiner} label={tx("install command")} />
          <p className="text-xs text-muted-foreground">
            {tx("The code works once and until")}{" "}
            {new Date(enrollment!.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {tx(
              ". The installer downloads the agent, checks its SHA-256, sets up the selected tools, sends a first report and enables the timers."
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={generating || !canGenerate}>
            {generating ? <Spinner /> : <KeyRound />}
            {expired
              ? tx("Generate a new install command")
              : tx("Generate install command")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {canGenerate
              ? tx("Creates a one-time code, valid for one hour.")
              : tx("Only an owner or admin can generate install commands.")}
          </span>
        </div>
      )}

      <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="link" className="h-auto px-0 text-xs">
            {manualOpen ? tx("Hide") : tx("Prefer to read the agent first?")}{" "}
            {tx("Manual install")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <CodeLine
            text={install.commands[0]!}
            label={tx("download command")}
          />
          <CodeLine
            text={install.commands[1]!}
            label={tx("checksum command")}
          />
          <CodeLine text={manualInstall} label={tx("install command")} />
          <p className="text-xs text-muted-foreground">
            {tx("The same file is in the repository at")}{" "}
            <code className="font-mono">apps/api/agent/pc-agent.py</code>.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The one click that fixes a finding, or the place in the app where the fix is. */
function FindingFix({
  finding,
  fix,
}: {
  finding: ServerFinding;
  fix: FixAction;
}) {
  const [service, setService] = useState<ContainerService | null>(null);
  const app = fix.kind === "redeploy" ? fix.app : null;
  useEffect(() => {
    if (!app) return;
    let live = true;
    api
      .getContainerServices(finding.serverId)
      .then((r) => live && setService(r.services[app] ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [app, finding.serverId]);
  if (fix.kind === "redeploy")
    return service ? (
      <RedeployButton
        serverId={finding.serverId}
        app={fix.app}
        service={service}
        variant="full"
      />
    ) : null;
  if (fix.kind === "settings")
    return (
      <Button asChild size="sm">
        <Link to="/settings">{tx("Open settings")}</Link>
      </Button>
    );
  const label: Record<typeof fix.tab, string> = {
    maintenance: tx("Go to Maintenance"),
    agent: tx("Go to Setup"),
    security: tx("Go to Security"),
    apps: tx("Go to Apps"),
  };
  return (
    <Button asChild size="sm">
      <Link
        to="/servers/$serverId"
        params={{ serverId: finding.serverId }}
        search={{ tab: fix.tab }}
      >
        {label[fix.tab]}
        <ChevronRight />
      </Link>
    </Button>
  );
}

function FindingDetailSheet({
  finding,
  onOpenChange,
}: {
  finding: ServerFinding | null;
  onOpenChange: (open: boolean) => void;
}) {
  const plain = finding ? explainFinding(finding) : null;
  return (
    <Sheet open={!!finding} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {finding && plain && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <SeverityBadge severity={finding.severity} />
                {plain.selfResolving && !finding.resolvedAt && (
                  <SelfResolvingBadge />
                )}
                {finding.resolvedAt && (
                  <Badge variant="secondary">{tx("resolved")}</Badge>
                )}
              </div>
              <SheetTitle className="text-base leading-snug">
                {plain.title}
              </SheetTitle>
              {plain.title !== finding.title && (
                <SheetDescription className="break-words text-xs">
                  {finding.title}
                </SheetDescription>
              )}
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6 text-sm">
              {plain.meaning && (
                <section className="space-y-1">
                  <h3 className="font-medium">{tx("What this means")}</h3>
                  <p className="text-muted-foreground">{plain.meaning}</p>
                </section>
              )}
              {plain.action && (
                <section
                  className={cn(
                    "space-y-3 rounded-lg border p-3",
                    plain.selfResolving
                      ? "border-success/30 bg-success/5"
                      : "bg-muted/40"
                  )}
                >
                  <div className="space-y-1">
                    <h3 className="font-medium">{tx("What to do")}</h3>
                    <p>{plain.action}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 empty:hidden">
                    {plain.fix && !finding.resolvedAt && (
                      <FindingFix finding={finding} fix={plain.fix} />
                    )}
                    {finding.repositoryId && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to="/repos/$repoId"
                          params={{ repoId: finding.repositoryId }}
                        >
                          {tx("Open the affected application")}
                        </Link>
                      </Button>
                    )}
                    {finding.reference && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={finding.reference}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {finding.reference.includes("/guide/")
                            ? tx("Open the guide")
                            : tx("Advisory / reference")}
                          <ExternalLink />
                        </a>
                      </Button>
                    )}
                  </div>
                </section>
              )}
              <Collapsible defaultOpen={!plain.meaning && !plain.action}>
                <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  {tx("Technical details")}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  {finding.detail && (
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {finding.detail}
                    </p>
                  )}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">{tx("Source")}</dt>
                    <dd>{SOURCE_LABEL[finding.source]}</dd>
                    {finding.target && (
                      <>
                        <dt className="text-muted-foreground">
                          {tx("Affects")}
                        </dt>
                        <dd className="break-all font-mono">
                          {finding.target}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">
                      {tx("First seen")}
                    </dt>
                    <dd>{formatDateTime(finding.firstSeenAt)}</dd>
                    <dt className="text-muted-foreground">{tx("Last seen")}</dt>
                    <dd>{formatDateTime(finding.lastSeenAt)}</dd>
                    {finding.resolvedAt && (
                      <>
                        <dt className="text-muted-foreground">
                          {tx("Resolved")}
                        </dt>
                        <dd>{formatDateTime(finding.resolvedAt)}</dd>
                      </>
                    )}
                  </dl>
                  {!plain.action && finding.reference && (
                    <Button asChild variant="link" className="h-auto px-0">
                      <a
                        href={finding.reference}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {tx("Advisory / reference")}
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
              {!plain.action && finding.repositoryId && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to="/repos/$repoId"
                    params={{ repoId: finding.repositoryId }}
                  >
                    {tx("Open the affected application")}
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Nothing to do: the server's automation fixes it. */
export function SelfResolvingBadge() {
  return (
    <Badge
      variant="success"
      title={tx("The server's automation fixes this by itself.")}
    >
      {tx("fixes itself")}
    </Badge>
  );
}

/**
 * Findings, most severe first. Clicking a row opens the detail sheet — the
 * table itself stays scannable even with hundreds of Trivy rows.
 */
type TableFinding = ServerFinding & {
  serverName?: string | null;
  repositoryName?: string | null;
};

function AutoFixBadge({ at }: { at: string }) {
  return (
    <Badge
      variant="secondary"
      title={`Fixed automatically ${formatDateTime(at)}`}
    >
      auto-fix {formatRelative(at)}
    </Badge>
  );
}

/** Status badges shared by rows and groups. */
function FindingBadges({ f }: { f: ServerFinding }) {
  const plain = explainFinding(f);
  return (
    <>
      {plain.selfResolving && !f.resolvedAt ? (
        <SelfResolvingBadge />
      ) : (
        f.autoFixAt && <AutoFixBadge at={f.autoFixAt} />
      )}
      {f.source === "trivy" &&
        !plain.selfResolving &&
        (f.fixAvailable ? (
          <Badge variant="success">{tx("fix available")}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {tx("no fix yet")}
          </Badge>
        ))}
    </>
  );
}

/**
 * Trivy reports one row per CVE and package — a kernel with five CVEs is five
 * rows. Group by (server, target, package) so the table reads as "what needs
 * updating", with the CVEs one click away.
 */
function groupKey(f: TableFinding): string {
  if (f.source !== "trivy") return f.id;
  const parts = f.fingerprint.split("|");
  return parts.length >= 4
    ? `${f.serverId}|${parts.slice(0, 3).join("|")}`
    : f.id;
}

const byPriority = (a: ServerFinding, b: ServerFinding) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  // Within a severity, what can be fixed now comes first.
  Number(!!b.fixAvailable) - Number(!!a.fixAvailable) ||
  b.lastSeenAt.localeCompare(a.lastSeenAt);

export function FindingsTable({
  findings,
  showSource = true,
  showServer = false,
  resolved = false,
  limit = 300,
}: {
  findings: TableFinding[];
  showSource?: boolean;
  /** Adds a column linking each finding to its server (cross-server lists). */
  showServer?: boolean;
  resolved?: boolean;
  limit?: number;
}) {
  const [selected, setSelected] = useState<ServerFinding | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    const map = new Map<string, TableFinding[]>();
    for (const f of findings) {
      const k = groupKey(f);
      const list = map.get(k) ?? [];
      list.push(f);
      map.set(k, list);
    }
    return [...map.entries()]
      .map(([key, items]) => ({ key, items: items.sort(byPriority) }))
      .sort((a, b) => byPriority(a.items[0]!, b.items[0]!));
  }, [findings]);
  const shown = groups.slice(0, limit);
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const serverCell = (f: TableFinding) =>
    showServer && (
      <TableCell className="hidden text-xs @2xl/main:table-cell">
        <Link
          to="/servers/$serverId"
          params={{ serverId: f.serverId }}
          className="font-medium hover:text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {f.serverName ?? "server"}
        </Link>
        {f.repositoryName && (
          <p className="text-muted-foreground">{f.repositoryName}</p>
        )}
      </TableCell>
    );
  const sinceCell = (f: ServerFinding) => (
    <TableCell
      className="hidden pr-6 text-right text-xs text-muted-foreground @2xl/main:table-cell"
      title={
        formatDateTime(resolved ? f.resolvedAt : f.firstSeenAt) ?? undefined
      }
    >
      {formatRelative(resolved ? f.resolvedAt : f.firstSeenAt)}
    </TableCell>
  );
  // Phones hide the source, server and since columns; the same facts ride
  // along under the title instead.
  const mobileMeta = (f: TableFinding) => (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs whitespace-normal text-muted-foreground @2xl/main:hidden">
      {showSource && <span>{SOURCE_LABEL[f.source]}</span>}
      {showServer && (
        <>
          {showSource && <span aria-hidden>·</span>}
          <Link
            to="/servers/$serverId"
            params={{ serverId: f.serverId }}
            className="font-medium text-foreground hover:text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {f.serverName ?? "server"}
          </Link>
          {f.repositoryName && <span>({f.repositoryName})</span>}
        </>
      )}
      {(showSource || showServer) && <span aria-hidden>·</span>}
      <span
        title={
          formatDateTime(resolved ? f.resolvedAt : f.firstSeenAt) ?? undefined
        }
      >
        {resolved ? tx("resolved ") : tx("since ")}
        {formatRelative(resolved ? f.resolvedAt : f.firstSeenAt)}
      </span>
    </p>
  );
  const row = (f: TableFinding, nested = false) => (
    <TableRow
      key={f.id}
      className={cn("cursor-pointer", nested && "bg-muted/20")}
      onClick={() => setSelected(f)}
    >
      <TableCell className={nested ? "pl-10" : "pl-6"}>
        <SeverityBadge severity={f.severity} />
      </TableCell>
      {showSource && (
        <TableCell className="hidden text-xs text-muted-foreground @2xl/main:table-cell">
          {SOURCE_LABEL[f.source]}
        </TableCell>
      )}
      {serverCell(f)}
      <TableCell className="max-w-md pr-4 @2xl/main:pr-2">
        <span className="line-clamp-2 whitespace-normal font-medium">
          {nested ? f.title.split(" in ")[0] : explainFinding(f).title}
        </span>
        <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
          <FindingBadges f={f} />
        </div>
        {mobileMeta(f)}
      </TableCell>
      <TableCell className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground @2xl/main:table-cell">
        {f.target ?? "—"}
      </TableCell>
      {sinceCell(f)}
    </TableRow>
  );

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-24 pl-6">{tx("Severity")}</TableHead>
            {showSource && (
              <TableHead className="hidden w-28 @2xl/main:table-cell">
                {tx("Source")}
              </TableHead>
            )}
            {showServer && (
              <TableHead className="hidden w-40 @2xl/main:table-cell">
                {tx("Server")}
              </TableHead>
            )}
            <TableHead>{tx("Finding")}</TableHead>
            <TableHead className="hidden @2xl/main:table-cell">
              {tx("Affects")}
            </TableHead>
            <TableHead className="hidden w-32 pr-6 text-right @2xl/main:table-cell">
              {resolved ? tx("Resolved") : tx("Since")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ key, items }) => {
            if (items.length === 1) return row(items[0]!);
            const head = items[0]!;
            const isOpen = open.has(key);
            const fixable = items.filter((f) => f.fixAvailable).length;
            return (
              <Fragment key={key}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                >
                  <TableCell className="pl-6">
                    <SeverityBadge severity={head.severity} />
                  </TableCell>
                  {showSource && (
                    <TableCell className="hidden text-xs text-muted-foreground @2xl/main:table-cell">
                      {SOURCE_LABEL[head.source]}
                    </TableCell>
                  )}
                  {serverCell(head)}
                  <TableCell className="max-w-md pr-4 @2xl/main:pr-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90"
                        )}
                      />
                      <span className="truncate">
                        {explainFinding(head).title}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        · {tx("{n} known holes", { n: items.length })}
                      </span>
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {head.autoFixAt && <AutoFixBadge at={head.autoFixAt} />}
                      {fixable === items.length ? (
                        <Badge variant="success">{tx("fix available")}</Badge>
                      ) : fixable > 0 ? (
                        <Badge variant="success">
                          {tx("fix for")} {fixable} of {items.length}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          {tx("no fix yet")}
                        </Badge>
                      )}
                    </div>
                    <div className="pl-5">{mobileMeta(head)}</div>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground @2xl/main:table-cell">
                    {head.target ?? "—"}
                  </TableCell>
                  {sinceCell(head)}
                </TableRow>
                {isOpen && items.map((f) => row(f, true))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {groups.length > limit && (
        <p className="border-t px-6 py-3 text-xs text-muted-foreground">
          {tx("Showing the")} {limit} {tx("most severe of")} {groups.length}{" "}
          entries.
        </p>
      )}
      <FindingDetailSheet
        finding={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
