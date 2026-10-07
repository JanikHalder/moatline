import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The form links to the password-reset page, which needs a router context.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const mode = vi.hoisted(() => ({
  value: { cloud: false, signupOpen: false, emailVerification: false } as {
    cloud: boolean;
    signupOpen: boolean;
    firstAccount?: boolean;
    emailVerification: boolean;
  },
}));
vi.mock("@/lib/system-mode", () => ({ useSystemMode: () => mode.value }));

import { LoginForm, safeNext } from "./login-form";

beforeEach(() => {
  mode.value = { cloud: false, signupOpen: false, emailVerification: false };
  window.history.replaceState(null, "", "/login");
});

describe("LoginForm", () => {
  it("signs in, with the reset link and no sign-up where registration is closed", () => {
    render(<LoginForm />);
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /forgot password/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign up$/i })).toBeNull();
    expect(
      screen.getByText(/registration is by invitation/i)
    ).toBeInTheDocument();
  });

  it("switches to a sign-up form with a name when sign-up is open", () => {
    mode.value = { cloud: true, signupOpen: true, emailVerification: true };
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    expect(screen.getByText("Create your account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Your name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i })
    ).toBeInTheDocument();
  });

  it("sets up a fresh instance with the first account", () => {
    mode.value = {
      cloud: false,
      signupOpen: true,
      firstAccount: true,
      emailVerification: false,
    };
    render(<LoginForm />);
    expect(screen.getByText("Set up Moatline")).toBeInTheDocument();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
  });

  it("shows and hides the password", () => {
    render(<LoginForm />);
    const input = screen.getByPlaceholderText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(input.type).toBe("text");
  });
});

describe("safeNext", () => {
  it("only returns to paths inside the app", () => {
    expect(safeNext("/accept-invitation/x")).toBe("/accept-invitation/x");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("/\\evil")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});
