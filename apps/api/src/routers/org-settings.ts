import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import type { Context } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireOrgAdmin } from "../middleware/tenant";
import { encryptSecret } from "../lib/crypto";
import { validateLiveUrl } from "../lib/live-check";
import { audit } from "../lib/audit-log";
import { syncKumaForOrg } from "../services/kuma";
import {
  parseTokens,
  syncHetznerForOrg,
  TOKEN_RE,
  type HetznerState,
} from "../services/hetzner";
import { collectDigest, formatDigest } from "../services/digest";
import {
  notify,
  findTelegramChats,
  sendTestNotification,
  storedTelegramToken,
} from "../lib/notify";
import { sendEvent } from "../lib/events";
import { newAlertToken } from "../services/alerts";
import { setupOpenObserve } from "../services/observability-setup";
import { normalizeBase, whoami } from "../lib/git-host";
import { forgetStacks, syncStacksForOrg } from "../services/stack-platforms";
import { randomUUID } from "node:crypto";

/**
 * Settings hold org secrets and can trigger deploys/merges – so, unlike the
 * read endpoints, they require a REAL authenticated session and reject the
 * demo-org (no-session) bypass.
 */
function requireMember(
  c: Context<{ Variables: TenantVariables }>
): string | Response {
  const session = c.get("session");
  if (!session) return c.json({ error: "Authentication required" }, 401);
  return requireOrganization(c);
}

const settingsSchema = z.object({
  githubToken: z.string().optional(),
  dokployBaseUrl: z.string().optional(),
  dokployToken: z.string().optional(),
  coolifyBaseUrl: z.string().optional(),
  coolifyToken: z.string().optional(),
  komodoBaseUrl: z.string().max(500).optional(),
  komodoApiKey: z.string().max(500).optional(),
  komodoApiSecret: z.string().max(500).optional(),
  portainerBaseUrl: z.string().max(500).optional(),
  portainerToken: z.string().max(1000).optional(),
  otlpEndpoint: z.string().max(500).optional(),
  otlpHeaders: z.string().max(4000).optional(),
  grafanaUrl: z.string().max(500).optional(),
  grafanaToken: z.string().max(500).optional(),
  eventWebhookUrl: z.string().max(1000).optional(),
  slackWebhookUrl: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().nullable().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().optional(),
  notifyEmailTo: z.string().optional(),
  kumaBaseUrl: z.string().optional(),
  kumaApiKey: z.string().optional(),
  wazuhApiUrl: z.string().optional(),
  wazuhUser: z.string().optional(),
  wazuhPassword: z.string().optional(),
  wazuhCaCert: z.string().max(20000).optional(),
  // Read-only Hetzner Cloud tokens, one per line (one per project).
  hetznerTokens: z.string().max(2000).optional(),
  pagespeedApiKey: z.string().max(200).optional(),
  notifyLanguage: z.enum(["en", "de"]).optional(),
  weeklyDigest: z.boolean().optional(),
});

