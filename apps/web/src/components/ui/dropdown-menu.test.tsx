import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function Menu({ onPick = vi.fn() }: { onPick?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onPick}>First</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Radix opens on pointerdown (which jsdom cannot fully emulate) or on the
// keyboard; Enter is the reliable path here and is what keyboard users press.
const open = (trigger: HTMLElement) =>
  fireEvent.keyDown(trigger, { key: "Enter" });

describe("DropdownMenu", () => {
  it("stays closed until the trigger is activated", () => {
    render(<Menu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    open(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes after picking an item and reports the click", async () => {
    const onPick = vi.fn();
    render(<Menu onPick={onPick} />);

    open(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "First" }));

    expect(onPick).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
  });

  it("closes on Escape", async () => {
    render(<Menu />);
    open(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
  });

  it("closes on an outside pointer press", async () => {
    render(<Menu />);
    open(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Radix only starts listening for outside presses one tick after opening,
    // so the click that opened a menu cannot also close it.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
  });

  it("renders the trigger as a single button, not a nested one", () => {
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger.querySelector("button")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
