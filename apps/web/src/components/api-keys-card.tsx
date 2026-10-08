import { useEffect, useState } from "react";
import { Bot, KeyRound, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ApiKey,
  type RepoListItem,
  type ServerListItem,
} from "@/lib/api";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
];

/**
 * Keys for the MCP endpoint, so Claude (or another assistant) can answer
 * questions from this organization's data. Scopes and allowlists limit what
 * each key may see and start.
 */
export function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [servers, setServers] = useState<ServerListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scan, setScan] = useState(false);
  const [fix, setFix] = useState(false);
  const [members, setMembers] = useState(false);
  const [expiry, setExpiry] = useState("90");
  const [allowedRepoIds, setAllowedRepoIds] = useState<string[]>([]);
  const [allowedServerIds, setAllowedServerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editScan, setEditScan] = useState(false);
  const [editFix, setEditFix] = useState(false);
  const [editMembers, setEditMembers] = useState(false);
  const [editRepoIds, setEditRepoIds] = useState<string[]>([]);
  const [editServerIds, setEditServerIds] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);

  const load = () =>
    Promise.all([
      api.getApiKeys(),
      api.getRepos().catch(() => [] as RepoListItem[]),
      api.getServers().catch(() => [] as ServerListItem[]),
    ])
      .then(([k, r, s]) => {
        setKeys(k);
        setRepos(r);
        setServers(s);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );

  useEffect(() => {
    void load();
  }, []);

  const endpoint = `${window.location.origin}/api/mcp`;

  const toggleId = (
    list: string[],
    set: (v: string[]) => void,
    id: string,
    on: boolean
  ) => {
    set(on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createApiKey({
        name: name.trim(),
        scan,
        fix,
        members,
        expiresInDays: expiry === "never" ? null : Number(expiry),
        allowedRepoIds: allowedRepoIds.length ? allowedRepoIds : null,
        allowedServerIds: allowedServerIds.length ? allowedServerIds : null,
      });
      setCreated(r.key);
      setName("");
      setScan(false);
      setFix(false);
      setMembers(false);
      setAllowedRepoIds([]);
      setAllowedServerIds([]);
      await load();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : tx("Could not create the key")
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    try {
      await api.revokeApiKey(k.id);
      toast.success(`Revoked ${k.name}`);
      if (editingId === k.id) setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not revoke"));
    }
  };

  const startEdit = (k: ApiKey) => {
    setEditingId(k.id);
    setEditName(k.name);
    setEditScan(k.scopes.includes("scan"));
    setEditFix(k.scopes.includes("fix"));
    setEditMembers(k.scopes.includes("members"));
    setEditRepoIds(k.allowedRepoIds ?? []);
    setEditServerIds(k.allowedServerIds ?? []);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditBusy(true);
    try {
      await api.updateApiKey(editingId, {
        name: editName.trim(),
        scan: editScan,
        fix: editFix,
        members: editMembers,
        allowedRepoIds: editRepoIds.length ? editRepoIds : null,
        allowedServerIds: editServerIds.length ? editServerIds : null,
      });
      toast.success(tx("API key updated"));
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          {tx("API keys (MCP)")}
        </CardTitle>
        <CardDescription>
          {tx(
            "Let Claude or another AI assistant read this organization's servers, findings, uptime and repositories over MCP. Choose scopes and optional allowlists; nothing can change settings or touch servers."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <p className="text-muted-foreground">
            {error.includes("two-factor") || error.includes("owner")
              ? error
              : tx("Could not load the keys: {error}", { error })}
          </p>
        )}

        {created && (
          <Alert variant="warning">
            <KeyRound />
            <AlertTitle>{tx("Your key — shown only now")}</AlertTitle>
            <AlertDescription className="space-y-2">
              <CodeLine text={created} label={tx("API key")} />
              <p>{tx("Add it to Claude Code:")}</p>
              <CodeLine
                text={`claude mcp add --transport http moatline ${endpoint} --header "Authorization: Bearer ${created}"`}
                label={tx("claude mcp add command")}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreated(null)}
              >
                {tx("I have stored it")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {keys && keys.length > 0 && (
          <ul className="divide-y rounded-md border">
            {keys.map((k) => {
              const expired =
                !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();
              const editing = editingId === k.id;
              return (
                <li key={k.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {k.name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {k.prefix}…
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {k.lastUsedAt
                          ? tx("used {when}", {
                              when: formatRelative(k.lastUsedAt) ?? "",
                            })
                          : tx("never used")}
                        {k.expiresAt &&
                          !k.revokedAt &&
                          ` · ${tx(expired ? "expired {when}" : "expires {when}", { when: formatRelative(k.expiresAt) ?? "" })}`}
                        {k.allowedRepoIds?.length
                          ? ` · ${tx("{n} repositories", { n: k.allowedRepoIds.length })}`
                          : ""}
                        {k.allowedServerIds?.length
                          ? ` · ${tx("{n} servers", { n: k.allowedServerIds.length })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {k.scopes.includes("scan") && (
                        <Badge variant="warning">{tx("can start scans")}</Badge>
                      )}
                      {k.scopes.includes("fix") && (
                        <Badge variant="warning">
                          {tx("can open fix PRs")}
                        </Badge>
                      )}
                      {k.scopes.includes("members") && (
                        <Badge variant="warning">
                          {tx("can list members")}
                        </Badge>
                      )}
                      {k.revokedAt ? (
                        <Badge
                          variant="outline"
                          title={formatDateTime(k.revokedAt) ?? undefined}
                        >
                          {tx("revoked")}
                        </Badge>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tx("Edit {name}", { name: k.name })}
                            onClick={() => startEdit(k)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tx("Revoke {name}", { name: k.name })}
                            onClick={() => revoke(k)}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {editing && !k.revokedAt && (
                    <div className="mt-3 grid gap-3 border-t pt-3">
                      <div className="grid gap-2">
                        <Label htmlFor={`edit-key-name-${k.id}`}>
                          {tx("Name")}
                        </Label>
                        <Input
                          id={`edit-key-name-${k.id}`}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={editScan}
                          onCheckedChange={(v) => setEditScan(v === true)}
                        />
                        {tx("Also allow starting Nuclei and repository scans")}
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={editFix}
                          onCheckedChange={(v) => setEditFix(v === true)}
                        />
                        {tx("Also allow opening security-fix pull requests")}
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={editMembers}
                          onCheckedChange={(v) => setEditMembers(v === true)}
                        />
                        {tx("Also allow listing organization members")}
                      </label>
                      {repos.length > 0 && (
                        <div className="space-y-2">
                          <Label>
                            {tx("Limit to repositories (empty = all)")}
                          </Label>
                          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                            {repos.map((r) => (
                              <label
                                key={r.id}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={editRepoIds.includes(r.id)}
                                  onCheckedChange={(v) =>
                                    toggleId(
                                      editRepoIds,
                                      setEditRepoIds,
                                      r.id,
                                      v === true
                                    )
                                  }
                                />
                                <span className="truncate">{r.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {servers.length > 0 && (
                        <div className="space-y-2">
                          <Label>{tx("Limit to servers (empty = all)")}</Label>
                          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                            {servers.map((s) => (
                              <label
                                key={s.id}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={editServerIds.includes(s.id)}
                                  onCheckedChange={(v) =>
                                    toggleId(
                                      editServerIds,
                                      setEditServerIds,
                                      s.id,
                                      v === true
                                    )
                                  }
                                />
                                <span className="truncate">{s.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveEdit()}
                          disabled={editBusy || !editName.trim()}
                        >
                          {editBusy && <Spinner />}
                          {tx("Save key")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                        >
                          {tx("Cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!error && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <Label htmlFor="api-key-name">{tx("New key")}</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tx("e.g. Claude on Alex's laptop")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="api-key-expiry">{tx("Valid for")}</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="api-key-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy && <Spinner />}
                {tx("Create key")}
              </Button>
            </div>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={scan}
                onCheckedChange={(v) => setScan(v === true)}
              />
              {tx("Also allow starting Nuclei and repository scans")}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={fix}
                onCheckedChange={(v) => setFix(v === true)}
              />
              {tx("Also allow opening security-fix pull requests")}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={members}
                onCheckedChange={(v) => setMembers(v === true)}
              />
              {tx("Also allow listing organization members")}
            </label>
            {repos.length > 0 && (
              <div className="space-y-2">
                <Label>{tx("Limit to repositories (empty = all)")}</Label>
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {repos.map((r) => (
                    <label key={r.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={allowedRepoIds.includes(r.id)}
                        onCheckedChange={(v) =>
                          toggleId(
                            allowedRepoIds,
                            setAllowedRepoIds,
                            r.id,
                            v === true
                          )
                        }
                      />
                      <span className="truncate">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {servers.length > 0 && (
              <div className="space-y-2">
                <Label>{tx("Limit to servers (empty = all)")}</Label>
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {servers.map((s) => (
                    <label key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={allowedServerIds.includes(s.id)}
                        onCheckedChange={(v) =>
                          toggleId(
                            allowedServerIds,
                            setAllowedServerIds,
                            s.id,
                            v === true
                          )
                        }
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
