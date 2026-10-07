import { useState } from "react";
import { Database, FolderPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ServerDetail,
  type StorageCheck,
  type StorageItem,
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const GB = 1e9;

const KIND_LABEL: Record<string, string> = {
  minio: "MinIO",
  garage: "Garage",
  seaweedfs: "SeaweedFS",
  rustfs: "RustFS",
  cloudserver: "CloudServer",
  versitygw: "Versity",
  ceph: "Ceph",
};

/** Decimal units, like the limits and the alerts: 200 GB is 200 × 10⁹. */
export function formatGb(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(n >= 1e13 ? 0 : 1)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  return `${Math.max(0, Math.round(n / 1e6))} MB`;
}

/** "in about 9 days", or nothing when it is far off or not growing. */
export function fullIn(daysLeft: number | null | undefined, within = 60) {
  if (daysLeft == null || daysLeft > within) return null;
  const d = Math.round(daysLeft);
  return d < 1
    ? tx("within a day")
    : d === 1
      ? tx("in about 1 day")
      : tx("in about {n} days", { n: d });
}

type Row = {
  name: string;
  item: StorageItem | null;
  check: StorageCheck | null;
};

/**
 * Object storage the agent found (MinIO, Garage, … in Docker) and folders
 * the user watches: how big, which buckets, how fast it grows, and a limit
 * that warns before it gets too big.
 */
export function StorageCard({
  server,
  onSaved,
}: {
  server: ServerDetail;
  onSaved: () => void;
}) {
  const report = server.lastReport;
  const items = report?.storage?.items ?? [];
  const checks = server.storageChecks ?? [];
  const forecast = report?.storageForecast ?? {};
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const byName = new Map(checks.map((c) => [c.name, c]));
  const rows: Row[] = [
    ...items.map((i) => ({
      name: i.name,
      item: i,
      check: byName.get(i.name) ?? null,
    })),
    // Watched folders the agent has not reported yet.
    ...checks
      .filter((c) => c.path && !items.some((i) => i.name === c.name))
      .map((c) => ({ name: c.name, item: null, check: c })),
  ];

  const save = async (next: StorageCheck[]) => {
    setBusy(true);
    try {
      await api.updateServer(server.id, { storageChecks: next });
      toast.success(tx("Saved"), {
        description: tx("The agent picks it up with its next report."),
      });
      onSaved();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Save failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setLimit = (name: string, limitGb: number | null) => {
    const existing = byName.get(name);
    const next = existing
      ? checks.map((c) => (c.name === name ? { ...c, limitGb } : c))
      : [...checks, { name, path: null, limitGb }];
    // A found storage without a limit needs no entry.
    return save(next.filter((c) => c.path || c.limitGb));
  };

  if (!rows.length && !server.lastReportAt) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" />
          {tx("Storage")}
        </CardTitle>
        <CardDescription>
          {tx(
            "S3 storage on this server and folders you watch: how big, what grows, and a warning before it is too big."
          )}
          {report?.storage?.measuredAt &&
            ` ${tx("Measured {when}.", { when: formatRelative(report.storage.measuredAt) ?? "" })}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {server.agentOutdated
              ? tx(
                  "Needs agent 1.14.0 or newer — update it on the Setup tab. Then MinIO, Garage, SeaweedFS and other S3 servers in Docker show up here by themselves."
                )
              : tx(
                  "No S3 storage found. MinIO, Garage, SeaweedFS and other S3 servers in Docker show up here by themselves; for anything else, watch its folder."
                )}
          </p>
        )}
        {rows.map((r) => (
          <StorageRow
            key={r.name}
            row={r}
            forecast={forecast}
            busy={busy}
            onLimit={(gb) => setLimit(r.name, gb)}
            onRemove={
              r.check?.path
                ? () => save(checks.filter((c) => c.name !== r.name))
                : undefined
            }
          />
        ))}
        {adding ? (
          <AddFolder
            taken={new Set(rows.map((r) => r.name))}
            busy={busy}
            onCancel={() => setAdding(false)}
            onAdd={async (name, path) => {
              if (await save([...checks, { name, path, limitGb: null }]))
                setAdding(false);
            }}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <FolderPlus className="size-4" />
            {tx("Watch a folder")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StorageRow({
  row,
  forecast,
  busy,
  onLimit,
  onRemove,
}: {
  row: Row;
  forecast: Record<string, { perDay: number; daysLeft: number | null }>;
  busy: boolean;
  onLimit: (gb: number | null) => Promise<boolean>;
  onRemove?: () => void;
}) {
  const { item, check } = row;
  const [editing, setEditing] = useState(false);
  const [limit, setLimitText] = useState(
    check?.limitGb ? String(check.limitGb) : ""
  );
  const size = item?.sizeBytes ?? null;
  const limitBytes = check?.limitGb ? check.limitGb * GB : null;
  const growth = forecast[`storage:${row.name}`];
  const disk = item?.disk ?? null;
  const diskGrowth = disk ? forecast[`disk:${disk.mount}`] : undefined;
  const diskPct = disk?.totalBytes
    ? (disk.usedBytes / disk.totalBytes) * 100
    : null;
  const limitPct =
    limitBytes && size != null ? (size / limitBytes) * 100 : null;
  const barPct = limitPct ?? diskPct;
  const kind = item?.kind ?? "folder";
  const isBuckets = kind !== "folder";

  const notes = [
    growth && growth.perDay > 0.05 * GB
      ? tx("grows by about {size} a day", { size: formatGb(growth.perDay) })
      : null,
    limitBytes && fullIn(growth?.daysLeft)
      ? tx("limit reached {when}", { when: fullIn(growth?.daysLeft)! })
      : null,
    disk && fullIn(diskGrowth?.daysLeft)
      ? tx("disk full {when}", { when: fullIn(diskGrowth?.daysLeft)! })
      : null,
  ].filter(Boolean);

  const topSize = item?.folders[0]?.sizeBytes ?? 0;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{row.name}</span>
            <Badge variant="outline">
              {kind === "folder" ? tx("Folder") : (KIND_LABEL[kind] ?? "S3")}
            </Badge>
          </p>
          {(item?.paths[0] ?? check?.path) && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {item?.paths[0] ?? check?.path}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">
            {formatGb(size)}
            {limitBytes && (
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {formatGb(limitBytes)}
              </span>
            )}
          </p>
        </div>
      </div>

      {!item ? (
        <Badge variant="outline">{tx("waiting for agent")}</Badge>
      ) : (
        <>
          {barPct != null && (
            <div className="space-y-1">
              <Progress
                value={Math.min(100, barPct)}
                className={cn(
                  barPct >= 90 &&
                    "[&>[data-slot=progress-indicator]]:bg-destructive"
                )}
              />
              <p className="text-xs text-muted-foreground">
                {limitPct != null
                  ? tx("{pct}% of its limit", { pct: Math.round(limitPct) })
                  : tx("Disk {mount}: {pct}% used, {free} free", {
                      mount: disk!.mount,
                      pct: Math.round(diskPct!),
                      free: formatGb(disk!.totalBytes - disk!.usedBytes),
                    })}
                {notes.length > 0 && ` · ${notes.join(" · ")}`}
              </p>
            </div>
          )}
          {item.error && (
            <p className="text-xs text-destructive">{item.error}</p>
          )}
          {item.folders.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {isBuckets ? tx("Biggest buckets") : tx("Biggest folders")}
              </p>
              {item.folders.slice(0, 5).map((f) => (
                <div
                  key={f.name}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-3 text-sm"
                >
                  <span className="truncate font-mono text-xs">{f.name}</span>
                  <Progress
                    value={topSize ? (f.sizeBytes / topSize) * 100 : 0}
                    className="h-1.5"
                  />
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatGb(f.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Input
              aria-label={tx("Limit in GB")}
              type="number"
              inputMode="decimal"
              min={1}
              placeholder="200"
              value={limit}
              onChange={(e) => setLimitText(e.target.value)}
              className="h-8 w-28"
            />
            <span className="text-sm text-muted-foreground">GB</span>
            <Button
              size="sm"
              disabled={busy || !(Number(limit) > 0)}
              onClick={async () => {
                if (await onLimit(Number(limit))) setEditing(false);
              }}
            >
              {tx("Save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {tx("Cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {check?.limitGb ? tx("Change limit") : tx("Set a limit")}
            </Button>
            {check?.limitGb && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setLimitText("");
                  void onLimit(null);
                }}
              >
                {tx("Remove limit")}
              </Button>
            )}
          </>
        )}
        {onRemove && !editing && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            disabled={busy}
            onClick={onRemove}
            aria-label={tx("Stop watching")}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddFolder({
  taken,
  busy,
  onAdd,
  onCancel,
}: {
  taken: Set<string>;
  busy: boolean;
  onAdd: (name: string, path: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const validPath = path.startsWith("/") && !path.split("/").includes("..");
  const nameTaken = taken.has(name.trim());
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Input
          aria-label={tx("Name")}
          placeholder={tx("e.g. Uploads")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label={tx("Folder on the server")}
          placeholder="/var/lib/docker/volumes/minio-data/_data"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {nameTaken
          ? tx("That name is already in use.")
          : tx(
              "Any folder on the server — the data folder of an S3 server outside Docker, an upload folder, a backup target. The agent only measures its size."
            )}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !name.trim() || nameTaken || !validPath}
          onClick={() => onAdd(name.trim(), path.trim())}
        >
          {tx("Watch")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {tx("Cancel")}
        </Button>
      </div>
    </div>
  );
}
