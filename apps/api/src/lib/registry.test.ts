import { describe, expect, it } from "vitest";
import { judgeImage, parseImageRef } from "./registry";

describe("parseImageRef", () => {
  it("reads Docker Hub references", () => {
    expect(parseImageRef("postgres:16")).toEqual({
      namespace: "library",
      repo: "postgres",
      tag: "16",
    });
    expect(parseImageRef("bytemark/smtp")).toEqual({
      namespace: "bytemark",
      repo: "smtp",
      tag: "latest",
    });
    expect(parseImageRef("docker.io/boky/postfix:edge")).toMatchObject({
      namespace: "boky",
      tag: "edge",
    });
  });

  it("leaves other registries and pinned digests alone", () => {
    expect(parseImageRef("ghcr.io/acme/app:1")).toBeNull();
    expect(parseImageRef("localhost:5000/app")).toBeNull();
    expect(parseImageRef("redis@sha256:abc")).toBeNull();
  });
});

describe("judgeImage", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");

  it("calls a repository without a push for a year unmaintained", () => {
    expect(
      judgeImage(
        { digest: "sha256:a", created: "2018-07-17T00:00:00Z" },
        {
          repoUpdated: "2018-07-17T13:45:22Z",
          tagUpdated: null,
          tagDigest: "sha256:a",
        },
        now
      )
    ).toEqual({ status: "unmaintained", since: "2018-07-17T13:45:22Z" });
  });

  it("sees a newer build of the same tag", () => {
    expect(
      judgeImage(
        { digest: "sha256:old", created: "2026-05-01T00:00:00Z" },
        {
          repoUpdated: "2026-09-29T00:00:00Z",
          tagUpdated: "2026-09-29T00:00:00Z",
          tagDigest: "sha256:new",
        },
        now
      ).status
    ).toBe("outdated");
  });

  it("does not mistake a per-architecture digest for an update", () => {
    expect(
      judgeImage(
        { digest: "sha256:arm", created: "2026-09-29T10:00:00Z" },
        {
          repoUpdated: "2026-09-29T00:00:00Z",
          tagUpdated: "2026-09-29T00:00:00Z",
          tagDigest: "sha256:index",
        },
        now
      ).status
    ).toBe("current");
  });

  it("says nothing about images Docker Hub does not know", () => {
    expect(judgeImage({ digest: null, created: null }, null, now).status).toBe(
      "unknown"
    );
  });
});
