import { describe, it, expect } from "vitest";
import {
  configSetsStandalone,
  dockerfileUsesStandalone,
  startScriptUsesStandalone,
  verdictNextStandalone,
} from "./next-standalone";

describe("configSetsStandalone", () => {
  it("finds output standalone in next.config", () => {
    expect(configSetsStandalone(`output: 'standalone'`)).toBe(true);
    expect(configSetsStandalone(`output: "standalone",`)).toBe(true);
    expect(configSetsStandalone(`output: \`standalone\``)).toBe(true);
    expect(configSetsStandalone(`output: 'export'`)).toBe(false);
    expect(configSetsStandalone(`const x = 1`)).toBe(false);
  });
});

describe("startScriptUsesStandalone", () => {
  it("detects the standalone server path", () => {
    expect(
      startScriptUsesStandalone({
        scripts: { start: "node .next/standalone/server.js" },
      })
    ).toBe(true);
    expect(
      startScriptUsesStandalone({
        scripts: { start: "next start" },
      })
    ).toBe(false);
  });
});

describe("verdictNextStandalone", () => {
  it("is fine without next", () => {
    expect(
      verdictNextStandalone({
        pkg: {},
        nextConfig: null,
        dockerfile: null,
      }).missing
    ).toBe(false);
  });

  it("flags next without standalone", () => {
    const v = verdictNextStandalone({
      pkg: {
        dependencies: { next: "15.0.0" },
        scripts: { start: "next start" },
      },
      nextConfig: "const nextConfig = {}",
      dockerfile: null,
    });
    expect(v.missing).toBe(true);
    expect(v.startMismatch).toBe(false);
  });

  it("accepts dockerfile standalone without start script change", () => {
    const df = "COPY --from=builder /app/.next/standalone ./";
    expect(dockerfileUsesStandalone(df)).toBe(true);
    const v = verdictNextStandalone({
      pkg: {
        dependencies: { next: "15.0.0" },
        scripts: { start: "next start" },
      },
      nextConfig: "output: 'standalone'",
      dockerfile: df,
    });
    expect(v.missing).toBe(false);
    expect(v.dockerfileStandalone).toBe(true);
    expect(v.startMismatch).toBe(false);
  });

  it("warns when config has standalone but start still uses next start", () => {
    const v = verdictNextStandalone({
      pkg: {
        dependencies: { next: "15.0.0" },
        scripts: { start: "next start" },
      },
      nextConfig: "output: 'standalone'",
      dockerfile: null,
    });
    expect(v.missing).toBe(false);
    expect(v.startMismatch).toBe(true);
  });
});
