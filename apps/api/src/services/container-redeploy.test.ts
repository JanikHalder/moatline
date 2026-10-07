import { describe, expect, it } from "vitest";
import { dokployNodeByHost } from "./container-redeploy";

const dokploy = [
  { serverId: "srv_a", name: "web-02", ipAddress: "49.12.1.2" },
  { serverId: "srv_b", name: "edge", ipAddress: "100.64.0.9" },
];

describe("dokployNodeByHost", () => {
  it("knows the Dokploy host by Dokploy's own container", () => {
    expect(
      dokployNodeByHost(
        { lastReport: { containers: [{ name: "dokploy.1.abcdef1234" }] } },
        dokploy
      )
    ).toBeNull();
  });
  it("matches a remote server by its address, public or on the tailnet", () => {
    expect(
      dokployNodeByHost({ lastReport: {}, address: "49.12.1.2" }, dokploy)
    ).toBe("srv_a");
    expect(
      dokployNodeByHost(
        { lastReport: { tailscale: { ips: ["100.64.0.9"] } } },
        dokploy
      )
    ).toBe("srv_b");
  });
  it("falls back to the hostname, and gives up without a match", () => {
    expect(
      dokployNodeByHost(
        { lastReport: { host: { hostname: "Web-02" } } },
        dokploy
      )
    ).toBe("srv_a");
    expect(
      dokployNodeByHost({ lastReport: { host: { hostname: "x" } } }, dokploy)
    ).toBeUndefined();
  });
});
