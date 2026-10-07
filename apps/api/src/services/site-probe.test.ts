import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, repositories: {} }));
vi.mock("./deploy", () => ({ usesPayload: vi.fn() }));

import { judgeSite } from "./site-probe";

const answer = (
  status: number,
  body = "",
  headers: Record<string, string> = {}
) => ({
  status,
  body,
  headers: new Headers(headers),
  contentType: headers["content-type"] ?? "text/html",
});

const safeHeaders = {
  "strict-transport-security": "max-age=31536000",
  "x-frame-options": "SAMEORIGIN",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'",
};

describe("judgeSite", () => {
  it("finds nothing on a well-configured Payload site", () => {
    expect(
      judgeSite("https://shop.example", {
        root: answer(200, "<html>", safeHeaders),
        plainHttp: answer(301),
        env: answer(404),
        envLocal: answer(404),
        git: answer(404),
        seed: answer(404),
        playground: answer(404),
        users: answer(403, '{"errors":[]}', {
          "content-type": "application/json",
        }),
        submissions: answer(200, '{"docs":[]}', {
          "content-type": "application/json",
        }),
      })
    ).toEqual([]);
  });

  it("flags exposed files, open Payload endpoints and missing headers", () => {
    const f = judgeSite("https://shop.example", {
      root: answer(200, "<html>", { "x-powered-by": "Next.js" }),
      plainHttp: answer(200, "<html>"),
      env: answer(200, "DATABASE_URI=postgres://x\nPAYLOAD_SECRET=y"),
      envLocal: answer(200, "<html>not found page</html>"),
      git: answer(200, "ref: refs/heads/main\n"),
      seed: answer(405),
      playground: answer(200, "<title>GraphQL Playground</title>"),
      users: answer(200, '{"docs":[{"email":"a@b.c"}]}', {
        "content-type": "application/json",
      }),
      submissions: answer(200, '{"docs":[{"name":"x"}]}', {
        "content-type": "application/json",
      }),
    });
    const ids = f.map((x) => x.id);
    expect(ids).toEqual([
      "env:/.env",
      "git",
      "payload:seed",
      "payload:playground",
      "payload:users",
      "payload:form-submissions",
      "http",
      "header:hsts",
      "header:framing",
      "header:nosniff",
      "header:csp",
      "header:powered-by",
    ]);
    // An HTML page answering /.env.local is a catch-all, not the file.
    expect(ids).not.toContain("env:/.env.local");
    expect(f.find((x) => x.id === "payload:users")!.severity).toBe("critical");
  });
});
