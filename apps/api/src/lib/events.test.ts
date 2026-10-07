import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {} }));

import { otlpBody, otlpLogsUrl, parseHeaders } from "./events";

describe("events", () => {
  it("reads header lines", () => {
    expect(
      parseHeaders(
        "Authorization: Bearer abc:def\nDash0-Dataset: prod\n\nbroken line\nBad Key: x"
      )
    ).toEqual({ Authorization: "Bearer abc:def", "Dash0-Dataset": "prod" });
  });

  it("adds /v1/logs once", () => {
    expect(otlpLogsUrl("https://otlp.example.com/")).toBe(
      "https://otlp.example.com/v1/logs"
    );
    expect(otlpLogsUrl("https://otlp.example.com/v1/logs")).toBe(
      "https://otlp.example.com/v1/logs"
    );
  });

  it("sends an event as an OTLP log record", () => {
    const body = otlpBody({
      name: "deploy.healthy",
      title: "Deploy of shop is live and healthy",
      severity: "info",
      repository: { id: "r1", name: "shop" },
      attributes: {
        "deploy.id": "d1",
        "check.passed": true,
        minutes: 4,
        skipped: undefined,
      },
      at: new Date("2026-10-05T12:00:00Z"),
    });
    const rl = body.resourceLogs[0]!;
    expect(rl.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "shop" },
    });
    const rec = rl.scopeLogs[0]!.logRecords[0]!;
    expect(rec.timeUnixNano).toBe("1791201600000000000");
    expect(rec.body).toEqual({
      stringValue: "Deploy of shop is live and healthy",
    });
    expect(rec.attributes).toEqual([
      { key: "event.name", value: { stringValue: "moatline.deploy.healthy" } },
      { key: "deploy.id", value: { stringValue: "d1" } },
      { key: "check.passed", value: { boolValue: true } },
      { key: "minutes", value: { intValue: "4" } },
    ]);
  });
});
