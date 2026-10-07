import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, GitBranch, RefreshCw, Trash2 } from "lucide-react";
import {
  api,
  type BranchOverview,
  type BranchRow,
  type GitHostKind,
} from "@/lib/api";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorAlert } from "@/components/error-alert";
import { branchUrl, hostLabel } from "@/lib/git-host";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

const canGo = (b: BranchRow) => b.status === "merged" && !b.protected;

/**
 * Every branch on the host and whether it still holds work. Merged branches
 * nobody deleted keep showing as "open" in editors and tools — here they
 * are named, and can go in one click. Branches with work that is not in the
 * default branch are never offered for deletion.
 */
export function BranchesCard({
  repoId,
  githubUrl,
  gitHost,
}: {
  repoId: string;
  githubUrl: string;
  gitHost?: GitHostKind | null;
}) {
  const t = useT();
  const [data, setData] = useState<BranchOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const host = hostLabel(githubUrl, gitHost);

  const load = useCallback(
    (refresh = false) => {
      setLoading(true);
      setError(null);
      api
        .getRepoBranches(repoId, refresh)
        .then(setData)
        .catch((e) =>
          setError(e instanceof Error ? e.message : t("Branches not readable"))
        )
        .finally(() => setLoading(false));
    },
    [repoId, t]
  );
  useEffect(() => load(), [load]);

  const remove = async (names: string[]) => {
    setDeleting(true);
    try {
      const res = await api.deleteRepoBranches(repoId, names);
      if (res.deleted.length)
        toast.success(
          t(
            res.deleted.length === 1
              ? "{n} branch deleted"
              : "{n} branches deleted",
            { n: res.deleted.length }
          )
        );
      for (const r of res.refused) toast.error(`${r.name}: ${t(r.reason)}`);
      setConfirm(null);
      load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not delete"));
    } finally {
      setDeleting(false);
    }
  };

  const rows = data?.branches ?? [];
  const merged = rows.filter(canGo);
  const count = (s: BranchRow["status"]) =>
    rows.filter((b) => b.status === s).length;
  const others = rows.filter((b) => b.status !== "default");
  const LIMIT = 12;
  const shown = showAll ? others : others.slice(0, LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 text-muted-foreground" />
          {t("Branches")}
        </CardTitle>
        <CardDescription>
          {t(
            "Branches on {host} and whether they still hold work. Merged ones nobody deleted keep showing up as open — they can go.",
            { host }
          )}
        </CardDescription>
        <CardAction className="flex gap-2">
          {data?.canDelete && merged.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm(merged.map((b) => b.name))}
            >
              <Trash2 />
              {t(
                merged.length === 1
                  ? "Delete {n} merged branch"
                  : "Delete {n} merged branches",
                { n: merged.length }
              )}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => load(true)}
            disabled={loading}
            aria-label={t("Check again")}
            title={t("Check again")}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <ErrorAlert>{error}</ErrorAlert>
        ) : !data ? (
          <Skeleton className="h-24 w-full" />
        ) : others.length === 0 ? (
          <p className="text-muted-foreground">
            {t("Only the default branch — nothing to clean up.")}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              {[
                count("merged") && t("{n} merged", { n: count("merged") }),
                count("open_pr") &&
                  t("{n} with an open pull request", { n: count("open_pr") }),
                count("unmerged") &&
                  t("{n} with work not in the default branch", {
                    n: count("unmerged"),
                  }),
                count("unknown") && t("{n} unknown", { n: count("unknown") }),
              ]
                .filter(Boolean)
                .join(" · ")}
              {data.checkedAt && (
                <span title={formatDateTime(data.checkedAt) ?? undefined}>
                  {" "}
                  · {t("checked")} {formatRelative(data.checkedAt) ?? ""}
                </span>
              )}
            </p>
            <ul className="divide-y rounded-md border">
              {shown.map((b) => (
                <li
                  key={b.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                >
                  <a
                    href={branchUrl(githubUrl, b.name, gitHost)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                    title={b.name}
                  >
                    {b.name}
                  </a>
                  {b.ours && <Badge variant="outline">Moatline</Badge>}
                  {b.protected && (
                    <Badge variant="outline">{t("protected")}</Badge>
                  )}
                  <StatusBadge row={b} />
                  {b.date && (
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      title={formatDateTime(b.date) ?? undefined}
                    >
                      {formatRelative(b.date)}
                    </span>
                  )}
                  {(b.openPr || b.mergedPr) && (
                    <a
                      href={(b.openPr ?? b.mergedPr)!.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                    >
                      #{(b.openPr ?? b.mergedPr)!.number}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {data.canDelete && canGo(b) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setConfirm([b.name])}
                      aria-label={t("Delete {name}", { name: b.name })}
                      title={t("Delete branch")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {others.length > LIMIT && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? t("Show fewer")
                  : t("Show all {n} branches", { n: others.length })}
              </Button>
            )}
            {data.truncated && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Only the first 100 branches were compared; the rest show as unknown."
                )}
              </p>
            )}
            {!data.canDelete && merged.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "To delete branches from here, add a {host} token with write access under Settings.",
                  { host }
                )}
              </p>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => !o && !deleting && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                confirm?.length === 1
                  ? "Delete {n} branch on {host}?"
                  : "Delete {n} branches on {host}?",
                { n: confirm?.length ?? 0, host }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Everything in them is already in the default branch, so no work is lost. Each one is checked again before it is deleted; a branch that got new commits in the meantime stays."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs">
            {confirm?.map((n) => (
              <li key={n} className="truncate">
                {n}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void remove(confirm);
              }}
            >
              {deleting ? t("Deleting…") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StatusBadge({ row }: { row: BranchRow }) {
  const t = useT();
  switch (row.status) {
    case "merged":
      return (
        <Badge variant="success">
          {row.mergedPr ? t("merged via PR") : t("merged")}
        </Badge>
      );
    case "open_pr":
      return <Badge variant="secondary">{t("open pull request")}</Badge>;
    case "unmerged":
      return <Badge variant="outline">{t("not merged")}</Badge>;
    case "unknown":
      return <Badge variant="outline">{t("unknown")}</Badge>;
    default:
      return null;
  }
}
