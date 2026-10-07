import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MembersPage } from "./members-page";

const getFullOrganization = vi.fn();
const listInvitations = vi.fn();
const inviteMember = vi.fn();
const cancelInvitation = vi.fn();

const createMemberDirect = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    createMemberDirect: (...a: unknown[]) => createMemberDirect(...a),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: {
      getFullOrganization: () => getFullOrganization(),
      listInvitations: () => listInvitations(),
      inviteMember: (...a: unknown[]) => inviteMember(...a),
      cancelInvitation: (...a: unknown[]) => cancelInvitation(...a),
      removeMember: vi.fn(),
    },
  },
  useSession: () => ({
    data: {
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    },
  }),
}));

describe("MembersPage", () => {
  beforeEach(() => {
    getFullOrganization.mockResolvedValue({
      data: {
        members: [
          {
            id: "m1",
            role: "owner",
            userId: "user-1",
            user: { name: "Chef", email: "chef@agency.com" },
          },
          {
            id: "m2",
            role: "member",
            userId: "user-2",
            user: { name: "Colleague", email: "colleague@agency.com" },
          },
        ],
      },
      error: null,
    });
    listInvitations.mockResolvedValue({
      data: [
        {
          id: "inv-1",
          email: "pending@agency.com",
          role: "member",
          status: "pending",
          expiresAt: new Date("2030-01-01").toISOString(),
        },
        {
          id: "inv-2",
          email: "gone@agency.com",
          role: "member",
          status: "canceled",
          expiresAt: new Date("2030-01-01").toISOString(),
        },
      ],
      error: null,
    });
    inviteMember.mockResolvedValue({ data: { id: "inv-new" }, error: null });
  });

  it("lists members and only pending invitations", async () => {
    render(<MembersPage />);
    expect(await screen.findByText("chef@agency.com")).toBeInTheDocument();
    expect(screen.getByText("colleague@agency.com")).toBeInTheDocument();
    expect(await screen.findByText("pending@agency.com")).toBeInTheDocument();
    expect(screen.queryByText("gone@agency.com")).not.toBeInTheDocument();
  });

  it("does not offer to remove yourself", async () => {
    render(<MembersPage />);
    await screen.findByText("chef@agency.com");
    // Only the other member gets a Remove button.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("invites a colleague and shows the link to pass on by hand", async () => {
    render(<MembersPage />);
    await screen.findByText("chef@agency.com");

    fireEvent.change(screen.getByPlaceholderText("colleague@agency.com"), {
      target: { value: "new@agency.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => expect(inviteMember).toHaveBeenCalledOnce());
    expect(inviteMember.mock.calls[0][0]).toEqual({
      email: "new@agency.com",
      role: "member",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "/accept-invitation/inv-new"
    );
  });

  it("surfaces an invite error", async () => {
    inviteMember.mockResolvedValue({
      data: null,
      error: { message: "Already a member" },
    });
    render(<MembersPage />);
    await screen.findByText("chef@agency.com");

    fireEvent.change(screen.getByPlaceholderText("colleague@agency.com"), {
      target: { value: "dupe@agency.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already a member"
    );
  });

  it("creates an account without email and shows the password once", async () => {
    createMemberDirect.mockResolvedValue({
      created: true,
      email: "new@agency.com",
      password: "sekrit-generated-pw",
    });
    render(<MembersPage />);
    await screen.findByText("Team");

    fireEvent.change(screen.getByPlaceholderText("new-colleague@agency.com"), {
      target: { value: "new@agency.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(createMemberDirect).toHaveBeenCalledWith({
        email: "new@agency.com",
        name: undefined,
        role: "member",
      })
    );
    expect(await screen.findByText("sekrit-generated-pw")).toBeInTheDocument();
  });

  it("reports why a direct account could not be created", async () => {
    createMemberDirect.mockRejectedValue(
      new Error("Only an owner or admin can add members directly.")
    );
    render(<MembersPage />);
    await screen.findByText("Team");

    fireEvent.change(screen.getByPlaceholderText("new-colleague@agency.com"), {
      target: { value: "new@agency.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText(/only an owner or admin/i)
    ).toBeInTheDocument();
  });
});
