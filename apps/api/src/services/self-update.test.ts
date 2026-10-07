import { describe, expect, it } from "vitest";
import { updateScript } from "./self-update";

describe("updateScript", () => {
  it("pulls first, pins the version only then, and recreates", () => {
    const s = updateScript("package-checker", "/opt/pc", "1.4.0");
    expect(s.indexOf("pull")).toBeLessThan(s.indexOf("sed -i"));
    expect(s).toContain(
      "PC_VERSION=1.4.0 docker compose -p 'package-checker' pull"
    );
    expect(s).toContain("cd '/opt/pc'");
    expect(s).toContain("s/^PC_VERSION=.*/PC_VERSION=1.4.0/");
    expect(s).toContain("docker compose -p 'package-checker' up -d");
  });
  it("quotes paths safely", () => {
    expect(updateScript("p", "/opt/it's", "1.0.0")).toContain(
      "cd '/opt/it'\\''s'"
    );
  });
});
