import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("../auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("db", () => {
  const rows = Promise.resolve([{ role: "owner" }]);
  return {
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => rows }) }),
      }),
    },
    member: {},
    organization: {},
  };
});

import { requireOrgAdmin, type TenantVariables } from "./tenant";

function appAs(user: { id: string; twoFactorEnabled?: boolean }) {
  return new Hono<{ Variables: TenantVariables }>()
    .use("*", async (c, next) => {
      c.set("user", user as never);
      c.set("session", { id: "s" } as never);
      c.set("organizationId", "org1");
      await next();
    })
    .post("/admin", async (c) => {
      const orgId = await requireOrgAdmin(c);
      if (orgId instanceof Response) return orgId;
      return c.json({ ok: true });
    });
}

afterEach(() => {
  delete process.env.REQUIRE_ADMIN_2FA;
});

describe("requireOrgAdmin", () => {
  it("refuses an owner without two-factor authentication", async () => {
    const res = await appAs({ id: "u1" }).request("/admin", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
  });

  it("lets an owner with two-factor authentication through", async () => {
    const res = await appAs({ id: "u1", twoFactorEnabled: true }).request(
      "/admin",
      { method: "POST" }
    );
    expect(res.status).toBe(200);
  });

  it("can be switched off for a local instance", async () => {
    process.env.REQUIRE_ADMIN_2FA = "false";
    const res = await appAs({ id: "u1" }).request("/admin", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
