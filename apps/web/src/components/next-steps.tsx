import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck } from "lucide-react";
import {
  api,
  type DashboardData,
  type OpenIncident,
  type OrgFinding,
} from "@/lib/api";
import { explainFinding } from "@/lib/explain";
import { SEVERITY_RANK } from "@/components/severity-badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { tx } from "@/lib/i18n";

/**
 * The top of the overview: what needs someone, most urgent first, in plain
 * words with the one button that leads to the fix. Numbers per severity
 * tell an expert where to look; this tells everyone what to do — and when
 * there is nothing, says so.
 */

type Urgency = "now" | "soon" | "later";

type Step = {
  key: string;
  urgency: Urgency;
  /** Sorts within an urgency: lower first. */
  rank: number;
  title: string;
  /** Where (server, app) and what it means, one line. */
  context: string | null;
  /** The button, labelled. */
  link: (label: string) => ReactNode;
  cta: string;
};

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, later: 2 };

const LINE: Record<Urgency, string> = {
  now: "bg-destructive",
  soon: "bg-warning",
  later: "bg-muted-foreground/35",
};

const SHOWN = 6;

function urgencyOf(severity: OrgFinding["severity"]): Urgency {
  return severity === "critical"
    ? "now"
    : severity === "high"
      ? "soon"
      : "later";
}

/** Trivy reports one row per CVE; on a to-do list that is one task per package. */
function groupKey(f: OrgFinding): string {
  if (f.source !== "trivy") return f.id;
  const p = f.fingerprint.split("|");
  return p.length >= 4 ? `${f.serverId}|${p.slice(0, 3).join("|")}` : f.id;
}

