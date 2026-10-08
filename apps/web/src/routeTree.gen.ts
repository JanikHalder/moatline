import { useEffect } from "react";
import {
  createRootRoute,
  createRoute,
  useRouter,
} from "@tanstack/react-router";
import { RootLayout } from "@/components/root-layout";
import { LoginForm } from "@/components/login-form";
import { ReposList } from "@/components/repos-list";
import { RepoDetail } from "@/components/repo-detail";
import { Dashboard } from "@/components/dashboard";
import { SettingsPage } from "@/components/settings-page";
import { MembersPage } from "@/components/members-page";
import { AcceptInvitation } from "@/components/accept-invitation";
import { ForgotPassword } from "@/components/forgot-password";
import { ResetPassword } from "@/components/reset-password";
import { ServersList } from "@/components/servers-list";
import { ServerDetail } from "@/components/server-detail";
import { MonitoringPage } from "@/components/monitoring-page";
import { AccountPage } from "@/components/account-page";
import { AuditPage } from "@/components/audit-page";
import { OperatorPage } from "@/components/operator-page";
import { ClientsPage } from "@/components/clients-page";
import { ClientDetail } from "@/components/client-detail";
import { VersionsPage } from "@/components/versions-page";
import { NewSitePage } from "@/components/new-site-page";
import { StatusPublic } from "@/components/status-public";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginForm,
});

function IndexRedirect() {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate({ to: "/repos" });
  }, [navigate]);
  return null;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexRedirect,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: Dashboard,
});

const reposIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
  component: ReposList,
});

const REPO_TABS = [
  "overview",
  "packages",
  "live",
  "checks",
  "branches",
] as const;

const repoIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$repoId",
  component: RepoDetail,
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: (typeof REPO_TABS)[number] } => ({
    tab: REPO_TABS.find((t) => t === search.tab),
  }),
});

const serversIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servers",
  component: ServersList,
});

const SERVER_TABS = [
  "overview",
  "apps",
  "security",
  "maintenance",
  "findings",
  "settings",
  "agent",
] as const;

const serverIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servers/$serverId",
  component: ServerDetail,
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: (typeof SERVER_TABS)[number] } => ({
    tab: SERVER_TABS.find((t) => t === search.tab),
  }),
});

const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients",
  component: ClientsPage,
});

const clientIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  component: ClientDetail,
});

const newSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new-site",
  component: NewSitePage,
});

const versionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/versions",
  component: VersionsPage,
});

const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/monitoring",
  component: MonitoringPage,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountPage,
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  component: AuditPage,
});

const operatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operator",
  component: OperatorPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/members",
  component: MembersPage,
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invitation/$invitationId",
  component: AcceptInvitation,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPassword,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPassword,
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status/$slug",
  component: StatusPublic,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  dashboardRoute,
  reposIndexRoute,
  repoIdRoute,
  serversIndexRoute,
  serverIdRoute,
  clientsRoute,
  clientIdRoute,
  versionsRoute,
  newSiteRoute,
  monitoringRoute,
  accountRoute,
  auditRoute,
  operatorRoute,
  settingsRoute,
  membersRoute,
  acceptInvitationRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  statusRoute,
]);

export { routeTree };
