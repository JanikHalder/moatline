import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { api, type OpenIncident } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

/** Sites down right now — on top of the overview, refreshed every minute. */
export function OpenIncidentsAlert() {
  const t = useT();
  const [open, setOpen] = useState<OpenIncident[]>([]);
  useEffect(() => {
    const load = () =>
      api
        .getOpenIncidents()
        .then(setOpen)
        .catch(() => setOpen([]));
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  if (!open.length) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>
        {t(open.length === 1 ? "{n} site is down" : "{n} sites are down", {
          n: open.length,
        })}
      </AlertTitle>
      <AlertDescription>
        <ul className="space-y-0.5">
          {open.map((i) => (
            <li key={i.id}>
              <Link
                to="/repos/$repoId"
                params={{ repoId: i.repositoryId }}
                className="font-medium underline underline-offset-2"
              >
                {i.name}
              </Link>{" "}
              — {t("since {when}", { when: formatRelative(i.startedAt) ?? "" })}
              {i.healAttempts > 0 && ` · ${t("restarted")}`}
              {i.cause && (
                <span className="block truncate font-mono text-xs">
                  {i.cause.split("\n")[0]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
