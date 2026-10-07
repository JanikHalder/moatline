import {
  Outlet,
  Link,
  useRouter,
  useLocation,
  type LinkProps,
} from "@tanstack/react-router";
import {
  ChartColumn,
  ChevronsUpDown,
  CreditCard,
  KeyRound,
  FolderGit2,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Server,
  Building2,
  Layers,
  Activity,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type { Org } from "@/lib/auth-types";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toaster } from "@/components/ui/sonner";
import { BrandMark, OrgSwitcher } from "@/components/org-switcher";
import { CreateOrgDialog } from "@/components/create-org-dialog";
import { safeNext } from "@/components/login-form";
import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";
import { LOGIN_DISABLED } from "@/lib/auth-mode";
import { useTheme, type Theme } from "@/lib/theme";
import { LANGS, setLang, useLang, useT, type Lang } from "@/lib/i18n";
import { NarrowContentProvider, useIsNarrow } from "@/hooks/use-narrow-content";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  auth: boolean;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, auth: false },
  { to: "/repos", label: "Repositories", icon: FolderGit2, auth: false },
  { to: "/servers", label: "Servers", icon: Server, auth: false },
  { to: "/clients", label: "Clients", icon: Building2, auth: false },
  { to: "/versions", label: "Versions", icon: Layers, auth: false },
  { to: "/monitoring", label: "Monitoring", icon: Activity, auth: false },
  { to: "/members", label: "Team", icon: Users, auth: true },
  { to: "/audit", label: "Audit log", icon: ScrollText, auth: true },
  { to: "/settings", label: "Settings", icon: Settings, auth: true },
];

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** The sidebar block persists its open state in this cookie. */
function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  return !document.cookie.split("; ").some((c) => c === "sidebar_state=false");
}

function isActivePath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + "/");
}

