import { describe, expect, it, vi } from "vitest";

const { state, fake } = vi.hoisted(() => {
  const state = {
    dokploy: { configured: true, ok: true },
    coolify: { configured: false, ok: true },
    komodo: { configured: false, ok: true },
    portainer: { configured: false, ok: true },
  };
  const fake = (id: keyof typeof state) => ({
    id,
    label: id,
    configured: async () => state[id].configured,
    services: async () =>
      state[id].ok
        ? {
            ok: true,
            services: [{ platform: id, id: `${id}-1`, serviceName: `${id}-1` }],
          }
        : { ok: false, error: `${id} down` },
    serviceOfContainer: () => null,
  });
  return { state, fake };
});
vi.mock("./dokploy", () => ({ dokploy: fake("dokploy") }));
vi.mock("./coolify", () => ({ coolify: fake("coolify") }));
vi.mock("./komodo", () => ({ komodo: fake("komodo") }));
vi.mock("./portainer", () => ({ portainer: fake("portainer") }));

import { allServices, repoTarget } from "./index";

const links = {
  dokployApplicationId: null,
  dokployKind: null,
  dokployAppName: null,
  coolifyAppUuid: null,
};

describe("repoTarget", () => {
  it("reads each platform's link, Dokploy first", () => {
    expect(repoTarget(links)).toBeNull();
    expect(repoTarget({ ...links, coolifyAppUuid: "u1" })).toMatchObject({
      platform: "coolify",
      appId: "u1",
    });
    expect(
      repoTarget({
        ...links,
        dokployApplicationId: "a1",
        dokployKind: "compose",
        dokployAppName: "shop-x1",
        coolifyAppUuid: "u1",
      })
    ).toEqual({
      platform: "dokploy",
      appId: "a1",
      kind: "compose",
      serviceName: "shop-x1",
    });
  });

  it("reads a Komodo or Portainer stack after Dokploy and Coolify", () => {
    expect(
      repoTarget({ ...links, platformKind: "portainer", platformAppId: "2:5" })
    ).toEqual({
      platform: "portainer",
      appId: "2:5",
      kind: "stack",
      serviceName: null,
    });
    expect(
      repoTarget({
        ...links,
        coolifyAppUuid: "u1",
        platformKind: "komodo",
        platformAppId: "s1",
      })?.platform
    ).toBe("coolify");
    expect(
      repoTarget({ ...links, platformKind: "nope", platformAppId: "x" })
    ).toBeNull();
  });
});

describe("allServices", () => {
  it("skips platforms that are not connected", async () => {
    state.dokploy = { configured: true, ok: true };
    state.coolify = { configured: false, ok: true };
    const r = await allServices("org");
    expect(r.services.map((s) => s.id)).toEqual(["dokploy-1"]);
    expect(r).toMatchObject({ failed: [], error: null });
  });

  it("names connected platforms that did not answer", async () => {
    state.dokploy = { configured: true, ok: false };
    state.coolify = { configured: true, ok: true };
    const r = await allServices("org");
    expect(r.failed).toEqual(["dokploy"]);
    expect(r.error).toBeNull();
  });

  it("errs when nothing is connected or nothing answers", async () => {
    state.dokploy = { configured: false, ok: true };
    state.coolify = { configured: false, ok: true };
    expect((await allServices("org")).error).toMatch(/No platform/);
    state.dokploy = { configured: true, ok: false };
    expect((await allServices("org")).error).toBe("dokploy down");
  });
});
