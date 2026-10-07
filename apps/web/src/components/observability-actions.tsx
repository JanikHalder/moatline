import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CodeLine } from "@/components/server-ui";
import { useT } from "@/lib/i18n";
import { OpenObserveSetup } from "@/components/openobserve-setup";

/** Send a test event; create the URL alerts are sent to. */
export function ObservabilityActions({
  receiverSet,
  onChanged,
}: {
  receiverSet: boolean;
  /** Settings changed on the server (OpenObserve set the OTLP target). */
  onChanged?: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.sendTestEvent();
      if (!r.sent.length && !r.failed.length)
        toast.error(
          t(
            "No target set — save an OTLP endpoint, Grafana or a webhook first."
          )
        );
      else if (r.failed.length)
        toast.error(
          t("Sent to {ok}; failed: {bad}", {
            ok: r.sent.join(", ") || "—",
            bad: r.failed.map((f) => `${f.target} (${f.error})`).join(", "),
          })
        );
      else
        toast.success(t("Test event sent to {ok}", { ok: r.sent.join(", ") }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not send"));
    } finally {
      setTesting(false);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      setUrl((await api.createAlertReceiver()).url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not create"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid gap-3 border-t pt-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={testing}>
          {testing && <Spinner />}
          {t("Send a test event")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={create}
          disabled={creating}
        >
          {creating && <Spinner />}
          {receiverSet
            ? t("New alert receiver URL")
            : t("Create alert receiver URL")}
        </Button>
        <OpenObserveSetup onDone={() => onChanged?.()} />
      </div>
      {url ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground">
            {t(
              "Shown once — copy it now. Add it as a webhook contact point in Grafana or a receiver in Alertmanager. Label alerts with service (or app, job) = the repository's name; add moatline_action=restart to let Moatline restart the app."
            )}
          </p>
          <CodeLine text={url} label={t("alert receiver URL")} />
        </div>
      ) : (
        <p className="text-muted-foreground">
          {receiverSet
            ? t("Alerts are being received. A new URL replaces the old one.")
            : t(
                "Alerts from Grafana, Alertmanager and other tools become incidents on the repository they name."
              )}
        </p>
      )}
    </div>
  );
}
