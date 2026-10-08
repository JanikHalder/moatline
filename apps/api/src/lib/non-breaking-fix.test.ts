import { describe, it, expect } from "vitest";
import {
  declaredDepsChanged,
  isNonBreakingSecurityChange,
  lockedMajorBumps,
} from "./non-breaking-fix";

describe("declaredDepsChanged", () => {
  it("is false when ranges match", () => {
    expect(
      declaredDepsChanged({ lodash: "^4.17.0" }, { lodash: "^4.17.0" })
    ).toBe(false);
  });
  it("is true when a range moves", () => {
    expect(
      declaredDepsChanged({ lodash: "^4.17.0" }, { lodash: "^5.0.0" })
    ).toBe(true);
  });
  it("is true when a package is added or removed", () => {
    expect(declaredDepsChanged({}, { lodash: "^4.17.0" })).toBe(true);
    expect(declaredDepsChanged({ lodash: "^4.17.0" }, {})).toBe(true);
  });
});

describe("lockedMajorBumps", () => {
  it("reports packages whose highest major rose", () => {
    expect(
      lockedMajorBumps(
        [
          { name: "lodash", version: "4.17.21" },
          { name: "left-pad", version: "1.3.0" },
        ],
        [
          { name: "lodash", version: "5.0.0" },
          { name: "left-pad", version: "1.3.1" },
        ]
      )
    ).toEqual(["lodash 4→5"]);
  });
  it("ignores within-major bumps", () => {
    expect(
      lockedMajorBumps(
        [{ name: "lodash", version: "4.17.20" }],
        [{ name: "lodash", version: "4.17.21" }]
      )
    ).toEqual([]);
  });
});

describe("isNonBreakingSecurityChange", () => {
  const ok = {
    onlyAllowedFiles: true,
    declaredDepsUnchanged: true,
    majorBumps: [] as string[],
    usedForce: false,
  };
  it("accepts lockfile-only within-major fixes", () => {
    expect(isNonBreakingSecurityChange(ok)).toEqual({ ok: true });
  });
  it("rejects force, range edits, foreign files and majors", () => {
    expect(isNonBreakingSecurityChange({ ...ok, usedForce: true }).ok).toBe(
      false
    );
    expect(
      isNonBreakingSecurityChange({ ...ok, declaredDepsUnchanged: false }).ok
    ).toBe(false);
    expect(
      isNonBreakingSecurityChange({ ...ok, onlyAllowedFiles: false }).ok
    ).toBe(false);
    expect(
      isNonBreakingSecurityChange({ ...ok, majorBumps: ["foo 1→2"] }).ok
    ).toBe(false);
  });
});
