import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkLiveUrl,
  isLiveStatus,
  isTailnetHost,
  validateLiveUrl,
} from "./live-check";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALLOW_PRIVATE_LIVE_URLS;
  delete process.env.ALLOW_TAILNET_LIVE_URLS;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("validateLiveUrl", () => {
  it("accepts a public http(s) URL", () => {
    expect(validateLiveUrl("https://app.example.com/api/health")).toEqual({
      ok: true,
    });
    expect(validateLiveUrl("http://app.example.com").ok).toBe(true);
  });

  it("rejects anything that is not http(s)", () => {
    expect(validateLiveUrl("ftp://example.com").ok).toBe(false);
    expect(validateLiveUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateLiveUrl("not a url").ok).toBe(false);
  });

  it("refuses loopback, private and link-local hosts by default", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1/health",
      "http://10.1.2.3",
      "http://172.16.0.9",
      "http://192.168.1.10",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://db.internal",
    ]) {
      const result = validateLiveUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it("allows private hosts when the instance opts in", () => {
    process.env.ALLOW_PRIVATE_LIVE_URLS = "true";
    expect(validateLiveUrl("http://192.168.1.10:8080").ok).toBe(true);
    expect(validateLiveUrl("http://localhost:3000").ok).toBe(true);
  });

  it("keeps public addresses that merely look private", () => {
    expect(validateLiveUrl("https://172.32.0.1").ok).toBe(true);
    expect(validateLiveUrl("https://11.0.0.1").ok).toBe(true);
  });
});

describe("isLiveStatus", () => {
  it("treats 2xx-4xx as up and 5xx as down", () => {
    // A login wall (401/403) is a running app; a 502 from the proxy is not.
    expect(isLiveStatus(200)).toBe(true);
    expect(isLiveStatus(401)).toBe(true);
    expect(isLiveStatus(404)).toBe(true);
    expect(isLiveStatus(500)).toBe(false);
    expect(isLiveStatus(502)).toBe(false);
  });
});

describe("checkLiveUrl", () => {
  it("reports up and picks the commit out of a health payload", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, commit: "752de05" }))
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://app.example.com/api/health");
    expect(res.ok).toBe(true);
    expect(res.httpStatus).toBe(200);
    expect(res.commit).toBe("752de05");
    expect(res.error).toBeNull();
  });

  it("reports down for a 502 without inventing a commit", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("bad gateway", { status: 502 }))
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://app.example.com");
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(502);
    expect(res.commit).toBeNull();
    expect(res.error).toBe("HTTP 502");
  });

  it("ignores commit-shaped values in an HTML page", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response('<html>{"commit":"abc"}</html>', {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      )
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://app.example.com");
    expect(res.ok).toBe(true);
    expect(res.commit).toBeNull();
  });

  it("ignores a commit field holding prose rather than an identifier", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ commit: "x".repeat(200), version: "1.4.2" })
      )
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://app.example.com");
    expect(res.commit).toBe("1.4.2");
  });

  it("returns the network error instead of throwing", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://nope.example.com");
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBeNull();
    expect(res.error).toMatch(/ENOTFOUND/);
  });

  it("gives up on a URL that never answers", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://slow.example.com", {
      timeoutMs: 20,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No answer/);
  });

  it("refuses a private URL without any request going out", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await checkLiveUrl("http://127.0.0.1:5432");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkLiveUrl body handling", () => {
  it("does not read a body that announces itself as huge", async () => {
    const text = vi.fn(() => Promise.resolve("x".repeat(10)));
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: new Headers({
          "content-type": "application/json",
          "content-length": String(5 * 1024 * 1024),
        }),
        text,
      })
    ) as unknown as typeof fetch;

    const res = await checkLiveUrl("https://app.example.com");
    expect(res.ok).toBe(true);
    expect(res.commit).toBeNull();
    expect(text).not.toHaveBeenCalled();
  });
});

describe("Tailscale addresses", () => {
  it("recognizes the tailnet ranges and MagicDNS names", () => {
    expect(isTailnetHost("100.64.0.1")).toBe(true);
    expect(isTailnetHost("100.101.102.103")).toBe(true);
    expect(isTailnetHost("100.127.255.254")).toBe(true);
    expect(isTailnetHost("fd7a:115c:a1e0::1")).toBe(true);
    expect(isTailnetHost("server.tail1234.ts.net")).toBe(true);
  });

  it("does not mistake neighbouring public addresses for a tailnet", () => {
    // 100.64.0.0/10 ends at 100.127.255.255 – 100.128.x is public space.
    expect(isTailnetHost("100.128.0.1")).toBe(false);
    expect(isTailnetHost("100.63.0.1")).toBe(false);
    expect(isTailnetHost("ts.net.example.com")).toBe(false);
  });

  it("refuses a tailnet URL by default, and says what is needed", () => {
    const result = validateLiveUrl("https://server.tail1234.ts.net/health");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(
      /ALLOW_TAILNET_LIVE_URLS/
    );
  });

  it("allows tailnet URLs once the instance opts in", () => {
    process.env.ALLOW_TAILNET_LIVE_URLS = "true";
    expect(validateLiveUrl("https://server.tail1234.ts.net/health").ok).toBe(
      true
    );
    expect(validateLiveUrl("http://100.101.102.103:3000/health").ok).toBe(true);
    expect(validateLiveUrl("http://[fd7a:115c:a1e0::1]/health").ok).toBe(true);
  });

  it("does not open the LAN along with the tailnet", () => {
    process.env.ALLOW_TAILNET_LIVE_URLS = "true";
    expect(validateLiveUrl("http://192.168.1.10").ok).toBe(false);
    expect(validateLiveUrl("http://169.254.169.254/").ok).toBe(false);
  });
});