/** Non-secret plain text field: undefined = keep, "" = clear, else set. */
function plainField(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Secret field: undefined = keep, "" = clear, else encrypt+set. */
function secretField(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? null : encryptSecret(t);
}

const gitHostSchema = z.object({
  kind: z.enum(["gitlab", "gitea", "bitbucket"]),
  url: z.string().max(300).optional(),
  username: z.string().max(200).optional(),
  token: z.string().min(1).max(2000),
});

const httpUrl = (v: string | undefined) =>
  !v?.trim() || /^https?:\/\/[^\s]+$/i.test(v.trim());

export const orgSettingsRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireMember(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .select()
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
    // Never return raw secrets – only whether they are configured.
    return c.json({
      githubTokenSet: !!row?.githubToken,
      githubApp: row?.githubApp
        ? {
            name: row.githubApp.name,
            slug: row.githubApp.slug,
            htmlUrl: row.githubApp.htmlUrl,
            installations: row.githubApp.installations,
          }
        : null,
      gitHosts: (row?.gitHosts ?? []).map((h) => ({
        id: h.id,
        kind: h.kind,
        url: h.url,
        username: h.username,
        tokenSet: !!h.token,
      })),
      dokployBaseUrl: row?.dokployBaseUrl ?? null,
      dokployTokenSet: !!row?.dokployToken,
      coolifyBaseUrl: row?.coolifyBaseUrl ?? null,
      coolifyTokenSet: !!row?.coolifyToken,
      komodoBaseUrl: row?.komodoBaseUrl ?? null,
      komodoKeySet: !!row?.komodoApiKey && !!row?.komodoApiSecret,
      portainerBaseUrl: row?.portainerBaseUrl ?? null,
      portainerTokenSet: !!row?.portainerToken,
      otlpEndpoint: row?.otlpEndpoint ?? null,
      otlpHeadersSet: !!row?.otlpHeaders,
      grafanaUrl: row?.grafanaUrl ?? null,
      grafanaTokenSet: !!row?.grafanaToken,
      eventWebhookSet: !!row?.eventWebhookUrl,
      alertReceiverSet: !!row?.alertTokenHash,
      slackWebhookUrlSet: !!row?.slackWebhookUrl,
      telegramBotTokenSet: !!row?.telegramBotToken,
      telegramChatId: row?.telegramChatId ?? null,
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? null,
      smtpUser: row?.smtpUser ?? null,
      smtpPassSet: !!row?.smtpPass,
      smtpFrom: row?.smtpFrom ?? null,
      notifyEmailTo: row?.notifyEmailTo ?? null,
      kumaBaseUrl: row?.kumaBaseUrl ?? null,
      kumaApiKeySet: !!row?.kumaApiKey,
      wazuhApiUrl: row?.wazuhApiUrl ?? null,
      wazuhUser: row?.wazuhUser ?? null,
      wazuhPasswordSet: !!row?.wazuhPassword,
      wazuhCaCertSet: !!row?.wazuhCaCert,
      hetznerTokenCount: parseTokens(row?.hetznerTokens).length,
      pagespeedApiKeySet: !!row?.pagespeedApiKey,
      notifyLanguage: row?.notifyLanguage ?? "en",
      hetznerState: (row?.hetznerState ?? null) as HetznerState | null,
      weeklyDigest: row?.weeklyDigest ?? true,
      lastDigestAt: row?.lastDigestAt ?? null,
    });
  })
  .put("/", zValidator("json", settingsSchema), async (c) => {
    // Changing where secrets point (or replacing them) is an admin action:
    // a member who could swap the Dokploy URL could collect the token.
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can change integrations."
    );
    if (orgId instanceof Response) return orgId;
    const body = c.req.valid("json");
    for (const k of [
      "otlpEndpoint",
      "grafanaUrl",
      "eventWebhookUrl",
      "komodoBaseUrl",
      "portainerBaseUrl",
    ] as const)
      if (!httpUrl(body[k]))
        return c.json({ error: `${k}: enter an http(s) URL` }, 400);

    // Build a partial update: only fields the client actually sent.
    const patch: Record<string, string | number | boolean | null> = {};
    const setIf = (key: string, val: string | number | null | undefined) => {
      if (val !== undefined) patch[key] = val;
    };
    setIf("githubToken", secretField(body.githubToken));
    setIf("dokployBaseUrl", plainField(body.dokployBaseUrl));
    setIf("dokployToken", secretField(body.dokployToken));
    setIf("coolifyBaseUrl", plainField(body.coolifyBaseUrl));
    setIf("coolifyToken", secretField(body.coolifyToken));
    setIf("komodoBaseUrl", plainField(body.komodoBaseUrl));
    setIf("komodoApiKey", secretField(body.komodoApiKey));
    setIf("komodoApiSecret", secretField(body.komodoApiSecret));
    setIf("portainerBaseUrl", plainField(body.portainerBaseUrl));
    setIf("portainerToken", secretField(body.portainerToken));
    setIf("otlpEndpoint", plainField(body.otlpEndpoint));
    setIf("otlpHeaders", secretField(body.otlpHeaders));
    setIf("grafanaUrl", plainField(body.grafanaUrl));
    setIf("grafanaToken", secretField(body.grafanaToken));
    setIf("eventWebhookUrl", secretField(body.eventWebhookUrl));
    setIf("slackWebhookUrl", secretField(body.slackWebhookUrl));
    setIf("telegramBotToken", secretField(body.telegramBotToken));
    setIf("telegramChatId", plainField(body.telegramChatId));
    setIf("smtpHost", plainField(body.smtpHost));
    setIf("smtpPort", body.smtpPort === undefined ? undefined : body.smtpPort);
    setIf("smtpUser", plainField(body.smtpUser));
    setIf("smtpPass", secretField(body.smtpPass));
    setIf("smtpFrom", plainField(body.smtpFrom));
    setIf("notifyEmailTo", plainField(body.notifyEmailTo));
    setIf("kumaBaseUrl", plainField(body.kumaBaseUrl));
    setIf("kumaApiKey", secretField(body.kumaApiKey));
    setIf("wazuhApiUrl", plainField(body.wazuhApiUrl));
    setIf("wazuhUser", plainField(body.wazuhUser));
    setIf("wazuhPassword", secretField(body.wazuhPassword));
    setIf("wazuhCaCert", plainField(body.wazuhCaCert));
    setIf("pagespeedApiKey", secretField(body.pagespeedApiKey));
    if (body.hetznerTokens !== undefined) {
      const tokens = body.hetznerTokens.split(/\s+/).filter(Boolean);
      if (tokens.length > 10) {
        return c.json({ error: "At most 10 Hetzner tokens." }, 400);
      }
      if (tokens.some((t) => !TOKEN_RE.test(t))) {
        return c.json(
          {
            error:
              "A Hetzner API token is 64 letters and digits — one per line.",
          },
          400
        );
      }
      patch.hetznerTokens = tokens.length
        ? encryptSecret([...new Set(tokens)].join("\n"))
        : null;
    }
    if (body.weeklyDigest !== undefined) patch.weeklyDigest = body.weeklyDigest;
    if (body.notifyLanguage !== undefined)
      patch.notifyLanguage = body.notifyLanguage;

    // These URLs are fetched by the server on a schedule: same SSRF rules as
    // live URLs, and the Wazuh API only over TLS.
    for (const key of ["kumaBaseUrl", "wazuhApiUrl"] as const) {
      const url = patch[key];
      if (typeof url !== "string") continue;
      const valid = validateLiveUrl(url);
      if (!valid.ok) return c.json({ error: `${key}: ${valid.reason}` }, 400);
    }
    if (
      typeof patch.wazuhApiUrl === "string" &&
      !patch.wazuhApiUrl.startsWith("https://")
    ) {
      return c.json({ error: "The Wazuh API URL must use https://." }, 400);
    }
    if (
      typeof patch.wazuhCaCert === "string" &&
      !patch.wazuhCaCert.includes("-----BEGIN CERTIFICATE-----")
    ) {
      return c.json(
        { error: "The Wazuh CA certificate must be in PEM format." },
        400
      );
    }

    const [existing] = await db
      .select({ id: orgIntegrations.id })
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));

    if (existing) {
      await db
        .update(orgIntegrations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(orgIntegrations.organizationId, orgId));
    } else {
      await db
        .insert(orgIntegrations)
        .values({ organizationId: orgId, ...patch });
    }
    // New Kuma credentials: show the result now, not after the next tick.
    if (body.kumaBaseUrl !== undefined || body.kumaApiKey !== undefined) {
      await syncKumaForOrg(orgId).catch((e) =>
        console.error("[settings] Kuma sync after save failed:", e)
      );
    }
    if (
      [
        body.komodoBaseUrl,
        body.komodoApiKey,
        body.komodoApiSecret,
        body.portainerBaseUrl,
        body.portainerToken,
      ].some((v) => v !== undefined)
    ) {
      forgetStacks(orgId);
      void syncStacksForOrg(orgId).catch((e) =>
        console.error("[settings] Komodo/Portainer sync after save failed:", e)
      );
    }
    if (body.hetznerTokens !== undefined) {
      await syncHetznerForOrg(orgId).catch((e) =>
        console.error("[settings] Hetzner sync after save failed:", e)
      );
    }
    // Which settings changed — secrets by name only, never their values.
    await audit(
      c,
      "integrations.update",
      { type: "integrations" },
      {
        changed: Object.keys(patch),
      }
    );
    return c.json({ ok: true });
  })
  .post(
    "/telegram/chats",
    zValidator(
      "json",
      z.object({ botToken: z.string().trim().max(200).optional() })
    ),
    async (c) => {
      const orgId = await requireOrgAdmin(
        c,
        "Only an owner or admin can change integrations."
      );
      if (orgId instanceof Response) return orgId;
      // A token typed into the form (not saved yet) wins over the stored one.
      const token =
        c.req.valid("json").botToken || (await storedTelegramToken(orgId));
      if (!token) return c.json({ error: "Enter the bot token first." }, 400);
      if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
        return c.json(
          { error: "That does not look like a bot token (123456:ABC…)." },
          400
        );
      }
      try {
        return c.json({ chats: await findTelegramChats(token) });
      } catch (e) {
        return c.json(
          { error: e instanceof Error ? e.message : String(e) },
          502
        );
      }
    }
  )
  .post("/digest", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can change integrations."
    );
    if (orgId instanceof Response) return orgId;
    // A preview of this week's summary, sent now over the configured
    // channels — without touching the weekly schedule.
    const data = await collectDigest(orgId);
    if (!data) {
      return c.json(
        { error: "Nothing to summarize yet — add a server or repository." },
        400
      );
    }
    const { title, message } = formatDigest(data);
    await notify(orgId, { type: "weekly_digest", title, message });
    return c.json({ ok: true, title, message });
  })
  .post("/test", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can change integrations."
    );
    if (orgId instanceof Response) return orgId;
    const results = await sendTestNotification(orgId);
    if (results.length === 0) {
      return c.json(
        { error: "No notification channel is configured and saved yet." },
        400
      );
    }
    return c.json({ results });
  })
  // GitLab, Gitea/Forgejo or Bitbucket: tested with the token before it is
  // stored, so a typo shows here and not in the first failed scan. The same
  // host again replaces its token.
  .post("/git-hosts", zValidator("json", gitHostSchema), async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can change integrations."
    );
    if (orgId instanceof Response) return orgId;
    const body = c.req.valid("json");
    const defaults = {
      gitlab: "https://gitlab.com",
      bitbucket: "https://bitbucket.org",
    } as const;
    const raw =
      body.kind === "bitbucket"
        ? defaults.bitbucket
        : body.url?.trim() || (body.kind === "gitlab" ? defaults.gitlab : "");
    const url = raw ? normalizeBase(raw) : null;
    if (!url) return c.json({ error: "Enter the host's https:// URL." }, 400);
    if (!url.startsWith("https://"))
      return c.json(
        {
          error:
            "The host must use https:// — the token travels with every request.",
        },
        400
      );
    // Fetched by the server: the same SSRF rules as every other URL.
    const valid = validateLiveUrl(url);
    if (!valid.ok) return c.json({ error: valid.reason }, 400);
    const entry = {
      kind: body.kind,
      url,
      username: body.username?.trim() || null,
      token: body.token.trim(),
    };
    let account: string;
    try {
      account = await whoami(entry);
    } catch (e) {
      return c.json(
        {
          error: `The token did not work: ${e instanceof Error ? e.message : "no answer"}`,
        },
        400
      );
    }
    const [row] = await db
      .select({ gitHosts: orgIntegrations.gitHosts })
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
    const list = (row?.gitHosts ?? []).filter(
      (h) => !(h.kind === entry.kind && normalizeBase(h.url) === url)
    );
    if (list.length >= 20)
      return c.json({ error: "At most 20 Git hosts." }, 400);
    const id = randomUUID();
    const gitHosts = [
      ...list,
      { id, ...entry, token: encryptSecret(entry.token) },
    ];
    await db
      .insert(orgIntegrations)
      .values({ organizationId: orgId, gitHosts })
      .onConflictDoUpdate({
        target: orgIntegrations.organizationId,
        set: { gitHosts, updatedAt: new Date() },
      });
    await audit(
      c,
      "integrations.git_host_add",
      { type: "organization", id: orgId },
      { kind: entry.kind, url }
    );
    return c.json({ id, account }, 201);
  })
  .delete("/git-hosts/:id", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can change integrations."
    );
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [row] = await db
      .select({ gitHosts: orgIntegrations.gitHosts })
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
    const gone = (row?.gitHosts ?? []).find((h) => h.id === id);
    if (!gone) return c.json({ error: "Not found" }, 404);
    await db
      .update(orgIntegrations)
      .set({
        gitHosts: (row?.gitHosts ?? []).filter((h) => h.id !== id),
        updatedAt: new Date(),
      })
      .where(eq(orgIntegrations.organizationId, orgId));
    await audit(
      c,
      "integrations.git_host_remove",
      { type: "organization", id: orgId },
      { kind: gone.kind, url: gone.url }
    );
    return c.json({ ok: true });
  });

