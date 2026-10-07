import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const emptyPromise = Promise.resolve([]);
const oneRow = (row: object) => Promise.resolve([row]);

const getSessionMock = vi.fn().mockResolvedValue(null);
vi.mock("./auth", () => ({
  auth: {
    api: { getSession: getSessionMock },
    handler: vi.fn((_req: Request) => new Response()),
  },
}));

vi.mock("db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(emptyPromise, { limit: () => emptyPromise }),
        orderBy: () => ({ limit: () => emptyPromise }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => oneRow({ id: "test-id" }) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  repositories: {},
  scans: {},
  packageFindings: {},
  updateRuns: {},
  organization: {},
}));

describe("API", () => {
  beforeAll(async () => {
    const { app } = await import("./app");
    (global as unknown as { __app?: typeof app }).__app = app;
  });

  it("GET /api/health reports ok plus the build it is running", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // commit is null when neither an env var nor a git checkout is available;
    // the field itself must always be there, since that is what deploy checks
    // read.
    expect(data).toHaveProperty("commit");
    expect(data).toHaveProperty("startedAt");
    expect(typeof data.scheduler).toBe("boolean");
  });

  it("GET /api/repos without session returns 403", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("POST /api/repos without session returns 403", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.com/owner/repo" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/repos with session returns 200 and empty list", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "u@test.com",
        name: "User",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "s1",
        userId: "u1",
        token: "t",
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: "org1",
      },
    } as never);
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toEqual([]);
  });

  afterEach(() => {
    getSessionMock.mockResolvedValue(null);
  });
});

describe("agent bootstrap", () => {
  it("serves an install script that verifies the agent's checksum", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/agent/install.sh");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/SHA256="[0-9a-f]{64}"/);
    expect(body).toContain("sha256sum -c -");
    expect(body).toContain('install --url "$BASE" "$@"');
  });

  it("rejects malformed install codes without touching the database", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/agent/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "pce_nope" }),
    });
    expect(res.status).toBe(401);
  });
});
