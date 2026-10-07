import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ClientListItem, type Domain } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

const NONE = "none";

/** Problem texts come from the API in English; known ones are translated. */
function problemText(
  t: ReturnType<typeof useT>,
  p: { id: string; text: string }
): string {
  const n = p.text.match(/(\d+) days/)?.[1] ?? "";
  const known: Record<string, string> = {
    cert: "No valid certificate",
    "cert-expiry":
      "Certificate expires in {n} days — automatic renewal is not working",
    registration: "Domain registration expires in {n} days",
    spf: "No SPF record — mail from this domain lands in spam or is rejected",
    dmarc: "No DMARC record",
    "dmarc-none": "DMARC policy is p=none — spoofed mail is not stopped",
    dkim: "No DKIM key found for common selectors",
  };
  return known[p.id] ? t(known[p.id]!, { n }) : p.text;
}

function Days({ n, warnBelow }: { n: number | null; warnBelow: number }) {
  const t = useT();
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={
        n < 7 ? "text-destructive" : n < warnBelow ? "text-warning" : undefined
      }
    >
      {t("{n} days", { n })}
    </span>
  );
}

/**
 * Domains with what can silently break: the certificate (renewal stopped),
 * the registration (nobody renewed it) and mail authentication (form mails
 * in spam).
 */
export function DomainsTable({
  domains,
  clients,
  onChange,
}: {
  domains: Domain[];
  /** When given, each row can be moved to a client. */
  clients?: ClientListItem[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const t = useT();
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("That did not work"));
    } finally {
      setBusy(null);
    }
  };
  if (!domains.length)
    return (
      <p className="px-6 py-4 text-sm text-muted-foreground">
        {t(
          "No domains yet — they appear from the live URLs of the repositories, or add one."
        )}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="pl-6">{t("Domain")}</TableHead>
          <TableHead>{t("Certificate")}</TableHead>
          <TableHead className="hidden @2xl/main:table-cell">
            {t("Registration")}
          </TableHead>
          <TableHead className="hidden @3xl/main:table-cell">
            {t("Mail")}
          </TableHead>
          {clients && (
            <TableHead className="hidden @4xl/main:table-cell">
              {t("Client")}
            </TableHead>
          )}
          <TableHead className="pr-6 text-right">
            <span className="sr-only">{t("Actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.map((d) => {
          const st = d.state;
          const problems = (st?.problems ?? []).filter(
            (p) => p.severity !== "low"
          );
          return (
            <TableRow key={d.id}>
              <TableCell className="pl-6 align-top">
                <p className="font-medium">{d.name}</p>
                {problems.map((p) => (
                  <p
                    key={p.id}
                    className={
                      p.severity === "high"
                        ? "text-xs text-destructive"
                        : "text-xs text-warning"
                    }
                  >
                    {problemText(t, p)}
                  </p>
                ))}
                {d.checkedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t("checked {when}", {
                      when: formatRelative(d.checkedAt) ?? "",
                    })}
                  </p>
                )}
              </TableCell>
              <TableCell className="align-top text-sm">
                {!st ? (
                  <span className="text-muted-foreground">
                    {t("not checked")}
                  </span>
                ) : st.cert.daysLeft == null ? (
                  <span className="text-destructive">
                    {st.cert.error ?? t("none")}
                  </span>
                ) : (
                  <>
                    <Days n={st.cert.daysLeft} warnBelow={14} />
                    {st.cert.issuer && (
                      <span className="block text-xs text-muted-foreground">
                        {st.cert.issuer}
                      </span>
                    )}
                  </>
                )}
              </TableCell>
              <TableCell className="hidden align-top text-sm @2xl/main:table-cell">
                {st?.registration.daysLeft != null ? (
                  <Days n={st.registration.daysLeft} warnBelow={30} />
                ) : (
                  <span
                    className="text-muted-foreground"
                    title={t(
                      "The registry does not publish the date (e.g. .at, .de)"
                    )}
                  >
                    {t("not published")}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden align-top @3xl/main:table-cell">
                {!st ? null : !st.mail.mx.length ? (
                  <span className="text-xs text-muted-foreground">
                    {t("no mail")}
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant={st.mail.spf ? "success" : "destructive-soft"}
                    >
                      SPF
                    </Badge>
                    <Badge
                      variant={st.mail.dkim.length ? "success" : "outline"}
                    >
                      DKIM
                    </Badge>
                    <Badge
                      variant={
                        !st.mail.dmarc
                          ? "destructive-soft"
                          : st.mail.dmarcPolicy === "none"
                            ? "warning"
                            : "success"
                      }
                    >
                      DMARC
                      {st.mail.dmarcPolicy ? ` ${st.mail.dmarcPolicy}` : ""}
                    </Badge>
                  </div>
                )}
              </TableCell>
              {clients && (
                <TableCell className="hidden align-top @4xl/main:table-cell">
                  <Select
                    value={d.clientId ?? NONE}
                    onValueChange={(v) =>
                      act(d.id, () =>
                        api.setDomainClient(d.id, v === NONE ? null : v)
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-40"
                      aria-label={t("Client")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("No client")}</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              )}
              <TableCell className="pr-6 text-right align-top">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Check {name} now", { name: d.name })}
                    disabled={busy === d.id}
                    onClick={() => act(d.id, () => api.checkDomain(d.id))}
                  >
                    {busy === d.id ? <Spinner /> : <RefreshCw />}
                  </Button>
                  {d.source === "manual" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Remove {name}", { name: d.name })}
                      disabled={busy === d.id}
                      onClick={() => act(d.id, () => api.deleteDomain(d.id))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
