import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { api, type ServerDetail, type ServerFinding } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { SeverityBadge } from "@/components/severity-badge";
import { tx } from "@/lib/i18n";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function yesNo(good: boolean, label: string) {
  return <Badge variant={good ? "success" : "destructive-soft"}>{label}</Badge>;
}

/**
 * Hardening, who has access, and signs of compromise — with the one action
 * that belongs here: accepting access someone added on purpose.
 */
export function SecurityCard({
  server,
  onChanged,
}: {
  server: ServerDetail;
  onChanged: () => void;
}) {
  const r = server.lastReport;
  const [findings, setFindings] = useState<ServerFinding[] | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api
      .getServerFindings(server.id, { status: "open", source: "security" })
      .then(setFindings)
      .catch(() => setFindings([]));
  }, [server.id, server.lastReportAt]);

  if (!r?.hardening && !r?.access) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            {tx("Security")}
          </CardTitle>
          <CardDescription>
            {tx(
              "SSH, firewall, access changes, Docker risks and signs of compromise — reported by agent 1.4.0 or newer. Reinstall the agent from the Setup tab."
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const compromise = (findings ?? []).filter((f) =>
    f.fingerprint.startsWith("compromise:")
  );
  const newAccess = (findings ?? []).filter((f) =>
    f.fingerprint.startsWith("access:")
  );
  const ssh = r.hardening?.ssh ?? null;
  const fw = server.providerFirewall;
  const applied = fw?.firewalls.filter((f) => f.status === "applied") ?? [];
  const groups = r.access?.privilegedGroups ?? {};

  const accept = async () => {
    setAccepting(true);
    try {
      await api.acceptServerAccess(server.id);
      toast.success(tx("Current access accepted"));
      setFindings((f) =>
        (f ?? []).filter((x) => !x.fingerprint.startsWith("access:"))
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not accept"));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          {tx("Security")}
        </CardTitle>
        <CardDescription>
          {tx("Hardening, who can get in, and signs of compromise.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {compromise.length > 0 && (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>{tx("Possible compromise")}</AlertTitle>
            <AlertDescription className="space-y-1">
              {compromise.map((f) => (
                <p key={f.id}>
                  <strong>{f.title}:</strong> {f.detail?.split("\n")[0]}
                </p>
              ))}
              <p className="pt-1">
                {tx(
                  "If you do not recognise this: block the server in the provider firewall, keep it running for analysis, rotate every credential that was on it."
                )}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {newAccess.length > 0 && (
          <Alert variant="warning">
            <UserCheck />
            <AlertTitle className="line-clamp-none">
              {tx("Access changed since it was last accepted")}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <ul className="list-disc space-y-0.5 pl-4">
                {newAccess.map((f) => (
                  <li key={f.id}>
                    <SeverityBadge severity={f.severity} className="mr-1" />
                    {f.title}
                  </li>
                ))}
              </ul>
              <p>
                {tx(
                  "Did you (or a colleague) add this? Then accept it. If not, someone else did — remove it and treat the server as compromised."
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={accept}
                disabled={accepting}
              >
                {accepting && <Spinner />}
                {tx("Yes, accept current access")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {tx("Hardening")}
            </p>
            <Row
              label={tx("SSH password login")}
              value={
                ssh?.passwordauthentication
                  ? yesNo(
                      ssh.passwordauthentication === "no",
                      ssh.passwordauthentication === "no" ? "off" : "allowed"
                    )
                  : "—"
              }
            />
            <Row
              label={tx("root login")}
              value={
                ssh?.permitrootlogin
                  ? yesNo(
                      ssh.permitrootlogin !== "yes",
                      ssh.permitrootlogin === "yes"
                        ? "with password"
                        : ssh.permitrootlogin
                    )
                  : "—"
              }
            />
            <Row
              label={tx("Firewall (UFW)")}
              value={
                r.hardening?.ufw
                  ? yesNo(r.hardening.ufw === "active", r.hardening.ufw)
                  : "—"
              }
            />
            {fw && (
              <Row
                label={tx("Hetzner firewall")}
                value={yesNo(
                  applied.length > 0,
                  applied.length
                    ? applied.map((f) => f.name).join(", ")
                    : "none applied"
                )}
              />
            )}
            <Row
              label={tx("Brute-force protection")}
              value={
                r.hardening?.fail2ban === "active" || r.crowdsec?.available
                  ? yesNo(
                      true,
                      [
                        r.hardening?.fail2ban === "active" && "fail2ban",
                        r.crowdsec?.available && "CrowdSec",
                      ]
                        .filter(Boolean)
                        .join(" + ")
                    )
                  : yesNo(false, "none")
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {tx("Access")}
            </p>
            <Row
              label={tx("SSH keys")}
              value={`${r.access?.sshKeys.length ?? 0}`}
            />
            {Object.entries(groups)
              .filter(([, users]) => users.length > 0)
              .map(([g, users]) => (
                <Row
                  key={g}
                  label={
                    g === "docker" ? tx("docker group (= root)") : `${g} group`
                  }
                  value={
                    <span className="font-mono text-xs">
                      {users.join(", ")}
                    </span>
                  }
                />
              ))}
            <Row
              label={tx("uid 0 accounts")}
              value={
                r.access
                  ? yesNo(r.access.uid0.length <= 1, r.access.uid0.join(", "))
                  : "—"
              }
            />
          </div>
        </div>

        {r.access && r.access.sshKeys.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {tx("Authorized SSH keys")}
            </summary>
            <ul className="mt-2 space-y-1">
              {r.access.sshKeys.map((k) => (
                <li key={`${k.user}|${k.fingerprint}`} className="break-all">
                  <span className="font-medium">{k.user}</span> · {k.type} ·{" "}
                  <span className="font-mono">{k.fingerprint}</span>
                  {k.comment && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {k.comment}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {fw && applied.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {tx("What the Hetzner firewall lets in")}
            </summary>
            <ul className="mt-2 space-y-1">
              {fw.inbound.length === 0 && (
                <li className="text-muted-foreground">
                  {tx("No inbound rules — everything is blocked.")}
                </li>
              )}
              {fw.inbound.map((rule, i) => {
                const world = rule.sources.some(
                  (s) => s === "0.0.0.0/0" || s === "::/0"
                );
                return (
                  <li
                    key={`${rule.firewall}-${i}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <span className="font-mono">
                      {rule.protocol}
                      {rule.port ? ` ${rule.port}` : ""}
                    </span>
                    <span className="text-muted-foreground">←</span>
                    {world ? (
                      <Badge variant="warning">anywhere</Badge>
                    ) : (
                      <span className="font-mono break-all">
                        {rule.sources.join(", ")}
                      </span>
                    )}
                    {rule.description && (
                      <span className="text-muted-foreground">
                        · {rule.description}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        {findings && findings.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {findings.length} {tx("open security")}{" "}
            {findings.length === 1 ? "finding" : "findings"}{" "}
            {tx("— details in the Findings tab (filter “Security”).")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
