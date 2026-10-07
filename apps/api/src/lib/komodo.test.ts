import { afterEach, describe, expect, it, vi } from "vitest";
import {
  komodoDeploy,
  komodoOfContainer,
  komodoUpdateState,
  listKomodo,
  type KomodoResource,
} from "./komodo";

const cfg = { baseUrl: "https://komodo.example.com/", key: "k", secret: "s" };

function route(map: Record<string, unknown>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.entries(map).find(([k]) => url.endsWith(k));
    return Promise.resolve(
      hit
        ? new Response(JSON.stringify(hit[1]))
        : new Response("nope", { status: 404 })
    );
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("Komodo", () => {
  it("lists stacks with their repository and deployments with their image", async () => {
    const calls = route({
      "/read/ListStacks": [
        {
          id: "st1",
          name: "shop",
          info: {
            state: "Running",
            server_name: "web-1",
            repo: "acme/shop",
            git_provider: "github.com",
            branch: "main",
          },
        },
        { _id: { $oid: "st2" }, name: "local", info: { repo: "" } },
      ],
      "/read/ListDeployments": [
        {
          id: "d1",
          name: "pg",
          info: { image: "postgres:16", state: "running" },
        },
      ],
    });
    const r = await listKomodo(cfg);
    expect(r.ok && r.data).toEqual([
      {
        id: "st1",
        kind: "stack",
        name: "shop",
        state: "running",
        server: "web-1",
        repoUrl: "https://github.com/acme/shop",
        branch: "main",
        image: null,
      },
      expect.objectContaining({ id: "st2", repoUrl: null }),
      expect.objectContaining({
        id: "d1",
        kind: "deployment",
        image: "postgres:16",
      }),
    ]);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://komodo.example.com/read/ListStacks");
    expect(h["x-api-key"]).toBe("k");
    expect(h["x-api-secret"]).toBe("s");
  });

  it("deploys a stack and follows the update", async () => {
    const calls = route({
      "/execute/DeployStack": { id: "u1", status: "InProgress" },
      "/read/GetUpdate": { status: "Complete", success: false },
    });
    const r = await komodoDeploy(cfg, "stack", "st1");
    expect(r).toEqual({ ok: true, data: { updateId: "u1" } });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ stack: "st1" });
    expect(await komodoUpdateState(cfg, "u1")).toBe("error");
  });

  it("says why a call failed", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("bad", { status: 401 }))
    ) as unknown as typeof fetch;
    expect(await listKomodo(cfg)).toEqual({
      ok: false,
      error: "Komodo refused the API key (HTTP 401)",
    });
  });

  it("finds the stack or deployment of a container", () => {
    const res = [
      { id: "a", kind: "stack", name: "shop" },
      { id: "b", kind: "stack", name: "shop-admin" },
      { id: "c", kind: "deployment", name: "pg" },
    ] as KomodoResource[];
    expect(komodoOfContainer({ app: "shop-admin-web" }, res)?.id).toBe("b");
    expect(komodoOfContainer({ app: "shop-web" }, res)?.id).toBe("a");
    expect(komodoOfContainer({ app: "pg", name: "pg" }, res)?.id).toBe("c");
    expect(komodoOfContainer({ app: "other" }, res)).toBeNull();
  });
});
