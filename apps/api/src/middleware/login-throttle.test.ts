import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { loginThrottle, resetLoginThrottle } from "./login-throttle";

const app = new Hono()
  .use("*", loginThrottle)
  .post("/api/auth/sign-in/email", (c) => c.text("ok"))
  .post("/api/auth/sign-up/email", (c) => c.text("ok"));
const attempt = (email: string, ip: string) =>
  app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password: "x" }),
  });

beforeEach(() => resetLoginThrottle());

describe("loginThrottle", () => {
  it("limits guesses per account even from rotating addresses", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await attempt("Admin@Example.com", `10.0.0.${i}`)).status).toBe(
        200
      );
    }
    const blocked = await attempt("admin@example.com", "10.0.0.99");
    expect(blocked.status).toBe(429);
    // Other accounts are unaffected.
    expect((await attempt("other@example.com", "10.0.0.99")).status).toBe(200);
  });

  it("limits sign-ups from one network, whatever the address", async () => {
    const signUp = (email: string) =>
      app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "x" }),
      });
    for (let i = 0; i < 5; i++)
      expect((await signUp(`user${i}@example.com`)).status).toBe(200);
    const blocked = await signUp("user99@example.com");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).message).toMatch(/sign-ups/);
  });
});
