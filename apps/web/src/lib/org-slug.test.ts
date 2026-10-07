import { describe, it, expect } from "vitest";
import { slugifyOrgName } from "./org-slug";

describe("slugifyOrgName", () => {
  it("lowercases and hyphenates a display name", () => {
    expect(slugifyOrgName("Acme Inc")).toMatch(/^acme-inc-[a-z0-9]{6}$/);
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyOrgName("  Foo & Bar!! ")).toMatch(/^foo-bar-[a-z0-9]{6}$/);
  });

  it("still produces a slug for names without ASCII letters", () => {
    expect(slugifyOrgName("!!!")).toMatch(/^org-[a-z0-9]{6}$/);
  });

  it("gives two orgs with the same name distinct slugs", () => {
    expect(slugifyOrgName("Acme")).not.toBe(slugifyOrgName("Acme"));
  });
});
