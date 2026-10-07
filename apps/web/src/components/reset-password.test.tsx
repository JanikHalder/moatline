import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResetPassword } from "./reset-password";

const resetPassword = vi.fn();
let search: { token?: string } = { token: "tok-1" };
const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => search,
  useRouter: () => ({ navigate }),
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { resetPassword: (...a: unknown[]) => resetPassword(...a) },
}));

const fill = (value: string, confirm: string) => {
  const fields = screen.getAllByPlaceholderText(/password/i);
  fireEvent.change(fields[0], { target: { value } });
  fireEvent.change(fields[1], { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
};

describe("ResetPassword", () => {
  beforeEach(() => {
    resetPassword.mockReset();
    navigate.mockReset();
    search = { token: "tok-1" };
  });

  it("sends the new password with the token from the link", async () => {
    resetPassword.mockResolvedValue({ error: null });
    render(<ResetPassword />);
    fill("NewPassword123", "NewPassword123");

    await waitFor(() => expect(resetPassword).toHaveBeenCalledOnce());
    expect(resetPassword.mock.calls[0][0]).toEqual({
      newPassword: "NewPassword123",
      token: "tok-1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /password changed/i
    );
  });

  it("refuses two passwords that do not match", async () => {
    render(<ResetPassword />);
    fill("NewPassword123", "Typo123456");

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("refuses a password that is too short", async () => {
    render(<ResetPassword />);
    fill("short", "short");

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8/i);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("explains a spent or invalid link instead of failing silently", async () => {
    resetPassword.mockResolvedValue({ error: { message: "Invalid token" } });
    render(<ResetPassword />);
    fill("NewPassword123", "NewPassword123");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid token");
  });

  it("asks for a new link when the URL carries no token", () => {
    search = {};
    render(<ResetPassword />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /missing its reset token/i
    );
  });
});
