/**
 * What Moatline needs from a deployment platform (Dokploy, Coolify,
 * …). Everything above this — deploy guard, self-healing, redeploy
 * buttons, risk checks — talks to platforms only through this interface;
 * supporting another platform means implementing it once.
 */

export type PlatformId = "dokploy" | "coolify" | "komodo" | "portainer";

/** The application a repository deploys to, on its platform. */
export type AppTarget = {
  platform: PlatformId;
  /** The platform's id for the application. */
  appId: string;
  /** Platform-specific kind ("application", "compose" …). */
  kind: string;
  /** The running service's name, when the platform needs it (Dokploy). */
  serviceName: string | null;
};

export type BuildState = "running" | "done" | "error" | null;

export type Done = { ok: true } | { ok: false; error: string };

/** A service the platform runs: an app, a stack or a database. */
export type ManagedService = {
  platform: PlatformId;
  id: string;
  /** Shown to people and sent back to the platform. */
  kind: string;
  name: string;
  /** What its containers are named after (Dokploy appName, Coolify uuid). */
  serviceName: string;
  project: string;
  environment: string | null;
  isDatabase: boolean;
};

export type ReportedContainer = { app?: string | null; name?: string | null };

export interface Platform {
  id: PlatformId;
  label: string;
  /** Connected for this organization (credentials stored). */
  configured(organizationId: string): Promise<boolean>;

  /** Start a deployment; `ref` follows its status when the platform has one. */
  deploy(
    organizationId: string,
    target: AppTarget,
    opts: { title?: string }
  ): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }>;
  /** Whether the platform deploys a push to `branch` by itself (webhook). */
  deploysPushItself(
    organizationId: string,
    target: AppTarget,
    branch: string
  ): Promise<boolean>;
  /** State of the deployment started at `since` (or by `ref`). */
  buildStatus(
    organizationId: string,
    target: AppTarget,
    since: Date,
    ref: string | null
  ): Promise<BuildState>;
  /** Restart the application without rebuilding it. */
  restart(organizationId: string, target: AppTarget): Promise<Done>;
  /**
   * Put the previous build back, when the platform keeps one. null: this
   * platform (or this application) has no rollback — revert in git instead.
   */
  rollback(
    organizationId: string,
    target: AppTarget
  ): Promise<{ ok: boolean; detail: string } | null>;

  /** Every service the platform runs, databases included. */
  services(
    organizationId: string,
    fresh?: boolean
  ): Promise<
    { ok: true; services: ManagedService[] } | { ok: false; error: string }
  >;
  /** The service a container reported by an agent belongs to. */
  serviceOfContainer(
    container: ReportedContainer,
    services: ManagedService[]
  ): ManagedService | null;
  /** The application's page in the platform's web interface. */
  dashboardUrl(
    organizationId: string,
    target: AppTarget
  ): Promise<string | null>;
  /** The redeploy button: Dokploy redeploys, Coolify restarts. */
  redeployService(
    organizationId: string,
    service: ManagedService
  ): Promise<Done>;
}
