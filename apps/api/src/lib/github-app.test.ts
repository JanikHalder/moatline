import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appJwt,
  appManifest,
  installationFor,
  installationToken,
  manifestAction,
} from "./github-app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const app = { id: 42, privateKey };

afterEach(() => vi.restoreAllMocks());

describe("GitHub App", () => {
  it("signs a JWT GitHub accepts: RS256, issuer, under ten minutes", () => {
    const now = Date.UTC(2026, 9, 6, 12);
    const jwt = appJwt(app, now);
    const [h, b, sig] = jwt.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${b}`);
    expect(verify.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
    const body = JSON.parse(Buffer.from(b!, "base64url").toString());
    expect(body.iss).toBe("42");
    expect(body.iat).toBe(now / 1000 - 60);
    expect(body.exp - body.iat).toBeLessThanOrEqual(600);
  });

  it("describes the app with callbacks on the web app and no events", () => {
    const m = appManifest({
      appUrl: "https://m.example.com/",
      name: "Moatline x",
    });
    expect(m.redirect_url).toBe(
      "https://m.example.com/api/github-app/callback"
    );
    expect(m.setup_url).toBe("https://m.example.com/api/github-app/installed");
    expect(m.default_permissions).toMatchObject({
      contents: "write",
      pull_requests: "write",
    });
    expect(m.hook_attributes.active).toBe(false);
    expect(m.public).toBe(false);
  });

  it("posts to the personal account or an organization", () => {
    expect(manifestAction("s1")).toBe(
      "https://github.com/settings/apps/new?state=s1"
    );
    expect(manifestAction("s1", "acme")).toBe(
      "https://github.com/organizations/acme/settings/apps/new?state=s1"
    );
  });

  it("picks the installation of the repository's owner", () => {
    const list = [
      { id: 1, account: "janik", type: "User" },
      { id: 2, account: "Acme", type: "Organization" },
    ];
    expect(installationFor(list, "acme")?.id).toBe(2);
    expect(installationFor(list, "other")).toBeNull();
    expect(installationFor(list, null)).toBeNull();
    expect(installationFor([list[0]!], undefined)?.id).toBe(1);
  });

  it("reuses an installation token until shortly before it ends", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "ghs_x",
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          })
        )
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await installationToken(app, 7)).toBe("ghs_x");
    expect(await installationToken(app, 7)).toBe("ghs_x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.github.com/app/installations/7/access_tokens"
    );
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Bearer ey/
    );
  });
});
