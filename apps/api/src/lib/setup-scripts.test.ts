import { describe, it, expect } from "vitest";
import { setupScriptStates } from "./setup-scripts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const current = {
  "harden-server.sh": A,
  "auto-update.sh": A,
  "setup-github-runner.sh": A,
};

describe("setupScriptStates", () => {
  it("knows nothing when the agent does not report stamps", () => {
    expect(setupScriptStates(null, current)).toEqual({
      reported: false,
      scripts: [],
    });
  });

  it("compares each stamp with the script the app serves now", () => {
    const res = setupScriptStates(
      [
        { name: "harden-server.sh", sha256: A, ranAt: "2026-11-01T10:00:00Z" },
        { name: "auto-update.sh", sha256: B, ranAt: "2026-10-01T10:00:00Z" },
      ],
      current
    );
    expect(res.reported).toBe(true);
    expect(res.scripts).toEqual([
      {
        name: "harden-server.sh",
        state: "current",
        ranAt: "2026-11-01T10:00:00Z",
      },
      {
        name: "auto-update.sh",
        state: "outdated",
        ranAt: "2026-10-01T10:00:00Z",
      },
    ]);
  });

  it("lists expected scripts without a stamp as never run", () => {
    const res = setupScriptStates([], current);
    expect(res.scripts.map((s) => [s.name, s.state])).toEqual([
      ["harden-server.sh", "never"],
      ["auto-update.sh", "never"],
    ]);
  });

  it("shows optional scripts only once they ran, and ignores unknown names", () => {
    const res = setupScriptStates(
      [
        { name: "setup-github-runner.sh", sha256: A },
        { name: "something-else.sh", sha256: A },
      ],
      current
    );
    expect(res.scripts.map((s) => s.name)).toEqual([
      "harden-server.sh",
      "auto-update.sh",
      "setup-github-runner.sh",
    ]);
  });
});
