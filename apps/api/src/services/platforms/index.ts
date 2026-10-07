import { coolify } from "./coolify";
import { dokploy } from "./dokploy";
import { komodo } from "./komodo";
import { portainer } from "./portainer";
import type {
  AppTarget,
  ManagedService,
  Platform,
  PlatformId,
  ReportedContainer,
} from "./types";

export type * from "./types";

/**
 * Every supported platform, in the order a container is matched. A function,
 * not a constant: the platform modules import services that import this one,
 * and a module-level array would read them before they are defined.
 */
export function platforms(): Platform[] {
  return [dokploy, coolify, komodo, portainer];
}

export function platform(id: PlatformId): Platform {
  return platforms().find((p) => p.id === id)!;
}

type RepoLinks = {
  dokployApplicationId: string | null;
  dokployKind: "application" | "compose" | null;
  dokployAppName: string | null;
  coolifyAppUuid: string | null;
  platformKind?: string | null;
  platformAppId?: string | null;
};

/**
 * Where a repository deploys to. Each platform keeps its link in its own
 * columns; this is the one place that reads them. Dokploy wins, then
 * Coolify, then Komodo or Portainer.
 */
export function repoTarget(repo: RepoLinks): AppTarget | null {
  if (repo.dokployApplicationId)
    return {
      platform: "dokploy",
      appId: repo.dokployApplicationId,
      kind: repo.dokployKind ?? "application",
      serviceName: repo.dokployAppName,
    };
  if (repo.coolifyAppUuid)
    return {
      platform: "coolify",
      appId: repo.coolifyAppUuid,
      kind: "application",
      serviceName: repo.coolifyAppUuid,
    };
  if (
    (repo.platformKind === "komodo" || repo.platformKind === "portainer") &&
    repo.platformAppId
  )
    return {
      platform: repo.platformKind,
      appId: repo.platformAppId,
      // Only stacks are linked: they are what deploys from a repository.
      kind: "stack",
      serviceName: null,
    };
  return null;
}

/** Whether the repository has a platform to deploy to. */
export const hasDeployTarget = (repo: RepoLinks) => repoTarget(repo) !== null;

/**
 * The services of every connected platform. `failed` lists connected
 * platforms that did not answer — their apps are unknown right now, not
 * gone; `error` is set when no platform is connected or none answered.
 */
export async function allServices(
  organizationId: string,
  fresh = false
): Promise<{
  services: ManagedService[];
  failed: PlatformId[];
  error: string | null;
}> {
  const results = await Promise.all(
    platforms().map(async (p) => {
      if (!(await p.configured(organizationId))) return null;
      return { id: p.id, res: await p.services(organizationId, fresh) };
    })
  );
  const connected = results.filter((r) => r !== null);
  const services = connected.flatMap((r) => (r.res.ok ? r.res.services : []));
  const failed = connected.filter((r) => !r.res.ok);
  const firstError = failed[0]?.res;
  return {
    services,
    failed: failed.map((r) => r.id),
    error: !connected.length
      ? "No platform (Dokploy, Coolify, Komodo or Portainer) is connected."
      : failed.length === connected.length && firstError && !firstError.ok
        ? firstError.error
        : null,
  };
}

/** The platform service a container belongs to, on whichever platform. */
export function serviceOfContainer(
  container: ReportedContainer,
  services: ManagedService[]
): ManagedService | null {
  for (const p of platforms()) {
    const hit = p.serviceOfContainer(container, services);
    if (hit) return hit;
  }
  return null;
}
