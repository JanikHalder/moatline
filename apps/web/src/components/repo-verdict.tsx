import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { Repo, Scan, Vulnerability } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatRelative } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { tx } from "@/lib/i18n";

/**
 * A site's state in one sentence, with the one button that helps — the
 * first thing on its page. The cards below hold the detail; this says
 * whether anyone needs to read them.
 */

type Tone = "bad" | "warn" | "good" | "neutral";

type Verdict = {
  tone: Tone;
  icon: typeof CircleCheck;
  title: string;
  detail: string | null;
  action: ReactNode;
};

const TONE: Record<Tone, string> = {
  bad: "border-destructive/30 bg-destructive/5 [&_svg.lead]:text-destructive",
  warn: "border-warning/40 bg-warning/5 [&_svg.lead]:text-warning",
  good: "border-success/30 bg-success/5 [&_svg.lead]:text-success",
  neutral: "bg-muted/40 [&_svg.lead]:text-muted-foreground",
};

export function verdictOf({
  repo,
  lastScan,
  vulns,
  onFix,
  onScan,
  fixing,
  scanning,
  fixRunning,
}: {
  repo: Pick<Repo, "liveUrl" | "liveStatus" | "liveCheckedAt">;
  lastScan: Pick<Scan, "status" | "auditNote" | "finishedAt"> | null;
  vulns: Pick<Vulnerability, "severity" | "fixAvailable">[];
  onFix: () => void;
  onScan: () => void;
  fixing: boolean;
  scanning: boolean;
  /** A fix is already on its way (an update run is going). */
  fixRunning: boolean;
}): Verdict {
  const scanButton = (label: string) => (
    <Button size="sm" variant="outline" onClick={onScan} disabled={scanning}>
      {scanning ? <Spinner /> : <RefreshCw />}
      {label}
    </Button>
  );

  if (repo.liveUrl && repo.liveStatus === "down")
    return {
      tone: "bad",
      icon: WifiOff,
      title: tx("The site is not reachable right now"),
      detail: tx(
        "Visitors see an error. The incident below shows since when, and what Moatline already tried."
      ),
      action: null,
    };

  if (
    !lastScan ||
    lastScan.status === "pending" ||
    lastScan.status === "running"
  )
    return {
      tone: "neutral",
      icon: RefreshCw,
      title: lastScan
        ? tx("The check is running…")
        : tx("This site has not been checked yet"),
      detail: lastScan
        ? tx("Usually done within a minute.")
        : tx(
            "The first check looks for known security holes and outdated packages."
          ),
      action: lastScan ? null : scanButton(tx("Check now")),
    };

  if (lastScan.status === "failed")
    return {
      tone: "warn",
      icon: CircleAlert,
      title: tx("The last check failed"),
      detail: tx(
        "So it is unknown whether the site has security holes. The error is under “Latest scan”."
      ),
      action: scanButton(tx("Try again")),
    };

  if (lastScan.auditNote)
    return {
      tone: "warn",
      icon: CircleAlert,
      title: tx("Security holes could not be checked"),
      detail: lastScan.auditNote,
      action: scanButton(tx("Try again")),
    };

  const urgent = vulns.filter(
    (v) => v.severity === "critical" || v.severity === "high"
  );
  const fixable = urgent.filter((v) => v.fixAvailable).length;
  const critical = urgent.filter((v) => v.severity === "critical").length;
  if (urgent.length > 0)
    return {
      tone: critical ? "bad" : "warn",
      icon: ShieldAlert,
      title:
        urgent.length === 1
          ? tx("1 serious security hole")
          : tx("{n} serious security holes", { n: urgent.length }),
      detail: fixRunning
        ? tx("A fix is on its way — progress is shown below.")
        : fixable === urgent.length
          ? tx(
              "All of them are fixed by an update. Moatline prepares it as a pull request — you review and merge it."
            )
          : fixable > 0
            ? tx(
                "{n} of them are fixed by an update, which Moatline prepares as a pull request. For the rest no fix exists yet.",
                { n: fixable }
              )
            : tx(
                "No fix exists yet. Moatline checks again every day and tells you as soon as there is one."
              ),
      action:
        fixable > 0 && !fixRunning ? (
          <Button
            size="sm"
            variant={critical ? "destructive" : "default"}
            onClick={onFix}
            disabled={fixing}
          >
            {fixing ? <Spinner /> : <ShieldCheck />}
            {tx("Fix automatically")}
          </Button>
        ) : null,
    };

  return {
    tone: "good",
    icon: CircleCheck,
    title: tx("All good"),
    detail: [
      vulns.length
        ? tx("Only minor security holes, nothing urgent.")
        : tx("No known security holes."),
      repo.liveUrl && repo.liveStatus === "up"
        ? tx("The site is online.")
        : null,
      lastScan.finishedAt
        ? tx("Checked {when}.", {
            when: formatRelative(lastScan.finishedAt) ?? "",
          })
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    action: null,
  };
}

export function RepoVerdict(props: Parameters<typeof verdictOf>[0]) {
  const v = verdictOf(props);
  const Icon = v.icon;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-5 py-4",
        TONE[v.tone]
      )}
      role="status"
    >
      <Icon className="lead size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{v.title}</p>
        {v.detail && (
          <p className="text-sm text-muted-foreground">{v.detail}</p>
        )}
      </div>
      {v.action}
    </div>
  );
}
