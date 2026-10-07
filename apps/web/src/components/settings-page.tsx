import { useEffect, useState } from "react";
import {
  api,
  type OrgIntegrations,
  type OrgIntegrationsUpdate,
} from "@/lib/api";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Activity,
  Bell,
  BrickWall,
  Gauge,
  Check,
  GitBranch,
  Mail,
  Rocket,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ApiKeysCard } from "@/components/api-keys-card";
import { formatRelative } from "@/lib/schedule";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";
import { BillingCard } from "@/components/billing-card";
import { UpdatesCard } from "@/components/updates-card";
import { GitHostsCard } from "@/components/git-hosts-card";
import { GithubAppSection } from "@/components/github-app-section";
import { StatusPagesCard } from "@/components/status-pages-card";
import { ObservabilityActions } from "@/components/observability-actions";

/** Card header with an icon tile, shared by every integration section. */
function SectionHeader({
  icon: Icon,
  title,
  description,
  configured,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  configured?: boolean;
}) {
  return (
    <CardHeader className="flex flex-row items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          {configured && (
            <Badge variant="success">
              <Check />
              {tx("Configured")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </CardHeader>
  );
}

export function SettingsPage() {
  const [data, setData] = useState<OrgIntegrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Plain fields mirror the stored value; secret fields are write-only (empty
  // unless the user types a new value).
  const [githubToken, setGithubToken] = useState("");
  const [dokployBaseUrl, setDokployBaseUrl] = useState("");
  const [dokployToken, setDokployToken] = useState("");
  const [coolifyBaseUrl, setCoolifyBaseUrl] = useState("");
  const [coolifyToken, setCoolifyToken] = useState("");
  const [komodoBaseUrl, setKomodoBaseUrl] = useState("");
  const [komodoApiKey, setKomodoApiKey] = useState("");
  const [komodoApiSecret, setKomodoApiSecret] = useState("");
  const [portainerBaseUrl, setPortainerBaseUrl] = useState("");
  const [portainerToken, setPortainerToken] = useState("");
  const [otlpEndpoint, setOtlpEndpoint] = useState("");
  const [otlpHeaders, setOtlpHeaders] = useState("");
  const [grafanaUrl, setGrafanaUrl] = useState("");
  const [grafanaToken, setGrafanaToken] = useState("");
  const [eventWebhookUrl, setEventWebhookUrl] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [tgChats, setTgChats] = useState<Array<{
    id: string;
    title: string;
    type: string;
  }> | null>(null);
  const [tgLookup, setTgLookup] = useState(false);
  const [testing, setTesting] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [notifyLanguage, setNotifyLanguage] = useState<"en" | "de">("en");
  const [previewing, setPreviewing] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [notifyEmailTo, setNotifyEmailTo] = useState("");
  const [kumaBaseUrl, setKumaBaseUrl] = useState("");
  const [kumaApiKey, setKumaApiKey] = useState("");
  const [wazuhApiUrl, setWazuhApiUrl] = useState("");
  const [wazuhUser, setWazuhUser] = useState("");
  const [wazuhPassword, setWazuhPassword] = useState("");
  const [wazuhCaCert, setWazuhCaCert] = useState("");
  const [hetznerTokens, setHetznerTokens] = useState("");
  const [pagespeedKey, setPagespeedKey] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getOrgIntegrations()
      .then((d) => {
        setData(d);
        setDokployBaseUrl(d.dokployBaseUrl ?? "");
        setCoolifyBaseUrl(d.coolifyBaseUrl ?? "");
        setKomodoBaseUrl(d.komodoBaseUrl ?? "");
        setPortainerBaseUrl(d.portainerBaseUrl ?? "");
        setOtlpEndpoint(d.otlpEndpoint ?? "");
        setGrafanaUrl(d.grafanaUrl ?? "");
        setTelegramChatId(d.telegramChatId ?? "");
        setSmtpHost(d.smtpHost ?? "");
        setSmtpPort(d.smtpPort != null ? String(d.smtpPort) : "");
        setSmtpUser(d.smtpUser ?? "");
        setSmtpFrom(d.smtpFrom ?? "");
        setNotifyEmailTo(d.notifyEmailTo ?? "");
        setWeeklyDigest(d.weeklyDigest ?? true);
        setNotifyLanguage(d.notifyLanguage === "de" ? "de" : "en");
        setKumaBaseUrl(d.kumaBaseUrl ?? "");
        setWazuhApiUrl(d.wazuhApiUrl ?? "");
        setWazuhUser(d.wazuhUser ?? "");
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      )
      .finally(() => setLoading(false));
  }, []);

  const findChats = async () => {
    setTgLookup(true);
    try {
      const { chats } = await api.findTelegramChats(
        telegramBotToken.trim() || undefined
      );
      setTgChats(chats);
      if (chats.length === 1) setTelegramChatId(chats[0]!.id);
      if (chats.length === 0) {
        toast.info(
          tx(
            "No chats yet – send your bot a message (or add it to a group), then try again."
          )
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Lookup failed"));
    } finally {
      setTgLookup(false);
    }
  };

  // Tests what is *saved*: unsaved form values would prove nothing about
  // what the next real alert will use.
  const sendTest = async () => {
    setTesting(true);
    try {
      const { results } = await api.sendTestNotification();
      for (const r of results) {
        const name = { slack: "Slack", telegram: "Telegram", email: "Email" }[
          r.channel
        ];
        if (r.ok) toast.success(`${name}: test message sent`);
        else toast.error(`${name}: ${r.error}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Test failed"));
    } finally {
      setTesting(false);
    }
  };

  const secretPlaceholder = (isSet: boolean) =>
    isSet ? "•••••••• (configured – type to replace)" : "not set";

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const patch: OrgIntegrationsUpdate = {
        dokployBaseUrl,
        coolifyBaseUrl,
        komodoBaseUrl,
        portainerBaseUrl,
        otlpEndpoint,
        grafanaUrl,
        telegramChatId,
        smtpHost,
        smtpPort: smtpPort.trim() ? Number(smtpPort) : null,
        smtpUser,
        smtpFrom,
        notifyEmailTo,
        weeklyDigest,
        notifyLanguage,
        kumaBaseUrl,
        wazuhApiUrl,
        wazuhUser,
      };
      // Secret fields: only send when the user actually typed something.
      if (githubToken) patch.githubToken = githubToken;
      if (dokployToken) patch.dokployToken = dokployToken;
      if (coolifyToken) patch.coolifyToken = coolifyToken;
      if (komodoApiKey) patch.komodoApiKey = komodoApiKey;
      if (komodoApiSecret) patch.komodoApiSecret = komodoApiSecret;
      if (portainerToken) patch.portainerToken = portainerToken;
      if (otlpHeaders.trim()) patch.otlpHeaders = otlpHeaders;
      if (grafanaToken) patch.grafanaToken = grafanaToken;
      if (eventWebhookUrl.trim())
        patch.eventWebhookUrl = eventWebhookUrl.trim();
      if (slackWebhookUrl) patch.slackWebhookUrl = slackWebhookUrl;
      if (telegramBotToken) patch.telegramBotToken = telegramBotToken;
      if (smtpPass) patch.smtpPass = smtpPass;
      if (kumaApiKey) patch.kumaApiKey = kumaApiKey;
      if (wazuhPassword) patch.wazuhPassword = wazuhPassword;
      if (wazuhCaCert.trim()) patch.wazuhCaCert = wazuhCaCert;
      if (hetznerTokens.trim()) patch.hetznerTokens = hetznerTokens;
      if (pagespeedKey.trim()) patch.pagespeedApiKey = pagespeedKey.trim();

      await api.updateOrgIntegrations(patch);
      const fresh = await api.getOrgIntegrations();
      setData(fresh);
      setGithubToken("");
      setDokployToken("");
      setCoolifyToken("");
      setKomodoApiKey("");
      setKomodoApiSecret("");
      setPortainerToken("");
      setOtlpHeaders("");
      setGrafanaToken("");
      setEventWebhookUrl("");
      setSlackWebhookUrl("");
      setTelegramBotToken("");
      setSmtpPass("");
      setKumaApiKey("");
      setWazuhPassword("");
      setWazuhCaCert("");
      setHetznerTokens("");
      setSaved(true);
      toast.success(tx("Integrations saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const pageHeader = (
    <PageHeader
      title={tx("Integrations")}
      description={tx(
        "Tokens and endpoints this organization uses for scans, fixes and notifications."
      )}
    />
  );

  if (loading)
    return (
      <div className="max-w-3xl space-y-6">
        {pageHeader}
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );

  return (
    <div className="max-w-3xl space-y-6">
      {pageHeader}
      {error && <ErrorAlert>{error}</ErrorAlert>}

      <BillingCard />

      <Card>
        <SectionHeader
          icon={GitBranch}
          title={tx("GitHub")}
          description={tx("Used to clone repositories and open pull requests.")}
          configured={
            !!data?.githubTokenSet || !!data?.githubApp?.installations.length
          }
        />
        <CardContent className="space-y-4">
          <GithubAppSection
            app={data?.githubApp ?? null}
            onChanged={() => {
              void api.getOrgIntegrations().then(setData);
            }}
          />
          <div className="grid gap-2">
            <Label htmlFor="github-token">{tx("Access token")}</Label>
            <Input
              id="github-token"
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={secretPlaceholder(!!data?.githubTokenSet)}
            />
            <p className="text-xs text-muted-foreground">
              {tx("Needed for private repositories. Scanning requires")}{" "}
              <strong>{tx("Contents: read")}</strong>
              {tx("; the update and security workflows also need")}{" "}
              <strong>{tx("Contents: write")}</strong> and{" "}
              <strong>{tx("Pull requests: read and write")}</strong>{" "}
              {tx(
                "to push branches and open or merge PRs. Without a token here the server-wide GITHUB_TOKEN is used, if one is set."
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <GitHostsCard
        header={
          <SectionHeader
            icon={GitBranch}
            title={tx("GitLab, Bitbucket, Gitea / Forgejo")}
            description={tx(
              "Repositories on other Git hosts — cloud or self-hosted. Scans, update and security PRs, CI checks and the branch overview work the same as on GitHub."
            )}
            configured={!!data?.gitHosts?.length}
          />
        }
        hosts={data?.gitHosts ?? []}
        onChanged={() => {
          void api.getOrgIntegrations().then(setData);
        }}
      />

      <StatusPagesCard />
      <UpdatesCard />

      <Card>
        <SectionHeader
          icon={Rocket}
          title={tx("Dokploy (auto-deploy)")}
          description={tx("Lets the security pipeline ship a merged fix.")}
          configured={!!data?.dokployTokenSet}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dokploy-url">{tx("Base URL")}</Label>
            <Input
              id="dokploy-url"
              value={dokployBaseUrl}
              onChange={(e) => setDokployBaseUrl(e.target.value)}
              placeholder="https://panel.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dokploy-token">{tx("API token (x-api-key)")}</Label>
            <Input
              id="dokploy-token"
              type="password"
              value={dokployToken}
              onChange={(e) => setDokployToken(e.target.value)}
              placeholder={secretPlaceholder(!!data?.dokployTokenSet)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Rocket}
          title={tx("Coolify")}
          description={tx(
            "Sites on Coolify get the same: deploys with watch and rollback, self-healing, redeploy buttons, database checks. Turn the API on in Coolify (Settings → API) and create a token with read and deploy."
          )}
          configured={!!data?.coolifyTokenSet}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="coolify-url">{tx("Coolify URL")}</Label>
            <Input
              id="coolify-url"
              value={coolifyBaseUrl}
              onChange={(e) => setCoolifyBaseUrl(e.target.value)}
              placeholder="https://coolify.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="coolify-token">
              {tx("Coolify token (Bearer)")}
            </Label>
            <Input
              id="coolify-token"
              type="password"
              value={coolifyToken}
              onChange={(e) => setCoolifyToken(e.target.value)}
              placeholder={secretPlaceholder(!!data?.coolifyTokenSet)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Rocket}
          title={tx("Komodo")}
          description={tx(
            "Stacks on Komodo that deploy from a Git repository: deploys with watch, self-healing, redeploy buttons. Create an API key and secret in Komodo (Settings → API keys)."
          )}
          configured={!!data?.komodoKeySet}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="komodo-url">{tx("Komodo URL")}</Label>
            <Input
              id="komodo-url"
              value={komodoBaseUrl}
              onChange={(e) => setKomodoBaseUrl(e.target.value)}
              placeholder="https://komodo.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="komodo-key">{tx("Komodo API key")}</Label>
            <Input
              id="komodo-key"
              type="password"
              value={komodoApiKey}
              onChange={(e) => setKomodoApiKey(e.target.value)}
              placeholder={secretPlaceholder(!!data?.komodoKeySet)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="komodo-secret">{tx("Komodo API secret")}</Label>
            <Input
              id="komodo-secret"
              type="password"
              value={komodoApiSecret}
              onChange={(e) => setKomodoApiSecret(e.target.value)}
              placeholder={secretPlaceholder(!!data?.komodoKeySet)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Rocket}
          title={tx("Portainer")}
          description={tx(
            "Stacks in Portainer deployed from a Git repository: redeploys with watch, self-healing, redeploy buttons. Create an access token in Portainer (My account → Access tokens)."
          )}
          configured={!!data?.portainerTokenSet}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="portainer-url">{tx("Portainer URL")}</Label>
            <Input
              id="portainer-url"
              value={portainerBaseUrl}
              onChange={(e) => setPortainerBaseUrl(e.target.value)}
              placeholder="https://portainer.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="portainer-token">
              {tx("Portainer access token")}
            </Label>
            <Input
              id="portainer-token"
              type="password"
              value={portainerToken}
              onChange={(e) => setPortainerToken(e.target.value)}
              placeholder={secretPlaceholder(!!data?.portainerTokenSet)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Activity}
          title={tx("Observability")}
          description={tx(
            "Deploys, rollbacks, incidents and fix PRs, sent to your observability tools — and their alerts turned into incidents here."
          )}
          configured={
            !!data?.otlpEndpoint ||
            !!data?.grafanaTokenSet ||
            !!data?.eventWebhookSet
          }
        />
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="otlp-endpoint">
                {tx("OTLP endpoint (HTTP)")}
              </Label>
              <Input
                id="otlp-endpoint"
                value={otlpEndpoint}
                onChange={(e) => setOtlpEndpoint(e.target.value)}
                placeholder="https://ingress.eu-west-1.aws.dash0.com"
              />
              <p className="text-xs text-muted-foreground">
                {tx(
                  "Dash0, Grafana Cloud, SigNoz, Honeycomb … — events arrive as logs."
                )}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="otlp-headers">
                {tx("OTLP headers, one per line")}
              </Label>
              <Textarea
                id="otlp-headers"
                value={otlpHeaders}
                onChange={(e) => setOtlpHeaders(e.target.value)}
                placeholder={
                  data?.otlpHeadersSet
                    ? tx("Stored — type to replace")
                    : "Authorization: Bearer …"
                }
                className="min-h-16 font-mono text-xs"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="grafana-url">
                {tx("Grafana URL (annotations)")}
              </Label>
              <Input
                id="grafana-url"
                value={grafanaUrl}
                onChange={(e) => setGrafanaUrl(e.target.value)}
                placeholder="https://grafana.example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="grafana-token">
                {tx("Grafana service account token")}
              </Label>
              <Input
                id="grafana-token"
                type="password"
                value={grafanaToken}
                onChange={(e) => setGrafanaToken(e.target.value)}
                placeholder={secretPlaceholder(!!data?.grafanaTokenSet)}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="event-webhook">
                {tx("Webhook for events (JSON)")}
              </Label>
              <Input
                id="event-webhook"
                type="password"
                value={eventWebhookUrl}
                onChange={(e) => setEventWebhookUrl(e.target.value)}
                placeholder={secretPlaceholder(!!data?.eventWebhookSet)}
              />
            </div>
          </div>
          <ObservabilityActions
            receiverSet={!!data?.alertReceiverSet}
            onChanged={() =>
              api
                .getOrgIntegrations()
                .then((d) => {
                  setData(d);
                  setOtlpEndpoint(d.otlpEndpoint ?? "");
                })
                .catch(() => {})
            }
          />
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Bell}
          title={tx("Notifications")}
          description={tx("Where scan results and pipeline events are posted.")}
        />
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="slack">{tx("Slack incoming webhook URL")}</Label>
            <Input
              id="slack"
              type="password"
              value={slackWebhookUrl}
              onChange={(e) => setSlackWebhookUrl(e.target.value)}
              placeholder={secretPlaceholder(!!data?.slackWebhookUrlSet)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tg-token">{tx("Telegram bot token")}</Label>
              <Input
                id="tg-token"
                type="password"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder={secretPlaceholder(!!data?.telegramBotTokenSet)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tg-chat">{tx("Telegram chat ID")}</Label>
              <div className="flex gap-2">
                <Input
                  id="tg-chat"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="-1001234567890"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={findChats}
                  disabled={
                    tgLookup ||
                    (!telegramBotToken.trim() && !data?.telegramBotTokenSet)
                  }
                >
                  {tgLookup && <Spinner />}
                  {tx("Find chat")}
                </Button>
              </div>
            </div>
          </div>
          {tgChats && tgChats.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {tgChats.map((chat) => (
                <Button
                  key={chat.id}
                  type="button"
                  size="sm"
                  variant={telegramChatId === chat.id ? "secondary" : "outline"}
                  onClick={() => setTelegramChatId(chat.id)}
                >
                  {chat.title}
                  <span className="text-muted-foreground">{chat.type}</span>
                </Button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {tx("Create a bot with")}{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              {tx("@BotFather")}
            </a>
            {tx(
              ", send it a message (or add it to your team's group), then click"
            )}{" "}
            <strong>{tx("Find chat")}</strong>
            {tx(
              ". Alerts arrive for new critical CVEs, auto-fix PRs, deploys, failures and new server problems."
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
            <span id="notify-lang-label">
              {tx("Language of notifications")}
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              aria-labelledby="notify-lang-label"
              value={notifyLanguage}
              onValueChange={(v) => v && setNotifyLanguage(v as "en" | "de")}
            >
              <ToggleGroupItem value="en" className="px-3">
                English
              </ToggleGroupItem>
              <ToggleGroupItem value="de" className="px-3">
                Deutsch
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-xs text-muted-foreground">
              {tx(
                "Slack, Telegram and email. Package names and error texts from GitHub stay as they are."
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={weeklyDigest}
                onCheckedChange={setWeeklyDigest}
                aria-label={tx("Weekly summary")}
              />
              <span>
                {tx("Weekly summary on Mondays")}
                {data?.lastDigestAt && (
                  <span className="text-muted-foreground">
                    {" "}
                    {tx("· last")} {formatRelative(data.lastDigestAt)}
                  </span>
                )}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={previewing}
                onClick={async () => {
                  setPreviewing(true);
                  try {
                    const r = await api.sendDigestPreview();
                    toast.success(`Sent: ${r.title}`);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : tx("Could not send")
                    );
                  } finally {
                    setPreviewing(false);
                  }
                }}
              >
                {previewing && <Spinner />}
                {tx("Send this week's summary now")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={sendTest}
                disabled={testing}
              >
                {testing ? <Spinner /> : <Send />}
                {tx("Send test message")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Mail}
          title={tx("Email (SMTP)")}
          description={tx(
            "Sends invitations, password resets and alert mails."
          )}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="smtp-host">{tx("Host")}</Label>
            <Input
              id="smtp-host"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-port">{tx("Port")}</Label>
            <Input
              id="smtp-port"
              inputMode="numeric"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-user">{tx("User")}</Label>
            <Input
              id="smtp-user"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-pass">{tx("Password")}</Label>
            <Input
              id="smtp-pass"
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder={secretPlaceholder(!!data?.smtpPassSet)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-from">{tx("From")}</Label>
            <Input
              id="smtp-from"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="alerts@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notify-to">{tx("Notify address")}</Label>
            <Input
              id="notify-to"
              value={notifyEmailTo}
              onChange={(e) => setNotifyEmailTo(e.target.value)}
              placeholder="security@example.com"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Activity}
          title={tx("Uptime Kuma")}
          description={tx(
            "Monitors are pulled every 5 minutes and attached to the servers and applications they watch."
          )}
          configured={!!data?.kumaApiKeySet && !!data?.kumaBaseUrl}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="kuma-url">{tx("Uptime Kuma URL")}</Label>
            <Input
              id="kuma-url"
              value={kumaBaseUrl}
              onChange={(e) => setKumaBaseUrl(e.target.value)}
              placeholder="https://status.example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kuma-key">{tx("API key")}</Label>
            <Input
              id="kuma-key"
              type="password"
              value={kumaApiKey}
              onChange={(e) => setKumaApiKey(e.target.value)}
              placeholder={secretPlaceholder(!!data?.kumaApiKeySet)}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {tx(
              "Create a key in Uptime Kuma under Settings → API Keys. It only grants read access to"
            )}{" "}
            <code className="font-mono">/metrics</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={ShieldCheck}
          title={tx("Wazuh")}
          description={tx(
            "Agent status and hardening (SCA) scores from the Wazuh manager API."
          )}
          configured={!!data?.wazuhPasswordSet && !!data?.wazuhApiUrl}
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="wazuh-url">{tx("Manager API URL")}</Label>
            <Input
              id="wazuh-url"
              value={wazuhApiUrl}
              onChange={(e) => setWazuhApiUrl(e.target.value)}
              placeholder="https://wazuh.example.com:55000"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wazuh-user">{tx("User")}</Label>
            <Input
              id="wazuh-user"
              value={wazuhUser}
              onChange={(e) => setWazuhUser(e.target.value)}
              placeholder={tx("moatline (read-only role)")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wazuh-pass">{tx("Password")}</Label>
            <Input
              id="wazuh-pass"
              type="password"
              value={wazuhPassword}
              onChange={(e) => setWazuhPassword(e.target.value)}
              placeholder={secretPlaceholder(!!data?.wazuhPasswordSet)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="wazuh-ca">{tx("CA certificate (PEM)")}</Label>
            <Textarea
              id="wazuh-ca"
              value={wazuhCaCert}
              onChange={(e) => setWazuhCaCert(e.target.value)}
              placeholder={
                data?.wazuhCaCertSet
                  ? tx("Configured – paste to replace")
                  : tx("-----BEGIN CERTIFICATE-----")
              }
              className="min-h-20 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {tx(
                "For a manager with a self-signed certificate: paste its CA and exactly that CA is trusted. TLS verification is never switched off. Use a user with a read-only role."
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={Gauge}
          title={tx("Performance (Lighthouse)")}
          description={tx(
            "Lighthouse and Core Web Vitals of every live site, daily and after each deploy, through Google PageSpeed Insights."
          )}
          configured={!!data?.pagespeedApiKeySet}
        />
        <CardContent className="grid gap-2">
          <Label htmlFor="pagespeed-key">
            {tx("PageSpeed Insights API key")}
          </Label>
          <Input
            id="pagespeed-key"
            type="password"
            value={pagespeedKey}
            onChange={(e) => setPagespeedKey(e.target.value)}
            placeholder={
              data?.pagespeedApiKeySet
                ? tx("configured – enter to replace")
                : tx("AIza…")
            }
            className="font-mono"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {tx(
              'Free: Google Cloud Console → APIs & Services → enable "PageSpeed Insights API" → Credentials → Create API key (restrict it to that API). 25,000 runs a day; without a key Google allows none.'
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <SectionHeader
          icon={BrickWall}
          title={tx("Hetzner Cloud firewalls")}
          description={tx(
            "Read the firewall rules in front of each server, so a database port the firewall opens to everyone is caught — not only what our one IP sees."
          )}
          configured={(data?.hetznerTokenCount ?? 0) > 0}
        />
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="hetzner-tokens">
              {tx("Read-only project tokens, one per line")}
            </Label>
            <Textarea
              id="hetzner-tokens"
              value={hetznerTokens}
              onChange={(e) => setHetznerTokens(e.target.value)}
              placeholder={
                data?.hetznerTokenCount
                  ? tx("{n} configured — paste all tokens to replace them", {
                      n: data.hetznerTokenCount,
                    })
                  : tx("One token per line")
              }
              className="min-h-16 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {tx(
                "Hetzner Console → project → Security → API tokens → Generate, with permission"
              )}{" "}
              <strong>{tx("Read")}</strong>
              {tx(
                ". Read is enough and keeps the token harmless: it cannot change firewalls or servers. Servers are matched by their public IP (the address in the server settings) or by name."
              )}
            </p>
          </div>
          {data?.hetznerState && (
            <p
              className={
                data.hetznerState.error
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {data.hetznerState.error ??
                tx(
                  "{n} Hetzner servers read, {matched} matched to servers here",
                  {
                    n: data.hetznerState.servers,
                    matched: data.hetznerState.matched,
                  }
                )}{" "}
              · {formatRelative(data.hetznerState.checkedAt)}
            </p>
          )}
          {(data?.hetznerTokenCount ?? 0) > 0 && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await api.updateOrgIntegrations({ hetznerTokens: "" });
                    setData(await api.getOrgIntegrations());
                    toast.success(tx("Hetzner tokens removed"));
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : tx("Could not remove")
                    );
                  }
                }}
              >
                {tx("Remove tokens")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ApiKeysCard />

      {/* One save for every section: the API takes the whole patch at once. */}
      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <Check className="size-4" />
            {tx("Saved")}
          </span>
        )}
        <Button onClick={save} disabled={saving}>
          {saving && <Spinner />}
          {saving ? tx("Saving…") : tx("Save changes")}
        </Button>
      </div>
    </div>
  );
}
