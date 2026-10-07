import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GithubRepoPicker } from "./github-repo-picker";

const repo = vi.hoisted(() => (fullName: string, connected = false) => ({
  fullName,
  url: `https://github.com/${fullName}`,
  defaultBranch: "main",
  private: true,
  pushedAt: null,
  description: null,
  language: "TypeScript",
  connected,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getGithubRepos: vi.fn().mockResolvedValue({
      repos: [repo("acme/shop"), repo("acme/blog"), repo("acme/old", true)],
    }),
  },
}));

describe("GithubRepoPicker", () => {
  it("lists only repositories that are not connected yet, and filters", async () => {
    const onChange = vi.fn();
    render(
      <GithubRepoPicker
        selected={[]}
        onChange={onChange}
        onUnavailable={vi.fn()}
      />
    );
    expect(await screen.findByText("acme/shop")).toBeTruthy();
    expect(screen.queryByText("acme/old")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "blog" },
    });
    expect(screen.queryByText("acme/shop")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "acme/blog" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ fullName: "acme/blog" }),
    ]);
  });
});
