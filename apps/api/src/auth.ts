import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import { db } from "db";
import { sendOrgEmail, sendUserEmail } from "./lib/notify";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { auditRaw } from "./lib/audit-log";
import { clientIpFromHeaders } from "./lib/client-ip";
import { isCloud } from "./lib/cloud";
import { sendSystemEmail, systemMail } from "./lib/system-mail";

/** Public origin of the web app, used to build links in emails. */
const appUrl = (
  process.env.APP_URL ??
  process.env.CORS_ORIGIN?.split(",")[0] ??
  "http://localhost:5173"
)
  .trim()
  .replace(/\/+$/, "");

const isProd = process.env.NODE_ENV === "production";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
// The web app's own origin always counts: links in emails (confirmation,
// password reset) send the browser back to it.
const trustedOrigins = [
  ...new Set([
    appUrl,
    ...(isProd
      ? (process.env.CORS_ORIGIN ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : ["http://localhost:5173", "http://localhost:3000", baseURL]),
  ]),
];

/**
 * On the cloud anyone can sign up, so an address is confirmed before it
 * can sign in — when the instance can send mail at all.
 */
export const requireEmailVerification = isCloud() && !!systemMail();

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    requireEmailVerification,
    async sendResetPassword({ user, url }) {
      const sent = await sendUserEmail(
        user.id,
        user.email,
        "Reset your password",
        [
          "Someone requested a password reset for your Moatline account.",
          "",
          `Open this link to choose a new password: ${url}`,
          "",
          "The link expires in one hour. If you did not request this, ignore this email — your password stays unchanged.",
        ].join("\n")
      );
      if (!sent) {
        // The endpoint always answers "check your email" so addresses cannot
        // be probed, which would hide a missing mail server from the user.
        console.error(
          `[auth] Password reset requested for ${user.email}, but neither the instance nor an organization of that user can send mail — none was sent.`
        );
      }
    },
  },
  emailVerification: requireEmailVerification
    ? {
        sendOnSignUp: true,
        // Signing in unconfirmed sends a fresh link instead of a dead end.
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        async sendVerificationEmail({ user, url }) {
          await sendSystemEmail(
            user.email,
            "Confirm your email address",
            [
              "Welcome to Moatline.",
              "",
              `Open this link to confirm your address and sign in: ${url}`,
              "",
              "If you did not create an account, ignore this email.",
            ].join("\n")
          );
        },
      }
    : undefined,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-in-production",
  baseURL,
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
  advanced: {
    useSecureCookies: isProd || baseURL.startsWith("https://"),
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: isProd || baseURL.startsWith("https://"),
    },
  },
  // Sign-ins and 2FA changes go to the audit log. A session is created only
  // once sign-in is complete (after the second factor, when there is one).
  databaseHooks: {
    session: {
      create: {
        async after(session, ctx) {
          // Better Auth's own session IP is the left-most X-Forwarded-For
          // entry, which the client writes; record the one it cannot.
          const headers = ctx?.headers ?? ctx?.request?.headers;
          await auditRaw({
            userId: session.userId,
            action: "auth.sign_in",
            ip: headers
              ? clientIpFromHeaders((n) => headers.get(n))
              : (session.ipAddress ?? null),
            detail: { userAgent: session.userAgent ?? null },
          });
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.context.returned instanceof APIError) return;
      const user = ctx.context.session?.user;
      if (!user) return;
      // verify-totp with an existing session is the step that turns 2FA on;
      // during sign-in there is no session yet.
      const action =
        ctx.path === "/two-factor/disable"
          ? "auth.2fa_disabled"
          : ctx.path === "/two-factor/verify-totp"
            ? "auth.2fa_enabled"
            : ctx.path === "/two-factor/generate-backup-codes"
              ? "auth.2fa_backup_codes_regenerated"
              : ctx.path === "/change-password"
                ? "auth.password_changed"
                : null;
      if (!action) return;
      await auditRaw({
        userId: user.id,
        userEmail: user.email,
        action,
        ip: ctx.headers
          ? clientIpFromHeaders((n) => ctx.headers?.get(n))
          : null,
      });
    }),
  },
  plugins: [
    // TOTP (authenticator app) plus single-use backup codes. The issuer is
    // what the authenticator app shows next to the code.
    twoFactor({ issuer: "Moatline" }),
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      async sendInvitationEmail(data) {
        const link = `${appUrl}/accept-invitation/${data.id}`;
        const inviter = data.inviter.user.name || data.inviter.user.email;
        await sendOrgEmail(
          data.organization.id,
          data.email,
          `${inviter} invited you to ${data.organization.name}`,
          [
            `${inviter} invited you to join "${data.organization.name}" on Moatline.`,
            "",
            `Open this link to accept: ${link}`,
            "",
            "If you do not have an account yet, sign up with this email address first — the invitation allows it.",
          ].join("\n")
        );
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
