import { useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { api, type SiteProbe } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { SeverityBadge } from "@/components/severity-badge";
import { ErrorAlert } from "@/components/error-alert";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

/**
 * What the live site exposes to anyone: downloadable .env/.git, open Payload
 * endpoints (seed, users, form submissions, GraphQL playground), missing
 * security headers. Read-only GETs — never a login attempt.
 */
export function SiteProbeCard({
  repoId,
  initial,
}: {
  repoId: string;
  initial: SiteProbe | null | undefined;
}) {
  const [probe, setProbe] = useState<SiteProbe | null>(initial ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = () => {
    setRunning(true);
    setError(null);
    api
      .probeSite(repoId)
      .then(setProbe)
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Check failed"))
      )
      .finally(() => setRunning(false));
  };
  const findings = probe?.findings ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {findings.some(
            (f) => f.severity === "critical" || f.severity === "high"
          ) ? (
            <ShieldAlert className="size-4 text-destructive" />
          ) : (
            <ShieldCheck className="size-4 text-muted-foreground" />
          )}
          {tx("Site security")}
        </CardTitle>
        <CardDescription>
          {tx("What the live site shows anyone: exposed files")}
          {probe?.payload ? tx(", open Payload endpoints") : ""}{" "}
          {tx("and security headers. Read-only, daily and after every deploy.")}
          {probe && (
            <>
              {" "}
              {tx("· checked")} {formatRelative(probe.checkedAt)}
            </>
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={check}
            disabled={running}
          >
            {running ? <Spinner /> : <RefreshCw />}
            {tx("Check now")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!probe ? (
          <p className="text-muted-foreground">{tx("Not checked yet.")}</p>
        ) : findings.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            {tx("Nothing exposed, headers in place.")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {findings.map((f) => (
              <li key={f.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-medium">{f.title}</span>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={tx("Open")}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
