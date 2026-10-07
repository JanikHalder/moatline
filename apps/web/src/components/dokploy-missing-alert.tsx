import { useEffect, useState } from "react";
import { Plus, ServerOff } from "lucide-react";
import { api, type MissingServer } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/**
 * Servers Dokploy deploys to that no agent watches — so a whole machine is
 * never overlooked.
 */
export function DokployMissingAlert({
  known,
  onAdd,
}: {
  /** Number of servers here; reloads the check when one is added. */
  known: number;
  onAdd: (server: MissingServer) => void;
}) {
  const t = useT();
  const [missing, setMissing] = useState<MissingServer[]>([]);

  useEffect(() => {
    api
      .getDokployMissing()
      .then((r) => setMissing(r.servers))
      .catch(() => setMissing([]));
  }, [known]);

  if (!missing.length) return null;
  return (
    <Alert variant="warning">
      <ServerOff />
      <AlertTitle>
        {t(
          missing.length === 1
            ? "{n} Dokploy server has no agent"
            : "{n} Dokploy servers have no agent",
          { n: missing.length }
        )}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {t(
            "Dokploy deploys to them, but nothing here watches load, updates, attacks or vulnerabilities."
          )}
        </p>
        <ul className="divide-y rounded-md border bg-card">
          {missing.map((m) => (
            <li
              key={m.dokployServerId ?? "host"}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {m.dokployServerId ? m.name : t("Dokploy host")}
                </span>
                {m.address && (
                  <span className="block truncate font-mono text-xs">
                    {m.address}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onAdd({
                    ...m,
                    name: m.dokployServerId ? m.name : t("Dokploy host"),
                  })
                }
              >
                <Plus />
                {t("Add")}
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
