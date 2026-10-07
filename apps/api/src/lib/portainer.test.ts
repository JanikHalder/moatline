import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listPortainerStacks,
  portainerOfContainer,
  redeployPortainerStack,
  restartPortainerStack,
} from "./portainer";

const cfg = { baseUrl: "https://portainer.example.com", token: "ptr_x" };

function route(map: Record<string, unknown>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    return Promise.resolve(
      hit
        ? new Response(JSON.stringify(hit[1]))
        : new Response("{}", { status: 404 })
    );
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => vi.restoreAllMocks());

const STACK = {
  Id: 5,
  Name: "shop",
  EndpointId: 2,
  Type: 2,
  Status: 1,
  GitConfig: {
    URL: "https://github.com/acme/shop.git",
    ReferenceName: "refs/heads/main",
  },
  AutoUpdate: { Interval: "5m" },
  Env: [{ name: "A", value: "1" }],
};

describe("Portainer", () => {
  it("lists stacks with repository, branch and GitOps updates", async () => {
    const calls = route({
      "/api/stacks": [STACK, { Id: 6, Name: "x", EndpointId: 2, Type: 1 }],
    });
    const r = await listPortainerStacks(cfg);
    expect(r.ok && r.data[0]).toEqual({
      id: "2:5",
      stackId: 5,
      endpointId: 2,
      name: "shop",
      type: "compose",
      active: true,
      repoUrl: "https://github.com/acme/shop.git",
      branch: "main",
      autoUpdate: true,
    });
    expect(r.ok && r.data[1]).toMatchObject({
      type: "swarm",
      repoUrl: null,
      autoUpdate: false,
    });
    expect(
      (calls[0]!.init.headers as Record<string, string>)["x-api-key"]
    ).toBe("ptr_x");
  });

  it("redeploys from Git and keeps the environment variables", async () => {
    const calls = route({
      "/git/redeploy": { Id: 5 },
      "/api/stacks/5": STACK,
    });
    expect(await redeployPortainerStack(cfg, "2:5")).toEqual({
      ok: true,
      data: null,
    });
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(put.url).toBe(
      "https://portainer.example.com/api/stacks/5/git/redeploy?endpointId=2"
    );
    expect(JSON.parse(put.init.body as string)).toMatchObject({
      Env: STACK.Env,
      Prune: false,
    });
  });

  it("refuses to redeploy a stack that is not from Git", async () => {
    route({ "/api/stacks/5": { ...STACK, GitConfig: null } });
    const r = await redeployPortainerStack(cfg, "2:5");
    expect(r.ok).toBe(false);
  });

  it("restarts every container of a compose stack", async () => {
    const calls = route({
      "/containers/json": [{ Id: "c1" }, { Id: "c2" }],
      "/restart": {},
    });
    const r = await restartPortainerStack(cfg, {
      endpointId: 2,
      name: "Shop",
      type: "compose",
    });
    expect(r.ok).toBe(true);
    expect(decodeURIComponent(calls[0]!.url)).toContain(
      "com.docker.compose.project=shop"
    );
    expect(calls.filter((c) => c.url.endsWith("/restart"))).toHaveLength(2);
  });

  it("finds the stack of a container", () => {
    const stacks = [{ name: "shop" }, { name: "shop-api" }];
    expect(portainerOfContainer({ app: "shop-api-web" }, stacks)?.name).toBe(
      "shop-api"
    );
    expect(portainerOfContainer({ app: "shop_web" }, stacks)?.name).toBe(
      "shop"
    );
    expect(portainerOfContainer({ app: "blog-web" }, stacks)).toBeNull();
  });
});
