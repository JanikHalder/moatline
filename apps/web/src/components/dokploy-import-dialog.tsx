import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type DokployImportPlan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ErrorAlert } from "@/components/error-alert";
import { useT } from "@/lib/i18n";

/**
 * Everything Dokploy deploys from GitHub that is not here yet, in one go —
 * each new repository linked to its Dokploy service, server and live URL.
 */
export function DokployImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const t = useT();
  const [plan, setPlan] = useState<DokployImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setError(null);
    api
      .getDokployImport()
      .then((p) => {
        setPlan(p);
        setPicked(new Set(p.candidates.map((c) => c.applicationId)));
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("Could not load Dokploy"))
      );
  }, [open, t]);

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.importFromDokploy([...picked]);
      toast.success(
        t(
          r.created === 1
            ? "{n} repository added — fast scan running"
            : "{n} repositories added — fast scans running",
          { n: r.created }
        )
      );
      onOpenChange(false);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Import failed"));
    } finally {
      setSaving(false);
    }
  };

  const where = (x: { project: string; environment: string | null }) =>
    [x.project, x.environment].filter(Boolean).join(" / ");
  const all = plan?.candidates ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Add everything from Dokploy")}</DialogTitle>
          <DialogDescription>
            {t(
              "Every repository Dokploy deploys from GitHub that is not here yet — linked to its Dokploy service, server and live URL, and scanned right away."
            )}
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!plan && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : plan ? (
          <div className="grid gap-3 text-sm">
            {all.length === 0 ? (
              <p className="text-muted-foreground">
                {t(
                  "Nothing missing — every Dokploy service with a GitHub source is already here."
                )}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {t("Not here yet: {n}", { n: all.length })}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() =>
                      setPicked(
                        picked.size === all.length
                          ? new Set()
                          : new Set(all.map((c) => c.applicationId))
                      )
                    }
                  >
                    {picked.size === all.length
                      ? t("Select none")
                      : t("Select all")}
                  </Button>
                </div>
                <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
                  {all.map((c) => (
                    <li key={c.applicationId}>
                      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/50">
                        <Checkbox
                          className="mt-0.5"
                          checked={picked.has(c.applicationId)}
                          onCheckedChange={(v) =>
                            toggle(c.applicationId, v === true)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {c.githubRepo}
                            {c.branch && (
                              <span className="font-mono text-xs font-normal text-muted-foreground">
                                {" "}
                                @ {c.branch}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {where(c)} · {c.name}
                            {c.kind === "compose" ? " · compose" : ""}
                          </span>
                          {c.also.length > 0 && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {t("also deployed as {list}", {
                                list: c.also.join(", "),
                              })}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.existing.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("Already here: {n} Dokploy services.", {
                  n: plan.existing.length,
                })}
              </p>
            )}
            {plan.unsupported.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t("Without a GitHub source (nothing to scan): {n}", {
                    n: plan.unsupported.length,
                  })}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {plan.unsupported.map((u) => (
                    <li key={u.applicationId}>
                      {where(u)} · {u.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || picked.size === 0}>
            {saving && <Spinner />}
            {picked.size === 1
              ? t("Add {n} repository", { n: 1 })
              : t("Add {n} repositories", { n: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
