import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BranchSelect } from "./branch-select";

const mocks = vi.hoisted(() => ({ getBranches: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getBranches: mocks.getBranches } }));

describe("BranchSelect", () => {
  it("lists the branches the token can read", async () => {
    mocks.getBranches.mockResolvedValue({ branches: ["main", "develop"] });
    render(
      <BranchSelect
        id="b"
        githubUrl="https://github.com/acme/shop"
        value="main"
        onChange={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(mocks.getBranches).toHaveBeenCalledWith(
        "https://github.com/acme/shop"
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(false)
    );
  });

  it("falls back to typing when the host refuses", async () => {
    mocks.getBranches.mockRejectedValue(new Error("no token"));
    render(
      <BranchSelect
        id="b"
        githubUrl="https://github.com/acme/shop"
        value="main"
        onChange={vi.fn()}
      />
    );
    expect(
      await screen.findByDisplayValue("main", {}, { timeout: 2000 })
    ).toBeTruthy();
  });
});
