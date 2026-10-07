import { useEffect, useState } from "react";
import { Archive, Container, Plus, Trash2 } from "lucide-react";
import {
  api,
  type BackupCheck,
  type ContainerService,
  type ImageStatus,
  type ServerDetail,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/components/server-ui";
import {
  ContainerSheet,
  type ContainerRow,
} from "@/components/container-sheet";
import { RedeployButton } from "@/components/container-redeploy";
import { ImageBadge } from "@/components/image-badge";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";
import { appName } from "@/lib/explain";

const HOUR = 60 * 60 * 1000;

/** A container's state in words: "keeps restarting", not "Restarting (1)". */
function containerState(c: {
  state?: string | null;
  health?: string | null;
}): string {
  if (c.state === "restarting") return tx("keeps restarting");
  if (c.health === "unhealthy") return tx("not healthy");
  if (c.health === "healthy") return tx("healthy");
  if (c.health === "starting") return tx("starting");
  if (c.state === "exited") return tx("stopped");
  if (c.state === "paused") return tx("paused");
  return tx("running");
}

/**
 * Every app on the server: Swarm services (Dokploy) with their replicas and
 * every running container with its health check and the CVEs Trivy found in
 * its image — what is actually live, in one table.
 */
export function DockerAppsCard({ server }: { server: ServerDetail }) {
  const [selected, setSelected] = useState<ContainerRow | null>(null);
  // Containers Dokploy runs, by app — those can be redeployed.
  const [dokploy, setDokploy] = useState<Record<string, ContainerService>>({});
  useEffect(() => {
    api
      .getContainerServices(server.id)
      .then((r) => setDokploy(r.services))
      .catch(() => setDokploy({}));
  }, [server.id]);
  // Each image against Docker Hub: no longer maintained, newer build.
  const [images, setImages] = useState<Record<string, ImageStatus>>({});
  useEffect(() => {
    api
      .getServerImages(server.id)
      .then((r) =>
        setImages(Object.fromEntries(r.images.map((i) => [i.image, i])))
      )
      .catch(() => setImages({}));
  }, [server.id]);
  const r = server.lastReport;
  const containers = r?.containers ?? [];
  const services = r?.services ?? [];
  if (!r || (containers.length === 0 && services.length === 0)) return null;
  const cves = new Map(
    (r.trivy?.targets ?? [])
      .filter((t) => t.kind === "image")
      .map((t) => [t.target, t])
  );
  const appOf = (c: ContainerRow) => c.app || c.name;
  // Memory per app (replicas add up) against its usual level and limit.
  const usage = (c: ContainerRow) => {
    const reps = containers.filter((x) => appOf(x) === appOf(c));
    const mem = reps.reduce((s, x) => s + (x.memBytes ?? 0), 0);
    const limit = reps.every((x) => (x.memLimit ?? 0) > 0)
      ? reps.reduce((s, x) => s + (x.memLimit ?? 0), 0)
      : null;
    const base = server.workloadBaseline?.apps[appOf(c)];
    const usual = base && base.samples >= 288 ? base.mem : null;
    const hot =
      (limit != null && mem / limit >= 0.9) ||
      (usual != null && mem >= 2 * usual && mem - usual >= 256 * 1024 ** 2) ||
      reps.some((x) => x.oomKilled);
    return { mem, limit, usual, hot, reps };
  };
  const critical = (c: ContainerRow) =>
    cves.get(c.image)?.severities?.critical ?? 0;
  const imagesWithCritical = new Set(
    containers.filter((c) => critical(c) > 0).map((c) => c.image)
  ).size;
  const hotApps = new Set(containers.filter((c) => usage(c).hot).map(appOf))
    .size;
  const downServices = services.filter(
    (s) => s.desired > 0 && s.running < s.desired
  );
  const unhealthy = containers.filter(
    (c) => c.health === "unhealthy" || c.state === "restarting"
  );
  const trouble = (c: ContainerRow) =>
    (c.health === "unhealthy" || c.state === "restarting" ? 4 : 0) +
    (usage(c).hot ? 2 : 0) +
    (critical(c) > 0 ? 1 : 0);
  const sorted = [...containers].sort(
    (a, b) => trouble(b) - trouble(a) || a.name.localeCompare(b.name)
  );

  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="border-b pb-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-2">
          <Container className="size-4" />
          {tx("Docker apps")}
        </CardTitle>
        <CardDescription>
          {[
            tx("{n} running containers", { n: containers.length }),
            services.length > 0
              ? tx("{n} services", { n: services.length })
              : null,
            downServices.length > 0
              ? tx("{n} not at full strength", { n: downServices.length })
              : null,
            unhealthy.length > 0
              ? tx("{n} with problems", { n: unhealthy.length })
              : null,
            hotApps > 0
              ? tx("{n} using unusually much memory", { n: hotApps })
              : null,
            imagesWithCritical > 0
              ? tx("{n} with critical security holes", {
                  n: imagesWithCritical,
                })
              : null,
            r.trivy?.scannedAt
              ? tx("checked {when}", {
                  when: formatRelative(r.trivy.scannedAt) ?? "",
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      {services.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-6 py-3">
          {[...services]
            .sort(
              (a, b) =>
                Number(b.running < b.desired) - Number(a.running < a.desired) ||
                a.name.localeCompare(b.name)
            )
            .map((s) => (
              <Badge
                key={s.name}
                variant={
                  s.desired === 0
                    ? "outline"
                    : s.running === 0
                      ? "destructive"
                      : s.running < s.desired
                        ? "warning"
                        : "success"
                }
                title={s.mode ?? undefined}
              >
                {s.name} {s.running}/{s.desired}
              </Badge>
            ))}
        </div>
      )}
      {sorted.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-6">{tx("Container")}</TableHead>
              <TableHead className="hidden @lg/main:table-cell">
                {tx("State")}
              </TableHead>
              <TableHead className="hidden @2xl/main:table-cell">
                {tx("Image")}
              </TableHead>
              <TableHead className="text-right">{tx("Memory")}</TableHead>
              <TableHead className="text-right">{tx("CVEs")}</TableHead>
              <TableHead className="w-0 pr-6">
                <span className="sr-only">{tx("Actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((c) => {
              const t = cves.get(c.image);
              const u = usage(c);
              const sev = t?.severities;
              return (
                <TableRow
                  key={c.name}
                  className="cursor-pointer"
                  onClick={() => setSelected(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(c);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Details for ${c.name}`}
                >
                  <TableCell
                    className="max-w-40 truncate pl-6 font-medium sm:max-w-56"
                    title={c.name}
                  >
                    {appName(c.name)}
                    <p className="truncate font-mono text-xs font-normal text-muted-foreground @2xl/main:hidden">
                      {c.image}
                    </p>
                    {/* Narrow screens: the state column is gone, problems stay. */}
                    {(c.state === "restarting" || c.health === "unhealthy") && (
                      <Badge
                        variant="destructive"
                        className="mt-1 @lg/main:hidden"
                      >
                        {containerState(c)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal @lg/main:table-cell">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant={
                          c.state === "restarting" || c.health === "unhealthy"
                            ? "destructive"
                            : c.health === "healthy"
                              ? "success"
                              : c.health === "starting"
                                ? "secondary"
                                : "outline"
                        }
                        title={c.status ?? undefined}
                      >
                        {containerState(c)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-xs font-mono text-xs text-muted-foreground @2xl/main:table-cell">
                    <span className="block truncate">{c.image}</span>
                    <ImageBadge status={images[c.image]} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {c.memBytes == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span
                          className={cn(
                            "tabular-nums",
                            u.hot && "font-medium text-destructive"
                          )}
                        >
                          {formatBytes(c.memBytes)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {c.memLimit
                            ? tx("of {size}", { size: formatBytes(c.memLimit) })
                            : u.usual != null
                              ? tx("usually {size}", {
                                  size: formatBytes(u.usual / u.reps.length),
                                })
                              : c.cpuPct != null
                                ? `${Math.round(c.cpuPct / (r?.host.cpuCount || 1))}% CPU`
                                : null}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {t == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : t.count === 0 ? (
                      <Badge variant="success">0</Badge>
                    ) : sev ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {(sev.critical ?? 0) > 0 && (
                          <Badge variant="destructive">
                            {sev.critical} {tx("critical")}
                          </Badge>
                        )}
                        {(sev.high ?? 0) > 0 && (
                          <Badge variant="destructive-soft">
                            {sev.high} {tx("high")}
                          </Badge>
                        )}
                        {!sev.critical && !sev.high && (
                          <Badge variant="outline">{t.count}</Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="destructive-soft">{t.count}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {dokploy[appOf(c)] && (
                      <RedeployButton
                        serverId={server.id}
                        app={appOf(c)}
                        service={dokploy[appOf(c)]!}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <ContainerSheet
        server={server}
        container={selected}
        service={selected ? dokploy[appOf(selected)] : undefined}
        imageStatus={selected ? images[selected.image] : undefined}
        siblings={
          selected ? containers.filter((x) => appOf(x) === appOf(selected)) : []
        }
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Card>
  );
}

/** Backups configured on the server and how fresh they are. */
export function BackupsCard({ server }: { server: ServerDetail }) {
  const checks = server.backupChecks ?? [];
  const results = new Map(
    (server.lastReport?.backups ?? []).map((b) => [b.name, b])
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="size-4" />
          {tx("Backups")}
        </CardTitle>
        <CardDescription>
          {checks.length === 0
            ? tx(
                "None watched yet — add the backup folders under Settings and missing backups raise an alarm."
              )
            : tx("Newest file per backup location; too old raises an alarm.")}
        </CardDescription>
      </CardHeader>
      {checks.length > 0 && (
        <CardContent className="space-y-2 text-sm">
          {checks.map((c) => {
            const r = results.get(c.name);
            const age = r?.newestAt
              ? Date.now() - new Date(r.newestAt).getTime()
              : null;
            const stale = age != null && age > c.maxAgeHours * HOUR;
            return (
              <div
                key={c.name}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {c.path}
                  </p>
                </div>
                {!r ? (
                  <Badge variant="outline">{tx("waiting for agent")}</Badge>
                ) : r.error || !r.newestAt ? (
                  <Badge variant="destructive">
                    {r.error ?? tx("no files")}
                  </Badge>
                ) : (
                  <Badge
                    variant={stale ? "destructive-soft" : "success"}
                    title={formatDateTime(r.newestAt) ?? undefined}
                  >
                    {formatRelative(r.newestAt)}
                    {r.sizeBytes != null && ` · ${formatBytes(r.sizeBytes)}`}
                  </Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Name, path, max age and the button share one row from sm up; on a phone
 * name and path get a full line each and age + button share the last.
 */
const BACKUP_ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border p-2 sm:grid-cols-[1fr_2fr_7rem_auto] sm:border-0 sm:p-0";
const BACKUP_WIDE = "col-span-2 sm:col-span-1";

/** Settings: which backup locations the agent watches. */
export function BackupChecksEditor({
  value,
  onChange,
}: {
  value: BackupCheck[];
  onChange: (next: BackupCheck[]) => void;
}) {
  const [draft, setDraft] = useState<BackupCheck>({
    name: "",
    path: "",
    maxAgeHours: 26,
  });
  const validPath =
    draft.path.startsWith("/") && !draft.path.split("/").includes("..");
  const update = (i: number, patch: Partial<BackupCheck>) =>
    onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-3">
      {value.map((b, i) => (
        <div key={i} className={BACKUP_ROW}>
          <Input
            aria-label={tx("Backup name")}
            className={BACKUP_WIDE}
            value={b.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            aria-label={tx("Backup path")}
            value={b.path}
            onChange={(e) => update(i, { path: e.target.value })}
            className={cn(BACKUP_WIDE, "font-mono text-xs")}
          />
          <Input
            aria-label={tx("Maximum age in hours")}
            type="number"
            inputMode="numeric"
            min={1}
            value={b.maxAgeHours}
            onChange={(e) =>
              update(i, { maxAgeHours: Number(e.target.value) || 1 })
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${b.name}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={BACKUP_ROW}>
        <Input
          aria-label={tx("New backup name")}
          placeholder={tx("Database")}
          className={BACKUP_WIDE}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Input
          aria-label={tx("New backup path")}
          placeholder={tx("/var/backups/postgres or /backups/*.sql.gz")}
          value={draft.path}
          onChange={(e) => setDraft({ ...draft, path: e.target.value })}
          className={cn(BACKUP_WIDE, "font-mono text-xs")}
        />
        <Input
          aria-label={tx("New backup maximum age in hours")}
          type="number"
          inputMode="numeric"
          min={1}
          value={draft.maxAgeHours}
          onChange={(e) =>
            setDraft({ ...draft, maxAgeHours: Number(e.target.value) || 1 })
          }
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={tx("Add backup location")}
          disabled={!draft.name.trim() || !validPath}
          onClick={() => {
            onChange([...value, { ...draft, name: draft.name.trim() }]);
            setDraft({ name: "", path: "", maxAgeHours: 26 });
          }}
        >
          <Plus />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tx(
          "A folder, file or glob on the server. The agent only reads file dates and sizes — never contents. 26 hours suits a nightly backup."
        )}
      </p>
    </div>
  );
}
