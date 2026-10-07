import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpCircle, Search, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type StackPackage,
  type VersionLag,
  type VersionOverview,
} from "@/lib/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/page-header";
import { StatBand, StatCard } from "@/components/stat-card";
import { ErrorAlert } from "@/components/error-alert";
import { ServerVersionsTable } from "@/components/server-versions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Repo = VersionOverview["repos"][number];
type Family = "Payload" | "Next.js";
const LEADER: Record<Family, StackPackage> = {
  Payload: "payload",
  "Next.js": "next",
};

const LAG_CLASS: Record<VersionLag, string> = {
  current: "text-success",
  patch: "text-foreground",
  minor: "text-warning",
  major: "text-destructive",
  unknown: "text-muted-foreground",
};

function VersionCell({ p }: { p: Repo["packages"][StackPackage] }) {
  const t = useT();
  if (!p) return <span className="text-muted-foreground">—</span>;
  const label: Record<VersionLag, string> = {
    current: t("current"),
    patch: t("patch behind"),
    minor: t("minor behind"),
    major: t("major behind"),
    unknown: "",
  };
  return (
    <span
      className="flex flex-col"
      title={
        p.fromLockfile
          ? t("Installed (lockfile) · declared {range}", {
              range: p.declared ?? "—",
            })
          : t("No lockfile — lowest version of {range}", {
              range: p.declared ?? "—",
            })
      }
    >
      <span className={cn("font-mono tabular-nums", LAG_CLASS[p.lag])}>
        {p.version ?? p.declared ?? "—"}
      </span>
      {p.lag !== "current" && p.lag !== "unknown" && (
        <span className="text-xs text-muted-foreground">{label[p.lag]}</span>
      )}
    </span>
  );
}

function NodeCell({ node }: { node: Repo["node"] }) {
  const t = useT();
  if (!node) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="flex flex-col"
      title={t("From {source}", { source: node.source })}
    >
      <span className="font-mono tabular-nums">{node.version}</span>
      {node.support === "eol" ? (
        <Badge variant="destructive" className="mt-0.5 w-fit">
          {t("end of life")}
        </Badge>
      ) : node.support === "soon" ? (
        <Badge variant="warning" className="mt-0.5 w-fit">
          {t("EOL soon")}
        </Badge>
      ) : null}
    </span>
  );
}

/** Versions of every site, or of every server. */
export function VersionsPage() {
  const t = useT();
  const [view, setView] = useState<"sites" | "servers">("sites");
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Versions")}
        description={
          view === "sites"
            ? t(
                "Payload, Next.js, React and Node on every site — from each repository's lockfile and Dockerfile."
              )
            : t(
                "Operating system, kernel, Docker and updates on every server — and which ones are out of support."
              )
        }
        actions={
          <ToggleGroup
            type="single"
            variant="outline"
            value={view}
            onValueChange={(v) => v && setView(v as "sites" | "servers")}
          >
            <ToggleGroupItem value="sites">{t("Sites")}</ToggleGroupItem>
            <ToggleGroupItem value="servers">{t("Servers")}</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      {view === "sites" ? <SiteVersions /> : <ServerVersionsTable />}
    </div>
  );
}

/**
 * Payload, Next.js, React and Node across every site — how far behind each
 * one is, and every Payload (or Next.js) site to one release in one go.
 */
