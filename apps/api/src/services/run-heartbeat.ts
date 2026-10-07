import { eq } from "drizzle-orm";
import { db, updateRuns } from "db";

export const RUN_HEARTBEAT_MS = 60_000;

/**
 * Proof that a fix or update run is still being worked on. Returns the stop
 * function; call it when the run ends, however it ends.
 */
export function startRunHeartbeat(runId: string): () => void {
  const beat = () =>
    db
      .update(updateRuns)
      .set({ heartbeatAt: new Date() })
      .where(eq(updateRuns.id, runId))
      .catch(() => {});
  void beat();
  const t = setInterval(beat, RUN_HEARTBEAT_MS);
  t.unref();
  return () => clearInterval(t);
}
