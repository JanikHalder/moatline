import {
  autoDeploys,
  coolifyDashboardUrl,
  environmentPaths,
  deployApplication,
  deploymentStatus,
  resourceOfContainer,
  restartResource,
  type CoolifyKind,
  type CoolifyResource,
} from "../../lib/coolify";
import { coolifyResources, resolveCoolifyConfig } from "../coolify";
import type { ManagedService, Platform } from "./types";

const toManaged = (r: CoolifyResource): ManagedService => ({
  platform: "coolify",
  id: r.uuid,
  kind: `coolify-${r.kind}`,
  name: r.name,
  serviceName: r.uuid,
  project: "Coolify",
  environment: null,
  isDatabase: r.kind === "database",
});

const coolifyKind = (kind: string): CoolifyKind =>
  kind === "coolify-database"
    ? "database"
    : kind === "coolify-service"
      ? "service"
      : "application";

export const coolify: Platform = {
  id: "coolify",
  label: "Coolify",
  configured: async (org) => (await resolveCoolifyConfig(org)).ok,

  async deploy(org, t) {
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return cfg;
    const r = await deployApplication(cfg.config, t.appId);
    return r.ok ? { ok: true, ref: r.data.deploymentUuid } : r;
  },

  async deploysPushItself(org, t) {
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return false;
    return autoDeploys(cfg.config, t.appId).catch(() => false);
  },

  async buildStatus(org, _t, _since, ref) {
    // Webhook deploys have no id to follow; then only the live URL tells.
    if (!ref) return null;
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return null;
    return deploymentStatus(cfg.config, ref);
  },

  async restart(org, t) {
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return cfg;
    const r = await restartResource(cfg.config, "application", t.appId);
    return r.ok ? { ok: true } : r;
  },

  // Coolify's API has no rollback: the deploy guard reverts in git.
  rollback: async () => null,

  async services(org, fresh) {
    const res = await coolifyResources(org, fresh);
    return res.ok ? { ok: true, services: res.resources.map(toManaged) } : res;
  },

  serviceOfContainer(container, services) {
    const mine = services.filter((s) => s.platform === "coolify");
    const hit = resourceOfContainer(
      container,
      mine.map((s) => ({ ...s, uuid: s.serviceName }))
    );
    return hit ? mine.find((s) => s.id === hit.id)! : null;
  },

  async dashboardUrl(org, t) {
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return null;
    const res = await coolifyResources(org);
    const app = res.ok
      ? res.resources.find((r) => r.uuid === t.appId)
      : undefined;
    if (!app?.environmentId) return null;
    const paths = await environmentPaths(cfg.config);
    return coolifyDashboardUrl(
      cfg.config.baseUrl,
      app,
      paths.get(app.environmentId)
    );
  },

  async redeployService(org, s) {
    const cfg = await resolveCoolifyConfig(org);
    if (!cfg.ok) return cfg;
    const r = await restartResource(cfg.config, coolifyKind(s.kind), s.id);
    return r.ok ? { ok: true } : r;
  },
};
