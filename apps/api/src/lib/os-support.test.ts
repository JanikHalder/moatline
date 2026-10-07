import { describe, expect, it } from "vitest";
import { osSupport } from "./os-support";

describe("osSupport", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  it("knows Ubuntu and Debian support ends", () => {
    expect(osSupport("Ubuntu 20.04.6 LTS", now)).toMatchObject({
      name: "Ubuntu 20.04",
      status: "eol",
    });
    expect(osSupport("Ubuntu 24.04.1 LTS", now)).toMatchObject({
      status: "ok",
      eol: "2029-05-31",
    });
    // Debian 11 LTS ended in August 2026.
    expect(osSupport("Debian GNU/Linux 11 (bullseye)", now).status).toBe("eol");
    expect(
      osSupport("Ubuntu 22.04.5 LTS", Date.parse("2027-01-10")).status
    ).toBe("soon");
    expect(osSupport("Debian GNU/Linux 12 (bookworm)", now).status).toBe("ok");
  });
  it("says nothing about the unknown", () => {
    expect(osSupport("Rocky Linux 9.4", now).status).toBe("unknown");
    expect(osSupport(null, now).status).toBe("unknown");
  });
});
