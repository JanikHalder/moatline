import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Building2, Globe, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, type ClientListItem, type Domain } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { EmptyState } from "@/components/empty-state";
import { DomainsTable } from "@/components/domains-table";
import { useT } from "@/lib/i18n";

/** Customers, and the domains not yet put under one. */
export function ClientsPage() {
  const t = useT();
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [saving, setSaving] = useState(false);
  const [domainName, setDomainName] = useState("");

  const load = () => {
    api
      .getClients()
      .then(setClients)
      .catch(() => setClients([]));
    api
      .getDomains()
      .then(setDomains)
      .catch(() => setDomains([]));
  };
  useEffect(load, []);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createClient({
        name: name.trim(),
        contactEmail: email.trim() || null,
        language,
      });
      setOpen(false);
      setName("");
      setEmail("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not create"));
    } finally {
      setSaving(false);
    }
  };

  const addDomain = async () => {
    if (!domainName.trim()) return;
    try {
      await api.addDomain(domainName.trim());
      setDomainName("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not add"));
    }
  };

  const unassigned = domains.filter((d) => !d.clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Clients")}
        description={t(
          "Your customers' sites, servers and domains in one place — and the monthly maintenance report."
        )}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {t("New client")}
          </Button>
        }
      />

      {clients === null ? (
        <div className="grid gap-4 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={t("No clients yet")}
            description={t(
              "Create one, then put its repositories, servers and domains under it."
            )}
            action={
              <Button variant="outline" onClick={() => setOpen(true)}>
                <Plus />
                {t("New client")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              to="/clients/$clientId"
              params={{ clientId: c.id }}
              className="block"
            >
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    {c.name}
                  </CardTitle>
                  <CardDescription>
                    {t("{a} sites · {b} servers · {c} domains", {
                      a: c.repos,
                      b: c.servers,
                      c: c.domains,
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {c.down > 0 && (
                    <Badge variant="destructive">
                      {t("{n} down", { n: c.down })}
                    </Badge>
                  )}
                  {c.domainProblems > 0 && (
                    <Badge variant="warning">
                      {t(
                        c.domainProblems === 1
                          ? "{n} domain issue"
                          : "{n} domain issues",
                        { n: c.domainProblems }
                      )}
                    </Badge>
                  )}
                  {c.down === 0 && c.domainProblems === 0 && (
                    <Badge variant="success">{t("all good")}</Badge>
                  )}
                  <Badge variant="outline">{c.language.toUpperCase()}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-muted-foreground" />
            {unassigned.length === domains.length
              ? t("Domains")
              : t("Domains without a client")}
          </CardTitle>
          <CardDescription>
            {t(
              "From the repositories' live URLs, plus any you add. Checked daily: certificate, registration, SPF / DKIM / DMARC."
            )}
          </CardDescription>
          <form
            className="flex gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addDomain();
            }}
          >
            <Input
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="kunde.at"
              aria-label={t("Domain to add")}
              className="max-w-xs"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!domainName.trim()}
            >
              <Plus />
              {t("Add domain")}
            </Button>
          </form>
        </CardHeader>
        <DomainsTable
          domains={unassigned}
          clients={clients ?? []}
          onChange={load}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("New client")}</DialogTitle>
            <DialogDescription>
              {t(
                "The report language is what the client reads; the app stays as it is."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="client-name">{t("Name")}</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-email">
                {t("Contact email (optional)")}
              </Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-language">{t("Report language")}</Label>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(v as "de" | "en")}
              >
                <SelectTrigger id="client-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={create} disabled={saving || !name.trim()}>
              {saving && <Spinner />}
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
