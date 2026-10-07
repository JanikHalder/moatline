import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  domains: {},
  provisionRuns: {},
  repositories: {},
  scans: {},
}));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));
vi.mock("./scan", () => ({ runScan: vi.fn() }));
vi.mock("../lib/github-token", () => ({ getGithubUserToken: vi.fn() }));

import {
  autoKind,
  buildEnv,
  parseEnvExample,
  randomPassword,
  slugify,
} from "./provision";

describe("provision helpers", () => {
  it("slugifies names", () => {
    expect(slugify("Müller Bau GmbH")).toBe("muller-bau-gmbh");
    expect(slugify("  ---  ")).toBe("site");
  });

  it("makes passwords Dokploy accepts", () => {
    const p = randomPassword();
    expect(p).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(randomPassword()).not.toBe(p);
  });

  it("reads .env.example keys once each", () => {
    expect(
      parseEnvExample(
        '# comment\nDATABASE_URI=mongodb://127.0.0.1/app\nPAYLOAD_SECRET=\nexport SMTP_HOST="smtp.example.com"\nDATABASE_URI=again\nlower=x'
      )
    ).toEqual([
      { key: "DATABASE_URI", example: "mongodb://127.0.0.1/app" },
      { key: "PAYLOAD_SECRET", example: "" },
      { key: "SMTP_HOST", example: "smtp.example.com" },
    ]);
  });

  it("knows which keys fill themselves", () => {
    expect(autoKind("DATABASE_URI")).toBe("database");
    expect(autoKind("PAYLOAD_SECRET")).toBe("secret");
    expect(autoKind("NEXT_PUBLIC_SERVER_URL")).toBe("url");
    expect(autoKind("SMTP_HOST")).toBeNull();
  });

  it("fills the environment, user values first", () => {
    const r = buildEnv(
      [
        { key: "DATABASE_URI", example: "" },
        { key: "PAYLOAD_SECRET", example: "" },
        { key: "NEXT_PUBLIC_SERVER_URL", example: "" },
        { key: "SMTP_HOST", example: "smtp.example.com" },
        { key: "S3_BUCKET", example: "" },
      ],
      {
        databaseUrl: "postgresql://a:b@site-db:5432/a",
        siteUrl: "https://kunde.at",
      },
      { SMTP_HOST: "mail.kunde.at", EXTRA: "1" }
    );
    const env = Object.fromEntries(
      r.env.split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2))
    );
    expect(env.DATABASE_URI).toBe("postgresql://a:b@site-db:5432/a");
    expect(env.PAYLOAD_SECRET).toMatch(/^[0-9a-f]{48}$/);
    expect(env.NEXT_PUBLIC_SERVER_URL).toBe("https://kunde.at");
    expect(env.SMTP_HOST).toBe("mail.kunde.at");
    expect(env.EXTRA).toBe("1");
    expect(r.empty).toEqual(["S3_BUCKET"]);
  });
});
