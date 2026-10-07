import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { api, type GitHostEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/error-alert";
import { HOST_LABEL } from "@/lib/git-host";
import { tx } from "@/lib/i18n";

type Kind = GitHostEntry["kind"];

const KIND_NAME: Record<Kind, string> = {
  gitlab: "GitLab",
  gitea: "Gitea / Forgejo",
  bitbucket: "Bitbucket Cloud",
};

/** What each host needs, in the words of its own token page. */
function hint(kind: Kind): string {
  switch (kind) {
    case "gitlab":
      return tx(
        "A personal, group or project access token with the api scope (read_api and read_repository are enough for scans only). Leave the URL empty for gitlab.com."
      );
    case "gitea":
      return tx(
        "An access token with repository read and write (and user read for the connection test). Enter your instance's URL, e.g. https://codeberg.org or https://git.example.com."
      );
    case "bitbucket":
      return tx(
        "An API token with repository and pull request read/write scopes, together with your Atlassian account email — or a repository/workspace access token without an email."
      );
  }
}

/**
 * GitLab, Gitea/Forgejo and Bitbucket next to GitHub: one entry per host,
 * cloud or self-hosted. Each token is tested before it is stored.
 */
export function GitHostsCard({
  header,
  hosts,
  onChanged,
}: {
  header: ReactNode;
  hosts: GitHostEntry[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("gitlab");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAdding(false);
    setUrl("");
    setUsername("");
    setToken("");
    setError(null);
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.addGitHost({
        kind,
        url: kind === "bitbucket" ? undefined : url.trim() || undefined,
        username:
          kind === "bitbucket" ? username.trim() || undefined : undefined,
        token: token.trim(),
      });
      toast.success(
        tx("{host} connected as {account}", {
          host: HOST_LABEL[kind],
          account: res.account,
        })
      );
      reset();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not connect"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: GitHostEntry) => {
    try {
      await api.removeGitHost(h.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not remove"));
    }
  };

  return (
    <Card>
      {header}
      <CardContent className="space-y-4">
        {hosts.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {hosts.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-28 shrink-0 font-medium">
                  {HOST_LABEL[h.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {h.url}
                  {h.username ? ` · ${h.username}` : ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => void remove(h)}
                  aria-label={tx("Remove {host}", { host: h.url })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <div className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-2">
              <Label htmlFor="git-host-kind">{tx("Host")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger id="git-host-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_NAME) as Kind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_NAME[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind !== "bitbucket" && (
              <div className="grid gap-2">
                <Label htmlFor="git-host-url">{tx("URL")}</Label>
                <Input
                  id="git-host-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    kind === "gitlab"
                      ? "https://gitlab.com"
                      : "https://git.example.com"
                  }
                  className="font-mono text-sm"
                />
              </div>
            )}
            {kind === "bitbucket" && (
              <div className="grid gap-2">
                <Label htmlFor="git-host-user">
                  {tx("Atlassian account email (optional)")}
                </Label>
                <Input
                  id="git-host-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="git-host-token">{tx("Access token")}</Label>
              <Input
                id="git-host-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{hint(kind)}</p>
            </div>
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void add()}
                disabled={
                  busy || !token.trim() || (kind === "gitea" && !url.trim())
                }
              >
                {busy ? tx("Testing…") : tx("Test and save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                {tx("Cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            {tx("Add a Git host")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
