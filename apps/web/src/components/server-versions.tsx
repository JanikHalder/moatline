import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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
import { StatCard } from "@/components/stat-card";
import { ErrorAlert } from "@/components/error-alert";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

export type ServerVersions = Awaited<ReturnType<typeof api.getServerVersions>>;

/** OS, kernel, Docker and updates of every server — and which OS is out of support. */
export function ServerVersionsTable() {
  const t = useT();
  const [data, setData] = useState<ServerVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getServerVersions()
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("Failed to load"))
      );
  }, [t]);
  if (error) return <ErrorAlert>{error}</ErrorAlert>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  const list = data.servers;
  const eol = list.filter((s) => s.support.status === "eol").length;
  const security = list.reduce((n, s) => n + (s.security ?? 0), 0);
  const reboot = list.filter((s) => s.rebootRequired).length;
  const agents = list.filter((s) => s.agentOutdated).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t("OS out of support")}
          value={eol}
          tone={eol ? "destructive" : "success"}
          description={t("no security updates any more")}
        />
        <StatCard
          label={t("Security updates")}
          value={security}
          tone={security ? "warning" : "success"}
          description={t("pending across all servers")}
        />
        <StatCard
          label={t("Reboot required")}
          value={reboot}
          tone={reboot ? "warning" : "success"}
          description={t("servers running an old kernel")}
        />
        <StatCard
          label={t("Agent {v}", { v: data.latestAgent ?? "" })}
          value={`${list.length - agents}/${list.length}`}
          tone={agents ? "warning" : "success"}
          description={t("servers on the current agent")}
        />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">{t("Server")}</TableHead>
              <TableHead>{t("Operating system")}</TableHead>
              <TableHead className="hidden @3xl/main:table-cell">
                {t("Kernel")}
              </TableHead>
              <TableHead className="hidden @2xl/main:table-cell">
                Docker
              </TableHead>
              <TableHead>{t("Updates")}</TableHead>
              <TableHead className="hidden pr-4 @xl/main:table-cell">
                {t("Agent")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-48 pl-4">
                  <Link
                    to="/servers/$serverId"
                    params={{ serverId: s.id }}
                    className="block truncate font-medium hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {s.lastReportAt
                      ? t("reported {when}", {
                          when: formatRelative(s.lastReportAt) ?? "",
                        })
                      : t("no report yet")}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block">{s.os ?? "—"}</span>
                  {s.support.status === "eol" ? (
                    <a
                      href="https://moatline.dev/guide/os-upgrade"
                      target="_blank"
                      rel="noreferrer noopener"
                      title={t("How to upgrade, and keep the IP")}
                    >
                      <Badge variant="destructive" className="mt-0.5">
                        {t("support ended {date}", {
                          date: s.support.eol ?? "",
                        })}
                      </Badge>
                    </a>
                  ) : s.support.status === "soon" ? (
                    <Badge variant="warning" className="mt-0.5">
                      {t("support ends {date}", { date: s.support.eol ?? "" })}
                    </Badge>
                  ) : s.support.eol ? (
                    <span className="text-xs text-muted-foreground">
                      {t("supported until {date}", { date: s.support.eol })}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden font-mono text-xs @3xl/main:table-cell">
                  {s.kernel ?? "—"}
                  {s.uptimeDays != null && (
                    <span className="block font-sans text-muted-foreground">
                      {t("up {n} days", { n: s.uptimeDays })}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden font-mono text-xs @2xl/main:table-cell">
                  {s.docker ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {s.security ? (
                      <Badge variant="destructive-soft">
                        {t("{n} security", { n: s.security })}
                      </Badge>
                    ) : s.pending === 0 ? (
                      <Badge variant="success">{t("up to date")}</Badge>
                    ) : null}
                    {!!s.pending && !s.security && (
                      <Badge variant="outline">
                        {t("{n} pending", { n: s.pending })}
                      </Badge>
                    )}
                    {s.rebootRequired && (
                      <Badge variant="warning">{t("reboot required")}</Badge>
                    )}
                    {s.autoUpdates === false && (
                      <Badge variant="warning">
                        {t("no automatic updates")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden pr-4 font-mono text-xs @xl/main:table-cell">
                  {s.agentVersion ?? "—"}
                  {s.agentOutdated && (
                    <span className="block font-sans text-warning">
                      {t("update available")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
