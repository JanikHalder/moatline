import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("db", () => ({
  orgIntegrations: {},
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.rows) }),
    }),
  },
}));

import { notify } from "./notify";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.rows = [];
  fetchMock = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

const event = { type: "new_critical_cve" as const, title: "T", message: "M" };

describe("notify", () => {
  it("does nothing when there is no integration row", async () => {
    await notify("org1", event);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Slack and Telegram when configured", async () => {
    state.rows = [
      {
        slackWebhookUrl: "https://hooks.slack.com/x",
        telegramBotToken: "bot123",
        telegramChatId: "42",
      },
    ];
    await notify("org1", event);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("https://hooks.slack.com/x");
    expect(urls.some((u) => u.includes("api.telegram.org/botbot123"))).toBe(
      true
    );
  });

  it("is best-effort: a failing channel does not block the others or throw", async () => {
    state.rows = [
      {
        slackWebhookUrl: "https://hooks.slack.com/x",
        telegramBotToken: "bot123",
        telegramChatId: "42",
      },
    ];
    fetchMock.mockImplementation((url: string) =>
      url.includes("slack")
        ? Promise.reject(new Error("slack down"))
        : Promise.resolve(new Response("ok", { status: 200 }))
    );
    await expect(notify("org1", event)).resolves.toBeUndefined();
    expect(
      fetchMock.mock.calls.some((c) =>
        (c[0] as string).includes("api.telegram.org")
      )
    ).toBe(true);
  });
});

describe("telegram", () => {
  const TOKEN = "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("finds the chats that wrote to the bot", async () => {
    const { findTelegramChats } = await import("./notify");
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: [
          {
            message: { chat: { id: 42, type: "private", first_name: "Alex" } },
          },
          {
            my_chat_member: {
              chat: { id: -100123, type: "supergroup", title: "Ops" },
            },
          },
          {
            message: { chat: { id: 42, type: "private", first_name: "Alex" } },
          },
        ],
      })
    );
    expect(await findTelegramChats(TOKEN)).toEqual([
      { id: "42", title: "Alex", type: "private" },
      { id: "-100123", title: "Ops", type: "supergroup" },
    ]);
  });

  it("reports Telegram's reason without ever echoing the token", async () => {
    const { findTelegramChats } = await import("./notify");
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { ok: false, description: `Conflict: webhook is active for ${TOKEN}` },
        { status: 409 }
      )
    );
    const err = await findTelegramChats(TOKEN).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("webhook is active");
    expect((err as Error).message).not.toContain(TOKEN);
  });
});
