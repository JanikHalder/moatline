import { useEffect, useMemo, useState } from "react";
import { Lock, Search } from "lucide-react";
import { api, type GithubRepo } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorAlert } from "@/components/error-alert";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

/**
 * The repositories the organization's Git tokens can read — GitHub and
 * every host from Settings — without the ones already connected: pick
 * instead of typing URLs.
 */
export function GithubRepoPicker({
  selected,
  onChange,
  onUnavailable,
}: {
  selected: GithubRepo[];
  onChange: (repos: GithubRepo[]) => void;
  /** No token or every host refused: the caller offers the URL form instead. */
  onUnavailable: (reason: string) => void;
}) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [hosts, setHosts] = useState(1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .getGithubRepos()
      .then((r) => {
        setRepos(r.repos.filter((x) => !x.connected));
        const sources = r.sources ?? [];
        setHosts(sources.length || 1);
        setFailed(
          sources
            .filter((x) => x.error)
            .map((x) => `${x.label} (${x.origin}): ${x.error}`)
        );
      })
      .catch((e) => {
        const reason =
          e instanceof Error ? e.message : tx("Git host not reachable");
        setError(reason);
        setRepos([]);
        onUnavailable(reason);
      });
    // Loaded once per open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter(
      (r) =>
        !q ||
        r.fullName.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }, [repos, query]);

  const isSelected = (r: GithubRepo) => selected.some((s) => s.url === r.url);
  const toggle = (r: GithubRepo) =>
    onChange(
      isSelected(r) ? selected.filter((s) => s.url !== r.url) : [...selected, r]
    );

  if (error) return <ErrorAlert>{error}</ErrorAlert>;

  return (
    <div className="grid gap-2">
      {failed.map((f) => (
        <p key={f} className="text-xs text-amber-700 dark:text-amber-400">
          {tx("Not listed:")} {f}
        </p>
      ))}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tx("Search repositories")}
          aria-label={tx("Search repositories")}
          className="pl-8"
          autoFocus
        />
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border">
        {repos === null ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {repos.length === 0
              ? tx(
                  "Every repository these tokens can read is already connected."
                )
              : tx("No repository matches.")}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((r) => (
              <li key={r.url}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
                  <Checkbox
                    className="mt-0.5"
                    checked={isSelected(r)}
                    onCheckedChange={() => toggle(r)}
                    aria-label={r.fullName}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium break-all">
                        {r.fullName}
                      </span>
                      {hosts > 1 && (
                        <Badge variant="secondary">{r.hostLabel}</Badge>
                      )}
                      {r.private && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" />
                          private
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        r.language,
                        r.defaultBranch,
                        r.pushedAt && `pushed ${formatRelative(r.pushedAt)}`,
                        r.description,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {repos && repos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.length}{" "}
          {tx(
            "selected · scanned on their default branch from the repository root. For a monorepo, set the root directory afterwards in the repository's settings."
          )}
        </p>
      )}
    </div>
  );
}
