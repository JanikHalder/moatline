import { useEffect, useState } from "react";
import { useParams, useRouter, Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AuthShell } from "@/components/auth-shell";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

type InvitationDetails = {
  organizationName?: string;
  email: string;
  role: string;
};

export function AcceptInvitation() {
  const { invitationId } = useParams({
    from: "/accept-invitation/$invitationId",
  });
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [invite, setInvite] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      setLoading(false);
      return;
    }
    authClient.organization
      .getInvitation({ query: { id: invitationId } })
      .then(({ data, error: inviteError }) => {
        if (inviteError || !data) {
          setError(
            inviteError?.message ??
              "This invitation is no longer valid. Ask for a new one."
          );
        } else {
          setInvite(data as InvitationDetails);
        }
        setLoading(false);
      });
  }, [invitationId, session?.user, isPending]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const { data, error: acceptError } =
      await authClient.organization.acceptInvitation({ invitationId });
    if (acceptError || !data) {
      setAccepting(false);
      setError(acceptError?.message ?? "Could not accept the invitation.");
      return;
    }
    // Land in the organization that was just joined.
    const orgId = data.invitation?.organizationId;
    if (orgId) {
      await authClient.organization.setActive({ organizationId: orgId });
    }
    router.navigate({ to: "/repos" });
  };

  return (
    <AuthShell title={tx("Organization invitation")}>
      {isPending || loading ? (
        <div className="space-y-3" aria-label={tx("Loading invitation")}>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : !session?.user ? (
        <>
          <p className="text-sm text-muted-foreground">
            {tx(
              "Sign in to accept this invitation. New here? Create an account with the address the invitation was sent to — afterwards you come right back here."
            )}
          </p>
          <div className="grid gap-2">
            <Button asChild className="w-full">
              <a
                href={`/login?mode=signup&next=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`}
              >
                {tx("Create an account")}
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a
                href={`/login?next=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`}
              >
                {tx("I already have an account")}
              </a>
            </Button>
          </div>
        </>
      ) : error ? (
        <>
          <ErrorAlert>{error}</ErrorAlert>
          <Button asChild variant="outline" className="w-full">
            <Link to="/repos">{tx("Back to the app")}</Link>
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
              <Building2 className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 text-sm">
              <p>
                {tx("You were invited to join")}{" "}
                <strong>
                  {invite?.organizationName ?? tx("an organization")}
                </strong>
                .
              </p>
              {invite?.role && (
                <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                  {tx("Role")} <Badge variant="secondary">{invite.role}</Badge>
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Button onClick={accept} disabled={accepting}>
              {accepting && <Spinner />}
              {accepting ? tx("Joining…") : tx("Accept invitation")}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/repos">{tx("Not now")}</Link>
            </Button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
