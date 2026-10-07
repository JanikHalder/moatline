import { describe, expect, it } from "vitest";
import { de } from "@/locales/de";
import { translate } from "./i18n";

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("translates, fills placeholders and falls back to English", () => {
    expect(translate("de", "Repositories")).toBe("Repositories");
    expect(translate("de", "{n} critical", { n: 3 })).toBe("3 kritisch");
    expect(translate("en", "{n} critical", { n: 3 })).toBe("3 critical");
    expect(translate("de", "Not translated yet")).toBe("Not translated yet");
  });

  it("keeps every placeholder in every German text", () => {
    for (const [key, value] of Object.entries(de))
      expect(placeholders(value), key).toEqual(placeholders(key));
  });
});
