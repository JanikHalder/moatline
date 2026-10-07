import { useEffect, useState } from "react";
import { Bot, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiKey } from "@/lib/api";
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
 * "is anything down?" from this organization's data. Read-only by default.
 */
export function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scan, setScan] = useState(false);
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const load = () =>
    api
      .getApiKeys()
      .then((k) => {
        setKeys(k);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );

  useEffect(() => {
    void load();
  }, []);

  const endpoint = `${window.location.origin}/api/mcp`;

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createApiKey({
        name: name.trim(),
        scan,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      });
      setCreated(r.key);
      setName("");
      setScan(false);
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
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not revoke"));
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
            "Let Claude or another AI assistant read this organization's servers, findings, uptime and repositories over MCP. Read-only unless you allow starting scans; nothing can change settings or touch servers."
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
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
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
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {k.scopes.includes("scan") && (
                      <Badge variant="warning">{tx("can start scans")}</Badge>
                    )}
                    {k.revokedAt ? (
                      <Badge
                        variant="outline"
                        title={formatDateTime(k.revokedAt) ?? undefined}
                      >
                        {tx("revoked")}
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tx("Revoke {name}", { name: k.name })}
                        onClick={() => revoke(k)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!error && (
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
            <label className="flex items-center gap-2 sm:col-span-3">
              <Checkbox
                checked={scan}
                onCheckedChange={(v) => setScan(v === true)}
              />
              {tx("Also allow starting Nuclei and repository scans")}
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
