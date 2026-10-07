import { useEffect, useState } from "react";
import { CreditCard, FolderGit2, Server, Users } from "lucide-react";
import { api, type OperatorStats } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { StatBand, StatCard } from "@/components/stat-card";
import { ErrorAlert } from "@/components/error-alert";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

/**
 * How the hosted service is doing: accounts, activity, what customers set
 * up, who pays. Only for the operators in OPERATOR_EMAILS.
 */
export function OperatorPage() {
  const [stats, setStats] = useState<OperatorStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOperatorStats()
      .then(setStats)
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Could not load"))
      );
  }, []);

  const header = (
    <PageHeader
      title={tx("Usage")}
      description={tx(
        "Accounts, activity and subscriptions across every organization on this instance."
      )}
    />
  );
  if (error)
    return (
      <div className="space-y-6">
        {header}
        <ErrorAlert>{error}</ErrorAlert>
      </div>
    );
  if (!stats)
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    );

  const { users, organizations, billing } = stats;
  const max = Math.max(1, ...stats.signupsByWeek.map((w) => w.count));
  const pct = (part: number, whole: number) =>
    whole ? `${Math.round((part / whole) * 100)} %` : "–";

  return (
    <div className="space-y-6">
      {header}
      <StatBand>
        <StatCard
          label={tx("Users")}
          value={users.total}
          icon={Users}
          description={tx("{n} new in 7 days, {m} in 30 days", {
            n: users.new7d,
            m: users.new30d,
          })}
        />
        <StatCard
          label={tx("Active users")}
          value={users.active7d}
          description={tx("signed in within 7 days · {n} within 30", {
            n: users.active30d,
          })}
        />
        <StatCard
          label={tx("Paying")}
          value={billing.paying}
          icon={CreditCard}
          tone={billing.paying ? "success" : "default"}
          description={tx("{eur} € a month · {t} in trial", {
            eur: billing.mrrEur,
            t: billing.trialing,
          })}
        />
        <StatCard
          label={tx("Organizations")}
          value={organizations.total}
          description={tx("{s} with a server, {r} with a repository", {
            s: organizations.withServer,
            r: organizations.withRepository,
          })}
        />
      </StatBand>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{tx("Sign-ups per week")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-1.5">
              {stats.signupsByWeek.map((w) => (
                <div
                  key={w.week}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${w.week}: ${w.count}`}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {w.count || ""}
                  </span>
                  <div
                    className="w-full rounded-sm bg-primary/80"
                    style={{
                      height: `${(w.count / max) * 120}px`,
                      minHeight: w.count ? 4 : 1,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{stats.signupsByWeek[0]?.week}</span>
              <span>{tx("this week")}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tx("Funnel")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={tx("Accounts")} value={users.total} />
            <Row
              label={tx("Email confirmed")}
              value={users.verified}
              hint={pct(users.verified, users.total)}
            />
            <Row
              label={tx("Organization with a server")}
              value={organizations.withServer}
              hint={pct(organizations.withServer, organizations.total)}
            />
            <Row
              label={tx("Paying")}
              value={billing.paying}
              hint={pct(billing.paying, organizations.total)}
            />
            <div className="border-t pt-2" />
            <Row
              label={tx("Servers")}
              value={stats.servers.total}
              hint={tx("{n} reporting", { n: stats.servers.reporting24h })}
              icon={Server}
            />
            <Row
              label={tx("Repositories")}
              value={stats.repositories}
              icon={FolderGit2}
            />
            {Object.entries(billing.byPlan).map(([plan, n]) => (
              <Row key={plan} label={plan} value={n} />
            ))}
            {billing.pastDue > 0 && (
              <Row label={tx("payment failed")} value={billing.pastDue} />
            )}
            {billing.canceled > 0 && (
              <Row label={tx("canceled")} value={billing.canceled} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tx("Newest accounts")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{tx("Account")}</TableHead>
                <TableHead>{tx("Signed up")}</TableHead>
                <TableHead>{tx("Last active")}</TableHead>
                <TableHead>{tx("Organization")}</TableHead>
                <TableHead className="text-right">{tx("Servers")}</TableHead>
                <TableHead className="text-right">
                  {tx("Repositories")}
                </TableHead>
                <TableHead className="pr-6">{tx("Plan")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recent.map((u) => (
                <TableRow key={u.email}>
                  <TableCell className="pl-6">
                    <p className="font-medium">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.name}
                      {!u.verified && (
                        <Badge variant="outline" className="ml-2">
                          {tx("not confirmed")}
                        </Badge>
                      )}
                    </p>
                  </TableCell>
                  <TableCell title={formatDateTime(u.createdAt) ?? undefined}>
                    {formatRelative(u.createdAt)}
                  </TableCell>
                  <TableCell
                    title={
                      u.lastActiveAt
                        ? (formatDateTime(u.lastActiveAt) ?? undefined)
                        : undefined
                    }
                  >
                    {u.lastActiveAt ? formatRelative(u.lastActiveAt) : "–"}
                  </TableCell>
                  <TableCell>{u.organizations.join(", ") || "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.servers}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.repositories}
                  </TableCell>
                  <TableCell className="pr-6">
                    {u.plan ? <Badge variant="success">{u.plan}</Badge> : "–"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: typeof Server;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </span>
      <span className="tabular-nums">
        <span className="font-medium">{value}</span>
        {hint && (
          <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
    </div>
  );
}
