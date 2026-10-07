import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { Org } from "@/lib/auth-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { tx } from "@/lib/i18n";

/** The app mark, shared by the switcher and the signed-out brand header. */
export function BrandMark({ className }: { className?: string }) {
  return <Logo className={cn("rounded-lg", className)} />;
}

export function OrgSwitcher({
  activeOrg,
  orgs,
  onSwitch,
  onCreate,
}: {
  activeOrg: Org | null;
  orgs: Org[];
  onSwitch: () => void;
  onCreate: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();

  const setActive = async (orgId: string) => {
    setLoading(true);
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      onSwitch();
      if (isMobile) setOpenMobile(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={loading}>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <BrandMark />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeOrg?.name ?? tx("Select organization")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {tx("Moatline")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {tx("Organizations")}
            </DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => setActive(org.id)}
                className="gap-2"
              >
                <span className="flex size-6 items-center justify-center rounded-md border text-xs font-medium uppercase">
                  {org.name.slice(0, 1)}
                </span>
                <span className="flex-1 truncate">{org.name}</span>
                <Check
                  className={cn(
                    "size-4",
                    org.id === activeOrg?.id ? "opacity-100" : "opacity-0"
                  )}
                />
              </DropdownMenuItem>
            ))}
            {orgs.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => {
                // On phones the sidebar is a sheet; close it so the dialog
                // is not stacked on top of the navigation.
                if (isMobile) setOpenMobile(false);
                onCreate();
              }}
              className="gap-2"
            >
              <span className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </span>
              <span className="text-muted-foreground">
                {tx("New organization…")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
