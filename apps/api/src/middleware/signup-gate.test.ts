import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Distinct table markers so the db mock can tell the two queries apart.
const userTable = { __table: "user" };
const invitationTable = { __table: "invitation" };

let userCount = 0;
let pendingInvites: Array<{ id: string }> = [];

vi.mock("db", () => ({
  db: {
    select: () => ({
      from: (table: { __table: string }) => {
        if (table.__table === "user") {
          return Promise.resolve([{ count: userCount }]);
        }
        return {
          where: () => ({ limit: () => Promise.resolve(pendingInvites) }),
        };
      },
    }),
  },
  user: userTable,
  invitation: invitationTable,
}));

const { signupGate } = await import("./signup-gate");

function makeApp() {
  const app = new Hono();
  app.use("/api/auth/*", signupGate);
  app.post("/api/auth/sign-up/email", (c) => c.json({ ok: true }));
  app.post("/api/auth/sign-in/email", (c) => c.json({ ok: true }));
  return app;
}

const signUp = (app: Hono, email: unknown) =>
  app.request("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email === undefined ? {} : { email }),
  });

describe("signupGate", () => {
  beforeEach(() => {
    userCount = 0;
    pendingInvites = [];
  });

  it("allows the very first account so a fresh deployment can be bootstrapped", async () => {
    userCount = 0;
    const res = await signUp(makeApp(), "first@agency.com");
    expect(res.status).toBe(200);
  });

  it("rejects an uninvited address once an account exists", async () => {
    userCount = 1;
    const res = await signUp(makeApp(), "stranger@example.com");
    expect(res.status).toBe(403);
    // Better Auth's client surfaces `message`; without it the user only sees
    // a generic "Sign up failed".
    expect((await res.json()).message).toMatch(/invitation only/i);
  });

  it("allows an address with a pending invitation", async () => {
    userCount = 1;
    pendingInvites = [{ id: "inv-1" }];
    const res = await signUp(makeApp(), "colleague@agency.com");
    expect(res.status).toBe(200);
  });

  it("matches the invited address case-insensitively", async () => {
    userCount = 1;
    pendingInvites = [{ id: "inv-1" }];
    const res = await signUp(makeApp(), "  Colleague@Agency.com ");
    expect(res.status).toBe(200);
  });

  it("rejects a sign-up without an email", async () => {
    userCount = 1;
    const res = await signUp(makeApp(), undefined);
    expect(res.status).toBe(400);
  });

  it("is open to everyone on the cloud", async () => {
    userCount = 5;
    process.env.CLOUD_MODE = "true";
    try {
      const res = await signUp(makeApp(), "stranger@example.com");
      expect(res.status).toBe(200);
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it("leaves every other auth route alone", async () => {
    userCount = 1;
    const res = await makeApp().request(
      "http://localhost/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "stranger@example.com" }),
      }
    );
    expect(res.status).toBe(200);
  });
});
