import { useState } from "react";
import { HardDrive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ServerDetail } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/components/server-ui";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

type What = "builder" | "images";

/**
 * What Docker keeps on the disk and what of it is unused — with a cleanup
 * through Dokploy. Volumes (the data) are shown, never cleaned.
 */
export function DockerDiskCard({ server }: { server: ServerDetail }) {
  const t = useT();
  const [confirm, setConfirm] = useState<What | null>(null);
  const [busy, setBusy] = useState(false);
  const d = server.lastReport?.dockerDisk;
  if (!d) return null;

  const rows = [
    { label: t("Build cache"), part: d.buildCache },
    { label: t("Images"), part: d.images },
    { label: t("Containers"), part: d.containers },
    { label: t("Volumes (data)"), part: d.volumes, keep: true },
  ].filter((r) => r.part);

  const run = async (what: What) => {
    setBusy(true);
    try {
      await api.cleanDocker(server.id, what);
      toast.success(
        what === "builder"
          ? t("Build cache cleared")
          : t("Unused images removed"),
        {
          description: t(
            "The next agent report (within an hour) shows the new sizes."
          ),
        }
      );
      setConfirm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Cleanup failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4" />
          {t("Docker storage")}
        </CardTitle>
        <CardDescription>
          {t(
            "Every deploy leaves a build cache and an image behind — until the disk is full."
          )}
          {d.measuredAt &&
            ` ${t("Measured {when}.", { when: formatRelative(d.measuredAt) ?? "" })}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label} className="rounded-md border p-2.5">
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p className="mt-0.5 font-medium tabular-nums">
                {formatBytes(r.part!.sizeBytes)}
              </p>
              {!r.keep && r.part!.reclaimableBytes > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t("{size} unused", {
                    size: formatBytes(r.part!.reclaimableBytes),
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!d.buildCache?.reclaimableBytes}
            onClick={() => setConfirm("builder")}
          >
            <Trash2 />
            {t("Clear build cache")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!d.images?.reclaimableBytes}
            onClick={() => setConfirm("images")}
          >
            <Trash2 />
            {t("Remove unused images")}
          </Button>
        </div>
      </CardContent>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "builder"
                ? t("Clear the build cache?")
                : t("Remove unused images?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "builder"
                ? t(
                    "Safe: running apps are not touched. The next build of each app takes a little longer."
                  )
                : t(
                    "Removes every image no container uses — including older versions a Dokploy rollback would go back to. Running apps and volumes are not touched."
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
            <Button
              variant={confirm === "images" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => confirm && run(confirm)}
            >
              {busy ? <Spinner /> : <Trash2 />}
              {confirm === "builder"
                ? t("Clear build cache")
                : t("Remove unused images")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
