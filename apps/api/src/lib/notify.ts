import nodemailer from "nodemailer";
import { inMaintenance, type Scope } from "../services/maintenance";
import { sendSystemEmail, systemMail } from "./system-mail";
import { eq } from "drizzle-orm";
import { db, member, orgIntegrations } from "db";
import { decryptSecret, isEncrypted } from "./crypto";
import { translateNotification } from "./notify-i18n";

export type NotifyEventType =
  | "new_critical_cve"
  | "autofix_pr_opened"
  | "autofix_merged"
  | "deploy_triggered"
  | "workflow_failed"
  | "server_alert"
  | "weekly_digest";

export type NotifyEvent = {
  type: NotifyEventType;
  title: string;
  message: string;
  url?: string;
  /** What it is about: held back while that is in maintenance. */
  scope?: Scope;
};

function safeDecrypt(v: string | null): string | null {
  if (!v) return null;
  try {
    return isEncrypted(v) ? decryptSecret(v) : v;
  } catch {
    return null;
  }
}

async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack answered HTTP ${res.status}`);
  }
}

/** Telegram allows 4096 characters per message. */
const TELEGRAM_MAX = 4000;

type TelegramResponse<T> = { ok: boolean; description?: string; result?: T };

/**
 * One Bot API call. Errors carry Telegram's own description ("chat not
 * found", "bot was blocked by the user") but never the token, which is part
 * of the URL and must not end up in logs or API responses.
 */
async function telegramCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Telegram not reachable: ${msg.split(token).join("***")}`);
  }
  const data = (await res
    .json()
    .catch(() => null)) as TelegramResponse<T> | null;
  if (!res.ok || !data?.ok) {
    if (res.status === 401 || res.status === 404) {
      throw new Error("Telegram rejected the bot token.");
    }
    throw new Error(
      `Telegram: ${data?.description ?? `HTTP ${res.status}`}`
        .split(token)
        .join("***")
    );
  }
  return data.result as T;
}

async function sendTelegram(
  token: string,
  chatId: string,
  text: string
): Promise<void> {
  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: text.length > TELEGRAM_MAX ? `${text.slice(0, TELEGRAM_MAX)}…` : text,
    disable_web_page_preview: true,
  });
}

export type TelegramChat = {
  id: string;
  title: string;
  type: string;
};

/**
 * Chats that recently wrote to the bot (or added it to a group). That is how
 * a chat ID is found without fishing it out of the Bot API by hand: send the
 * bot a message, then ask here.
 */
export async function findTelegramChats(
  token: string
): Promise<TelegramChat[]> {
  type Update = {
    message?: { chat: TgChat };
    channel_post?: { chat: TgChat };
    my_chat_member?: { chat: TgChat };
  };
  type TgChat = {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  const updates = await telegramCall<Update[]>(token, "getUpdates", {
    limit: 100,
    allowed_updates: ["message", "channel_post", "my_chat_member"],
  });
  const chats = new Map<string, TelegramChat>();
  for (const u of updates) {
    const chat =
      u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
    if (!chat) continue;
    const name =
      chat.title ??
      [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
      chat.username;
    chats.set(String(chat.id), {
      id: String(chat.id),
      title: name || chat.username || String(chat.id),
      type: chat.type,
    });
  }
  return [...chats.values()];
}

type Integ = typeof orgIntegrations.$inferSelect;

async function sendEmail(
  integ: Integ,
  subject: string,
  text: string
): Promise<void> {
  if (!integ.notifyEmailTo) return;
  // No mail server of its own: the instance's, when it has one.
  if (!integ.smtpHost) {
    await sendSystemEmail(integ.notifyEmailTo, subject, text);
    return;
  }
  const port = integ.smtpPort ?? 587;
  const pass = safeDecrypt(integ.smtpPass);
  const transport = nodemailer.createTransport({
    host: integ.smtpHost,
    port,
    secure: port === 465,
    auth: integ.smtpUser && pass ? { user: integ.smtpUser, pass } : undefined,
  });
  await transport.sendMail({
    from: integ.smtpFrom ?? integ.smtpUser ?? "moatline@local",
    to: integ.notifyEmailTo,
    subject: `[Moatline] ${subject}`,
    text,
  });
}

/**
 * Send a one-off email to a specific recipient using the organization's SMTP
 * settings. Used for organization invitations, where the recipient is the
 * invitee rather than the org's fixed notification address.
 *
 * Returns whether the mail was actually sent, so callers can tell the user to
 * pass the link on by hand when no SMTP server is configured. Never throws.
 */
export async function sendOrgEmail(
  orgId: string,
  to: string,
  subject: string,
  text: string
): Promise<boolean> {
  try {
    const [integ] = await db
      .select()
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId))
      .limit(1);
    if (!integ?.smtpHost) return sendSystemEmail(to, subject, text);
    const port = integ.smtpPort ?? 587;
    const pass = safeDecrypt(integ.smtpPass);
    const transport = nodemailer.createTransport({
      host: integ.smtpHost,
      port,
      secure: port === 465,
      auth: integ.smtpUser && pass ? { user: integ.smtpUser, pass } : undefined,
    });
    await transport.sendMail({
      from: integ.smtpFrom ?? integ.smtpUser ?? "moatline@local",
      to,
      subject: `[Moatline] ${subject}`,
      text,
    });
    return true;
  } catch (e) {
    console.error("[notify] Could not send email to", to, e);
    return false;
  }
}

