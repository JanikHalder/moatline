import { afterEach, describe, expect, it } from "vitest";
import { isOperator } from "./operator-stats";

describe("isOperator", () => {
  afterEach(() => {
    delete process.env.OPERATOR_EMAILS;
  });
  it("is nobody without OPERATOR_EMAILS", () => {
    expect(isOperator("me@example.com")).toBe(false);
  });
  it("matches the listed addresses, whatever their case", () => {
    process.env.OPERATOR_EMAILS = " Me@Example.com , other@example.com";
    expect(isOperator("me@example.com")).toBe(true);
    expect(isOperator("OTHER@example.com")).toBe(true);
    expect(isOperator("someone@example.com")).toBe(false);
    expect(isOperator(null)).toBe(false);
  });
});
