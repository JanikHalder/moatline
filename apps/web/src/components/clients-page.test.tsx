import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientsPage } from "./clients-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getClients: vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "Kunstlicht",
        contactEmail: null,
        notes: null,
        language: "de",
        repos: 2,
        down: 0,
        servers: 1,
        domains: 1,
        domainProblems: 1,
      },
    ]),
    getDomains: vi.fn().mockResolvedValue([
      {
        id: "d1",
        name: "kunde.at",
        clientId: null,
        source: "auto",
        checkedAt: null,
        state: {
          cert: {
            ok: true,
            validTo: "2026-10-10T00:00:00Z",
            daysLeft: 6,
            issuer: "Let's Encrypt",
            error: null,
          },
          registration: { expires: null, daysLeft: null },
          mail: {
            mx: ["mx"],
            spf: null,
            dmarc: null,
            dmarcPolicy: null,
            dkim: [],
          },
          problems: [
            {
              id: "cert-expiry",
              severity: "medium",
              text: "Certificate expires in 6 days",
            },
          ],
        },
      },
    ]),
  },
}));

describe("ClientsPage", () => {
  it("shows clients with their state and domains without a client", async () => {
    render(<ClientsPage />);
    expect(await screen.findByText("Kunstlicht")).toBeInTheDocument();
    expect(screen.getByText("1 domain issue")).toBeInTheDocument();
    expect(await screen.findByText("kunde.at")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Certificate expires in 6 days — automatic renewal is not working"
      )
    ).toBeInTheDocument();
  });
});
