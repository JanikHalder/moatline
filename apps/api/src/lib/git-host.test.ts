import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {} }));

import { parseRepoUrl, repoKey, webUrl } from "./git-host";
import { gitlabApi } from "./git-gitlab";
import { giteaApi } from "./git-gitea";
import { bitbucketApi } from "./git-bitbucket";
import { githubApi } from "./git-github";

afterEach(() => vi.restoreAllMocks());

describe("parseRepoUrl", () => {
  it("reads the cloud hosts by name", () => {
    expect(parseRepoUrl("https://github.com/acme/shop")).toMatchObject({
      kind: "github",
      origin: "https://github.com",
      owner: "acme",
      repo: "shop",
      branch: "main",
    });
    expect(parseRepoUrl("https://gitlab.com/acme/web/shop.git")).toMatchObject({
      kind: "gitlab",
      owner: "acme/web",
      repo: "shop",
      path: "acme/web/shop",
    });
    expect(parseRepoUrl("https://bitbucket.org/team/site/")).toMatchObject({
      kind: "bitbucket",
      owner: "team",
      repo: "site",
    });
    expect(parseRepoUrl("https://codeberg.org/me/app")?.kind).toBe("gitea");
  });

  it("takes the branch from a browser URL", () => {
    expect(parseRepoUrl("https://github.com/a/b/tree/dev")?.branch).toBe("dev");
    expect(
      parseRepoUrl("https://gitlab.com/g/sub/p/-/tree/release/1.2")
    ).toMatchObject({ path: "g/sub/p", branch: "release/1.2" });
    expect(
      parseRepoUrl("https://codeberg.org/a/b/src/branch/next")?.branch
    ).toBe("next");
    expect(parseRepoUrl("https://gitlab.com/g/p/-/merge_requests")?.path).toBe(
      "g/p"
    );
  });

  it("reads SSH remotes", () => {
    expect(parseRepoUrl("git@github.com:acme/shop.git")?.path).toBe(
      "acme/shop"
    );
  });

  it("knows self-hosted instances only when configured", () => {
    const url = "https://git.example.com/team/app";
    expect(parseRepoUrl(url)).toBeNull();
    const hosts = [{ kind: "gitea" as const, url: "https://git.example.com/" }];
    expect(parseRepoUrl(url, hosts)).toMatchObject({
      kind: "gitea",
      origin: "https://git.example.com",
      path: "team/app",
    });
    // Under a path prefix.
    const prefixed = [
      { kind: "gitlab" as const, url: "https://example.com/gitlab" },
    ];
    expect(
      parseRepoUrl("https://example.com/gitlab/grp/proj", prefixed)
    ).toMatchObject({ origin: "https://example.com/gitlab", path: "grp/proj" });
  });

  it("refuses what is not a repository", () => {
    expect(parseRepoUrl("http://github.com/a/b")).toBeNull();
    expect(parseRepoUrl("https://github.com/a")).toBeNull();
    expect(parseRepoUrl("https://github.com/a/b/c")).toBeNull();
    expect(parseRepoUrl("https://example.com/a/b")).toBeNull();
    expect(parseRepoUrl("file:///etc/passwd")).toBeNull();
    expect(parseRepoUrl("https://github.com/../b")).toBeNull();
  });

  it("gives one key and one web URL per repository", () => {
    expect(repoKey("https://github.com/Acme/Shop.git")).toBe(
      repoKey("https://github.com/acme/shop/tree/main")
    );
    expect(webUrl(parseRepoUrl("git@gitlab.com:g/p.git")!)).toBe(
      "https://gitlab.com/g/p"
    );
  });
});

function route(map: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    if (!hit) return Promise.resolve(new Response("{}", { status: 404 }));
    const [, body] = hit;
    return Promise.resolve(
      body instanceof Response ? body : new Response(JSON.stringify(body))
    );
  }) as unknown as typeof fetch;
  return calls;
}

describe("clone URLs", () => {
  it("puts each host's token user in front", () => {
    const creds = { token: "t0k", username: null };
    expect(
      githubApi(parseRepoUrl("https://github.com/a/b")!, creds).cloneUrl()
    ).toBe("https://x-access-token:t0k@github.com/a/b.git");
    expect(
      gitlabApi(parseRepoUrl("https://gitlab.com/g/s/p")!, creds).cloneUrl()
    ).toBe("https://oauth2:t0k@gitlab.com/g/s/p.git");
    expect(
      bitbucketApi(parseRepoUrl("https://bitbucket.org/w/r")!, creds).cloneUrl()
    ).toBe("https://x-token-auth:t0k@bitbucket.org/w/r.git");
    expect(
      bitbucketApi(parseRepoUrl("https://bitbucket.org/w/r")!, {
        token: "t0k",
        username: "me@example.com",
      }).cloneUrl()
    ).toBe("https://x-bitbucket-api-token-auth:t0k@bitbucket.org/w/r.git");
    expect(
      githubApi(parseRepoUrl("https://github.com/a/b")!, {
        token: null,
        username: null,
      }).cloneUrl()
    ).toBe("https://github.com/a/b.git");
  });
});

