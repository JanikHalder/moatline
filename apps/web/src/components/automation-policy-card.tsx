import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { api, type AutomationPolicy } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { tx } from "@/lib/i18n";

const DEFAULT: AutomationPolicy = {
  defaultAutoFixCritical: false,
  allowMcpSecurityFix: true,
  requirePrReview: false,
};

/**
 * Org-wide rules for auto-fix and what AI agents may start over MCP.
 */
export function AutomationPolicyCard() {
  const [policy, setPolicy] = useState<AutomationPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOrgIntegrations()
      .then((d) => setPolicy(d.automationPolicy ?? DEFAULT))
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
  }, []);

  const save = async () => {
    if (!policy) return;
    setBusy(true);
    try {
      const res = await api.updateOrgIntegrations({ automationPolicy: policy });
      if (res.reposAutonomyDisabled && res.reposAutonomyDisabled > 0) {
        toast.success(
          tx("Automation policy saved — auto-merge/deploy turned off on {n} repositories", {
            n: res.reposAutonomyDisabled,
          })
        );
      } else {
        toast.success(tx("Automation policy saved"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4" />
          {tx("Automation & AI agents")}
        </CardTitle>
        <CardDescription>
          {tx(
            "Rules for unattended security fixes and what coding agents may start over MCP. Every action is written to the audit log."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-muted-foreground">{error}</p>}
        {policy && (
          <>
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={policy.defaultAutoFixCritical}
                onCheckedChange={(v) =>
                  setPolicy({
                    ...policy,
                    defaultAutoFixCritical: v === true,
                  })
                }
              />
              <span>
                <span className="font-medium">
                  {tx("Auto-fix critical CVEs on new repositories")}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {tx(
                    "New repositories start with auto-fix for critical advisories turned on. You can still change each repository."
                  )}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={policy.allowMcpSecurityFix}
                onCheckedChange={(v) =>
                  setPolicy({ ...policy, allowMcpSecurityFix: v === true })
                }
              />
              <span>
                <span className="font-medium">
                  {tx("Allow security fixes over MCP")}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {tx(
                    "API keys with the fix scope may open lockfile-only security PRs. Turn off to keep MCP read/scan only."
                  )}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={policy.requirePrReview}
                onCheckedChange={(v) =>
                  setPolicy({ ...policy, requirePrReview: v === true })
                }
              />
              <span>
                <span className="font-medium">
                  {tx("Require pull-request review")}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {tx(
                    "Blocks auto-merge and auto-deploy. Saving turns them off on repositories that already had them enabled. Fixes still open as PRs."
                  )}
                </span>
              </span>
            </label>
            <Button onClick={save} disabled={busy}>
              {busy && <Spinner />}
              {tx("Save automation policy")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
