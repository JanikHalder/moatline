import { describe, expect, it } from "vitest";
import { fill, runJourney, storeCookies, type Step } from "./synthetic";

const res = (
  status: number,
  body = "",
  headers: Record<string, string | string[]> = {}
) => {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers))
    for (const x of [v].flat()) h.append(k, x);
  return new Response(status === 204 || status === 302 ? null : body, {
    status,
    headers: h,
  });
};

describe("fill", () => {
  it("escapes values for JSON and forms", () => {
    expect(fill('{"p":"${pw}"}', { pw: 'a"b' }, "json")).toBe('{"p":"a\\"b"}');
    expect(fill("p=${pw}", { pw: "a&b" }, "form")).toBe("p=a%26b");
    expect(fill("${missing}", {}, "plain")).toBe("${missing}");
  });
});

describe("storeCookies", () => {
  it("keeps sessions and drops logouts", () => {
    const jar = new Map<string, string>();
    storeCookies(jar, ["payload-token=abc; Path=/; HttpOnly", "x=1"]);
    expect([...jar]).toEqual([
      ["payload-token", "abc"],
      ["x", "1"],
    ]);
    storeCookies(jar, ["x=; Max-Age=0"]);
    expect(jar.has("x")).toBe(false);
  });
});

describe("runJourney", () => {
  it("logs in and carries the cookie to the next step", async () => {
    const seen: Array<{ url: string; cookie: string | null; body: unknown }> =
      [];
    const fake = (async (url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      seen.push({
        url: String(url),
        cookie: headers.get("cookie"),
        body: init.body,
      });
      if (String(url).endsWith("/api/users/login"))
        return res(200, '{"ok":true}', {
          "set-cookie": "payload-token=t1; Path=/",
        });
      if (String(url).endsWith("/api/users/me"))
        return headers.get("cookie") === "payload-token=t1"
          ? res(200, '{"user":{}}')
          : res(401);
      return res(200, "<html>Admin</html>");
    }) as unknown as typeof fetch;
    const steps: Step[] = [
      { method: "GET", path: "/admin" },
      {
        method: "POST",
        path: "/api/users/login",
        contentType: "json",
        body: '{"email":"${email}","password":"${password}"}',
        expectStatus: 200,
      },
      { method: "GET", path: "/api/users/me", expectText: '"user"' },
    ];
    const r = await runJourney(
      "https://shop.example",
      steps,
      { email: "t@x", password: "s3cret" },
      fake
    );
    expect(r.ok).toBe(true);
    expect(seen[1]!.body).toBe('{"email":"t@x","password":"s3cret"}');
    expect(seen[2]!.cookie).toBe("payload-token=t1");
    // Results never carry the secret.
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });

  it("stops at the first failing step and says why", async () => {
    const fake = (async () => res(500)) as unknown as typeof fetch;
    const r = await runJourney(
      "https://shop.example",
      [
        { method: "GET", path: "/" },
        { method: "GET", path: "/never" },
      ],
      {},
      fake
    );
    expect(r).toEqual({
      ok: false,
      steps: [
        {
          step: "GET /",
          ok: false,
          status: 500,
          ms: expect.any(Number),
          error: "expected 2xx/3xx, got 500",
        },
      ],
    });
  });

  it("follows redirects on the same origin only", async () => {
    const calls: string[] = [];
    const fake = (async (url: URL) => {
      calls.push(String(url));
      if (url.pathname === "/") return res(302, "", { location: "/de" });
      if (url.pathname === "/de")
        return res(302, "", { location: "https://evil.example/x" });
      return res(200, "ok");
    }) as unknown as typeof fetch;
    const r = await runJourney(
      "https://shop.example",
      [{ method: "GET", path: "/" }],
      {},
      fake
    );
    expect(calls).toEqual(["https://shop.example/", "https://shop.example/de"]);
    // The foreign redirect is not followed; a 302 still counts as 3xx.
    expect(r.ok).toBe(true);
  });

  it("refuses paths that leave the site", async () => {
    const r = await runJourney(
      "https://shop.example",
      [{ method: "GET", path: "//evil.example/" }],
      {}
    );
    expect(r.steps[0]!.error).toBe("path must start with /");
  });
});
