import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupAdvisories, patchedVersion } from "./advisories";

afterEach(() => vi.restoreAllMocks());

describe("patchedVersion", () => {
  it("reads the upper bound of the vulnerable range", () => {
    expect(patchedVersion("<4.17.21")).toBe("4.17.21");
    expect(patchedVersion(">=13.0.0 <15.5.16")).toBe("15.5.16");
    expect(patchedVersion("<=4.17.23")).toBeNull();
    expect(patchedVersion(">=1.0.0")).toBeNull();
  });
});

describe("lookupAdvisories", () => {
  it("keeps advisories that hit an installed version, once per package", async () => {
    const adv = {
      url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
      title: "Command Injection in lodash",
      severity: "high",
      vulnerable_versions: "<4.17.21",
      cvss: { score: 7.2 },
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            lodash: [
              adv,
              adv,
              {
                ...adv,
                url: "x/GHSA-aaaa-bbbb-cccc",
                vulnerable_versions: "<1.0.0",
              },
            ],
          }),
          { status: 200 }
        )
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await lookupAdvisories(
      [
        { name: "lodash", version: "4.17.15" },
        { name: "lodash", version: "4.17.21" },
      ],
      new Set(["lodash"])
    );
    expect(r.ok && r.vulnerabilities).toEqual([
      expect.objectContaining({
        packageName: "lodash",
        severity: "high",
        ghsaId: "GHSA-35jh-r3h4-6jhm",
        patchedVersion: "4.17.21",
        fixAvailable: true,
        fixIsSemverMajor: false,
        isDirect: true,
        cvssScore: "7.2",
      }),
    ]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string
    );
    expect(body).toEqual({ lodash: ["4.17.15", "4.17.21"] });
  });

  it("reports an unreachable database instead of an empty result", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("", { status: 503 }))
    ) as unknown as typeof fetch;
    const r = await lookupAdvisories(
      [{ name: "a", version: "1.0.0" }],
      new Set()
    );
    expect(r).toEqual({
      ok: false,
      error: "npm advisory database answered HTTP 503",
    });
  });
});

describe("lookupMalicious", () => {
  it("flags versions on the malicious-packages list, nothing else", async () => {
    const { lookupMalicious } = await import("./advisories");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] },
              { vulns: [{ id: "MAL-2025-47141" }] },
            ],
          })
        )
      )
    ) as unknown as typeof fetch;
    const r = await lookupMalicious(
      [
        { name: "lodash", version: "4.17.21" },
        { name: "@ctrl/tinycolor", version: "4.1.1" },
      ],
      new Set()
    );
    expect(r).toEqual([
      expect.objectContaining({
        packageName: "@ctrl/tinycolor",
        severity: "critical",
        url: "https://osv.dev/vulnerability/MAL-2025-47141",
        fixAvailable: false,
      }),
    ]);
  });

  it("skips quietly when OSV is unreachable", async () => {
    const { lookupMalicious } = await import("./advisories");
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("down"))
    ) as unknown as typeof fetch;
    expect(
      await lookupMalicious([{ name: "a", version: "1.0.0" }], new Set())
    ).toEqual([]);
  });
});
