import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {}, repositories: {} }));

import { matchStack, type GitStack } from "./stack-platforms";

const s = (
  id: string,
  repoUrl: string | null,
  branch: string | null
): GitStack => ({
  platform: "portainer",
  id,
  name: id,
  repoUrl,
  branch,
});

describe("matchStack", () => {
  const repo = {
    githubUrl: "https://github.com/acme/shop",
    defaultBranch: "main",
  };

  it("links the one stack from the same repository, however its URL is written", () => {
    expect(
      matchStack(repo, [
        s("a", "https://github.com/Acme/shop.git", "main"),
        s("b", null, null),
      ])?.id
    ).toBe("a");
  });

  it("prefers the default branch and leaves real ambiguity to the user", () => {
    const both = [
      s("prod", "https://github.com/acme/shop", "main"),
      s("stage", "https://github.com/acme/shop", "staging"),
    ];
    expect(matchStack(repo, both)?.id).toBe("prod");
    expect(
      matchStack(repo, [
        s("x", "https://github.com/acme/shop", "a"),
        s("y", "https://github.com/acme/shop", "b"),
      ])
    ).toBeNull();
  });

  it("works for other Git hosts", () => {
    expect(
      matchStack(
        { githubUrl: "https://gitlab.com/g/sub/shop", defaultBranch: "main" },
        [s("g", "https://gitlab.com/g/sub/shop.git", "main")]
      )?.id
    ).toBe("g");
  });
});