function findingSteps(findings: OrgFinding[]): Step[] {
  const groups = new Map<string, OrgFinding[]>();
  for (const f of findings) {
    const k = groupKey(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const steps: Step[] = [];
  for (const [key, items] of groups) {
    items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const f = items[0]!;
    const plain = explainFinding(f);
    // The server's own automation handles it; not a task for anyone.
    if (plain.selfResolving) continue;
    const where = [f.serverName, f.repositoryName].filter(Boolean).join(" · ");
    steps.push({
      key,
      urgency: urgencyOf(f.severity),
      rank: SEVERITY_RANK[f.severity],
      title:
        items.length > 1
          ? `${plain.title} (${tx("{n} known holes", { n: items.length })})`
          : plain.title,
      context: [where, plain.action].filter(Boolean).join(" — ") || null,
      cta: tx("Go there"),
      link: (label) => (
        <Link
          to="/servers/$serverId"
          params={{ serverId: f.serverId }}
          search={{ tab: "findings" }}
        >
          {label}
        </Link>
      ),
    });
  }
  return steps;
}

function repoSteps(data: DashboardData): Step[] {
  const steps: Step[] = [];
  for (const r of data.repos) {
    const link = (label: string) => (
      <Link to="/repos/$repoId" params={{ repoId: r.repositoryId }}>
        {label}
      </Link>
    );
    const { critical, high } = r.counts;
    if (critical || high)
      steps.push({
        key: `repo:${r.repositoryId}`,
        urgency: critical ? "now" : "soon",
        rank: critical ? 0 : 1,
        title: critical
          ? tx(
              critical === 1
                ? "{name} has a critical security hole"
                : "{name} has {n} critical security holes",
              { name: r.name, n: critical }
            )
          : tx(
              high === 1
                ? "{name} has a serious security hole"
                : "{name} has {n} serious security holes",
              { name: r.name, n: high }
            ),
        context: tx(
          "In the packages the site uses. Most are fixed by updating — Moatline can open the pull request for you."
        ),
        cta: tx("Fix it"),
        link,
      });
    if (r.fixedNotDeployed > 0)
      steps.push({
        key: `deploy:${r.repositoryId}`,
        urgency: "soon",
        rank: 2,
        title: tx("A fix for {name} is ready, but not live yet", {
          name: r.name,
        }),
        context: tx(
          "The security fix is merged, but the site still runs the old version. Deploy it."
        ),
        cta: tx("Go there"),
        link,
      });
  }
  return steps;
}

function incidentSteps(incidents: OpenIncident[]): Step[] {
  return incidents.map((i) => ({
    key: `incident:${i.id}`,
    urgency: "now" as const,
    rank: -1,
    title: tx("{name} is not reachable", { name: i.name }),
    context: [
      tx("since {when}", { when: formatRelative(i.startedAt) ?? "" }),
      i.healAttempts > 0 ? tx("already restarted automatically") : null,
      i.cause?.split("\n")[0],
    ]
      .filter(Boolean)
      .join(" · "),
    cta: tx("Go there"),
    link: (label: string) => (
      <Link to="/repos/$repoId" params={{ repoId: i.repositoryId }}>
        {label}
      </Link>
    ),
  }));
}

const DOT: Record<Urgency, string> = {
  now: "bg-destructive",
  soon: "bg-warning",
  later: "bg-muted-foreground/50",
};

const URGENCY_LABEL = (): Record<Urgency, string> => ({
  now: tx("Now"),
  soon: tx("Soon"),
  later: tx("When you have time"),
});

export function NextSteps({ data }: { data: DashboardData }) {
  const [findings, setFindings] = useState<OrgFinding[] | null>(null);
  const [incidents, setIncidents] = useState<OpenIncident[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const load = () => {
      api
        .getOpenIncidents()
        .then(setIncidents)
        .catch(() => setIncidents([]));
      api
        .getImportantFindings()
        .then(setFindings)
        .catch(() => setFindings([]));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (findings === null) return <Skeleton className="h-48 rounded-lg" />;

  const steps = [
    ...incidentSteps(incidents),
    ...repoSteps(data),
    ...findingSteps(findings),
  ].sort(
    (a, b) =>
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.rank - b.rank
  );
  const shown = all ? steps : steps.slice(0, SHOWN);
  const nothingWatched = data.repos.length === 0 && data.servers.total === 0;

  if (steps.length === 0)
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <CircleCheck className="size-6 text-success" />
              {nothingWatched
                ? tx("Nothing is watched yet")
                : tx("All good — nothing to do")}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {nothingWatched
                ? tx(
                    "Add your sites and servers — Moatline then tells you here what needs you."
                  )
                : tx(
                    "Moatline keeps checking your sites and servers and tells you here as soon as something needs you."
                  )}
            </p>
          </div>
          {nothingWatched && (
            <Button asChild size="sm">
              <Link to="/repos">{tx("Add sites")}</Link>
            </Button>
          )}
        </div>
        <div
          aria-hidden
          className={cn(
            "h-1.5 rounded-full",
            nothingWatched ? "bg-border" : "bg-success"
          )}
        />
      </section>
    );

  const labels = URGENCY_LABEL();
  const counts = { now: 0, soon: 0, later: 0 };
  for (const st of steps) counts[st.urgency]++;
  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="gap-3 border-b pb-5 [.border-b]:pb-5">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {steps.length === 1
            ? tx("One thing needs you")
            : tx("{n} things need you", { n: steps.length })}
        </CardTitle>
        <CardDescription>
          {[
            counts.now ? tx("{n} now", { n: counts.now }) : null,
            counts.soon ? tx("{n} soon", { n: counts.soon }) : null,
            counts.later
              ? tx("{n} when you get to it", { n: counts.later })
              : null,
          ]
            .filter(Boolean)
            .join(", ")}
          {". "}
          {tx("The most urgent first.")}
        </CardDescription>
        <UrgencyLine steps={steps} labels={labels} />
      </CardHeader>
      <ul className="divide-y">
        {shown.map((s) => (
          <li
            key={s.key}
            className="flex items-start gap-3 px-6 py-3 hover:bg-muted/30"
          >
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                DOT[s.urgency]
              )}
              title={labels[s.urgency]}
              aria-label={labels[s.urgency]}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug">{s.title}</p>
              {s.context && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {s.context}
                </p>
              )}
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              {s.link(s.cta)}
            </Button>
          </li>
        ))}
      </ul>
      {steps.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t px-6 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        >
          {all ? tx("Show fewer") : tx("Show all {n}", { n: steps.length })}
          <ChevronRight
            className={cn("size-4 transition-transform", all && "-rotate-90")}
          />
        </button>
      )}
    </Card>
  );
}

/**
 * The line: one segment per thing that needs someone, most urgent on the
 * left. Read at a glance — mostly red is a different day from mostly grey.
 */
function UrgencyLine({
  steps,
  labels,
}: {
  steps: Step[];
  labels: Record<Urgency, string>;
}) {
  return (
    <div
      className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
      role="img"
      aria-label={(["now", "soon", "later"] as const)
        .map(
          (u) =>
            [labels[u], steps.filter((s) => s.urgency === u).length] as const
        )
        .filter(([, n]) => n > 0)
        .map(([label, n]) => `${label}: ${n}`)
        .join(", ")}
    >
      {steps.map((s) => (
        <span key={s.key} className={cn("min-w-1 flex-1", LINE[s.urgency])} />
      ))}
    </div>
  );
}