/** Observability: a test event, and the alert receiver's secret URL. */
export const observabilityRouter = new Hono<{ Variables: TenantVariables }>()
  .post("/test-event", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can send test events."
    );
    if (orgId instanceof Response) return orgId;
    const r = await sendEvent(orgId, {
      name: "test",
      title: "Test event from Moatline — events arrive here",
      severity: "info",
    });
    return c.json(r);
  })
  // OpenObserve through Dokploy, events pointed at it. Password shown once.
  .post(
    "/openobserve",
    zValidator(
      "json",
      z.object({
        environment: z.object({ id: z.string().min(1), legacy: z.boolean() }),
        serverId: z.string().min(1).nullable(),
        domain: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
        email: z.string().trim().email(),
      })
    ),
    async (c) => {
      const orgId = await requireOrgAdmin(
        c,
        "Only an owner or admin can set this up."
      );
      if (orgId instanceof Response) return orgId;
      const res = await setupOpenObserve(orgId, c.req.valid("json"));
      if (!res.ok) return c.json({ error: res.error }, 400);
      await audit(
        c,
        "integrations.openobserve",
        { type: "organization", id: orgId },
        { url: res.url }
      );
      return c.json(res, 201);
    }
  )
  // A new receiver URL; the old one stops working. Shown once.
  .post("/alert-receiver", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can create the alert receiver."
    );
    if (orgId instanceof Response) return orgId;
    const { token, hash } = newAlertToken();
    await db
      .insert(orgIntegrations)
      .values({ organizationId: orgId, alertTokenHash: hash })
      .onConflictDoUpdate({
        target: orgIntegrations.organizationId,
        set: { alertTokenHash: hash },
      });
    await audit(c, "integrations.alert_receiver", {
      type: "organization",
      id: orgId,
    });
    const base = (
      process.env.AGENT_BASE_URL ||
      process.env.APP_URL ||
      new URL(c.req.url).origin
    ).replace(/\/+$/, "");
    return c.json({ url: `${base}/api/alerts/${token}` });
  });
