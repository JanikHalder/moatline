import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, repositories: {}, scans: {} }));
vi.mock("../lib/github-token", () => ({ getGithubToken: async () => "tok" }));

import { githubApi } from "../lib/git-github";
import { parseRepoUrl } from "../lib/git-host";

const branchHead = (url: string, branch: string, token: string | null) =>
  githubApi(parseRepoUrl(url)!, { token, username: null }).branchHead(branch);

afterEach(() => vi.restoreAllMocks());

describe("branchHead", () => {
  it("reads the branch tip as a SHA", async () => {
    const sha = "a".repeat(40);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(`${sha}\n`)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await branchHead("https://github.com/acme/shop", "main", "tok")
    ).toBe(sha);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.github.com/repos/acme/shop/commits/main");
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/vnd.github.sha"
    );
  });

  it("gives up quietly on errors", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 404 }))
    ) as unknown as typeof fetch;
    expect(
      await branchHead("https://github.com/acme/shop", "main", null)
    ).toBeNull();
  });
});
