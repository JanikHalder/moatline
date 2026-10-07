import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { api, type PublicStatus } from "@/lib/api";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const pct = (u: number) => `${(Math.floor(u * 10000) / 100).toFixed(2)} %`;

function dayTone(downMinutes: number) {
  if (downMinutes === 0) return "bg-emerald-500";
  if (downMinutes < 30) return "bg-amber-400";
  return "bg-red-500";
}

function duration(from: string, to: string | null): string {
  const min = Math.max(
    1,
    Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 60000)
  );
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const OVERALL = {
  up: {
    text: "All systems operational",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  partial: {
    text: "Some systems are down",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  down: {
    text: "Major outage",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  maintenance: {
    text: "Planned maintenance in progress",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  unknown: {
    text: "Status not known yet",
    className: "border-border bg-muted text-muted-foreground",
  },
} as const;

/**
 * A public status page: shared with customers, readable without an
 * account. It refreshes itself every minute.
 */
export function StatusPublic() {
  const { slug } = useParams({ from: "/status/$slug" });
  const [data, setData] = useState<PublicStatus | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .getPublicStatus(slug)
        .then((d) => {
          setData(d);
          document.title = d.title;
        })
        .catch(() => setMissing(true));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [slug]);

  if (missing)
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-center text-muted-foreground">
        {tx("This status page does not exist or is not published.")}
      </div>
    );

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-muted/30">
        <div className="mx-auto max-w-3xl space-y-8 px-5 py-12">
          {!data ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <header className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {data.title}
                </h1>
                {data.description && (
                  <p className="text-muted-foreground">{data.description}</p>
                )}
              </header>

              <div
                className={cn(
                  "rounded-lg border px-5 py-4 font-medium",
                  OVERALL[data.overall].className
                )}
                role="status"
              >
                {tx(OVERALL[data.overall].text)}
              </div>

              <section className="divide-y rounded-lg border bg-background">
                {data.components.map((c) => (
                  <div key={c.name} className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{c.name}</span>
                      <span
                        className={cn(
                          "text-sm",
                          c.state === "up"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : c.state === "down"
                              ? "text-red-600 dark:text-red-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {c.state === "up"
                          ? tx("Operational")
                          : c.state === "down"
                            ? tx("Down")
                            : tx("Not checked")}
                      </span>
                    </div>
                    <div className="flex h-8 items-stretch gap-[2px]">
                      {c.days.map((d) => (
                        <Tooltip key={d.date}>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "flex-1 rounded-[2px]",
                                dayTone(d.downMinutes)
                              )}
                              aria-label={d.date}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            {d.date} ·{" "}
                            {d.downMinutes
                              ? tx("{n} min down", { n: d.downMinutes })
                              : tx("No downtime")}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{tx("90 days ago")}</span>
                      <span>
                        {tx("{pct} uptime", { pct: pct(c.uptime90) })}
                      </span>
                      <span>{tx("Today")}</span>
                    </div>
                  </div>
                ))}
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold">
                  {tx("Past incidents")}
                </h2>
                {data.incidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tx("No incidents in the last 30 days.")}
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border bg-background text-sm">
                    {data.incidents.map((i) => (
                      <li
                        key={`${i.component}-${i.startedAt}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-4"
                      >
                        <span>
                          <span className="font-medium">{i.component}</span>{" "}
                          {i.resolvedAt ? tx("was down") : tx("is down")}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDateTime(i.startedAt)} ·{" "}
                          {duration(i.startedAt, i.resolvedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <footer className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {tx("Updated {time}", {
                    time: formatDateTime(data.updatedAt) ?? "",
                  })}
                </span>
                <a
                  href="https://moatline.dev"
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Logo className="size-4" />
                  {tx("Powered by Moatline")}
                </a>
              </footer>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
