import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  repositories: {},
  serverScanRuns: {},
  servers: {},
  serverFindings: {},
}));

import { nucleiArgs, parseNucleiOutput } from "./nuclei";

describe("nucleiArgs", () => {
  const base = { targetsFile: "/t", outputFile: "/o" };

  it("never runs intrusive templates or code on this host", () => {
    const args = nucleiArgs({
      ...base,
      allowLocalNetwork: false,
      interactsh: false,
    });
    const tags = args[args.indexOf("-exclude-tags") + 1]!.split(",");
    expect(tags).toEqual(
      expect.arrayContaining(["dos", "fuzz", "intrusive", "brute-force"])
    );
    const types = args[args.indexOf("-exclude-type") + 1]!.split(",");
    expect(types).toEqual(
      expect.arrayContaining(["code", "file", "headless", "javascript"])
    );
    expect(args).toContain("-omit-raw");
  });

  it("keeps third-party OAST and the local network off by default", () => {
    const args = nucleiArgs({
      ...base,
      allowLocalNetwork: false,
      interactsh: false,
    });
    expect(args).toContain("-no-interactsh");
    expect(args).toContain("-restrict-local-network-access");
    const open = nucleiArgs({
      ...base,
      allowLocalNetwork: true,
      interactsh: true,
    });
    expect(open).not.toContain("-no-interactsh");
    expect(open).not.toContain("-restrict-local-network-access");
  });
});

describe("parseNucleiOutput", () => {
  it("maps results to findings and attaches them to the application by host", () => {
    const line = JSON.stringify({
      "template-id": "git-config",
      "matcher-name": "",
      "matched-at": "https://shop.example.com/.git/config",
      host: "https://shop.example.com",
      info: {
        name: "Git Config - Detect",
        severity: "medium",
        description: "Exposed git config",
        reference: ["https://example.com/ref"],
      },
    });
    const f = parseNucleiOutput(
      `${line}\nnot json\n`,
      new Map([["shop.example.com", "repo-1"]])
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      severity: "medium",
      title: "Git Config - Detect",
      target: "https://shop.example.com/.git/config",
      reference: "https://example.com/ref",
      repositoryId: "repo-1",
    });
  });
});

describe("parseNucleiStats", () => {
  it("reads progress lines and ignores everything else", async () => {
    const { parseNucleiStats } = await import("./nuclei");
    expect(
      parseNucleiStats(
        '{"duration":"0:03:15","errors":"2","hosts":"2","matched":"1","percent":"41","requests":"8123","rps":"30","templates":"9000","total":"19800"}'
      )
    ).toMatchObject({
      percent: 41,
      requests: 8123,
      total: 19800,
      rps: 30,
      matched: 1,
    });
    expect(parseNucleiStats("[INF] Using templates")).toBeNull();
    expect(parseNucleiStats('{"template-id":"x"}')).toBeNull();
  });
});
