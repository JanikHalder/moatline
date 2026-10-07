import { describe, it, expect, vi, afterEach } from "vitest";
import { createPullRequest, mergePullRequest } from "./github";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPullRequest", () => {
  it("returns number + url on 201", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            number: 7,
            html_url: "https://github.com/o/r/pull/7",
          }),
          { status: 201 }
        )
      )
    ) as unknown as typeof fetch;
    const r = await createPullRequest("tok", "o", "r", {
      head: "b",
      base: "main",
      title: "x",
      body: "y",
    });
    expect(r).toEqual({
      ok: true,
      number: 7,
      url: "https://github.com/o/r/pull/7",
    });
  });

  it("treats 422 'No commits between' as a no-diff (not an error to retry)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("No commits between main and b", { status: 422 })
      )
    ) as unknown as typeof fetch;
    const r = await createPullRequest("tok", "o", "r", {
      head: "b",
      base: "main",
      title: "x",
      body: "y",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.noDiff).toBe(true);
  });
});

describe("mergePullRequest", () => {
  it("returns ok on 200", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sha: "abc" }), { status: 200 })
      )
    ) as unknown as typeof fetch;
    const r = await mergePullRequest("tok", "o", "r", 7);
    expect(r.ok).toBe(true);
  });

  it("marks 405 (branch protection) as notMergeable and does not force", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("required status checks", { status: 405 }))
    ) as unknown as typeof fetch;
    const r = await mergePullRequest("tok", "o", "r", 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.notMergeable).toBe(true);
  });
});
