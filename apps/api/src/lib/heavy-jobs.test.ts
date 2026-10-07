import { describe, it, expect, vi } from "vitest";
import { withHeavySlot } from "./heavy-jobs";
import { lowPriority } from "./run";

describe("withHeavySlot", () => {
  it("runs one job at a time, in order", async () => {
    const events: string[] = [];
    const queued: number[] = [];
    const job = (name: string) => () =>
      new Promise<void>((resolve) => {
        events.push(`start ${name}`);
        setTimeout(() => {
          events.push(`end ${name}`);
          resolve();
        }, 5);
      });
    await Promise.all([
      withHeavySlot(job("a")),
      withHeavySlot(job("b"), (ahead) => {
        queued.push(ahead);
      }),
      withHeavySlot(job("c"), (ahead) => {
        queued.push(ahead);
      }),
    ]);
    expect(events).toEqual([
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
    expect(queued).toEqual([1, 2]);
  });

  it("frees the slot when a job fails", async () => {
    await expect(
      withHeavySlot(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    await expect(withHeavySlot(async () => "next")).resolves.toBe("next");
  });
});

describe("lowPriority", () => {
  it("caps the Node heap unless the repo sets its own", () => {
    expect(lowPriority("pnpm", ["build"], {}).env.NODE_OPTIONS).toMatch(
      /--max-old-space-size=\d+/
    );
    expect(
      lowPriority("pnpm", ["build"], {
        NODE_OPTIONS: "--max-old-space-size=4096",
      }).env.NODE_OPTIONS
    ).toBe("--max-old-space-size=4096");
  });
});

describe("a job that never finishes", () => {
  it("gives the slot up after the cap, so the queue moves on", async () => {
    vi.useFakeTimers();
    void withHeavySlot(() => new Promise<void>(() => {}));
    let ran = false;
    const second = withHeavySlot(async () => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(39 * 60 * 1000);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await second;
    expect(ran).toBe(true);
    vi.useRealTimers();
  });
});
