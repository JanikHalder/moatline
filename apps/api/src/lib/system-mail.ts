import nodemailer from "nodemailer";

/**
 * The instance's own mail. Organizations can set their own server under
 * Settings; this is what is used when they have not — on the cloud, a new
 * customer has none, yet needs the confirmation mail and password resets.
 *
 * Two ways to send, Resend first:
 * - RESEND_API_KEY (+ MAIL_FROM on a domain verified in Resend)
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
export type SystemMail =
  | { kind: "resend"; apiKey: string; from: string }
  | {
      kind: "smtp";
      host: string;
      port: number;
      user: string | null;
      pass: string | null;
      from: string;
    };

export function systemMail(): SystemMail | null {
  const from =
    process.env.MAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || "";
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) {
    // Resend's shared sender only delivers to the account's own address.
    return {
      kind: "resend",
      apiKey,
      from: from || "Moatline <onboarding@resend.dev>",
    };
  }
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const user = process.env.SMTP_USER?.trim() || null;
  return {
    kind: "smtp",
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    user,
    pass: process.env.SMTP_PASS || null,
    from: from || user || `moatline@${host}`,
  };
}

/** Send with the instance's own mail. Whether it was sent; never throws. */
export async function sendSystemEmail(
  to: string,
  subject: string,
  text: string
): Promise<boolean> {
  const mail = systemMail();
  if (!mail) return false;
  const fullSubject = `[Moatline] ${subject}`;
  try {
    if (mail.kind === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${mail.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: mail.from,
          to: [to],
          subject: fullSubject,
          text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        // Resend explains itself (unverified domain, bad key) in the body.
        throw new Error(
          `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`
        );
      }
      return true;
    }
    const transport = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.port === 465,
      auth:
        mail.user && mail.pass
          ? { user: mail.user, pass: mail.pass }
          : undefined,
    });
    await transport.sendMail({
      from: mail.from,
      to,
      subject: fullSubject,
      text,
    });
    return true;
  } catch (e) {
    console.error("[mail] Could not send email to", to, e);
    return false;
  }
}
