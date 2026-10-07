import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({ db: {}, serverFindings: {}, servers: {} }));

import { normalizeSeverity, safeReference } from "./server-findings";

describe("safeReference", () => {
  it("keeps http(s) links and drops everything that could run script", () => {
    expect(safeReference("https://nvd.nist.gov/vuln/detail/CVE-1")).toBe(
      "https://nvd.nist.gov/vuln/detail/CVE-1"
    );
    expect(safeReference("javascript:alert(1)")).toBeNull();
    expect(safeReference("data:text/html,<script>")).toBeNull();
    expect(safeReference("not a url")).toBeNull();
  });
});

describe("normalizeSeverity", () => {
  it("maps every scanner's vocabulary onto one scale", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("moderate")).toBe("medium");
    expect(normalizeSeverity("UNKNOWN")).toBe("info");
  });
});
