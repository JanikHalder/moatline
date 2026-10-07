import { useEffect, useState } from "react";
import { ArrowUpCircle, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, type UpdateStatus } from "@/lib/api";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CodeLine } from "@/components/server-ui";
import { useT } from "@/lib/i18n";

/**
 * Version and updates of a self-hosted instance — with a one-click update
 * when the Docker socket is mounted, like Dokploy. Hidden on the cloud.
 */
export function UpdatesCard() {
  const t = useT();
  const [s, setS] = useState<UpdateStatus | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .getUpdateStatus()
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s || s.hidden) return null;

  const update = async () => {
    setBusy(true);
    try {
      const r = await api.startSelfUpdate();
      toast.success(
        t("Updating to {v} — the app restarts in a minute or two.", {
          v: r.version,
        })
      );
      setConfirm(false);
      // Reload once the new version answers.
      const started = Date.now();
      const poll = setInterval(async () => {
        const next = await api.getUpdateStatus().catch(() => null);
        if (
          (next && !next.hidden && next.current === r.version) ||
          Date.now() - started > 10 * 60_000
        ) {
          clearInterval(poll);
          window.location.reload();
        }
      }, 10_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Update failed"));
    } finally {
      setBusy(false);
    }
  };

  const v = s.latest?.version;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="size-4" />
          {t("Updates")}
          {s.available ? (
            <Badge variant="warning">
              {t("{v} available", { v: v ?? "" })}
            </Badge>
          ) : s.latest ? (
            <Badge variant="success">{t("up to date")}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t("This instance runs version {v}.", { v: s.current })}
          {!s.latest && ` ${t("No release information available.")}`}
        </CardDescription>
      </CardHeader>
      {s.available && v && (
        <CardContent className="space-y-3 text-sm">
          {s.latest?.notes && (
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-sans text-xs whitespace-pre-wrap">
              {s.latest.notes}
            </pre>
          )}
          {s.mode === "button" ? (
            <Button onClick={() => setConfirm(true)}>
              <ArrowUpCircle />
              {t("Update to {v}", { v })}
            </Button>
          ) : s.mode === "dokploy" || s.mode === "coolify" ? (
            <p className="text-muted-foreground">
              {t(
                "Installed through {platform}: change the image tags in the service to {v} there and redeploy.",
                { platform: s.mode === "dokploy" ? "Dokploy" : "Coolify", v }
              )}
            </p>
          ) : (
            <div className="space-y-2">
              {s.hint === "no-socket-permission" && (
                <p className="text-warning">
                  {t(
                    "The Docker socket is mounted, but the API may not use it: add its group (group_add: DOCKER_GID, see docker-compose.yml) for one-click updates."
                  )}
                </p>
              )}
              <p className="text-muted-foreground">
                {t(
                  "In the folder with docker-compose.yml (set PC_VERSION in .env when you pin versions). For one-click updates, set SELF_UPDATE=true and mount the Docker socket."
                )}
              </p>
              <CodeLine
                text={`sed -i 's/^PC_VERSION=.*/PC_VERSION=${v}/' .env; docker compose pull && docker compose up -d`}
                label={t("update command")}
              />
            </div>
          )}
          {s.latest?.url && (
            <a
              href={s.latest.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("Release notes on GitHub")} <ExternalLink className="size-3" />
            </a>
          )}
        </CardContent>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Update to {v}?", { v: v ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Pulls the new images and recreates the containers. The app is unavailable for a minute or two; the database migrates on start. Data stays."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
            <Button onClick={update} disabled={busy}>
              {busy ? <Spinner /> : <ArrowUpCircle />}
              {t("Update")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
