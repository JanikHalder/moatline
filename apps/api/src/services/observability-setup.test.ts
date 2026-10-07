import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {} }));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));

import { openobserveCompose, strongPassword } from "./observability-setup";

describe("OpenObserve setup", () => {
  it("makes passwords OpenObserve accepts and Compose leaves alone", () => {
    for (let i = 0; i < 50; i++) {
      const pw = strongPassword();
      expect(pw).toHaveLength(24);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/\d/);
      expect(pw).toMatch(/[!@#%^*\-_+=]/);
      expect(pw).not.toMatch(/[$"'\\]/);
    }
  });

  it("pins the image and quotes the credentials", () => {
    const yml = openobserveCompose("a@b.at", "Pw1!x");
    expect(yml).toContain("image: openobserve/openobserve:v1.0.4");
    expect(yml).toContain('ZO_ROOT_USER_PASSWORD: "Pw1!x"');
    expect(yml).toContain("openobserve-data:/data");
  });
});