/**
 * Send an email to a user who has no active organization context — password
 * resets happen before sign-in. SMTP is configured per organization, so this
 * walks the organizations the user belongs to and uses the first one that has
 * a mail server set up.
 *
 * Returns whether the mail was sent. Never throws.
 */
export async function sendUserEmail(
  userId: string,
  to: string,
  subject: string,
  text: string
): Promise<boolean> {
  try {
    const orgs = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId));
    for (const org of orgs) {
      if (await sendOrgEmail(org.organizationId, to, subject, text)) {
        return true;
      }
    }
    // No organization yet (a fresh sign-up), or none of them sends mail.
    return orgs.length ? false : sendSystemEmail(to, subject, text);
  } catch (e) {
    console.error(
      "[notify] Could not look up SMTP settings for user",
      userId,
      e
    );
    return false;
  }
}

/**
 * Fan out a notification to whichever channels the org has configured.
 * Best-effort: never throws, one failing channel never blocks the others,
 * and it never propagates errors into the calling workflow.
 */
export async function notify(orgId: string, event: NotifyEvent): Promise<void> {
  if (event.scope) {
    const w = await inMaintenance(orgId, event.scope).catch(() => null);
    if (w) {
      console.log(
        `[notify] held back during maintenance until ${w.endsAt.toISOString()}: ${event.title}`
      );
      return;
    }
  }
  let integ: Integ | undefined;
  try {
    [integ] = await db
      .select()
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
  } catch {
    return;
  }
  if (!integ) return;

  const { title, message } = translateNotification(
    integ.notifyLanguage === "de" ? "de" : "en",
    event.title,
    event.message
  );
  const text = [title, "", message, event.url ? `\n${event.url}` : ""]
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();

  // A failing channel is logged, never thrown: one broken webhook must not
  // stop the others or the workflow that raised the event.
  const results = await sendToChannels(integ, title, text);
  for (const r of results) {
    if (!r.ok) console.error(`[notify] ${r.channel} failed: ${r.error}`);
  }
}

export type ChannelResult = {
  channel: "slack" | "telegram" | "email";
  ok: boolean;
  error: string | null;
};

async function sendToChannels(
  integ: Integ,
  subject: string,
  text: string
): Promise<ChannelResult[]> {
  const tasks: Array<Promise<ChannelResult>> = [];
  const attempt = (
    channel: ChannelResult["channel"],
    send: () => Promise<void>
  ) =>
    tasks.push(
      send().then(
        () => ({ channel, ok: true, error: null }),
        (e: unknown) => ({
          channel,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      )
    );
  const slackUrl = safeDecrypt(integ.slackWebhookUrl);
  if (slackUrl) attempt("slack", () => sendSlack(slackUrl, text));
  const tgToken = safeDecrypt(integ.telegramBotToken);
  if (tgToken && integ.telegramChatId) {
    const chatId = integ.telegramChatId;
    attempt("telegram", () => sendTelegram(tgToken, chatId, text));
  }
  if (integ.notifyEmailTo && (integ.smtpHost || systemMail())) {
    attempt("email", () => sendEmail(integ, subject, text));
  }
  return Promise.all(tasks);
}

/**
 * Send a test message over every configured channel and report each result,
 * so a wrong chat ID shows up now — not on the night a server goes down.
 */
export async function sendTestNotification(
  orgId: string
): Promise<ChannelResult[]> {
  const [integ] = await db
    .select()
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  if (!integ) return [];
  return sendToChannels(
    integ,
    "Test notification",
    "✅ Test from Moatline – notifications for this organization arrive here."
  );
}

/** The organization's stored Telegram bot token, decrypted. */
export async function storedTelegramToken(
  orgId: string
): Promise<string | null> {
  const [integ] = await db
    .select({ token: orgIntegrations.telegramBotToken })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  return safeDecrypt(integ?.token ?? null);
}
