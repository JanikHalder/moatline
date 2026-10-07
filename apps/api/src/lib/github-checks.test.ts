import { describe, it, expect, vi, afterEach } from "vitest";
import { getRefChecks, waitForChecks } from "./github";

afterEach(() => vi.restoreAllMocks());

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** check-runs and the combined status are fetched together, in that order. */
const respond = (runs: unknown, status: unknown) =>
  vi.fn((url: string) =>
    Promise.resolve(
      String(url).includes("/check-runs") ? json(runs) : json(status)
    )
  ) as unknown as typeof fetch;

describe("getRefChecks", () => {
  it("reports success when every check passed", async () => {
    globalThis.fetch = respond(
      {
        check_runs: [
          { name: "build", status: "completed", conclusion: "success" },
        ],
      },
      { state: "success", total_count: 1 }
    );
    const res = await getRefChecks("t", "o", "r", "branch");
    expect(res.state).toBe("success");
  });

  it("reports failure and names the failing check", async () => {
    globalThis.fetch = respond(
      {
        check_runs: [
          { name: "build", status: "completed", conclusion: "success" },
          { name: "e2e", status: "completed", conclusion: "failure" },
        ],
      },
      { state: "failure", total_count: 2 }
    );
    const res = await getRefChecks("t", "o", "r", "branch");
    expect(res.state).toBe("failure");
    expect(res.detail).toContain("e2e");
  });

  it("stays pending while a check is still running", async () => {
    globalThis.fetch = respond(
      {
        check_runs: [{ name: "e2e", status: "in_progress", conclusion: null }],
      },
      { state: "pending", total_count: 1 }
    );
    const res = await getRefChecks("t", "o", "r", "branch");
    expect(res.state).toBe("pending");
    expect(res.detail).toContain("e2e");
  });

  it("does not treat a skipped or neutral check as a failure", async () => {
    globalThis.fetch = respond(
      {
        check_runs: [
          {
            name: "deploy-preview",
            status: "completed",
            conclusion: "skipped",
          },
          { name: "lint", status: "completed", conclusion: "neutral" },
        ],
      },
      { state: "success", total_count: 2 }
    );
    expect((await getRefChecks("t", "o", "r", "b")).state).toBe("success");
  });

  it("distinguishes 'no CI at all' from 'everything passed'", async () => {
    globalThis.fetch = respond(
      { check_runs: [] },
      { state: null, total_count: 0 }
    );
    const res = await getRefChecks("t", "o", "r", "branch");
    expect(res.state).toBe("none");
  });

  it("still reports a failing legacy commit status", async () => {
    globalThis.fetch = respond(
      { check_runs: [] },
      { state: "failure", total_count: 1 }
    );
    expect((await getRefChecks("t", "o", "r", "b")).state).toBe("failure");
  });
});

describe("waitForChecks", () => {
  it("polls until the checks settle", async () => {
    let call = 0;
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/check-runs")) {
        call++;
        return Promise.resolve(
          json({
            check_runs: [
              call < 3
                ? { name: "e2e", status: "in_progress", conclusion: null }
                : { name: "e2e", status: "completed", conclusion: "success" },
            ],
          })
        );
      }
      // No legacy commit statuses here – the check runs drive the outcome.
      return Promise.resolve(json({ state: null, total_count: 0 }));
    }) as unknown as typeof fetch;

    const res = await waitForChecks("t", "o", "r", "branch", {
      intervalMs: 1,
      timeoutMs: 5000,
    });
    expect(res.state).toBe("success");
    expect(call).toBe(3);
  });

  it("reports still-pending rather than passing when it runs out of time", async () => {
    globalThis.fetch = respond(
      { check_runs: [{ name: "e2e", status: "queued", conclusion: null }] },
      { state: "pending", total_count: 1 }
    );
    const res = await waitForChecks("t", "o", "r", "branch", {
      intervalMs: 1,
      timeoutMs: 5,
    });
    expect(res.state).toBe("pending");
  });
});
