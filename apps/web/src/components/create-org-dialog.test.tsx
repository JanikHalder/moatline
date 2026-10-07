import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateOrgDialog } from "./create-org-dialog";

const create = vi.fn();
const setActive = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: {
      create: (...args: unknown[]) => create(...args),
      setActive: (...args: unknown[]) => setActive(...args),
    },
  },
}));

describe("CreateOrgDialog", () => {
  beforeEach(() => {
    create.mockReset();
    setActive.mockReset();
  });

  const submit = (name: string) => {
    fireEvent.change(screen.getByPlaceholderText(/organization name/i), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  };

  it("sends a slug along with the name and activates the new org", async () => {
    create.mockResolvedValue({ data: { id: "org-1" }, error: null });
    setActive.mockResolvedValue({});
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CreateOrgDialog open onOpenChange={onOpenChange} onCreated={onCreated} />
    );
    submit("Acme Inc");

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toEqual({
      name: "Acme Inc",
      slug: expect.stringMatching(/^acme-inc-[a-z0-9]{6}$/),
    });
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith({ organizationId: "org-1" })
    );
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces the API error instead of failing silently", async () => {
    create.mockResolvedValue({ data: null, error: { message: "Slug taken" } });
    const onCreated = vi.fn();

    render(
      <CreateOrgDialog open onOpenChange={vi.fn()} onCreated={onCreated} />
    );
    submit("Acme Inc");

    expect(await screen.findByRole("alert")).toHaveTextContent("Slug taken");
    expect(setActive).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
