import {
  parsePortainerId,
  portainerOfContainer,
  portainerStackUrl,
  redeployPortainerStack,
  restartPortainerStack,
  type PortainerStack,
} from "../../lib/portainer";
import { portainerStacks, resolvePortainerConfig } from "../stack-platforms";
import type { ManagedService, Platform } from "./types";

const toManaged = (s: PortainerStack): ManagedService => ({
  platform: "portainer",
  id: s.id,
  kind: `portainer-${s.type}`,
  name: s.name,
  serviceName: s.name,
  project: "Portainer",
  environment: `environment ${s.endpointId}`,
  isDatabase: false,
});

async function stackOf(org: string, id: string) {
  const res = await portainerStacks(org);
  return res.ok ? (res.list.find((s) => s.id === id) ?? null) : null;
}

export const portainer: Platform = {
  id: "portainer",
  label: "Portainer",
  configured: async (org) => (await resolvePortainerConfig(org)).ok,

  async deploy(org, t) {
    const cfg = await resolvePortainerConfig(org);
    if (!cfg.ok) return cfg;
    // Portainer answers when the redeploy is done: nothing left to follow.
    const r = await redeployPortainerStack(cfg.config, t.appId);
    return r.ok ? { ok: true, ref: "done" } : r;
  },

  // GitOps updates (polling or webhook) pull a push by themselves.
  async deploysPushItself(org, t) {
    return (await stackOf(org, t.appId))?.autoUpdate ?? false;
  },

  async buildStatus(_org, _t, _since, ref) {
    return ref === "done" ? "done" : null;
  },

  async restart(org, t) {
    const cfg = await resolvePortainerConfig(org);
    if (!cfg.ok) return cfg;
    const s = await stackOf(org, t.appId);
    if (!s) return { ok: false, error: "Portainer stack not found." };
    const r = await restartPortainerStack(cfg.config, s);
    return r.ok ? { ok: true } : r;
  },

  // Portainer keeps no previous deploy: the guard reverts in git.
  rollback: async () => null,

  async services(org, fresh) {
    const res = await portainerStacks(org, fresh);
    return res.ok ? { ok: true, services: res.list.map(toManaged) } : res;
  },

  serviceOfContainer(container, services) {
    const mine = services.filter((s) => s.platform === "portainer");
    const hit = portainerOfContainer(
      container,
      mine.map((s) => ({ id: s.id, name: s.serviceName }))
    );
    return hit ? mine.find((s) => s.id === hit.id)! : null;
  },

  async dashboardUrl(org, t) {
    const cfg = await resolvePortainerConfig(org);
    if (!cfg.ok) return null;
    const s = await stackOf(org, t.appId);
    const ids = parsePortainerId(t.appId);
    if (!s || !ids) return null;
    return portainerStackUrl(cfg.config.baseUrl, s);
  },

  async redeployService(org, s) {
    const cfg = await resolvePortainerConfig(org);
    if (!cfg.ok) return cfg;
    const stack = await stackOf(org, s.id);
    if (!stack) return { ok: false, error: "Portainer stack not found." };
    // A stack from Git is redeployed from it; any other one restarted.
    const r = stack.repoUrl
      ? await redeployPortainerStack(cfg.config, s.id)
      : await restartPortainerStack(cfg.config, stack);
    return r.ok ? { ok: true } : r;
  },
};
