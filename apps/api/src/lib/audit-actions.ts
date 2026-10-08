import { or, sql } from "drizzle-orm";
import { auditLog } from "db";

/** SQL filter for agent/MCP/automation audit entries. */
export function agentAuditFilter() {
  return or(
    sql`${auditLog.action} LIKE 'mcp.%'`,
    sql`${auditLog.action} LIKE 'api_key.%'`,
    sql`${auditLog.action} LIKE 'security_fix.%'`,
    sql`${auditLog.action} LIKE 'automation.%'`
  );
}
