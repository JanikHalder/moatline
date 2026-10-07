/**
 * Whether the login gate is bypassed (the API's demo organization is used
 * instead of a real session).
 *
 * Auth is ON by default. The bypass is a local development convenience and is
 * only honored when explicitly opted in via `VITE_DISABLE_LOGIN=true` in a dev
 * build — a production build always requires a login, even if the variable is
 * set. This mirrors the API, where the demo org is unreachable in production
 * unless `ENABLE_DEMO_ORG=true`.
 */
export const LOGIN_DISABLED =
  import.meta.env.DEV && import.meta.env.VITE_DISABLE_LOGIN === "true";
