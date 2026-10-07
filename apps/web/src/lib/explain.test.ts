import { describe, expect, it } from "vitest";
import type { ServerFinding } from "./api";
import { appName, explainFinding } from "./explain";

const finding = (f: Partial<ServerFinding>): ServerFinding => ({
  id: "f1",
  serverId: "s1",
  repositoryId: null,
  source: "host",
  fingerprint: "x",
  severity: "medium",
  title: "Something",
  detail: null,
  target: null,
  reference: null,
  fixAvailable: null,
  autoFixAt: null,
  firstSeenAt: "2026-10-01T00:00:00Z",
  lastSeenAt: "2026-10-01T00:00:00Z",
  resolvedAt: null,
  ...f,
});

describe("explainFinding", () => {
  it("names the app, not the Swarm task, and offers a redeploy", () => {
    const e = explainFinding(
      finding({
        fingerprint: "container:restarting:mongo-db-z3.1.abcdef123",
        title: "Container mongo-db-z3.1.abcdef123 keeps restarting",
      })
    );
    expect(e.title).toBe("mongo-db-z3 keeps crashing and restarting");
    expect(e.fix).toEqual({ kind: "redeploy", app: "mongo-db-z3" });
    expect(e.action).toBeTruthy();
  });

  it("says when the server fixes it by itself", () => {
    const e = explainFinding(
      finding({
        fingerprint: "updates:security",
        title: "7 security updates pending",
        autoFixAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      })
    );
    expect(e.selfResolving).toBe(true);
    expect(e.title).toContain("7");
  });

  it("asks for action when nothing installs security updates", () => {
    const e = explainFinding(
      finding({
        fingerprint: "updates:security",
        title: "7 security updates pending",
      })
    );
    expect(e.selfResolving).toBe(false);
    expect(e.fix).toEqual({ kind: "tab", tab: "agent" });
  });

  it("explains an image CVE with the package and the app to redeploy", () => {
    const e = explainFinding(
      finding({
        source: "trivy",
        severity: "critical",
        fingerprint: "image|nginx:1.25|openssl|CVE-2024-1",
        title: "CVE-2024-1 in openssl 3.0.1",
        target: "nginx:1.25 (web.1.abcdef123)",
        fixAvailable: true,
      })
    );
    expect(e.title).toBe("Known security hole in openssl, inside nginx:1.25");
    expect(e.fix).toEqual({ kind: "redeploy", app: "web" });
  });

  it("reads the database name out of platform findings", () => {
    const e = explainFinding(
      finding({
        source: "dokploy",
        fingerprint: "db-no-backup|abc",
        title: "No backup for database shop-db",
        target: "shop-db-x1y2",
      })
    );
    expect(e.title).toBe("The database shop-db has no backup");
    expect(e.action).toContain("Dokploy");
  });

  it("keeps the port's service for published ports", () => {
    const e = explainFinding(
      finding({
        source: "security",
        fingerprint: "docker:published:5432",
        title: "Port 5432 (PostgreSQL) is reachable from the internet",
      })
    );
    expect(e.title).toBe("Port 5432 (PostgreSQL) is open to the internet");
  });

  it("falls back to the API's title for kinds it does not know", () => {
    const e = explainFinding(
      finding({ source: "nuclei", fingerprint: "t|m|x", title: "Exposed .git" })
    );
    expect(e).toMatchObject({
      title: "Exposed .git",
      meaning: null,
      action: null,
    });
  });
});

describe("appName", () => {
  it("drops only a Swarm task suffix", () => {
    expect(appName("shop-x1.1.k3j4h5g6f7")).toBe("shop-x1");
    expect(appName("mail-ow8ook8skccoocckkcscoock")).toBe(
      "mail-ow8ook8skccoocckkcscoock"
    );
  });
});
