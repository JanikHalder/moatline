import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  servers: {},
  serverMetrics: {},
  serverFindings: {},
  storageMetrics: {},
}));

import { agentReportSchema, hostFindings } from "./agent-report";
import {
  buildForecast,
  daysUntil,
  growthPerDay,
  storageFindings,
} from "./storage-watch";

const DAY = 24 * 60 * 60 * 1000;
const GB = 1e9;

function report(usedGb: number, storage?: unknown) {
  return agentReportSchema.parse({
    v: 1,
    agentVersion: "1.14.0",
    sentAt: new Date().toISOString(),
    kind: "metrics",
    host: {
      hostname: "s3-01",
      cpuCount: 2,
      load: [0.1, 0.1, 0.1],
      memory: { totalBytes: 4e9, availableBytes: 3e9 },
      disks: [{ mount: "/data", totalBytes: 500 * GB, usedBytes: usedGb * GB }],
    },
    storage,
  });
}

const minio = (sizeGb: number) => ({
  items: [
    {
      name: "minio",
      kind: "minio",
      container: "minio-1",
      paths: ["/data/minio"],
      sizeBytes: sizeGb * GB,
      folders: [
        { name: "backups", sizeBytes: sizeGb * 0.8 * GB },
        { name: "media", sizeBytes: sizeGb * 0.2 * GB },
      ],
      disk: { mount: "/data", totalBytes: 500 * GB, usedBytes: 300 * GB },
    },
  ],
});

/** Hourly samples over `days` days, growing `perDay` bytes a day. */
function series(days: number, start: number, perDay: number) {
  return Array.from({ length: days * 24 + 1 }, (_, h) => ({
    t: h * (DAY / 24),
    used: start + (perDay * h) / 24,
  }));
}

describe("growthPerDay", () => {
  it("measures steady growth", () => {
    expect(growthPerDay(series(3, 100 * GB, 10 * GB))).toBeCloseTo(10 * GB, -3);
  });

  it("says nothing with less than two days of history", () => {
    expect(growthPerDay(series(1, 100 * GB, 10 * GB))).toBeNull();
  });

  it("does not take one big upload for a trend", () => {
    const s = series(7, 100 * GB, 0);
    for (const x of s.slice(-24)) x.used += 50 * GB;
    // A jump on the last day reads as far less than 50 GB a day.
    expect(growthPerDay(s)!).toBeLessThan(15 * GB);
  });
});

describe("daysUntil", () => {
  it("never forecasts a store that shrinks", () => {
    expect(daysUntil(10, 100, -1)).toBeNull();
    expect(daysUntil(10, 100, null)).toBeNull();
    expect(daysUntil(10, 100, 10)).toBe(9);
  });
});

describe("storageFindings", () => {
  it("warns before a disk fills up, naming the store on it", () => {
    const r = report(300, minio(200));
    const growth = new Map([["disk:/data", 20 * GB]]);
    const [f] = storageFindings(r, [], growth, 85);
    expect(f!.fingerprint).toBe("disk-forecast:/data");
    expect(f!.title).toBe("Disk /data will be full in about 10 days");
    expect(f!.severity).toBe("medium");
    expect(f!.detail).toContain('MinIO storage "minio" takes 200 GB');
    expect(f!.detail).toContain("backups 160 GB");
    expect(f!.detail).toContain("mc ilm rule add");
  });

  it("leaves a disk over its threshold to the disk-full finding", () => {
    const r = report(450);
    const growth = new Map([["disk:/data", 20 * GB]]);
    expect(storageFindings(r, [], growth, 85)).toEqual([]);
    const full = hostFindings(r, {
      cpuThreshold: 90,
      memoryThreshold: 90,
      diskThreshold: 85,
    }).find((f) => f.fingerprint === "disk:/data");
    expect(full).toBeDefined();
  });

  it("flags a store over its limit, and one about to reach it", () => {
    const over = storageFindings(
      report(300, minio(210)),
      [{ name: "minio", path: null, limitGb: 200 }],
      new Map(),
      85
    );
    expect(over[0]!.fingerprint).toBe("storage:limit:minio");
    expect(over[0]!.severity).toBe("high");
    expect(over[0]!.title).toBe(
      'MinIO storage "minio" is over its limit: 210 GB of 200 GB'
    );

    const soon = storageFindings(
      report(300, minio(150)),
      [{ name: "minio", path: null, limitGb: 200 }],
      new Map([["storage:minio", 10 * GB]]),
      85
    );
    expect(soon[0]!.fingerprint).toBe("storage:forecast:minio");
    expect(soon[0]!.title).toBe(
      'MinIO storage "minio" reaches its 200 GB limit in about 5 days'
    );
  });

  it("reports a watched folder that is gone", () => {
    const r = report(100, {
      items: [
        {
          name: "uploads",
          kind: "folder",
          paths: [],
          error: "folder not found",
        },
      ],
    });
    const [f] = storageFindings(r, [], new Map(), 85);
    expect(f!.fingerprint).toBe("storage:error:uploads");
    expect(f!.severity).toBe("medium");
  });
});

describe("buildForecast", () => {
  it("gives days left against the limit for stores and the disk for disks", () => {
    const f = buildForecast(
      report(300, minio(150)),
      [{ name: "minio", path: null, limitGb: 200 }],
      new Map([
        ["disk:/data", 20 * GB],
        ["storage:minio", 10 * GB],
      ])
    );
    expect(f["disk:/data"]!.daysLeft).toBe(10);
    expect(f["storage:minio"]!.daysLeft).toBe(5);
  });
});