/** Interface language: EN / DE, kept in this browser. */
function LanguageToggle() {
  const lang = useLang();
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      role="radiogroup"
      aria-label={t("Language")}
      value={lang}
      onValueChange={(v) => v && setLang(v as Lang)}
    >
      {LANGS.map(({ value, label }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="px-2 text-xs font-medium uppercase"
        >
          {value}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      // Single-select toggle groups expose their items as radios; naming the
      // group as a radiogroup keeps that pairing valid for assistive tech.
      role="radiogroup"
      aria-label={t("Color theme")}
      value={theme}
      // Radix reports "" when the active item is clicked again — a theme is
      // always set, so ignore that instead of deselecting.
      onValueChange={(v) => v && setTheme(v as Theme)}
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(label)}
          title={t(label)}
          className="px-2"
        >
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The instance's own usage figures, for its operators (OPERATOR_EMAILS). */
const OPERATOR_NAV: NavItem = {
  to: "/operator",
  label: "Usage",
  icon: ChartColumn,
  auth: true,
};

function NavMain({ isLoggedIn }: { isLoggedIn: boolean }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const t = useT();
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    if (!isLoggedIn) return;
    api
      .isOperator()
      .then((r) => setOperator(r.operator))
      .catch(() => setOperator(false));
  }, [isLoggedIn]);
  const items = operator ? [...NAV, OPERATOR_NAV] : NAV;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("Overview")}</SidebarGroupLabel>
      <SidebarMenu>
        {items
          .filter((item) => !item.auth || isLoggedIn)
          .map(({ to, label, icon: Icon }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                asChild
                isActive={isActivePath(pathname, to)}
                tooltip={t(label)}
              >
                <Link
                  to={to as LinkProps["to"]}
                  // The mobile sidebar is a sheet over the page; leave it
                  // open after navigating and the new page stays hidden.
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  <Icon />
                  <span>{t(label)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavUser({ email }: { email: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const initials = email.slice(0, 2).toUpperCase();
  const t = useT();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{email}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("Signed in")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/account"
                onClick={() => isMobile && setOpenMobile(false)}
              >
                <KeyRound />
                {t("Account security")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => authClient.signOut()}>
              <LogOut />
              {t("Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function CurrentSection() {
  const { pathname } = useLocation();
  const t = useT();
  const item = [...NAV, OPERATOR_NAV].find((n) => isActivePath(pathname, n.to));
  // Pages outside the sidebar still get a title next to the separator.
  const label =
    item?.label ??
    (pathname.startsWith("/account") ? "Account security" : null);
  if (!label) return null;
  return <span className="text-sm font-medium">{t(label)}</span>;
}

/**
 * Owners and admins need two-factor authentication for anything that hands
 * out access (the API refuses those actions without it). Say so up front
 * rather than after the first refused click.
 */
function TwoFactorNotice({
  orgId,
  enabled,
  onAccountPage,
}: {
  orgId: string | null;
  enabled: boolean;
  onAccountPage: boolean;
}) {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId || enabled) return;
    authClient.organization
      .getActiveMember()
      .then((r) => setRole(r.data?.role ?? null))
      .catch(() => setRole(null));
  }, [orgId, enabled]);
  const t = useT();
  if (enabled || onAccountPage || (role !== "owner" && role !== "admin"))
    return null;
  return (
    <Alert variant="warning" className="mb-6">
      <KeyRound />
      <AlertTitle>{t("Turn on two-factor authentication")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          {t(
            "As {role}, adding servers, issuing install codes and changing integrations need it.",
            { role }
          )}
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/account">{t("Set it up")}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The cloud is paid only: an organization without a subscription can look
 * around but not add servers or repositories. Say so up front, instead of
 * only when adding the first server fails.
 */
function BillingNotice({
  orgId,
  onSettings,
}: {
  orgId: string | null;
  onSettings: boolean;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!orgId) return;
    api
      .getBilling()
      .then((b) => setShow(b.enabled && b.plan === "none"))
      .catch(() => setShow(false));
  }, [orgId]);
  const t = useT();
  if (!show || onSettings) return null;
  return (
    <Alert className="mb-6">
      <CreditCard />
      <AlertTitle>{t("Choose a plan")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          {t(
            "Look around freely — adding servers and repositories needs a subscription, from 8 € a month."
          )}
        </span>
        <Button asChild size="sm">
          <Link to="/settings" hash="billing">
            {t("See plans")}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function RootLayout() {
  const t = useT();
  const lang = useLang();
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const location = useLocation();
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [orgList, setOrgList] = useState<Org[]>([]);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  // Tables stack their columns by the width next to the sidebar (see the
  // `@container/main` below), so phones and tablets with the sidebar open
  // get the same compact layout.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const narrowContent = useIsNarrow(contentEl);

  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const isLoggedIn = !!session?.user;

  useEffect(() => {
    if (!session?.user) return;
    authClient.organization.list().then((r) => {
      setOrgList(r.data ?? []);
      setOrgsLoaded(true);
    });
  }, [session?.user]);

  // A fresh session has no active organization, so every org-scoped request
  // would 403 and the app would look empty. Activate the first one the user
  // belongs to; they can still switch with the OrgSwitcher.
  useEffect(() => {
    if (!session?.user || activeOrgId || orgList.length === 0) return;
    authClient.organization.setActive({ organizationId: orgList[0].id });
  }, [session?.user, activeOrgId, orgList]);

  // An invitation link must survive being opened by someone who is not signed
  // in — bouncing them to /login would drop the invitation id.
  const isPublicPath =
    location.pathname === "/login" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password" ||
    location.pathname.startsWith("/accept-invitation/") ||
    location.pathname.startsWith("/status/");

  useEffect(() => {
    if (isPending) return;
    if (LOGIN_DISABLED) {
      if (location.pathname === "/login") {
        router.navigate({ to: "/repos" });
      }
      return;
    }
    if (!session?.user && !isPublicPath) {
      // Back to where they were going once signed in.
      const here = `${location.pathname}${window.location.search}`;
      router.history.push(
        here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`
      );
      return;
    }
    // Signed in: no confirmation is pending anymore.
    if (session?.user) sessionStorage.removeItem("pc-confirm-pending");
    if (session?.user && location.pathname === "/login") {
      const next = safeNext(
        new URLSearchParams(window.location.search).get("next")
      );
      if (next) router.history.push(next);
      else router.navigate({ to: "/repos" });
      return;
    }
  }, [isPending, session?.user, location.pathname, isPublicPath, router]);

  // Only once the list has actually loaded, so the prompt never flashes for
  // someone who does have organizations.
  // Account security works without an organization — 2FA comes first.
  const needsFirstOrg =
    isLoggedIn &&
    orgsLoaded &&
    orgList.length === 0 &&
    location.pathname !== "/account";

  const activeOrg = activeOrgId
    ? (orgList.find((o) => o.id === activeOrgId) ?? null)
    : null;
  const refreshOrg = () => {
    authClient.organization.list().then((r) => {
      setOrgList(r.data ?? []);
      setOrgsLoaded(true);
    });
  };

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner />
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  // Status pages are for the public: no app around them, signed in or not.
  if (
    (!isLoggedIn && !LOGIN_DISABLED) ||
    location.pathname.startsWith("/status/")
  ) {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  return (
    <SidebarProvider defaultOpen={readSidebarCookie()}>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          {isLoggedIn ? (
            <OrgSwitcher
              activeOrg={activeOrg}
              orgs={orgList}
              onSwitch={refreshOrg}
              onCreate={() => setShowCreateOrg(true)}
            />
          ) : (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <Link to="/repos">
                    <BrandMark />
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">Moatline</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {LOGIN_DISABLED
                          ? t("Login disabled")
                          : t("Security & operations")}
                      </span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarHeader>
        <SidebarContent>
          <NavMain isLoggedIn={isLoggedIn} />
        </SidebarContent>
        {isLoggedIn && session?.user?.email && (
          <SidebarFooter>
            <NavUser email={session.user.email} />
          </SidebarFooter>
        )}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <CurrentSection />
          <div className="ml-auto flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8">
          <div
            ref={setContentEl}
            className="@container/main mx-auto w-full max-w-6xl"
          >
            <NarrowContentProvider value={narrowContent}>
              {needsFirstOrg ? (
                // Every view is scoped to an organization, so without one the app
                // can only answer 403. Ask for it directly instead of leaving the
                // only way forward inside the switcher menu.
                <EmptyState
                  className="mt-12"
                  icon={ShieldCheck}
                  title={t("Create your first organization")}
                  description={t(
                    "Repositories, scans and findings all belong to an organization. Create one to get started — you can invite colleagues to it afterwards under Team."
                  )}
                  action={
                    <Button onClick={() => setShowCreateOrg(true)}>
                      {t("Create organization")}
                    </Button>
                  }
                />
              ) : (
                /* Route components load org-scoped data on mount, so remount them
                 when the active organization changes — otherwise the previous
                 org's repos, findings and settings stay on screen. */
                <>
                  <TwoFactorNotice
                    orgId={activeOrgId}
                    enabled={
                      !!(
                        session?.user as
                          | { twoFactorEnabled?: boolean | null }
                          | undefined
                      )?.twoFactorEnabled
                    }
                    onAccountPage={location.pathname === "/account"}
                  />
                  <BillingNotice
                    orgId={activeOrgId}
                    onSettings={location.pathname === "/settings"}
                  />
                  {/* …and when the language changes, so every text
                      translated with tx() is read again. */}
                  <Outlet key={`${activeOrgId ?? "no-org"}:${lang}`} />
                </>
              )}
            </NarrowContentProvider>
          </div>
        </div>
      </SidebarInset>

      {isLoggedIn && (
        <CreateOrgDialog
          open={showCreateOrg}
          onOpenChange={setShowCreateOrg}
          onCreated={refreshOrg}
        />
      )}
      <Toaster />
    </SidebarProvider>
  );
}
