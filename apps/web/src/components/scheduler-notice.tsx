import { AlertTriangle } from "lucide-react";
import type { SchedulerStatus } from "@/lib/api";
import { formatRelative } from "@/lib/schedule";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

/**
 * A repository can carry a scan schedule while the API instance runs without
 * ENABLE_SCHEDULER=true — nothing then happens, and until now nothing said so.
 * Rendered only when that mismatch actually exists.
 */
export function SchedulerNotice({
  status,
  hasSchedules,
}: {
  status: SchedulerStatus | null;
  hasSchedules: boolean;
}) {
  if (!status || !hasSchedules) return null;

  if (!status.enabled) {
    return (
      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>{tx("Automatic scans are not running")}</AlertTitle>
        <AlertDescription>
          <p>
            {tx(
              "Repositories here have a schedule, but this API instance was started without the scheduler. Set"
            )}{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              ENABLE_SCHEDULER=true
            </code>{" "}
            {tx(
              "on exactly one API instance and restart it. Manual scans are unaffected."
            )}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (status.lastError) {
    return (
      <ErrorAlert title={tx("The scheduler could not read the database")}>
        {status.lastError}
      </ErrorAlert>
    );
  }

  return null;
}

/** One-line footnote about the scheduler, for the bottom of a list. */
export function SchedulerFootnote({
  status,
}: {
  status: SchedulerStatus | null;
}) {
  if (!status?.enabled) return null;
  const last = formatRelative(status.lastCheckAt);
  return (
    <p className="text-xs text-muted-foreground">
      {tx("Scheduler active — checks for due scans every 5 minutes")}
      {last ? `, ${tx("last check {when}", { when: last })}` : ""}.
    </p>
  );
}
