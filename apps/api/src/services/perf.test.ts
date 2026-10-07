import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  orgIntegrations: {},
  perfRuns: {},
  repositories: {},
}));

import { budgetFailures, pageToTest, parsePsi, regression } from "./perf";

describe("parsePsi", () => {
  it("keeps scores, lab metrics and field data", () => {
    const r = parsePsi({
      lighthouseResult: {
        categories: {
          performance: { score: 0.54 },
          accessibility: { score: 0.97 },
          "best-practices": { score: 1 },
          seo: { score: 0.92 },
        },
        audits: {
          "largest-contentful-paint": { numericValue: 4123.4 },
          "cumulative-layout-shift": { numericValue: 0.02 },
          "total-blocking-time": { numericValue: 610 },
          "first-contentful-paint": { numericValue: 1800 },
          "server-response-time": { numericValue: 220 },
          "total-byte-weight": { numericValue: 2_400_000 },
        },
      },
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900 },
          INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
        },
      },
    });
    expect(r).toMatchObject({
      performance: 54,
      accessibility: 97,
      bestPractices: 100,
      seo: 92,
      lcpMs: 4123,
      tbtMs: 610,
      ttfbMs: 220,
      bytes: 2_400_000,
      fieldLcpMs: 2900,
      fieldInpMs: 180,
      fieldCls: 0.05,
    });
  });
});

describe("budget and regressions", () => {
  it("checks the lighthouse-check gate", () => {
    expect(
      budgetFailures({
        seo: 92,
        accessibility: 97,
        lcpMs: 4123,
        cls: 0.02,
        tbtMs: 610,
        bytes: 2_400_000,
      })
    ).toEqual([
      "SEO 92 (< 100)",
      "LCP 4.1 s (> 2.5 s)",
      "TBT 610 ms (> 300 ms)",
    ]);
  });

  it("calls a clear drop a regression, noise not", () => {
    expect(
      regression(
        { performance: 90, lcpMs: 1800 },
        { performance: 75, lcpMs: 2900 }
      )
    ).toBe("performance 90 → 75, LCP 1.8 s → 2.9 s");
    expect(
      regression(
        { performance: 90, lcpMs: 1800 },
        { performance: 86, lcpMs: 2000 }
      )
    ).toBeNull();
    expect(regression(null, { performance: 40 })).toBeNull();
  });

  it("tests the page, not the health endpoint", () => {
    expect(pageToTest("https://shop.example/api/health")).toBe(
      "https://shop.example/"
    );
    expect(pageToTest("https://shop.example/de")).toBe(
      "https://shop.example/de"
    );
  });
});
