import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { AuthShell } from "@/components/auth-shell";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    const { error: resetError } = await authClient.requestPasswordReset({
      email: trimmed,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message ?? "Could not start the password reset.");
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell
      title={tx("Reset your password")}
      description={tx("We will email you a link to choose a new one.")}
    >
      {sent ? (
        <>
          {/* role="status" rather than the Alert default: this is good news,
              not an interruption. */}
          <Alert variant="success" role="status">
            <MailCheck />
            <AlertDescription>
              {tx(
                "If that address belongs to an account, a reset link is on its way. The link expires in one hour."
              )}
            </AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link to="/login">{tx("Back to sign in")}</Link>
          </Button>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="forgot-email">{tx("Email")}</Label>
            <Input
              id="forgot-email"
              type="email"
              placeholder={tx("Email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <div className="grid gap-2">
            <Button type="submit" disabled={loading || !email.trim()}>
              {loading && <Spinner />}
              {loading ? tx("Sending…") : tx("Send reset link")}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/login">{tx("Cancel")}</Link>
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
