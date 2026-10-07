import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const orgIntegrationsTable = { organizationId: "organization_id" };
let storedToken: string | null = null;
let shouldThrow = false;

vi.mock("db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (shouldThrow) return Promise.reject(new Error("db is down"));
            return Promise.resolve(
              storedToken === null ? [] : [{ githubToken: storedToken }]
            );
          },
        }),
      }),
    }),
  },
  orgIntegrations: orgIntegrationsTable,
}));

vi.mock("./crypto", () => ({
  isEncrypted: (v: string) => v.startsWith("enc:"),
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

const { getGithubToken } = await import("./github-token");

describe("getGithubToken", () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    storedToken = null;
    shouldThrow = false;
    delete process.env.GITHUB_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalEnv;
    vi.restoreAllMocks();
  });

  it("prefers the organization's own token over the server-wide one", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    storedToken = "enc:org-token";
    expect(await getGithubToken("org-1")).toBe("org-token");
  });

  it("falls back to GITHUB_TOKEN when the organization has none", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    storedToken = null;
    expect(await getGithubToken("org-1")).toBe("server-token");
  });

  it("returns null when neither is configured", async () => {
    expect(await getGithubToken("org-1")).toBeNull();
  });

  it("accepts a token that was stored unencrypted", async () => {
    storedToken = "plain-token";
    expect(await getGithubToken("org-1")).toBe("plain-token");
  });

  it("uses the server-wide token when there is no organization context", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    expect(await getGithubToken(null)).toBe("server-token");
  });

  it("ignores a blank GITHUB_TOKEN instead of sending an empty bearer", async () => {
    process.env.GITHUB_TOKEN = "   ";
    expect(await getGithubToken(null)).toBeNull();
  });

  it("falls back rather than failing the scan when the lookup errors", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    shouldThrow = true;
    expect(await getGithubToken("org-1")).toBe("server-token");
  });
});
