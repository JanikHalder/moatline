import {
  DATABASE_IMAGE,
  komodoDeploy,
  komodoOfContainer,
  komodoRestart,
  komodoUpdateState,
  type KomodoResource,
} from "../../lib/komodo";
import { komodoResources, resolveKomodoConfig } from "../stack-platforms";
import type { ManagedService, Platform } from "./types";

const toManaged = (r: KomodoResource): ManagedService => ({
  platform: "komodo",
  id: r.id,
  kind: `komodo-${r.kind}`,
  name: r.name,
  serviceName: r.name,
  project: "Komodo",
  environment: r.server,
  isDatabase: r.kind === "deployment" && DATABASE_IMAGE.test(r.image ?? ""),
});

const kindOf = (k: string): "stack" | "deployment" =>
  k === "deployment" || k === "komodo-deployment" ? "deployment" : "stack";

export const komodo: Platform = {
  id: "komodo",
  label: "Komodo",
  configured: async (org) => (await resolveKomodoConfig(org)).ok,

  async deploy(org, t) {
    const cfg = await resolveKomodoConfig(org);
    if (!cfg.ok) return cfg;
    const r = await komodoDeploy(cfg.config, kindOf(t.kind), t.appId);
    return r.ok ? { ok: true, ref: r.data.updateId } : r;
  },

  // A Komodo stack redeploys on a push only through a webhook set up on the
  // Git host, which the API does not show: Moatline deploys itself.
  deploysPushItself: async () => false,

  async buildStatus(org, _t, _since, ref) {
    if (!ref) return null;
    const cfg = await resolveKomodoConfig(org);
    if (!cfg.ok) return null;
    return komodoUpdateState(cfg.config, ref);
  },

  async restart(org, t) {
    const cfg = await resolveKomodoConfig(org);
    if (!cfg.ok) return cfg;
    const r = await komodoRestart(cfg.config, kindOf(t.kind), t.appId);
    return r.ok ? { ok: true } : r;
  },

  // Komodo keeps no previous build to go back to: the guard reverts in git.
  rollback: async () => null,

  async services(org, fresh) {
    const res = await komodoResources(org, fresh);
    return res.ok ? { ok: true, services: res.list.map(toManaged) } : res;
  },

  serviceOfContainer(container, services) {
    const mine = services.filter((s) => s.platform === "komodo");
    const hit = komodoOfContainer(
      container,
      mine.map((s) => ({
        id: s.id,
        kind: kindOf(s.kind),
        name: s.serviceName,
        state: null,
        server: null,
        repoUrl: null,
        branch: null,
        image: null,
      }))
    );
    return hit ? mine.find((s) => s.id === hit.id)! : null;
  },

  async dashboardUrl(org, t) {
    const cfg = await resolveKomodoConfig(org);
    if (!cfg.ok) return null;
    const base = cfg.config.baseUrl.replace(/\/+$/, "");
    return `${base}/${kindOf(t.kind) === "stack" ? "stacks" : "deployments"}/${encodeURIComponent(t.appId)}`;
  },

  async redeployService(org, s) {
    const cfg = await resolveKomodoConfig(org);
    if (!cfg.ok) return cfg;
    const r = await komodoDeploy(cfg.config, kindOf(s.kind), s.id);
    return r.ok ? { ok: true } : r;
  },
};
