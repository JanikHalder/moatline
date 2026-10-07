import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, servers: {} }));
vi.mock("../lib/server-findings", () => ({ syncAndNotify: vi.fn() }));
vi.mock("./platforms", async () => {
  // The real matching, without the platform modules' database imports.
  const { serviceOfContainer } = await import("../lib/dokploy");
  const { resourceOfContainer } = await import("../lib/coolify");
  return {
    allServices: vi.fn(),
    platform: vi.fn(),
    serviceOfContainer: (
      c: { app?: string | null; name?: string | null },
      list: Array<{ platform: string; serviceName: string }>
    ) =>
      serviceOfContainer(
        c,
        list
          .filter((s) => s.platform === "dokploy")
          .map((s) => ({ ...s, appName: s.serviceName }))
      ) ??
      resourceOfContainer(
        c,
        list
          .filter((s) => s.platform === "coolify")
          .map((s) => ({ ...s, uuid: s.serviceName }))
      ),
  };
});

import { unmanagedFindings } from "./unmanaged";
import type { ManagedService } from "./platforms";

const svc = (
  platform: "dokploy" | "coolify",
  serviceName: string
): ManagedService => ({
  platform,
  id: serviceName,
  kind: "application",
  name: serviceName,
  serviceName,
  project: "P",
  environment: null,
  isDatabase: false,
});

const containers = [
  { app: "shop-x1", name: "shop-x1.1.abc" },
  { app: "dokploy", name: "dokploy.1.abc" },
  { app: "dokploy-traefik", name: "dokploy-traefik" },
  {
    app: "mail-ow8ook8skccoocckkcscoock",
    name: "mail-ow8ook8skccoocckkcscoock",
  },
  { app: "coolify-proxy", name: "coolify-proxy" },
  { app: "adminer", name: "adminer" },
];

describe("unmanagedFindings", () => {
  it("lists what no platform runs, and an unconnected Coolify", () => {
    const f = unmanagedFindings(containers, [svc("dokploy", "shop-x1")], false);
    expect(f.map((x) => x.fingerprint)).toEqual([
      "coolify-running",
      "unmanaged|mail-ow8ook8skccoocckkcscoock",
      "unmanaged|adminer",
    ]);
    expect(f[1]!.title).toContain("(Coolify)");
  });

  it("counts a connected Coolify's containers as managed", () => {
    const f = unmanagedFindings(
      containers,
      [svc("dokploy", "shop-x1"), svc("coolify", "ow8ook8skccoocckkcscoock")],
      true
    );
    expect(f.map((x) => x.fingerprint)).toEqual(["unmanaged|adminer"]);
  });

  it("stays quiet on servers no platform deploys to", () => {
    expect(
      unmanagedFindings([{ app: "adminer", name: "adminer" }], [], true)
    ).toEqual([]);
  });
});
