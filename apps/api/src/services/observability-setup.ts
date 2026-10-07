import crypto from "node:crypto";
import { db, orgIntegrations } from "db";
import { encryptSecret } from "../lib/crypto";
import { dokployPost } from "../lib/dokploy";
import { resolveDokployConfig } from "./deploy";

/**
 * An observability tool for teams that have none: OpenObserve (one light
 * container — SigNoz needs ClickHouse and several services, too heavy for
 * small servers) deployed through Dokploy, with Moatline's event export
 * pointed at it right away.
 */
export const OPENOBSERVE_IMAGE = "openobserve/openobserve:v1.0.4";

export function openobserveCompose(email: string, password: string): string {
  const q = (s: string) => JSON.stringify(s);
  return [
    "services:",
    "  openobserve:",
    `    image: ${OPENOBSERVE_IMAGE}`,
    "    restart: unless-stopped",
    "    environment:",
    `      ZO_ROOT_USER_EMAIL: ${q(email)}`,
    `      ZO_ROOT_USER_PASSWORD: ${q(password)}`,
    "      ZO_DATA_DIR: /data",
    "    volumes:",
    "      - openobserve-data:/data",
    "volumes:",
    "  openobserve-data: {}",
    "",
  ].join("\n");
}

/**
 * OpenObserve wants upper and lower case, a digit and a special character.
 * No "$" (Compose would read it as a variable), no quotes or backslashes.
 */
export function strongPassword(length = 24): string {
  const sets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#%^*-_+=",
  ];
  const all = sets.join("");
  const pick = (chars: string) => chars[crypto.randomInt(chars.length)]!;
  const out = [
    ...sets.map(pick),
    ...Array.from({ length: length - sets.length }, () => pick(all)),
  ];
  // Shuffle, so the guaranteed characters are not always up front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join("");
}

export async function setupOpenObserve(
  organizationId: string,
  input: {
    environment: { id: string; legacy: boolean };
    serverId: string | null;
    domain: string;
    email: string;
  }
): Promise<
  | { ok: true; url: string; email: string; password: string }
  | { ok: false; error: string }
> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return cfg;
  const pw = strongPassword();
  const where = input.environment.legacy
    ? { projectId: input.environment.id }
    : { environmentId: input.environment.id };
  const created = await dokployPost<{ composeId?: string }>(
    cfg.config,
    "compose.create",
    {
      name: "OpenObserve",
      description: "Observability for Moatline's events — set up by Moatline",
      composeType: "docker-compose",
      sourceType: "raw",
      appName: "openobserve",
      serverId: input.serverId,
      composeFile: openobserveCompose(input.email, pw),
      ...where,
    }
  );
  if (!created.ok) return created;
  const composeId = created.data?.composeId;
  if (!composeId)
    return {
      ok: false,
      error: "Dokploy created the service but returned no id.",
    };
  // Some Dokploy versions ignore the file on create: set it explicitly.
  const file = await dokployPost(cfg.config, "compose.update", {
    composeId,
    sourceType: "raw",
    composeFile: openobserveCompose(input.email, pw),
  });
  if (!file.ok) return file;
  const domain = await dokployPost(cfg.config, "domain.create", {
    host: input.domain,
    path: "/",
    port: 5080,
    https: true,
    certificateType: "letsencrypt",
    composeId,
    serviceName: "openobserve",
    domainType: "compose",
  });
  if (!domain.ok) return domain;
  const deploy = await dokployPost(cfg.config, "compose.deploy", {
    composeId,
    title: "Set up by Moatline",
  });
  if (!deploy.ok) return deploy;

  // OpenObserve takes OTLP under /api/<org>; Basic auth with the root user.
  const url = `https://${input.domain}`;
  const auth = Buffer.from(`${input.email}:${pw}`).toString("base64");
  const values = {
    otlpEndpoint: `${url}/api/default`,
    otlpHeaders: encryptSecret(
      `Authorization: Basic ${auth}\nstream-name: moatline`
    ),
  };
  await db
    .insert(orgIntegrations)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: orgIntegrations.organizationId,
      set: values,
    });
  return { ok: true, url, email: input.email, password: pw };
}
