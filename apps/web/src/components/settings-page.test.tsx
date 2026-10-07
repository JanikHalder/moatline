import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./settings-page";

vi.mock("@/lib/api", () => ({
  api: {
    getBilling: vi.fn().mockResolvedValue({ enabled: false }),
    getUpdateStatus: vi.fn().mockResolvedValue({ hidden: true }),
    getStatusPages: vi.fn().mockResolvedValue({ pages: [] }),
    getRepos: vi.fn().mockResolvedValue([]),
    getOrgIntegrations: vi.fn().mockResolvedValue({
      githubTokenSet: true,
      dokployBaseUrl: "https://panel.example.com",
      dokployTokenSet: true,
      slackWebhookUrlSet: false,
      telegramBotTokenSet: false,
      telegramChatId: null,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassSet: false,
      smtpFrom: null,
      notifyEmailTo: null,
      kumaBaseUrl: "https://status.example.com",
      kumaApiKeySet: true,
      wazuhApiUrl: null,
      wazuhUser: null,
      wazuhPasswordSet: false,
      wazuhCaCertSet: false,
    }),
    updateOrgIntegrations: vi.fn().mockResolvedValue({ ok: true }),
    getApiKeys: vi.fn().mockResolvedValue([]),
  },
}));

describe("SettingsPage", () => {
  it("renders integration sections and reflects configured secrets", async () => {
    render(<SettingsPage />);
    await screen.findByText("Integrations");
    expect(screen.getByText("Dokploy (auto-deploy)")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();

    // plain field shows the stored value
    const baseUrl = screen.getByLabelText(/Base URL/i) as HTMLInputElement;
    expect(baseUrl.value).toBe("https://panel.example.com");

    // secret field is write-only and shows a "configured" placeholder
    const token = screen.getByLabelText(/API token/i) as HTMLInputElement;
    expect(token.value).toBe("");
    expect(token.placeholder).toMatch(/configured/i);

    // The GitHub token is write-only in the same way.
    const github = screen.getByLabelText(/^access token$/i) as HTMLInputElement;
    expect(github.value).toBe("");
    expect(github.placeholder).toMatch(/configured/i);

    // Server-monitoring integrations follow the same rules.
    expect(
      (screen.getByLabelText(/Uptime Kuma URL/i) as HTMLInputElement).value
    ).toBe("https://status.example.com");
    const kumaKey = screen.getByLabelText("API key") as HTMLInputElement;
    expect(kumaKey.value).toBe("");
    expect(kumaKey.placeholder).toMatch(/configured/i);
    expect(screen.getByLabelText(/Manager API URL/i)).toBeInTheDocument();
  });
});
