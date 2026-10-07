import { useState } from "react";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { AuthShell } from "@/components/auth-shell";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

const MIN_LENGTH = 8;

export function ResetPassword() {
  const { token } = useSearch({ from: "/reset-password" });
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setLoading(false);
    if (resetError) {
      setError(
        resetError.message ??
          "This reset link is no longer valid. Request a new one."
      );
      return;
    }
    setDone(true);
    setTimeout(() => router.navigate({ to: "/login" }), 1500);
  };

  return (
    <AuthShell
      title={tx("Choose a new password")}
      description={tx("At least {n} characters.", { n: MIN_LENGTH })}
    >
      {!token ? (
        <>
          <ErrorAlert>
            {tx("This link is missing its reset token. Request a new one.")}
          </ErrorAlert>
          <Button asChild className="w-full">
            <Link to="/forgot-password">{tx("Request a new link")}</Link>
          </Button>
        </>
      ) : done ? (
        <Alert variant="success" role="status">
          <CheckCircle2 />
          <AlertDescription>
            {tx("Password changed. Taking you to the sign-in page…")}
          </AlertDescription>
        </Alert>
      ) : (
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="reset-password">{tx("New password")}</Label>
            <Input
              id="reset-password"
              type="password"
              placeholder={tx("New password")}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reset-confirm">{tx("Repeat new password")}</Label>
            <Input
              id="reset-confirm"
              type="password"
              placeholder={tx("Repeat new password")}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <Button type="submit" disabled={loading}>
            {loading && <Spinner />}
            {loading ? tx("Saving…") : tx("Set new password")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
