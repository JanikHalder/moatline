import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { OtpCode } from "@/components/otp-code";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: "enable" | "disable" | "codes" }
  | { kind: "scan"; totpURI: string; qr: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** The secret from an otpauth:// URI, for typing it in by hand. */
function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast.success(tx("Backup codes copied")))
          }
        >
          {tx("Copy")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([text + "\n"], { type: "text/plain" })
            );
            a.download = "moatline-backup-codes.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {tx("Download")}
        </Button>
      </div>
    </div>
  );
}

export function AccountPage() {
  const { data: session, refetch } = useSession();
  const enabled = !!(
    session?.user as { twoFactorEnabled?: boolean | null } | undefined
  )?.twoFactorEnabled;
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving the page mid-setup must not leave a secret on screen.
  useEffect(() => () => setStep({ kind: "idle" }), []);

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
    setError(null);
  };

  const submitPassword = async (purpose: "enable" | "disable" | "codes") => {
    setBusy(true);
    setError(null);
    try {
      if (purpose === "enable") {
        const res = await authClient.twoFactor.enable({ password });
        if (res.error || !res.data) throw new Error(res.error?.message);
        const qr = await QRCode.toDataURL(res.data.totpURI, {
          margin: 1,
          width: 200,
        });
        setStep({
          kind: "scan",
          totpURI: res.data.totpURI,
          qr,
          backupCodes: res.data.backupCodes,
        });
      } else if (purpose === "disable") {
        const res = await authClient.twoFactor.disable({ password });
        if (res.error) throw new Error(res.error.message);
        toast.success(tx("Two-factor authentication turned off"));
        await refetch();
        reset();
      } else {
        const res = await authClient.twoFactor.generateBackupCodes({
          password,
        });
        if (res.error || !res.data) throw new Error(res.error?.message);
        setStep({ kind: "codes", backupCodes: res.data.backupCodes });
      }
      setPassword("");
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : tx("That did not work")
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async (backupCodes: string[]) => {
    setBusy(true);
    setError(null);
    try {
      // Turning 2FA on only takes effect once a code from the app proves the
      // secret was stored — otherwise a botched scan locks the account.
      const res = await authClient.twoFactor.verifyTotp({
        code: code.replace(/\s/g, ""),
      });
      if (res.error) throw new Error(res.error.message);
      await refetch();
      setStep({ kind: "codes", backupCodes });
      setCode("");
      toast.success(tx("Two-factor authentication is on"));
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : tx("That code did not work")
      );
    } finally {
      setBusy(false);
    }
  };

  const passwordForm = (
    purpose: "enable" | "disable" | "codes",
    label: string
  ) => (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submitPassword(purpose);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="account-password">
          {tx("Confirm with your password")}
        </Label>
        <Input
          id="account-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={busy || !password}
          variant={purpose === "disable" ? "destructive" : "default"}
        >
          {busy && <Spinner />}
          {label}
        </Button>
        <Button type="button" variant="ghost" onClick={reset}>
          {tx("Cancel")}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={tx("Account security")}
        description={session?.user?.email ?? undefined}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {enabled ? (
              <ShieldCheck className="size-4 text-success" />
            ) : (
              <ShieldOff className="size-4 text-muted-foreground" />
            )}
            {tx("Two-factor authentication")}
            <Badge variant={enabled ? "success" : "outline"}>
              {enabled ? "on" : "off"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {tx(
              "Signing in also asks for a code from an authenticator app (1Password, Bitwarden, Google Authenticator, …). Required for owners and admins: this app knows every server and holds the integration secrets."
            )}
          </CardDescription>
          {step.kind === "idle" && (
            <CardAction className="flex flex-wrap gap-2">
              {enabled ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setStep({ kind: "password", purpose: "codes" })
                    }
                  >
                    {tx("New backup codes")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setStep({ kind: "password", purpose: "disable" })
                    }
                  >
                    {tx("Turn off")}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    setStep({ kind: "password", purpose: "enable" })
                  }
                >
                  <KeyRound />
                  {tx("Turn on")}
                </Button>
              )}
            </CardAction>
          )}
        </CardHeader>
        {step.kind !== "idle" && (
          <CardContent className="space-y-4">
            {step.kind === "password" &&
              passwordForm(
                step.purpose,
                step.purpose === "enable"
                  ? "Continue"
                  : step.purpose === "disable"
                    ? "Turn off 2FA"
                    : "Generate new codes"
              )}

            {step.kind === "scan" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                  <img
                    src={step.qr}
                    alt={tx("QR code for the authenticator app")}
                    className="size-[200px] shrink-0 rounded-md border bg-white p-1"
                  />
                  <div className="w-full min-w-0 flex-1 space-y-2 text-sm">
                    <p>
                      {tx(
                        "1. Scan the code with your authenticator app, or enter this key by hand:"
                      )}
                    </p>
                    <code className="block break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                      {secretOf(step.totpURI)}
                    </code>
                    <p>{tx("2. Enter the 6-digit code it shows:")}</p>
                    <form
                      className="flex flex-wrap items-center gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void confirmCode(step.backupCodes);
                      }}
                    >
                      <OtpCode
                        label={tx("Code from the authenticator app")}
                        value={code}
                        onChange={setCode}
                      />
                      <Button type="submit" disabled={busy || code.length < 6}>
                        {busy && <Spinner />}
                        {tx("Turn on")}
                      </Button>
                    </form>
                  </div>
                </div>
                {error && <ErrorAlert>{error}</ErrorAlert>}
                <Button variant="ghost" size="sm" onClick={reset}>
                  {tx("Cancel")}
                </Button>
              </div>
            )}

            {step.kind === "codes" && (
              <div className="space-y-3">
                <Alert variant="warning">
                  <KeyRound />
                  <AlertTitle>{tx("Backup codes — shown only now")}</AlertTitle>
                  <AlertDescription>
                    {tx(
                      "Each code signs you in once without the app. Store them in your password manager; older codes no longer work."
                    )}
                  </AlertDescription>
                </Alert>
                <BackupCodes codes={step.backupCodes} />
                <Button size="sm" onClick={reset}>
                  {tx("I have stored them")}
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
