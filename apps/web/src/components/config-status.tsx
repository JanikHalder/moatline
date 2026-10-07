import { CheckCircle2, CircleAlert, CircleDashed, Wrench } from "lucide-react";
import type { ConfigCheck, LiveChecks } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

type WithConfig = {
  liveChecks?: LiveChecks | null;
  configCheck?: ConfigCheck | null;
};

/** What is not working: health checks reporting false, required env missing. */
export function configProblems(repo: WithConfig): string[] {
  const fromHealth = Object.entries(repo.liveChecks ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => k);
  const fromEnv = (repo.configCheck?.items ?? [])
    .filter((i) => i.required && !i.ok)
    .map((i) => i.label);
  return [...new Set([...fromHealth, ...fromEnv])];
}

export function ConfigBadge({ repo }: { repo: WithConfig }) {
  const problems = configProblems(repo);
  if (!repo.liveChecks && !repo.configCheck) return null;
  return problems.length ? (
    <Badge variant="destructive-soft" title={problems.join(", ")}>
      <Wrench />
      {problems.length === 1
        ? problems[0]
        : tx("{n} setup problems", { n: problems.length })}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-success">
      <Wrench />
      {tx("config ok")}
    </Badge>
  );
}

function Value({ v }: { v: boolean | number | string | null }) {
  if (v === true) return <CheckCircle2 className="size-4 text-success" />;
  if (v === false) return <CircleAlert className="size-4 text-destructive" />;
  if (v === null)
    return <CircleDashed className="size-4 text-muted-foreground" />;
  if (typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.includes("T"))
    return <span className="text-xs tabular-nums">{formatRelative(v)}</span>;
  return <span className="text-xs tabular-nums">{String(v)}</span>;
}

/**
 * The site's configuration: what its health endpoint says about itself
 * (`checks`) and which required variables its Dokploy application has —
 * names only.
 */
export function ConfigCard({ repo }: { repo: WithConfig }) {
  const checks = Object.entries(repo.liveChecks ?? {});
  const items = repo.configCheck?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" />
          {tx("Configuration")}
        </CardTitle>
        <CardDescription>
          {tx(
            "Keys and services the site needs — mail, uploads, secrets. Never the values."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="font-medium">{tx("Reported by the site")}</p>
          {checks.length ? (
            <ul className="divide-y rounded-md border">
              {checks.map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="font-mono text-xs">{k}</span>
                  <Value v={v} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tx("The health endpoint reports no")} <code>checks</code>
              {tx(
                ". Add them to the health endpoint (see docs/health-endpoint.md), e.g."
              )}{" "}
              <code>{tx('{ "email": true, "storage": true }')}</code>{" "}
              {tx("— then a broken mail setup shows up here and notifies you.")}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <p className="font-medium">
            {tx("Environment in Dokploy")}
            {repo.configCheck && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                checked {formatRelative(repo.configCheck.checkedAt)}
              </span>
            )}
          </p>
          {items.length ? (
            <ul className="divide-y rounded-md border">
              {items.map((i) => (
                <li key={i.label} className="space-y-0.5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      {i.label}
                      {!i.required && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          {tx("· recommended")}
                        </span>
                      )}
                    </span>
                    {i.ok ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <CircleAlert
                        className={
                          i.required
                            ? "size-4 text-destructive"
                            : "size-4 text-warning"
                        }
                      />
                    )}
                  </div>
                  {!i.ok && (
                    <p className="text-xs text-muted-foreground">
                      <code>{i.names.join(" or ")}</code> {tx("is not set —")}{" "}
                      {i.why}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tx(
                "Checked for Payload sites linked to a Dokploy application (every 15 minutes)."
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
