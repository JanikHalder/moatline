import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { api, type LogErrorSummary } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

/** Errors per hour as small bars — a spike after a deploy stands out. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 3;
  return (
    <svg
      width={values.length * (w + 1)}
      height={20}
      className="shrink-0 text-destructive/70"
      aria-hidden
    >
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * 20) : 0;
        return (
          <rect
            key={i}
            x={i * (w + 1)}
            y={20 - h}
            width={w}
            height={h}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * What an app logged as errors — the "why" behind a broken page. From the
 * agent (1.11.0+): only error lines, scrubbed of credentials, e-mail and IP
 * addresses, the same message grouped.
 */
export function LogErrorsCard({
  source,
  compact = false,
}: {
  source: { repositoryId: string } | { serverId: string; app?: string };
  /** Inside a sheet: no card frame, fewer rows. */
  compact?: boolean;
}) {
  const t = useT();
  const [hours, setHours] = useState("24");
  const [rows, setRows] = useState<LogErrorSummary[] | null>(null);
  const key = JSON.stringify(source);

  useEffect(() => {
    setRows(null);
    const h = Number(hours);
    const req =
      "repositoryId" in source
        ? api.getRepoErrors(source.repositoryId, h)
        : api.getServerErrors(source.serverId, h, source.app);
    req.then(setRows).catch(() => setRows([]));
    // `key` stands for `source`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hours]);

  const list = (rows ?? []).slice(0, compact ? 8 : 20);
  const body =
    rows == null ? (
      <Skeleton className="h-24 w-full" />
    ) : list.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        {t(
          "No errors logged in this period. (Needs agent 1.11.0 on the server.)"
        )}
      </p>
    ) : (
      <ul className="divide-y rounded-md border">
        {list.map((e) => {
          const isNew = Date.now() - Date.parse(e.firstSeen) < DAY;
          return (
            <li key={e.id} className="space-y-1 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums">{e.recent}×</span>
                {isNew && <Badge variant="destructive-soft">{t("new")}</Badge>}
                {!("repositoryId" in source) && !source.app && (
                  <span className="truncate text-xs text-muted-foreground">
                    {e.app}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <Spark values={e.hourly} />
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatRelative(e.lastSeen)}
                  </span>
                </span>
              </div>
              <p className="font-mono text-xs break-all text-muted-foreground">
                {e.sample}
              </p>
            </li>
          );
        })}
      </ul>
    );

  const toggle = (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={hours}
      onValueChange={(v) => v && setHours(v)}
    >
      <ToggleGroupItem value="24">24 h</ToggleGroupItem>
      <ToggleGroupItem value="168">{t("7 days")}</ToggleGroupItem>
    </ToggleGroup>
  );

  if (compact)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{t("Errors in the logs")}</p>
          {toggle}
        </div>
        {body}
      </div>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="size-4" />
          {t("Errors in the logs")}
        </CardTitle>
        <CardDescription>
          {t(
            "Error lines the app logged, the same message grouped — passwords, tokens, e-mail and IP addresses removed on the server."
          )}
        </CardDescription>
        <CardAction>{toggle}</CardAction>
      </CardHeader>
      <CardContent className="text-sm">{body}</CardContent>
    </Card>
  );
}
