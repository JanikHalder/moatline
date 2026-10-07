import { describe, expect, it } from "vitest";
import {
  compareUrl,
  hostLabel,
  looksLikeRepoUrl,
  pullsUrl,
  repoShortName,
} from "./git-host";

describe("git-host links", () => {
  it("names the host from the URL or the API's word", () => {
    expect(hostLabel("https://gitlab.com/g/p")).toBe("GitLab");
    expect(hostLabel("https://git.example.com/a/b")).toBe("Git");
    expect(hostLabel("https://git.example.com/a/b", "gitea")).toBe("Gitea");
  });

  it("links each host's pull request pages", () => {
    expect(pullsUrl("https://github.com/a/b.git")).toBe(
      "https://github.com/a/b/pulls"
    );
    expect(pullsUrl("https://gitlab.com/g/p/")).toBe(
      "https://gitlab.com/g/p/-/merge_requests"
    );
    expect(pullsUrl("https://bitbucket.org/w/r")).toBe(
      "https://bitbucket.org/w/r/pull-requests"
    );
    expect(compareUrl("https://codeberg.org/a/b", "main", "fix")).toBe(
      "https://codeberg.org/a/b/compare/main...fix"
    );
  });

  it("shortens and recognizes repository URLs", () => {
    expect(repoShortName("https://github.com/acme/shop")).toBe("acme/shop");
    expect(repoShortName("https://gitlab.com/g/s/p.git")).toBe(
      "gitlab.com/g/s/p"
    );
    expect(looksLikeRepoUrl("git@gitlab.com:g/p.git")).toBe(true);
    expect(looksLikeRepoUrl("https://github.com/acme")).toBe(false);
  });
});
