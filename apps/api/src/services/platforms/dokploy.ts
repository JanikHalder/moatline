import {
  dashboardUrl,
  listApplications,
  listDeployments,
  redeployService,
  restartService,
  rollbackTo,
  serviceOfContainer,
  triggerDeploy,
  DATABASE_KINDS,
  type DokployKind,
  type DokployService,
} from "../../lib/dokploy";
import { dokployBuildStatus, resolveDokployConfig } from "../deploy";
import { servicesOf } from "../container-redeploy";
import type { AppTarget, ManagedService, Platform } from "./types";

const kindOf = (t: AppTarget): DokployKind =>
  t.kind === "compose" ? "compose" : "application";

const toManaged = (s: DokployService): ManagedService => ({
  platform: "dokploy",
  id: s.applicationId,
  kind: s.kind,
  name: s.name,
  serviceName: s.appName,
  project: s.project,
  environment: s.environment,
  isDatabase: (DATABASE_KINDS as readonly string[]).includes(s.kind),
});

export const dokploy: Platform = {
  id: "dokploy",
  label: "Dokploy",
  configured: async (org) => (await resolveDokployConfig(org)).ok,

  async deploy(org, t, opts) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return cfg;
    const res = await triggerDeploy({
      ...cfg.config,
      applicationId: t.appId,
      kind: kindOf(t),
      title: opts.title,
    });
    return res.ok
      ? { ok: true, ref: null }
      : { ok: false, error: `HTTP ${res.status}: ${res.body}` };
  },

  async deploysPushItself(org, t, branch) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return false;
    const list = await listApplications(cfg.config);
    const app = list.ok
      ? list.apps.find((a) => a.applicationId === t.appId)
      : undefined;
    return !!app?.autoDeploy && (app.branch == null || app.branch === branch);
  },

  async buildStatus(org, t, since) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return null;
    return dokployBuildStatus(cfg.config, t.appId, kindOf(t), since);
  },

  async restart(org, t) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return cfg;
    if (!t.serviceName)
      return { ok: false, error: "no Dokploy service name yet" };
    const r = await restartService({
      ...cfg.config,
      id: t.appId,
      kind: kindOf(t),
      appName: t.serviceName,
    });
    return r.ok
      ? { ok: true }
      : { ok: false, error: r.body || `HTTP ${r.status}` };
  },

  async rollback(org, t) {
    // Dokploy keeps rollback images for applications only, not stacks.
    if (kindOf(t) === "compose") return null;
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return null;
    const deployments = await listDeployments({
      ...cfg.config,
      applicationId: t.appId,
    });
    if (!deployments) return null;
    // Newest is the deploy being undone; take the newest good one before it.
    const previous = deployments
      .slice(1)
      .find((d) => d.rollbackId && (d.status ?? "done") === "done");
    if (!previous?.rollbackId)
      return {
        ok: false,
        detail:
          "Dokploy kept no previous image (enable rollbacks on the application for instant ones).",
      };
    const res = await rollbackTo({
      ...cfg.config,
      rollbackId: previous.rollbackId,
    });
    return res.ok
      ? { ok: true, detail: "Dokploy rolled back to the previous image." }
      : {
          ok: false,
          detail: `Dokploy rollback failed: HTTP ${res.status} ${res.body}`,
        };
  },

  async services(org, fresh) {
    const res = await servicesOf(org, fresh);
    return res.ok ? { ok: true, services: res.services.map(toManaged) } : res;
  },

  serviceOfContainer(container, services) {
    const mine = services.filter((s) => s.platform === "dokploy");
    // Dokploy names containers after the service (appName).
    const hit = serviceOfContainer(
      container,
      mine.map((s) => ({ ...s, appName: s.serviceName }))
    );
    return hit ? mine.find((s) => s.id === hit.id)! : null;
  },

  async dashboardUrl(org, t) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return null;
    const res = await servicesOf(org);
    const app = res.ok
      ? res.services.find((s) => s.applicationId === t.appId)
      : undefined;
    return app ? dashboardUrl(cfg.config.baseUrl, app) : null;
  },

  async redeployService(org, s) {
    const cfg = await resolveDokployConfig(org);
    if (!cfg.ok) return cfg;
    const r = await redeployService({
      ...cfg.config,
      id: s.id,
      kind: s.kind as DokployService["kind"],
    });
    return r.ok
      ? { ok: true }
      : {
          ok: false,
          error: `Dokploy refused the redeploy (HTTP ${r.status}): ${r.body || "no details"}`,
        };
  },
};
