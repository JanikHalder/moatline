import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  packageFindings: {},
  repositories: {},
  scans: {},
}));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));

import { envKeys } from "../lib/dokploy";
import { extractChecks } from "../lib/live-check";
import { evaluateConfig } from "./config-check";

describe("envKeys", () => {
  it("returns names with a value, never values", () => {
    const keys = envKeys(
      'PAYLOAD_SECRET=s3cr3t\n# COMMENT=1\nexport SMTP_HOST="mail.example"\nEMPTY=\nRESEND_API_KEY=""\n'
    );
    expect(keys).toEqual(["PAYLOAD_SECRET", "SMTP_HOST"]);
    expect(JSON.stringify(keys)).not.toContain("s3cr3t");
  });
});

describe("evaluateConfig", () => {
  it("asks for mail and S3 only when the app uses them", () => {
    const base = evaluateConfig(
      ["PAYLOAD_SECRET", "DATABASE_URI"],
      new Set(["payload"])
    );
    expect(base.map((i) => i.label)).toEqual([
      "Payload secret",
      "Database",
      "Server Actions key",
      "Public URL",
    ]);
    expect(base.find((i) => i.label === "Server Actions key")!.ok).toBe(false);

    const full = evaluateConfig(
      ["PAYLOAD_SECRET", "DATABASE_URL", "SMTP_HOST", "S3_BUCKET"],
      new Set([
        "payload",
        "@payloadcms/email-nodemailer",
        "@payloadcms/storage-s3",
      ])
    );
    const by = Object.fromEntries(full.map((i) => [i.label, i.ok]));
    expect(by).toMatchObject({
      Email: true,
      "S3 bucket": true,
      "S3 credentials": false,
      "Mail alarm": false,
    });
  });
});

describe("extractChecks", () => {
  it("keeps flags, numbers and short strings, drops anything else", () => {
    const body = JSON.stringify({
      status: "ok",
      checks: {
        email: true,
        storage: false,
        mailFailures: 2,
        lastMailOk: "2026-10-03T09:12:00Z",
        nested: { secret: "x" },
        "bad key!": true,
      },
    });
    expect(extractChecks(body, "application/json")).toEqual({
      email: true,
      storage: false,
      mailFailures: 2,
      lastMailOk: "2026-10-03T09:12:00Z",
    });
    expect(extractChecks("<html>", "text/html")).toBeNull();
  });
});
