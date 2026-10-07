import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type ProvisionOptions } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { CodeLine } from "@/components/server-ui";
import { useT } from "@/lib/i18n";

const HOST = "host";

/** OpenObserve on Dokploy, with Moatline's events pointed at it. */
export function OpenObserveSetup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ProvisionOptions | null>(null);
  const [env, setEnv] = useState("");
  const [server, setServer] = useState(HOST);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    url: string;
    email: string;
    password: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setEmail(session?.user?.email ?? "");
    api
      .getProvisionOptions()
      .then((o) => {
        setOpts(o);
        if (o.dokploy.ok) setEnv(o.dokploy.environments[0]?.id ?? "");
      })
      .catch(() => setOpts(null));
  }, [open, session?.user?.email]);

  const dk = opts?.dokploy.ok ? opts.dokploy : null;
  const ready = !!dk && !!env && /\./.test(domain) && /@/.test(email);

  const submit = async () => {
    if (!dk) return;
    const e = dk.environments.find((x) => x.id === env)!;
    setBusy(true);
    try {
      setDone(
        await api.setupOpenObserve({
          environment: { id: e.id, legacy: e.legacy },
          serverId: server === HOST ? null : server,
          domain: domain.trim().toLowerCase(),
          email: email.trim(),
        })
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Setup failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("Set up OpenObserve on Dokploy")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("OpenObserve on Dokploy")}</DialogTitle>
            <DialogDescription>
              {t(
                "A light observability tool on your own server — logs, events, dashboards. Moatline sends its events there right away."
              )}
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="grid gap-3 text-sm">
              <p>
                {t(
                  "Deploying now. Once the DNS points at the server, log in with these — the password is shown only now:"
                )}
              </p>
              <CodeLine text={done.url} label="URL" />
              <CodeLine text={done.email} label={t("E-mail")} />
              <CodeLine text={done.password} label={t("Password")} />
            </div>
          ) : !opts ? (
            <Spinner />
          ) : !dk ? (
            <p className="text-sm text-destructive">
              {opts.dokploy.ok ? "" : opts.dokploy.error}
            </p>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="oo-env">{t("Project")}</Label>
                <Select value={env} onValueChange={setEnv}>
                  <SelectTrigger id="oo-env" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dk.environments.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.project}
                        {e.legacy ? "" : ` / ${e.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="oo-server">{t("Server")}</Label>
                <Select value={server} onValueChange={setServer}>
                  <SelectTrigger id="oo-server" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HOST}>{t("Dokploy host")}</SelectItem>
                    {dk.servers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="oo-domain">{t("Domain")}</Label>
                <Input
                  id="oo-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="observe.example.com"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="oo-email">{t("Admin e-mail")}</Label>
                <Input
                  id="oo-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {done ? t("Close") : t("Cancel")}
            </Button>
            {!done && (
              <Button onClick={submit} disabled={!ready || busy}>
                {busy && <Spinner />}
                {t("Set up")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
