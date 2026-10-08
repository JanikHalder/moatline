import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { api, type AuditEntry } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const LABEL: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.2fa_enabled": "Turned on 2FA",
  "auth.2fa_disabled": "Turned off 2FA",
  "auth.2fa_backup_codes_regenerated": "New 2FA backup codes",
  "auth.password_changed": "Changed password",
  "server.create": "Added server",
  "server.update": "Changed server settings",
  "server.delete": "Deleted server",
  "server.install_code": "Created install code",
  "server.enrolled": "Agent installed",
  "server.token_revoke": "Revoked agent token",
  "server.nuclei_scan": "Started Nuclei scan",
  "kuma.assign": "Assigned monitor",
  "integrations.update": "Changed integrations",
  "member.add": "Added member",
  "member.create": "Created account",
  "repo.create": "Added repository",
  "repo.update": "Changed repository settings",
  "repo.delete": "Deleted repository",
  "repo.security_fix": "Started security fix",
  "repo.update_packages": "Started package update",
  "repo.deploy": "Triggered deploy",
  "api_key.create": "Created API key",
  "api_key.update": "Updated API key",
  "api_key.revoke": "Revoked API key",
  "security_fix.started": "Security fix started",
  "security_fix.pr_opened": "Security fix PR opened",
  "automation.pr_review_enforced": "PR review policy enforced",
  "mcp.get_overview": "MCP: overview",
  "mcp.list_servers": "MCP: list servers",
  "mcp.get_server": "MCP: get server",
  "mcp.list_findings": "MCP: list findings",
  "mcp.list_uptime": "MCP: list uptime",
  "mcp.list_repositories": "MCP: list repositories",
  "mcp.get_repository": "MCP: get repository",
  "mcp.list_members": "MCP: list members",
  "mcp.get_audit_log": "MCP: audit log",
  "mcp.start_nuclei_scan": "MCP: Nuclei scan",
  "mcp.start_repository_scan": "MCP: repository scan",
  "mcp.get_findings_report": "MCP: findings report",
  "mcp.start_security_fix": "MCP: security fix",
};

/** Actions that hand out access or change what runs unattended. */
const SENSITIVE = new Set([
  "auth.2fa_disabled",
  "server.install_code",
  "server.enrolled",
  "server.token_revoke",
  "server.delete",
  "integrations.update",
  "member.add",
  "member.create",
  "repo.delete",
  "repo.deploy",
  "api_key.create",
  "api_key.update",
  "mcp.start_nuclei_scan",
  "mcp.start_repository_scan",
  "mcp.start_security_fix",
  "security_fix.started",
  "security_fix.pr_opened",
]);

function describe(e: AuditEntry): string | null {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v == null || k === "serverId") continue;
    if (k === "userAgent") continue;
    parts.push(
      `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [agentsOnly, setAgentsOnly] = useState(false);

  const load = async (before?: string, filter = agentsOnly) => {
    setLoading(true);
    try {
      const page = await api.getAuditLog(before, filter);
      setEntries((prev) => (before ? [...(prev ?? []), ...page] : page));
      setMore(page.length === 100);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Failed to load"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(undefined, agentsOnly);
  }, [agentsOnly]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={tx("Audit log")}
        description={tx(
          "Who did what, when and from where — sign-ins, access to servers, integrations, members, MCP tools and unattended actions. Secret values are never recorded."
        )}
      />
      {entries && entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={agentsOnly ? "default" : "outline"}
            disabled={loading}
            onClick={() => setAgentsOnly((v) => !v)}
          >
            {tx("Agents & automation")}
          </Button>
        </div>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {!entries && !error ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : entries && entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title={
              agentsOnly
                ? tx("No agent or automation events yet")
                : tx("Nothing recorded yet")
            }
            className="py-12"
          />
        </Card>
      ) : entries ? (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="hidden w-36 pl-6 @2xl/main:table-cell">
                  {tx("When")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Who")}
                </TableHead>
                <TableHead className="pl-6 @2xl/main:pl-2">
                  {tx("What")}
                </TableHead>
                <TableHead className="hidden @4xl/main:table-cell">
                  {tx("Details")}
                </TableHead>
                <TableHead className="hidden pr-6 text-right @2xl/main:table-cell">
                  IP
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell
                    className="hidden pl-6 text-xs text-muted-foreground @2xl/main:table-cell"
                    title={formatDateTime(e.createdAt) ?? undefined}
                  >
                    {formatRelative(e.createdAt)}
                  </TableCell>
                  <TableCell className="hidden text-sm @2xl/main:table-cell">
                    {e.userEmail ?? (
                      <span className="text-muted-foreground">
                        {e.action === "server.enrolled" ? "server" : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 pl-6 whitespace-normal @2xl/main:pr-2 @2xl/main:pl-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          SENSITIVE.has(e.action) ? "warning" : "outline"
                        }
                      >
                        {LABEL[e.action] ?? e.action}
                      </Badge>
                      {e.targetName && (
                        <span className="text-sm font-medium break-all">
                          {e.targetName}
                        </span>
                      )}
                    </div>
                    {/* Phones: who, when, where and the details go here. */}
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground @2xl/main:hidden">
                      <p className="break-all">
                        <span className="text-foreground">
                          {e.userEmail ??
                            (e.action === "server.enrolled" ? "server" : "—")}
                        </span>
                      </p>
                      <p>
                        <span title={formatDateTime(e.createdAt) ?? undefined}>
                          {formatRelative(e.createdAt)}
                        </span>
                        {e.ip && (
                          <>
                            {" · "}
                            <span className="font-mono break-all">{e.ip}</span>
                          </>
                        )}
                      </p>
                      {describe(e) && (
                        <p className="break-words">{describe(e)}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground @4xl/main:table-cell">
                    {describe(e) ?? ""}
                  </TableCell>
                  <TableCell className="hidden pr-6 text-right font-mono text-xs text-muted-foreground @2xl/main:table-cell">
                    {e.ip ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {more && (
            <div className="border-t p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() =>
                  void load(entries[entries.length - 1]?.createdAt, agentsOnly)
                }
              >
                {tx("Load older")}
              </Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
