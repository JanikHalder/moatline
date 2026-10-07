import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ChevronLeft,
  FileText,
  FolderGit2,
  Globe,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ClientDetail as Client,
  type ClientListItem,
  type Domain,
  type RepoListItem,
  type ServerListItem,
} from "@/lib/api";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/page-header";
import { DomainsTable } from "@/components/domains-table";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

/** The last twelve months, newest first, as "2026-09". */
function months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 12; i++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)
    );
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return out;
}

type Pickable = { id: string; label: string; sub?: string };

/** One client: its sites, servers, domains and the monthly report. */
export function ClientDetail() {
  const t = useT();
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [month, setMonth] = useState(months()[0]!);
  const [reporting, setReporting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [options, setOptions] = useState<{
    repos: Pickable[];
    servers: Pickable[];
    domains: Pickable[];
  } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allClients, setAllClients] = useState<ClientListItem[]>([]);

  const load = useCallback(() => {
    api
      .getClient(clientId)
      .then(setClient)
      .catch(() => navigate({ to: "/clients" }));
    api
      .getClients()
      .then(setAllClients)
      .catch(() => {});
  }, [clientId, navigate]);
  useEffect(load, [load]);

  const openReport = async () => {
    setReporting(true);
    // Opened first, filled after: browsers block windows opened later.
    const win = window.open("", "_blank");
    try {
      const html = await api.getClientReport(clientId, month);
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      }
    } catch (e) {
      win?.close();
      toast.error(
        e instanceof Error ? e.message : t("Could not build the report")
      );
    } finally {
      setReporting(false);
    }
  };

  const openAssign = async () => {
    setPicked(new Set());
    setOptions(null);
    setAssignOpen(true);
    const [repos, servers, domains] = await Promise.all([
      api.getRepos().catch(() => [] as RepoListItem[]),
      api.getServers().catch(() => [] as ServerListItem[]),
      api.getDomains().catch(() => [] as Domain[]),
    ]);
    const taken = (id: string | null | undefined) => id === clientId;
    setOptions({
      repos: repos
        .filter((r) => !taken((r as { clientId?: string | null }).clientId))
        .map((r) => ({ id: `r:${r.id}`, label: r.name, sub: r.githubUrl })),
      servers: servers
        .filter((s) => !taken((s as { clientId?: string | null }).clientId))
        .map((s) => ({ id: `s:${s.id}`, label: s.name })),
      domains: domains
        .filter((d) => !taken(d.clientId))
        .map((d) => ({ id: `d:${d.id}`, label: d.name })),
    });
  };

  const assign = async () => {
    const ids = [...picked];
    const of = (p: string) =>
      ids.filter((i) => i.startsWith(p)).map((i) => i.slice(2));
    try {
      await api.assignToClient(clientId, {
        repositoryIds: of("r:"),
        serverIds: of("s:"),
        domainIds: of("d:"),
      });
      setAssignOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not assign"));
    }
  };

  if (!client)
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );

  const section = (title: string, items: Pickable[]) =>
    items.length > 0 && (
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {items.map((it) => (
            <li key={it.id}>
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/50">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(it.id)}
                  onCheckedChange={(v) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (v === true) n.add(it.id);
                      else n.delete(it.id);
                      return n;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate">{it.label}</span>
                  {it.sub && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {it.sub}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/clients">
          <ChevronLeft />
          {t("Clients")}
        </Link>
      </Button>
      <PageHeader
        title={client.name}
        description={client.contactEmail ?? t("No contact email")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-36" aria-label={t("Report month")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months().map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={openReport} disabled={reporting}>
              {reporting ? <Spinner /> : <FileText />}
              {t("Monthly report")}
            </Button>
            <Button variant="outline" onClick={openAssign}>
              <Plus />
              {t("Add sites, servers, domains")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("Details")}</CardTitle>
          <CardDescription>{t("Contact and report language")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 @2xl/main:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="c-name">{t("Name")}</Label>
            <Input
              id="c-name"
              defaultValue={client.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== client.name &&
                api
                  .updateClient(client.id, { name: e.target.value.trim() })
                  .then(load)
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-email">{t("Contact email")}</Label>
            <Input
              id="c-email"
              type="email"
              defaultValue={client.contactEmail ?? ""}
              onBlur={(e) =>
                e.target.value !== (client.contactEmail ?? "") &&
                api
                  .updateClient(client.id, {
                    contactEmail: e.target.value.trim() || null,
                  })
                  .then(load)
                  .catch((err) => toast.error(err.message))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-lang">{t("Report language")}</Label>
            <Select
              value={client.language}
              onValueChange={(v) =>
                api
                  .updateClient(client.id, { language: v as "de" | "en" })
                  .then(load)
              }
            >
              <SelectTrigger id="c-lang" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderGit2 className="size-4 text-muted-foreground" />
              {t("Sites")} ({client.repos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client.repos.length ? (
              <ul className="divide-y rounded-md border">
                {client.repos.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <Link
                      to="/repos/$repoId"
                      params={{ repoId: r.id }}
                      className="truncate font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.liveStatus && (
                      <Badge
                        variant={
                          r.liveStatus === "up" ? "success" : "destructive"
                        }
                      >
                        {r.liveStatus === "up" ? t("live") : t("down")}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("None yet.")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              {t("Servers")} ({client.servers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client.servers.length ? (
              <ul className="divide-y rounded-md border">
                {client.servers.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <Link
                      to="/servers/$serverId"
                      params={{ serverId: s.id }}
                      className="truncate font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {s.lastReportAt
                        ? t("reported {when}", {
                            when: formatRelative(s.lastReportAt) ?? "",
                          })
                        : t("no agent")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("None yet.")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-muted-foreground" />
            {t("Domains")} ({client.domains.length})
          </CardTitle>
          <CardDescription>
            {t(
              "Certificate, registration and mail authentication, checked daily."
            )}
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={async () => {
                if (
                  !window.confirm(
                    t(
                      "Delete client {name}? Sites, servers and domains stay, just without a client.",
                      { name: client.name }
                    )
                  )
                )
                  return;
                await api.deleteClient(client.id);
                navigate({ to: "/clients" });
              }}
            >
              <Trash2 />
              {t("Delete client")}
            </Button>
          </CardAction>
        </CardHeader>
        <DomainsTable
          domains={client.domains}
          clients={allClients}
          onChange={load}
        />
      </Card>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("Add to {name}", { name: client.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Pick what belongs to this client. Items under another client move here."
              )}
            </DialogDescription>
          </DialogHeader>
          {!options ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid gap-4">
              {section(t("Sites"), options.repos)}
              {section(t("Servers"), options.servers)}
              {section(t("Domains"), options.domains)}
              {!options.repos.length &&
                !options.servers.length &&
                !options.domains.length && (
                  <p className="text-sm text-muted-foreground">
                    {t("Nothing left to add.")}
                  </p>
                )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={assign} disabled={picked.size === 0}>
              {t("Add")} {picked.size || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
