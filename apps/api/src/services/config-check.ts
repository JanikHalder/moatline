import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, packageFindings, repositories, scans } from "db";
import { applicationEnvKeys, type DokployApplication } from "../lib/dokploy";
import { notify } from "../lib/notify";
import { resolveDokployConfig } from "./deploy";

export type ConfigItem = {
  /** What it is for, e.g. "Email". */
  label: string;
  /** Any one of these names satisfies it. */
  names: string[];
  required: boolean;
  ok: boolean;
  why: string;
};

export type ConfigCheck = { checkedAt: string; items: ConfigItem[] };

type Rule = Omit<ConfigItem, "ok"> & { when?: (deps: Set<string>) => boolean };

/** What a Payload site on Dokploy needs to run and to send mail. */
const PAYLOAD_RULES: Rule[] = [
  {
    label: "Payload secret",
    names: ["PAYLOAD_SECRET"],
    required: true,
    why: "Signs logins and tokens — without it Payload does not start.",
  },
  {
    label: "Database",
    names: ["DATABASE_URI", "DATABASE_URL", "MONGODB_URI"],
    required: true,
    why: "Where the content lives.",
  },
  {
    label: "Server Actions key",
    names: ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"],
    required: true,
    why: 'Without a stable key every deploy breaks open tabs with "Failed to find Server Action" — set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY once and keep it.',
  },
  {
    label: "Public URL",
    names: ["NEXT_PUBLIC_SERVER_URL"],
    required: false,
    why: "Absolute links in mails, previews and the sitemap.",
  },
  {
    label: "Email",
    names: ["RESEND_API_KEY", "SMTP_HOST"],
    required: true,
    why: "Form notifications and password resets are sent through it.",
    when: (deps) =>
      [
        "@payloadcms/email-resend",
        "@payloadcms/email-nodemailer",
        "@payloadcms/plugin-form-builder",
        "nodemailer",
        "resend",
      ].some((d) => deps.has(d)),
  },
  {
    label: "Mail alarm",
    names: ["ALERT_RESEND_API_KEY"],
    required: false,
    why: "Tells the agency when the customer's mail stops working.",
    when: (deps) =>
      deps.has("@payloadcms/email-nodemailer") || deps.has("nodemailer"),
  },
  {
    label: "S3 bucket",
    names: ["S3_BUCKET"],
    required: true,
    why: "Uploads go to the bucket — without it they fail or land on the container disk and vanish with the next deploy.",
    when: (deps) => deps.has("@payloadcms/storage-s3"),
  },
  {
    label: "S3 credentials",
    names: ["S3_ACCESS_KEY_ID"],
    required: true,
    why: "Access to the bucket.",
    when: (deps) => deps.has("@payloadcms/storage-s3"),
  },
];

/** Package names of the repository's latest successful scan. */
async function scannedPackages(repositoryId: string): Promise<Set<string>> {
  const [last] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(eq(scans.repositoryId, repositoryId), eq(scans.status, "success"))
    )
    .orderBy(desc(scans.startedAt))
    .limit(1);
  if (!last) return new Set();
  const rows = await db
    .select({ name: packageFindings.packageName })
    .from(packageFindings)
    .where(eq(packageFindings.scanId, last.id));
  return new Set(rows.map((r) => r.name));
}

export function evaluateConfig(
  keys: string[],
  deps: Set<string>
): ConfigItem[] {
  const have = new Set(keys);
  return PAYLOAD_RULES.filter((r) => !r.when || r.when(deps)).map(
    ({ when: _when, ...r }) => ({
      ...r,
      ok: r.names.some((n) => have.has(n)),
    })
  );
}

/**
 * For every Payload repository linked to a Dokploy application: are the
 * variables it needs set there? Names only — the values never leave
 * applicationEnvKeys. Notifies when a required one goes missing.
 */
export async function checkConfigForOrg(
  organizationId: string,
  apps?: DokployApplication[]
): Promise<void> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return;
  const repos = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        isNotNull(repositories.dokployApplicationId)
      )
    );
  for (const repo of repos) {
    if (
      apps &&
      !apps.some((a) => a.applicationId === repo.dokployApplicationId)
    )
      continue;
    const deps = await scannedPackages(repo.id);
    if (!deps.has("payload")) continue;
    const keys = await applicationEnvKeys({
      ...cfg.config,
      applicationId: repo.dokployApplicationId!,
      kind: repo.dokployKind,
    });
    if (!keys) continue;
    const items = evaluateConfig(keys, deps);
    const before = (repo.configCheck as ConfigCheck | null)?.items ?? [];
    const newlyMissing = items.filter(
      (i) =>
        i.required &&
        !i.ok &&
        before.find((b) => b.label === i.label)?.ok !== false
    );
    await db
      .update(repositories)
      .set({
        configCheck: {
          checkedAt: new Date().toISOString(),
          items,
        } satisfies ConfigCheck,
      })
      .where(eq(repositories.id, repo.id));
    if (newlyMissing.length) {
      await notify(organizationId, {
        type: "workflow_failed",
        title: `${repo.name}: ${newlyMissing.map((i) => i.label).join(", ")} not configured`,
        message: newlyMissing
          .map(
            (i) => `${i.names.join(" or ")} is not set in Dokploy — ${i.why}`
          )
          .join("\n"),
        url: repo.liveUrl ?? repo.githubUrl,
      }).catch(() => {});
    }
  }
}
