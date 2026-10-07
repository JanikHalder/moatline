import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Github, RefreshCw } from "lucide-react";
import { api, type OrgIntegrations } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tx } from "@/lib/i18n";

const RESULT: Record<string, { ok: boolean; text: string }> = {
  installed: { ok: true, text: "GitHub App installed." },
  failed: { ok: false, text: "GitHub did not confirm the app. Try again." },
  expired: {
    ok: false,
    text: "The GitHub App setup took too long or was started elsewhere. Start it again.",
  },
  signin: { ok: false, text: "Sign in first, then start the setup again." },
  missing: { ok: false, text: "No GitHub App to install. Create it first." },
};

/**
 * A GitHub App of the organization's own, created in two clicks: GitHub
 * shows it pre-filled, then it is installed on an account or organization.
 * Its tokens last an hour and belong to no person.
 */
export function GithubAppSection({
  app,
  onChanged,
}: {
  app: OrgIntegrations["githubApp"];
  onChanged: () => void;
}) {
  const [githubOrg, setGithubOrg] = useState("");
  const [busy, setBusy] = useState(false);

  // Back from GitHub: say how it went, once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("githubApp");
    if (!r) return;
    const msg = RESULT[r];
    if (msg) (msg.ok ? toast.success : toast.error)(tx(msg.text));
    params.delete("githubApp");
    const q = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}`
    );
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const { action, manifest } = await api.createGithubAppManifest(
        githubOrg.trim() || undefined
      );
      // GitHub takes the manifest as a form post from the browser.
      const form = document.createElement("form");
      form.method = "post";
      form.action = action;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = JSON.stringify(manifest);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not start"));
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      await api.refreshGithubApp();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not refresh"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.removeGithubApp();
      toast.success(tx("GitHub App disconnected"), {
        description: tx("Delete it on GitHub too if it is no longer needed."),
        action: {
          label: tx("Open"),
          onClick: () => window.open(r.htmlUrl, "_blank", "noopener"),
        },
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not remove"));
    } finally {
      setBusy(false);
    }
  };

  if (app) {
    return (
      <div className="grid gap-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Github className="size-4" />
          <a
            href={app.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline"
          >
            {app.name}
          </a>
          <Badge variant={app.installations.length ? "success" : "warning"}>
            {app.installations.length
              ? tx("installed")
              : tx("not installed yet")}
          </Badge>
        </div>
        {app.installations.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {tx("Installed on:")}{" "}
            {app.installations.map((i) => i.account).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a
              href={`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`}
              target="_blank"
              rel="noreferrer"
            >
              {app.installations.length
                ? tx("Install on another account")
                : tx("Install the app")}
              <ExternalLink />
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw />
            {tx("Check installations")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => void remove()}
            disabled={busy}
          >
            {tx("Disconnect")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {tx(
            "Repositories of the accounts the app is installed on use its tokens; the access token below stays for the rest and for new sites from templates."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="grid gap-1">
        <p className="font-medium">{tx("Recommended: a GitHub App")}</p>
        <p className="text-sm text-muted-foreground">
          {tx(
            "Create Moatline's own GitHub App in two clicks — like Dokploy. Its tokens last an hour and belong to no person, so nothing breaks when someone leaves."
          )}
        </p>
      </div>
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="github-app-org">
          {tx("GitHub organization (optional)")}
        </Label>
        <Input
          id="github-app-org"
          value={githubOrg}
          onChange={(e) => setGithubOrg(e.target.value)}
          placeholder={tx("empty: your personal account")}
        />
      </div>
      <div>
        <Button size="sm" onClick={() => void create()} disabled={busy}>
          <Github />
          {busy ? tx("Opening GitHub…") : tx("Create GitHub App")}
        </Button>
      </div>
    </div>
  );
}
