import { useState } from "react";
import { toast } from "sonner";
import { Database, ExternalLink, RefreshCw } from "lucide-react";
import { api, type MigrationCheck, type MigrationIssue } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

const NAME = { payload: "Payload", prisma: "Prisma", drizzle: "Drizzle" };

function Issues({ issues }: { issues: MigrationIssue[] }) {
  return (
    <ul className="space-y-2">
      {issues.map((i, n) => (
        <li key={`${i.title}-${n}`} className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <Badge
              variant={i.severity === "high" ? "destructive-soft" : "warning"}
            >
              {i.severity}
            </Badge>
            {i.title}
          </p>
          <p className="text-muted-foreground">{i.detail}</p>
          {i.file && (
            <p className="font-mono text-xs text-muted-foreground">
              {i.file}
              {i.line ? `:${i.line}` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What database migrations would do before they run: the setup, open pull
 * requests and merged commits that are not live yet.
 */
export function MigrationsCard({
  repoId,
  check: initial,
}: {
  repoId: string;
  check: MigrationCheck | null | undefined;
}) {
  const t = useT();
  const [check, setCheck] = useState(initial ?? null);
  const [busy, setBusy] = useState(false);
  if (!check?.framework) return null;

  const run = async () => {
    setBusy(true);
    try {
      setCheck(await api.checkMigrations(repoId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Check failed"));
    } finally {
      setBusy(false);
    }
  };

  const risky = check.prs.filter((p) => p.issues.length);
  const branch = check.branch?.issues.length ? check.branch : null;
  const clean = !check.setup.length && !risky.length && !branch;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          {t("Database migrations")}
          <Badge variant="outline">{NAME[check.framework]}</Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "Migrations that would delete data are caught in the pull request, before anything runs in production."
          )}
        </CardDescription>
        <CardAction>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => void run()}
            disabled={busy}
            aria-label={t("Check again")}
            title={t("Check again")}
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {clean && (
          <p className="text-muted-foreground">
            {t(
              "Nothing risky: no open pull request drops data, and the setup runs migrations properly."
            )}{" "}
            {t("Checked {when}.", {
              when: formatRelative(check.checkedAt) ?? "",
            })}
          </p>
        )}
        {risky.map((p) => (
          <div key={p.number} className="space-y-2 rounded-md border p-3">
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              {t("Pull request #{n}", { n: p.number })}: {p.title}
              <ExternalLink className="size-3" />
            </a>
            <Issues issues={p.issues} />
          </div>
        ))}
        {branch && (
          <div className="space-y-2 rounded-md border border-warning/40 p-3">
            <p className="font-medium">
              {t("Merged, not live yet")}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {branch.from.slice(0, 7)}…{branch.to.slice(0, 7)}
              </span>
            </p>
            <Issues issues={branch.issues} />
          </div>
        )}
        {check.setup.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">{t("Setup")}</p>
            <Issues issues={check.setup} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
