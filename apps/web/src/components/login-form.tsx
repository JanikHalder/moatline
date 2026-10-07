import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  GitPullRequest,
  MailCheck,
  Rocket,
  Server,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpCode } from "@/components/otp-code";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { ErrorAlert } from "@/components/error-alert";
import { authError } from "@/lib/auth-errors";
import { tx } from "@/lib/i18n";
import { useSystemMode } from "@/lib/system-mode";

const TWO_FACTOR_PENDING = "pc-two-factor-pending";
// The address waiting for its confirmation link. Kept like the 2FA step:
// signing up refetches the session, which remounts this form.
const CONFIRM_PENDING = "pc-confirm-pending";
const MIN_PASSWORD = 8;

type View = "signin" | "signup" | "check-email";

/** A path inside the app to return to after signing in, never elsewhere. */
export function safeNext(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")
    ? v
    : null;
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        placeholder={tx("Password")}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={shown ? tx("Hide password") : tx("Show password")}
        tabIndex={-1}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** What Moatline does, next to the form on wide screens. */
function BrandPanel() {
  const points = [
    {
      icon: GitPullRequest,
      title: tx("Vulnerabilities fixed by pull request"),
      text: tx(
        "Lockfile scans, fixes that keep your framework on one version."
      ),
    },
    {
      icon: Rocket,
      title: tx("Deploys that roll back when they break"),
      text: tx("Through Dokploy, Coolify, Komodo or Portainer."),
    },
    {
      icon: Server,
      title: tx("Servers, backups and domains in view"),
      text: tx("Disks filling up, updates, certificates — before they hurt."),
    },
  ];
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-[#12241b] p-10 text-white lg:flex">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Logo className="size-8" />
        Moatline
      </div>
      <div className="space-y-8">
        <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">
          {tx("Security and operations for self-hosted apps.")}
        </p>
        <ul className="space-y-5">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <p.icon className="size-4 text-emerald-300" />
              </span>
              <span>
                <span className="block font-medium">{p.title}</span>
                <span className="block text-sm text-white/60">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-white/40">moatline.dev</p>
    </div>
  );
}

export function LoginForm() {
  const params = new URLSearchParams(window.location.search);
  const next = safeNext(params.get("next"));
  const invited = !!next?.startsWith("/accept-invitation/");
  const mode = useSystemMode();
  const canSignUp = !!mode?.signupOpen || invited;
  const firstAccount = !!mode?.firstAccount;

  const pending = sessionStorage.getItem(CONFIRM_PENDING);
  const [view, setViewState] = useState<View>(
    pending
      ? "check-email"
      : params.get("mode") === "signup"
        ? "signup"
        : "signin"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState(pending ?? params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(0);

  // A fresh instance has no account to sign in to: start with setting up.
  useEffect(() => {
    if (firstAccount) setViewState("signup");
  }, [firstAccount]);

  // Second step for accounts with two-factor authentication: the password
  // was right, Better Auth now waits for a code from the authenticator app.
  //
  // Kept in sessionStorage: the sign-in triggers a session refetch that
  // remounts this form, and component state alone would drop the user back
  // at the password step.
  const [needsCode, setNeedsCodeState] = useState(
    () => sessionStorage.getItem(TWO_FACTOR_PENDING) === "1"
  );
  const setNeedsCode = (v: boolean) => {
    if (v) sessionStorage.setItem(TWO_FACTOR_PENDING, "1");
    else sessionStorage.removeItem(TWO_FACTOR_PENDING);
    setNeedsCodeState(v);
  };
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  const callbackURL = `${window.location.origin}${next ?? "/"}`;

  const setView = (v: View) => {
    if (v === "check-email") sessionStorage.setItem(CONFIRM_PENDING, email);
    else sessionStorage.removeItem(CONFIRM_PENDING);
    setViewState(v);
  };
  const switchTo = (v: View) => {
    setView(v);
    setError(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL,
      });
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        // Signing in unconfirmed sends a fresh link.
        switchTo("check-email");
      } else if (result.error) {
        setError(authError(result.error, tx("Sign in failed")));
      } else if (
        (result.data as { twoFactorRedirect?: boolean } | null)
          ?.twoFactorRedirect
      ) {
        setNeedsCode(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Sign in failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(tx("The password needs at least 8 characters."));
      return;
    }
    setLoading(true);
    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name: name.trim() || email.split("@")[0] || "User",
        callbackURL,
      });
      if (result.error) {
        setError(authError(result.error, tx("Sign up failed")));
      } else if (!result.data?.token) {
        // Signed up, but not signed in: the address needs confirming.
        switchTo("check-email");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Sign up failed"));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await authClient.sendVerificationEmail({ email, callbackURL });
      if (r.error) setError(authError(r.error, tx("Could not send the link")));
      else setResent(Date.now());
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({
            code: code.trim(),
            trustDevice,
          })
        : await authClient.twoFactor.verifyTotp({
            code: code.replace(/\s/g, ""),
            trustDevice,
          });
      if (result.error) {
        setError(authError(result.error, tx("That code did not work")));
      } else {
        setNeedsCode(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Verification failed"));
    } finally {
      setLoading(false);
    }
  };

  const heading = needsCode
    ? {
        title: tx("Two-factor authentication"),
        text: useBackup
          ? tx("Enter one of your backup codes.")
          : tx("Enter the 6-digit code from your authenticator app."),
      }
    : view === "check-email"
      ? {
          title: tx("Check your inbox"),
          text: tx(
            "We sent a link to {email}. Open it to confirm your address — then you are signed in.",
            { email }
          ),
        }
      : view === "signup"
        ? firstAccount
          ? {
              title: tx("Set up Moatline"),
              text: tx(
                "Create the first account. It owns this instance and can invite everyone else."
              ),
            }
          : invited
            ? {
                title: tx("Create your account"),
                text: tx(
                  "Use the address the invitation was sent to — then you join your team."
                ),
              }
            : {
                title: tx("Create your account"),
                text: tx("It takes a minute."),
              }
        : {
            title: tx("Welcome back"),
            text: invited
              ? tx("Sign in to accept the invitation.")
              : tx("Sign in to Moatline."),
          };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-center justify-center bg-muted/40 p-6 md:p-10 lg:bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 font-semibold lg:hidden">
              <Logo className="size-8" />
              <span>Moatline</span>
            </div>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {heading.title}
              </h1>
              <p className="text-sm text-muted-foreground">{heading.text}</p>
            </div>
          </div>

          {needsCode ? (
            <form className="grid gap-4" onSubmit={handleCode}>
              <div className="grid gap-2">
                <Label htmlFor="login-code">
                  {useBackup ? tx("Backup code") : tx("Authentication code")}
                </Label>
                {useBackup ? (
                  <Input
                    id="login-code"
                    autoComplete="one-time-code"
                    placeholder="xxxxx-xxxxx"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    required
                    className="font-mono tracking-widest"
                  />
                ) : (
                  <>
                    <OtpCode
                      id="login-code"
                      value={code}
                      onChange={setCode}
                      // Six digits are all there is: check right away.
                      onComplete={() => void handleCode()}
                    />
                    <p className="text-xs text-muted-foreground">
                      {tx(
                        "Enter the 6-digit code from your authenticator app."
                      )}
                    </p>
                  </>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={trustDevice}
                  onCheckedChange={(v) => setTrustDevice(v === true)}
                />
                {tx("Trust this device for 30 days")}
              </label>
              {error && <ErrorAlert>{error}</ErrorAlert>}
              <Button
                type="submit"
                disabled={
                  loading || (useBackup ? !code.trim() : code.length < 6)
                }
              >
                {loading && <Spinner />}
                {tx("Verify")}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    setUseBackup(!useBackup);
                    setCode("");
                    setError(null);
                  }}
                >
                  {useBackup
                    ? tx("Use the authenticator app instead")
                    : tx("Lost your phone? Use a backup code")}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    setNeedsCode(false);
                    setCode("");
                    setError(null);
                  }}
                >
                  {tx("Back to sign in")}
                </button>
              </div>
            </form>
          ) : view === "check-email" ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3 rounded-lg border bg-background p-4 text-sm">
                <MailCheck className="size-5 shrink-0 text-success" />
                <span>
                  {tx(
                    "Not there after a minute? Look in the spam folder, or send the link again."
                  )}
                </span>
              </div>
              {error && <ErrorAlert>{error}</ErrorAlert>}
              {resent > 0 && (
                <p role="status" className="text-sm text-success">
                  {tx("Sent again.")}
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => void resend()}
                disabled={loading}
              >
                {loading && <Spinner />}
                {tx("Send the link again")}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => switchTo("signin")}
              >
                {tx("Back to sign in")}
              </button>
            </div>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={view === "signup" ? handleSignUp : handleSignIn}
            >
              {view === "signup" && (
                <div className="grid gap-2">
                  <Label htmlFor="login-name">{tx("Name")}</Label>
                  <Input
                    id="login-name"
                    placeholder={tx("Your name")}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="login-email">{tx("Email")}</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder={tx("Email")}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus={view === "signin"}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">{tx("Password")}</Label>
                  {view === "signin" && (
                    <Link
                      to="/forgot-password"
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {tx("Forgot password?")}
                    </Link>
                  )}
                </div>
                <PasswordInput
                  id="login-password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={
                    view === "signup" ? "new-password" : "current-password"
                  }
                />
                {view === "signup" && (
                  <p
                    className={
                      password && password.length < MIN_PASSWORD
                        ? "text-xs text-warning"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {tx("At least 8 characters.")}
                  </p>
                )}
              </div>
              {error && <ErrorAlert>{error}</ErrorAlert>}
              <Button type="submit" disabled={loading}>
                {loading && <Spinner />}
                {view === "signup"
                  ? firstAccount
                    ? tx("Create the account")
                    : tx("Create account")
                  : tx("Sign in")}
              </Button>
              {view === "signin" ? (
                canSignUp ? (
                  <p className="text-center text-sm text-muted-foreground">
                    {tx("No account yet?")}{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      onClick={() => switchTo("signup")}
                    >
                      {tx("Sign up")}
                    </button>
                  </p>
                ) : mode && !mode.cloud ? (
                  <p className="text-center text-xs text-muted-foreground">
                    {tx(
                      "No account yet? Registration is by invitation — ask an owner of your organization."
                    )}
                  </p>
                ) : null
              ) : (
                !firstAccount && (
                  <p className="text-center text-sm text-muted-foreground">
                    {tx("Already have an account?")}{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      onClick={() => switchTo("signin")}
                    >
                      {tx("Sign in")}
                    </button>
                  </p>
                )
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
