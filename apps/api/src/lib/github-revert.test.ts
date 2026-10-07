import { afterEach, describe, expect, it, vi } from "vitest";
import { revertTipCommit } from "./github";

afterEach(() => vi.restoreAllMocks());

function github(tip: string) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const json = (b: unknown) =>
      Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
    if (url.endsWith("/git/ref/heads/main"))
      return json({ object: { sha: tip } });
    if (url.endsWith("/git/commits/merge1"))
      return json({ parents: [{ sha: "base0" }] });
    if (url.endsWith("/git/commits/base0"))
      return json({ tree: { sha: "tree0" } });
    if (url.endsWith("/git/commits") && method === "POST")
      return json({ sha: "revert1" });
    if (url.endsWith("/git/refs/heads/main") && method === "PATCH")
      return json({});
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof fetch;
  return calls;
}

describe("revertTipCommit", () => {
  it("restores the parent tree in a new commit and fast-forwards", async () => {
    const calls = github("merge1");
    const r = await revertTipCommit(
      "t",
      "o",
      "r",
      "main",
      "merge1",
      "Revert x"
    );
    expect(r).toEqual({ ok: true, sha: "revert1" });
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      message: "Revert x",
      tree: "tree0",
      parents: ["merge1"],
    });
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
      sha: "revert1",
      force: false,
    });
  });

  it("refuses when something was committed on top", async () => {
    const calls = github("later2");
    const r = await revertTipCommit(
      "t",
      "o",
      "r",
      "main",
      "merge1",
      "Revert x"
    );
    expect(r).toMatchObject({ ok: false, moved: true });
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });
});
