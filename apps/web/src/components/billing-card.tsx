import { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api, type BillingPlan, type BillingState } from "@/lib/api";
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
import { formatDateTime } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

/**
 * The cloud plans: a flat price per organization and month, by size,
 * billed by Stripe as merchant of record. Checkout, plan changes, invoices
 * and cancelling happen on Stripe's pages. Hidden on self-hosted instances.
 */
export function BillingCard() {
  const t = useT();
  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .getBilling()
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    void load();
    // Back from Stripe: the webhook needs a moment, then the plan shows.
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "done") {
      toast.success(t("Thank you — your plan is updated in a moment."));
      setTimeout(load, 4000);
      params.delete("billing");
      const q = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}`
      );
    }
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Linked from the "Choose a plan" notice: scroll here once it renders.
  const shown = !!state?.enabled;
  useEffect(() => {
    if (shown && window.location.hash === "#billing")
      document.getElementById("billing")?.scrollIntoView({ block: "start" });
  }, [shown]);

  if (!state?.enabled) return null;
  const active = state.plan === "active";
  // Exempt by the operator: nothing to buy, nothing to manage.
  if (state.plan === "free")
    return (
      <Card id="billing" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4" />
            {t("Billing")}
            <Badge variant="success">{t("free")}</Badge>
          </CardTitle>
          <CardDescription>
            {t("This organization uses Moatline without a subscription.")}
          </CardDescription>
        </CardHeader>
      </Card>
    );

  /** Off to a Stripe page: checkout, plan change or the portal. */
  const go = async (key: string, request: () => Promise<{ url: string }>) => {
    setBusy(key);
    try {
      const { url } = await request();
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Stripe did not answer"));
      setBusy(null);
    }
  };

  const fitsPlan = (p: BillingPlan) =>
    state.usage.servers <= p.servers &&
    (p.repositories == null || state.usage.repositories <= p.repositories);

  return (
    <Card id="billing" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CreditCard className="size-4" />
          {t("Billing")}
          {active ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : state.status === "canceled" ? (
            <Badge variant="destructive-soft">{t("canceled")}</Badge>
          ) : (
            <Badge variant="outline">{t("no subscription")}</Badge>
          )}
          {state.status === "past_due" && (
            <Badge variant="destructive">{t("payment failed")}</Badge>
          )}
          {state.test && <Badge variant="warning">{t("test mode")}</Badge>}
        </CardTitle>
        <CardDescription>
          {t(
            "One flat price per month for the whole organization — switch any time, charged pro rata. Prefer not to pay? Moatline is open source: host it yourself for free."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
          <div className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">{t("Servers")}</p>
            <p className="font-medium tabular-nums">{state.usage.servers}</p>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">{t("Repositories")}</p>
            <p className="font-medium tabular-nums">
              {state.usage.repositories}
            </p>
          </div>
        </div>
        {state.scheduledChange?.action === "cancel" && (
          <p className="text-warning">
            {t("Ends on {date}.", {
              date: formatDateTime(state.scheduledChange.effectiveAt) ?? "",
            })}
          </p>
        )}
        {active && state.periodEndsAt && !state.scheduledChange && (
          <p className="text-muted-foreground">
            {t("Renews on {date}.", {
              date: formatDateTime(state.periodEndsAt) ?? "",
            })}
          </p>
        )}
        {!active && (
          <p className="text-muted-foreground">
            {t(
              "Without a subscription you can look around, but not add servers or repositories."
            )}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {state.plans.map((p) => {
            const current = active && state.tier === p.id;
            const fits = fitsPlan(p);
            return (
              <div
                key={p.id}
                className={`flex flex-col gap-3 rounded-lg border p-4 ${current ? "border-primary ring-1 ring-primary" : ""}`}
              >
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {p.eur} €
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      {t("/ month")}
                    </span>
                  </p>
                </div>
                <ul className="space-y-1 text-muted-foreground">
                  <li>{t("Up to {n} servers", { n: p.servers })}</li>
                  <li>
                    {p.repositories == null
                      ? t("Unlimited repositories")
                      : t("Up to {n} repositories", { n: p.repositories })}
                  </li>
                  <li>{t("Every feature")}</li>
                </ul>
                <div className="mt-auto">
                  {current ? (
                    <Badge variant="success">{t("Your plan")}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant={active ? "outline" : "default"}
                      className="w-full"
                      disabled={!!busy || !fits}
                      title={
                        fits
                          ? undefined
                          : t("Too small for what this organization has")
                      }
                      onClick={() =>
                        void go(p.id, () =>
                          active ? api.changePlan(p.id) : api.checkout(p.id)
                        )
                      }
                    >
                      {busy === p.id ? <Spinner /> : !active && <CreditCard />}
                      {active
                        ? t("Switch")
                        : t("Choose {plan}", { plan: p.name })}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {(active || state.status) && (
          <Button
            variant="outline"
            onClick={() => void go("portal", api.billingPortal)}
            disabled={!!busy}
          >
            {busy === "portal" ? <Spinner /> : <ExternalLink />}
            {t("Invoices, payment method, cancel")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
