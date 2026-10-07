import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { api, type CronCheck, type PlatformWatch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorAlert } from "@/components/error-alert";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const PERIODS: Array<[number, string]> = [
  [300, "every 5 minutes"],
  [900, "every 15 minutes"],
  [3600, "hourly"],
  [6 * 3600, "every 6 hours"],
  [86400, "daily"],
  [7 * 86400, "weekly"],
];

const pingUrl = (token: string) =>
  `${window.location.origin}/api/ping/${token}`;

function graceFor(period: number): number {
  // A quarter of the period, at least 5 minutes, at most 6 hours.
  return Math.min(6 * 3600, Math.max(300, Math.round(period / 4)));
}

/**
 * Scheduled jobs that report in: backups, cleanups, imports. Each calls its
 * URL after a run; when it stays silent, Moatline says so.
 */
export function CronChecksTab() {
  const [checks, setChecks] = useState<CronCheck[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState(86400);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .getCronChecks()
      .then((r) => setChecks(r.checks))
      .catch(() => setChecks([]));
  useEffect(() => void load(), []);

  const create = async () => {
    setError(null);
    try {
      await api.createCronCheck({
        name: name.trim(),
        periodSeconds: period,
        graceSeconds: graceFor(period),
      });
      setAdding(false);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save"));
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(tx("Copied"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("Scheduled jobs")}</CardTitle>
        <CardDescription>
          {tx(
            "Backups, cleanups and imports that fail without a sound. Let each job call its URL after it ran — if it stays silent longer than expected, you hear about it, even when its server is down."
          )}
        </CardDescription>
        {!adding && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              {tx("Watch a job")}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {adding && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="cron-name">{tx("Name")}</Label>
              <Input
                id="cron-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tx("Nightly database backup")}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cron-period">{tx("Runs")}</Label>
              <Select
                value={String(period)}
                onValueChange={(v) => setPeriod(Number(v))}
              >
                <SelectTrigger id="cron-period" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map(([s, label]) => (
                    <SelectItem key={s} value={String(s)}>
                      {tx(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void create()}
                disabled={!name.trim()}
              >
                {tx("Save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                {tx("Cancel")}
              </Button>
            </div>
            {error && (
              <div className="sm:col-span-3">
                <ErrorAlert>{error}</ErrorAlert>
              </div>
            )}
          </div>
        )}

        {!checks ? (
          <Skeleton className="h-16 w-full" />
        ) : checks.length === 0 && !adding ? (
          <p className="text-muted-foreground">{tx("No job watched yet.")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {checks.map((c) => {
              const cmd = `curl -fsS -m 10 --retry 3 ${pingUrl(c.token)}`;
              return (
                <li key={c.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge
                      variant={
                        c.status === "up"
                          ? "success"
                          : c.status === "down"
                            ? "destructive-soft"
                            : "outline"
                      }
                    >
                      {c.status === "up"
                        ? tx("on time")
                        : c.status === "down"
                          ? tx("missed")
                          : tx("waiting for its first run")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {tx(
                        PERIODS.find(([s]) => s === c.periodSeconds)?.[1] ??
                          "custom"
                      )}
                      {c.lastPingAt && (
                        <span title={formatDateTime(c.lastPingAt) ?? undefined}>
                          {" "}
                          · {tx("last run")} {formatRelative(c.lastPingAt)}
                        </span>
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-auto size-7"
                      aria-label={tx("Delete")}
                      onClick={() => void api.deleteCronCheck(c.id).then(load)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                      {cmd}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={tx("Copy")}
                      onClick={() => copy(cmd)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {tx(
            "Append the command to the job, e.g. `pg_dump … && curl …`. Add /start before the run to measure how long it takes, /fail to report a failure right away."
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/** Each connected platform's version against its security advisories. */
export function PlatformsTab() {
  const [data, setData] = useState<PlatformWatch | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .getPlatformWatch()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const check = async () => {
    setBusy(true);
    try {
      setData(await api.checkPlatforms());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Check failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("Platforms")}</CardTitle>
        <CardDescription>
          {tx(
            "Dokploy, Coolify, Komodo and Portainer run everything else — the version you run, checked against the security advisories each project publishes."
          )}
        </CardDescription>
        <CardAction>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => void check()}
            disabled={busy}
            aria-label={tx("Check again")}
            title={tx("Check again")}
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : !data || data.platforms.length === 0 ? (
          <p className="text-muted-foreground">
            {data
              ? tx("No platform connected.")
              : tx("Not checked yet — check now.")}
          </p>
        ) : (
          <>
            {data.platforms.map((p) => (
              <div key={p.platform} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.label}</span>
                  <span className="font-mono text-xs">
                    {p.version ?? tx("version unknown")}
                  </span>
                  {p.affected.length > 0 ? (
                    <Badge variant="destructive-soft">
                      <ShieldAlert />
                      {tx("{n} known vulnerabilities", {
                        n: p.affected.length,
                      })}
                    </Badge>
                  ) : p.version ? (
                    <Badge variant="success">
                      {tx("no known vulnerability")}
                    </Badge>
                  ) : null}
                  {p.latest && p.version && p.latest !== p.version && (
                    <span className="text-xs text-muted-foreground">
                      {tx("latest: {v}", { v: p.latest })}
                    </span>
                  )}
                </div>
                {p.affected.length > 0 && (
                  <ul className="space-y-1">
                    {p.affected.slice(0, 8).map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Badge variant="outline">{a.severity}</Badge>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {a.summary}
                          <ExternalLink className="size-3" />
                        </a>
                        {a.patched && (
                          <span className="text-xs text-muted-foreground">
                            {tx("fixed in {v}", { v: a.patched })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {tx("Checked {when}.", {
                when: formatRelative(data.checkedAt) ?? "",
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
