import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { clientIp, isCloudflare, isPublicIp } from "./client-ip";

const app = new Hono().get("/", (c) => c.text(clientIp(c)));
const ip = async (headers: Record<string, string>) => {
  const res = await app.request("/", { headers });
  return res.text();
};

describe("clientIp", () => {
  it("ignores what the client prepends to X-Forwarded-For", async () => {
    expect(await ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })).toBe(
      "203.0.113.9"
    );
  });

  it("trusts CF-Connecting-IP only when the request came from Cloudflare", async () => {
    expect(
      await ip({
        "x-forwarded-for": "172.70.1.1", // a Cloudflare edge
        "cf-connecting-ip": "203.0.113.9",
      })
    ).toBe("203.0.113.9");
    // Straight to the origin, past Cloudflare: the header is a lie.
    expect(
      await ip({
        "x-forwarded-for": "198.51.100.7",
        "cf-connecting-ip": "1.2.3.4",
      })
    ).toBe("198.51.100.7");
  });

  it("knows Cloudflare's ranges", () => {
    expect(isCloudflare("104.16.1.1")).toBe(true);
    expect(isCloudflare("2606:4700::1")).toBe(true);
    expect(isCloudflare("46.224.164.197")).toBe(false);
  });
});

describe("isPublicIp", () => {
  it("accepts internet addresses only", () => {
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("2a01:4f8::1")).toBe(true);
    expect(isPublicIp("::ffff:1.1.1.1")).toBe(true);
    for (const ip of [
      "10.0.1.5",
      "172.18.0.3",
      "100.101.1.1",
      "127.0.0.1",
      "::1",
      "fd7a::1",
      "unknown",
    ])
      expect(isPublicIp(ip)).toBe(false);
  });
});
