import { useState } from "react";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { api, type ContainerService } from "@/lib/api";
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
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n";

const DATABASES = new Set(["postgres", "mysql", "mariadb", "mongo", "redis"]);

/**
 * Redeploy the Dokploy service behind a container — often all a stuck
 * database needs. Goes through Dokploy; the agent never takes commands.
 */
export function RedeployButton({
  serverId,
  app,
  service,
  variant = "icon",
}: {
  serverId: string;
  app: string;
  service: ContainerService;
  variant?: "icon" | "full";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isDb =
    DATABASES.has(service.kind) || service.kind === "coolify-database";
  const coolify = service.provider === "coolify";
  const where = [service.project, service.environment]
    .filter(Boolean)
    .join(" / ");

  const confirm = async () => {
    setBusy(true);
    try {
      await api.redeployContainer(serverId, app);
      toast.success(t("Redeploy of {name} started", { name: service.name }), {
        description: t(
          "The container restarts in a moment; the next agent report shows its state."
        ),
      });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Redeploy failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Redeploy {name}", { name: app })}
          title={t("Redeploy")}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <RotateCw />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <RotateCw />
          {t("Redeploy")}
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Redeploy {name}?", { name: service.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {coolify
                ? t(
                    "Coolify restarts it — same image, same volumes, no rebuild. It is unreachable for a few seconds."
                  )
                : isDb
                  ? t(
                      "Dokploy recreates the database container on the same volume — the data stays. It is unreachable for a few seconds."
                    )
                  : service.kind === "compose"
                    ? t(
                        "Dokploy rebuilds and restarts the whole compose stack, every service in it."
                      )
                    : t(
                        "Dokploy rebuilds the application from its source and replaces the running container."
                      )}
              {where && (
                <span className="mt-2 block text-xs">
                  {t("Dokploy: {where}", { where })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
            <Button onClick={confirm} disabled={busy}>
              {busy ? <Spinner /> : <RotateCw />}
              {t("Redeploy")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
