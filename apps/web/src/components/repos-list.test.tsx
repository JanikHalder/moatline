import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReposList } from "./repos-list";

// Repo rows link out; the list itself is what is under test, so a plain anchor
// stands in for the router-bound one.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

const repoWithLiveUrl = {
  id: "r1",
  name: "checker",
  githubUrl: "https://github.com/o/r",
  lastScannedAt: null,
  scanSchedule: null,
  lastScanStatus: null,
  nextScanAt: null,
  liveUrl: "https://app.example.com",
  liveStatus: null as "up" | "down" | null,
  liveHttpStatus: null,
  liveCommit: null,
  liveError: null,
  liveCheckedAt: null,
};

vi.mock("@/lib/api", () => ({
  api: {
    getRepos: vi.fn().mockResolvedValue([]),
    getSchedulerStatus: vi.fn().mockResolvedValue({
      enabled: true,
      checkInterval: "*/5 * * * *",
      lastCheckAt: null,
      nextCheckAt: null,
      scheduledRepos: 0,
      lastError: null,
    }),
    createRepo: vi.fn().mockResolvedValue({ id: "new-id" }),
    startScan: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ReposList", () => {
  it("shows loading then empty state", async () => {
    render(<ReposList />);
    expect(screen.getByText(/loading repos/i)).toBeInTheDocument();
    await screen.findByText(/no repos yet/i);
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    // Header action plus the empty-state call to action.
    expect(
      screen.getAllByRole("button", { name: /add repo/i }).length
    ).toBeGreaterThan(0);
  });

  it("shows the live state for repos that have a live URL", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.getRepos).mockResolvedValueOnce([
      { ...repoWithLiveUrl, liveStatus: "down", liveCheckedAt: null },
    ]);
    render(<ReposList />);
    await screen.findByText("Down");
  });

  it("says a live URL is set but unchecked rather than claiming a state", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.getRepos).mockResolvedValueOnce([repoWithLiveUrl]);
    render(<ReposList />);
    await screen.findByText(/live url set/i);
  });

  it("shows no live badge for repos without a live URL", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.getRepos).mockResolvedValueOnce([
      { ...repoWithLiveUrl, liveUrl: null },
    ]);
    render(<ReposList />);
    await screen.findByText("checker");
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
  });

  it("shows CVEs per repository, and searches and filters the list", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.getRepos).mockResolvedValueOnce([
      {
        ...repoWithLiveUrl,
        id: "a",
        name: "shop",
        githubUrl: "https://github.com/acme/shop",
        vulns: { critical: 2, high: 1, moderate: 0, low: 0, fixable: 3 },
        outdated: { total: 4, major: 1 },
      },
      {
        ...repoWithLiveUrl,
        id: "b",
        name: "blog",
        githubUrl: "https://github.com/acme/blog",
        vulns: { critical: 0, high: 0, moderate: 0, low: 0, fixable: 0 },
        outdated: { total: 0, major: 0 },
      },
    ]);
    render(<ReposList />);
    expect((await screen.findAllByText("2 critical")).length).toBeGreaterThan(
      0
    );

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "blog" },
    });
    expect(screen.queryByText("shop")).not.toBeInTheDocument();
    expect(screen.getByText("blog")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /critical & high/i }));
    expect(screen.queryByText("blog")).not.toBeInTheDocument();
    expect(screen.getByText("shop")).toBeInTheDocument();
  });
});