describe("GitLab", () => {
  const ref = parseRepoUrl("https://gitlab.com/grp/shop")!;
  const api = gitlabApi(ref, { token: "glpat", username: null });

  it("addresses the project by its encoded path, with the token header", async () => {
    const calls = route({
      "/repository/branches/main": { commit: { id: "a".repeat(40) } },
    });
    expect(await api.branchHead("main")).toBe("a".repeat(40));
    expect(calls[0]!.url).toBe(
      "https://gitlab.com/api/v4/projects/grp%2Fshop/repository/branches/main"
    );
    expect(
      (calls[0]!.init!.headers as Record<string, string>)["PRIVATE-TOKEN"]
    ).toBe("glpat");
  });

  it("folds job statuses into one CI state", async () => {
    route({
      "/statuses": [
        { name: "build", status: "success" },
        { name: "lint", status: "failed", allow_failure: true },
        { name: "test", status: "running" },
      ],
    });
    expect(await api.checks("b".repeat(40))).toEqual({
      state: "pending",
      detail: "running: test",
    });
  });

  it("finds the open merge request when one exists", async () => {
    route({
      "/merge_requests?state=opened&source_branch": [
        { iid: 4, web_url: "https://gitlab.com/grp/shop/-/merge_requests/4" },
      ],
      "/merge_requests": new Response("conflict", { status: 409 }),
    });
    expect(
      await api.createPr({ head: "x", base: "main", title: "t", body: "b" })
    ).toEqual({
      ok: true,
      number: 4,
      url: "https://gitlab.com/grp/shop/-/merge_requests/4",
      alreadyExists: true,
    });
  });

  it("refuses to revert when the branch moved", async () => {
    route({ "/repository/branches/main": { commit: { id: "c".repeat(40) } } });
    const res = await api.revertTip("main", "d".repeat(40), "m");
    expect(res).toMatchObject({ ok: false, moved: true });
  });
});

describe("Gitea", () => {
  const ref = parseRepoUrl("https://codeberg.org/me/app")!;
  const api = giteaApi(ref, { token: "gt", username: null });

  it("reads merged and closed pull requests", async () => {
    route({
      "/pulls/3": { state: "closed", merged: true, merge_commit_sha: "abc" },
      "/pulls/4": { state: "closed", merged: false },
    });
    expect(await api.getPr(3)).toEqual({ state: "merged", mergeSha: "abc" });
    expect(await api.getPr(4)).toEqual({ state: "closed", mergeSha: null });
  });

  it("calls a branch merged when nothing is left beyond the base", async () => {
    const calls = route({ "/commits?sha=feature": [] });
    expect(await api.compareBranch("feature", "main")).toEqual({
      merged: true,
      date: null,
    });
    expect(calls[0]!.url).toContain("not=main");
    expect(
      (calls[0]!.init!.headers as Record<string, string>).Authorization
    ).toBe("token gt");
  });

  it("does not pretend to revert", async () => {
    expect(await api.revertTip("main", "a".repeat(40), "m")).toMatchObject({
      ok: false,
    });
  });
});

describe("Bitbucket", () => {
  const ref = parseRepoUrl("https://bitbucket.org/team/site")!;

  it("uses Basic auth with a user, Bearer without", async () => {
    let calls = route({
      "/refs/branches/main": { target: { hash: "e".repeat(40) } },
    });
    await bitbucketApi(ref, { token: "t", username: "me@x.io" }).branchHead(
      "main"
    );
    expect(
      (calls[0]!.init!.headers as Record<string, string>).Authorization
    ).toBe(`Basic ${Buffer.from("me@x.io:t").toString("base64")}`);
    calls = route({
      "/refs/branches/main": { target: { hash: "e".repeat(40) } },
    });
    await bitbucketApi(ref, { token: "t", username: null }).branchHead("main");
    expect(
      (calls[0]!.init!.headers as Record<string, string>).Authorization
    ).toBe("Bearer t");
  });

  it("maps PR states", async () => {
    route({ "/pullrequests/9": { state: "DECLINED" } });
    expect(
      await bitbucketApi(ref, { token: "t", username: null }).getPr(9)
    ).toEqual({ state: "closed", mergeSha: null });
  });
});
