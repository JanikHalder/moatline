import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { api, type MaintenanceWindow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const DURATIONS: Array<[number, string]> = [
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
  [240, "4 hours"],
  [480, "8 hours"],
];

/**
 * Planned work on a server or repository: alerts are held back and status
 * pages say "maintenance" until it ends — or someone ends it.
 */
export function MaintenanceButton({
  scope,
  targetId,
}: {
  scope: "server" | "repository";
  targetId: string;
}) {
  const [active, setActive] = useState<MaintenanceWindow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .getMaintenance()
      .then(({ windows }) =>
        setActive(
          windows.find(
            (w) =>
              Date.parse(w.startsAt) <= Date.now() &&
              (w.scope === "organization" ||
                (w.scope === scope && w.targetId === targetId))
          ) ?? null
        )
      )
      .catch(() => setActive(null));
  // Loaded once per target; load only reads scope and targetId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [scope, targetId]);

  const start = async (minutes: number) => {
    setBusy(true);
    try {
      await api.startMaintenance({ scope, targetId, minutes });
      toast.success(tx("Maintenance started — alerts are held back."));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not start"));
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.endMaintenance(active.id);
      toast.success(tx("Maintenance ended"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (active)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void end()}
        disabled={busy || active.scope === "organization"}
        className="border-sky-500/40 text-sky-700 dark:text-sky-300"
        title={tx("Alerts are held back until {time}. Click to end it now.", {
          time: formatDateTime(active.endsAt) ?? "",
        })}
      >
        <Wrench />
        {tx("Maintenance until {time}", {
          time: new Date(active.endsAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        })}
      </Button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <Wrench />
          {tx("Maintenance")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-56 text-xs font-normal text-muted-foreground">
          {tx(
            "Hold back alerts while you work on it; status pages show maintenance."
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DURATIONS.map(([m, label]) => (
          <DropdownMenuItem key={m} onSelect={() => void start(m)}>
            {tx(label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
