import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSystemEmail, systemMail } from "./system-mail";

const KEYS = ["RESEND_API_KEY", "MAIL_FROM", "SMTP_HOST", "SMTP_FROM"];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("systemMail", () => {
  it("sends nothing without Resend or SMTP", () => {
    expect(systemMail()).toBeNull();
  });

  it("prefers Resend over SMTP", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.MAIL_FROM = "Moatline <noreply@example.com>";
    expect(systemMail()).toMatchObject({
      kind: "resend",
      from: "Moatline <noreply@example.com>",
    });
  });

  it("posts to Resend and reports a refusal as not sent", async () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.MAIL_FROM = "noreply@example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response("domain not verified", { status: 403 })
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendSystemEmail("a@example.com", "Hi", "Body")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_x");
    expect(JSON.parse(init.body)).toEqual({
      from: "noreply@example.com",
      to: ["a@example.com"],
      subject: "[Moatline] Hi",
      text: "Body",
    });

    expect(await sendSystemEmail("a@example.com", "Hi", "Body")).toBe(false);
  });
});