function SiteVersions() {
  const t = useT();
  const [data, setData] = useState<VersionOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "payload">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [family, setFamily] = useState<Family>("Payload");
  const [version, setVersion] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = () =>
    api
      .getVersions()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("Failed to load"))
      );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), []);

  // The target version defaults to the newest release of the family.
  useEffect(() => {
    if (data) setVersion(data.latest[LEADER[family]] ?? "");
  }, [data, family]);

  const repos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.repos ?? [])
      .filter((r) => only === "all" || r.packages.payload)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.client?.name?.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, query, only]);

  if (!data)
    return (
      <div className="space-y-6">
        {error ? (
          <ErrorAlert>{error}</ErrorAlert>
        ) : (
          <Skeleton className="h-96 rounded-lg" />
        )}
      </div>
    );

  const all = data.repos;
  const behind = (n: StackPackage) =>
    all.filter((r) => {
      const lag = r.packages[n]?.lag;
      return lag === "minor" || lag === "major";
    }).length;
  const using = (n: StackPackage) => all.filter((r) => r.packages[n]).length;
  const eol = all.filter((r) => r.node?.support === "eol").length;
  const unscanned = all.filter((r) => !r.scannedAt).length;

  // Bulk upgrade applies to selected repos that use the family and are not
  // already on that version.
  const eligible = repos.filter(
    (r) =>
      picked.has(r.id) &&
      r.packages[LEADER[family]] &&
      r.packages[LEADER[family]]!.version !== version &&
      !r.updating
  );

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.bulkUpgrade({
        family,
        version: version.trim(),
        repoIds: eligible.map((x) => x.id),
      });
      toast.success(
        t(
          r.started === 1
            ? "{n} update started — a pull request each"
            : "{n} updates started — a pull request each",
          { n: r.started }
        ),
        {
          description: t(
            "Builds run one after another; each pull request appears in its repository."
          ),
        }
      );
      setConfirm(false);
      setPicked(new Set());
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not start"));
    } finally {
      setBusy(false);
    }
  };

  const scanAll = async () => {
    setScanning(true);
    try {
      await api.scanAll();
      toast.success(t("Fast scans started — versions appear as they finish."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not start"));
    } finally {
      setScanning(false);
    }
  };

  const allPicked = repos.length > 0 && repos.every((r) => picked.has(r.id));

  return (
    <div className="space-y-6">
      {error && <ErrorAlert>{error}</ErrorAlert>}

      <StatBand>
        <StatCard
          label={`Payload ${data.latest.payload ?? ""}`}
          value={`${behind("payload")}/${using("payload")}`}
          tone={behind("payload") ? "warning" : "success"}
          description={t("sites a minor or major behind")}
        />
        <StatCard
          label={`Next.js ${data.latest.next ?? ""}`}
          value={`${behind("next")}/${using("next")}`}
          tone={behind("next") ? "warning" : "success"}
          description={t("sites a minor or major behind")}
        />
        <StatCard
          label={`React ${data.latest.react ?? ""}`}
          value={`${behind("react")}/${using("react")}`}
          tone={behind("react") ? "warning" : "success"}
          description={t("sites a minor or major behind")}
        />
        <StatCard
          label={t("Node.js (recommended {major})", {
            major: data.node.recommended,
          })}
          value={eol}
          tone={eol ? "destructive" : "success"}
          description={t("sites on a Node.js without security updates")}
        />
      </StatBand>

      {unscanned > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {t(
              "{n} repositories have no version data yet — it is collected with the next scan.",
              { n: unscanned }
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={scanAll}
            disabled={scanning}
          >
            {scanning ? <Spinner /> : <Zap />}
            {t("Fast scan all")}
          </Button>
        </div>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search repositories or clients")}
              aria-label={t("Search repositories or clients")}
              className="pl-8"
            />
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={only}
            onValueChange={(v) => v && setOnly(v as "all" | "payload")}
          >
            <ToggleGroupItem value="all">{t("All")}</ToggleGroupItem>
            <ToggleGroupItem value="payload">
              {t("Payload sites")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {picked.size > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-b bg-muted/40 px-4 py-3">
            <div className="grid gap-1">
              <Label className="text-xs">{t("Upgrade")}</Label>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={family}
                onValueChange={(v) => v && setFamily(v as Family)}
              >
                <ToggleGroupItem value="Payload">Payload</ToggleGroupItem>
                <ToggleGroupItem value="Next.js">Next.js</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="bulk-version" className="text-xs">
                {t("to version")}
              </Label>
              <Input
                id="bulk-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="h-8 w-32 font-mono"
              />
            </div>
            <Button
              size="sm"
              disabled={!eligible.length || !/^\d+\.\d+\.\d+/.test(version)}
              onClick={() => setConfirm(true)}
            >
              <ArrowUpCircle />
              {t("Open {n} pull requests", { n: eligible.length })}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("{n} selected", { n: picked.size })}
            </span>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-0 pl-4">
                <Checkbox
                  aria-label={t("Select all")}
                  checked={allPicked}
                  onCheckedChange={(v) =>
                    setPicked(
                      v === true ? new Set(repos.map((r) => r.id)) : new Set()
                    )
                  }
                />
              </TableHead>
              <TableHead>{t("Repository")}</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead>Next.js</TableHead>
              <TableHead className="hidden @2xl/main:table-cell">
                React
              </TableHead>
              <TableHead className="pr-4">Node.js</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={t("Select {name}", { name: r.name })}
                    checked={picked.has(r.id)}
                    onCheckedChange={(v) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (v === true) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      })
                    }
                  />
                </TableCell>
                <TableCell className="max-w-56">
                  <Link
                    to="/repos/$repoId"
                    params={{ repoId: r.id }}
                    className="block truncate font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {r.client?.name}
                    {!r.scannedAt && <span>{t("not scanned yet")}</span>}
                    {r.updating && (
                      <Badge variant="secondary" className="gap-1">
                        <Spinner className="size-3" />
                        {t("update running")}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <VersionCell p={r.packages.payload} />
                </TableCell>
                <TableCell>
                  <VersionCell p={r.packages.next} />
                </TableCell>
                <TableCell className="hidden @2xl/main:table-cell">
                  <VersionCell p={r.packages.react} />
                </TableCell>
                <TableCell className="pr-4">
                  <NodeCell node={r.node} />
                </TableCell>
              </TableRow>
            ))}
            {repos.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("No repositories match.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("{family} {version} on {n} sites?", {
                family,
                version,
                n: eligible.length,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "For each site: every {family} package to exactly this version, nothing else; then install, the repository's check, and a pull request. Nothing is merged or deployed — you review each pull request. Builds run one after another.",
                { family }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 overflow-y-auto rounded-md border text-sm">
            {eligible.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="truncate">{r.name}</span>
                <span className="font-mono text-muted-foreground">
                  {r.packages[LEADER[family]]?.version} → {version}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
            <Button onClick={start} disabled={busy}>
              {busy ? <Spinner /> : <ArrowUpCircle />}
              {t("Open {n} pull requests", { n: eligible.length })}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
