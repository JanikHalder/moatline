import type { Context } from "hono";
import { db, auditLog } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { clientIp } from "./client-ip";

export type AuditTarget = {
  type: string;
  id?: string | null;
  name?: string | null;
};

/**
 * Record an action. Best-effort: a failed audit write is logged, never
 * allowed to fail the action itself — but it must also never be skipped
 * silently, hence the console error.
 */
export async function audit(
  c: Context<{ Variables: TenantVariables }>,
  action: string,
  target?: AuditTarget | null,
  detail?: Record<string, unknown> | null
): Promise<void> {
  const user = c.get("user");
  try {
    await db.insert(auditLog).values({
      organizationId: c.get("organizationId"),
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      targetName: target?.name ?? null,
      detail: detail ?? null,
      ip: clientIp(c),
    });
  } catch (e) {
    console.error(`[audit] could not record ${action}:`, e);
  }
}

/** Audit entries for events outside a request (sign-ins via auth hooks). */
export async function auditRaw(entry: {
  organizationId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  target?: AuditTarget | null;
  ip?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      organizationId: entry.organizationId ?? null,
      userId: entry.userId ?? null,
      userEmail: entry.userEmail ?? null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      targetName: entry.target?.name ?? null,
      ip: entry.ip ?? null,
      detail: entry.detail ?? null,
    });
  } catch (e) {
    console.error(`[audit] could not record ${entry.action}:`, e);
  }
}
