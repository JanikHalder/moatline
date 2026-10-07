import { createAuthClient } from "better-auth/react";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  // The organization plugin mirrors the API's Better Auth setup. Besides
  // typing `authClient.organization.*`, it makes the session store refresh
  // after `setActive`, so the UI picks up the new active organization.
  // twoFactorClient: sign-in answers `twoFactorRedirect` for accounts with
  // 2FA; the login form then asks for the code (no page redirect needed).
  plugins: [organizationClient(), twoFactorClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signUp, signOut, useSession } = authClient;
