import { tx } from "@/lib/i18n";

/**
 * Better Auth's error codes in words a person understands. Its own messages
 * are written for developers ("Invalid email or password" is fine, "User
 * already exists. Use another email." is not a next step).
 */
export function authError(
  err: { code?: string; message?: string; status?: number } | null | undefined,
  fallback: string
): string {
  switch (err?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return tx("The email address or the password is not right.");
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return tx(
        "There is already an account with this email address. Sign in instead, or reset the password."
      );
    case "PASSWORD_TOO_SHORT":
      return tx("The password needs at least 8 characters.");
    case "PASSWORD_TOO_LONG":
      return tx("The password is too long.");
    case "INVALID_EMAIL":
      return tx("That does not look like an email address.");
    case "SIGNUP_INVITATION_ONLY":
      return tx(
        "Registration here is by invitation. Ask an owner of your organization to invite this address."
      );
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_BACKUP_CODE":
      return tx("That code did not work. Check it and try again.");
  }
  if (err?.status === 429)
    return tx("Too many attempts. Wait a few minutes, then try again.");
  return err?.message || fallback;
}
