import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Link2,
  MailPlus,
  Users,
} from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { useNarrowContent } from "@/hooks/use-narrow-content";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

type Member = {
  id: string;
  role: string;
  userId: string;
  user: { name?: string | null; email: string };
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
};

const ROLES = ["member", "admin", "owner"] as const;
type Role = (typeof ROLES)[number];

function RoleSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger id={id} className="w-32 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r} className="capitalize">
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function roleVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "owner") return "default";
  if (role === "admin") return "secondary";
  return "outline";
}

export function MembersPage() {
  const narrow = useNarrowContent();
  const { data: session } = useSession();
  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const myUserId = session?.user?.id ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Create directly" — for people you'd rather hand credentials to than mail
  // an invitation link (no SMTP needed).
  const [directEmail, setDirectEmail] = useState("");
  const [directName, setDirectName] = useState("");
  const [directRole, setDirectRole] = useState<Role>("member");
  const [creating, setCreating] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [full, invites] = await Promise.all([
      authClient.organization.getFullOrganization(),
      authClient.organization.listInvitations(),
    ]);
    if (full.error) {
      setError(full.error.message ?? "Could not load members.");
      setMembers([]);
    } else {
      setMembers((full.data?.members ?? []) as Member[]);
    }
    setInvitations(
      ((invites.data ?? []) as Invitation[]).filter(
        (i) => i.status === "pending"
      )
    );
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setError(null);
    setNotice(null);
    const { data, error: inviteError } =
      await authClient.organization.inviteMember({ email: trimmed, role });
    setInviting(false);
    if (inviteError || !data) {
      setError(inviteError?.message ?? "Could not send the invitation.");
      return;
    }
    setEmail("");
    // The invite mail goes out over the org's SMTP settings, which may not be
    // configured — always show the link so it can be passed on by hand.
    setNotice(
      `Invited ${trimmed}. If no mail arrives, send them this link: ${window.location.origin}/accept-invitation/${data.id}`
    );
    void load();
  };

  const createDirectly = async () => {
    const trimmed = directEmail.trim();
    if (!trimmed) return;
    setCreating(true);
    setDirectError(null);
    setCredentials(null);
    setCopied(false);
    try {
      const result = await api.createMemberDirect({
        email: trimmed,
        name: directName.trim() || undefined,
        role: directRole,
      });
      setDirectEmail("");
      setDirectName("");
      if (result.password) {
        setCredentials({ email: result.email, password: result.password });
      } else {
        setDirectError(null);
        setNotice(
          `${result.email} already had an account and was added to this organization.`
        );
      }
      void load();
    } catch (e) {
      setDirectError(
        e instanceof Error ? e.message : tx("Could not create the account.")
      );
    } finally {
      setCreating(false);
    }
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `Moatline\nE-Mail: ${credentials.email}\nPasswort: ${credentials.password}\n${window.location.origin}/login`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setDirectError("Could not copy — select the text and copy it manually.");
    }
  };

  const cancelInvitation = async (invitationId: string) => {
    setBusyId(invitationId);
    await authClient.organization.cancelInvitation({ invitationId });
    setBusyId(null);
    void load();
  };

  const removeMember = async (memberIdOrEmail: string) => {
    setBusyId(memberIdOrEmail);
    const { error: removeError } = await authClient.organization.removeMember({
      memberIdOrEmail,
    });
    setBusyId(null);
    if (removeError)
      setError(removeError.message ?? "Could not remove member.");
    void load();
  };

  if (!activeOrgId) {
    return (
      <div className="max-w-5xl space-y-6">
        <PageHeader title={tx("Team")} />
        <Card className="py-0">
          <EmptyState
            icon={Building2}
            title={tx("No organization selected")}
            description={tx("Select or create an organization first.")}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={tx("Team")}
        description={tx("Everyone with access to this organization.")}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailPlus className="size-4 text-muted-foreground" />
              {tx("Invite a colleague")}
            </CardTitle>
            <CardDescription>
              {tx(
                "Registration is invitation only — an invited address can create an account, nobody else can."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-[16rem] flex-1 gap-2">
                  <Label htmlFor="invite-email">{tx("Email")}</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && invite()}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite-role">{tx("Role")}</Label>
                  <RoleSelect
                    id="invite-role"
                    value={role}
                    onChange={setRole}
                  />
                </div>
                <Button onClick={invite} disabled={inviting || !email.trim()}>
                  {inviting && <Spinner />}
                  {inviting ? tx("Inviting…") : tx("Send invitation")}
                </Button>
              </div>
              {notice && (
                <Alert variant="success" role="status">
                  <Link2 />
                  <AlertDescription className="break-all text-foreground">
                    {notice}
                  </AlertDescription>
                </Alert>
              )}
              {error && <ErrorAlert>{error}</ErrorAlert>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              {tx("Create an account directly")}
            </CardTitle>
            <CardDescription>
              {tx(
                "No email is sent. The account is created straight away with a generated password — pass the credentials on yourself."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-[14rem] flex-1 gap-2">
                  <Label htmlFor="direct-email">{tx("Email")}</Label>
                  <Input
                    id="direct-email"
                    type="email"
                    placeholder="new-colleague@agency.com"
                    value={directEmail}
                    onChange={(e) => setDirectEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createDirectly()}
                  />
                </div>
                <div className="grid min-w-[10rem] flex-1 gap-2">
                  <Label htmlFor="direct-name">{tx("Name (optional)")}</Label>
                  <Input
                    id="direct-name"
                    placeholder={tx("Jane Doe")}
                    value={directName}
                    onChange={(e) => setDirectName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createDirectly()}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="direct-role">{tx("Role")}</Label>
                  <RoleSelect
                    id="direct-role"
                    value={directRole}
                    onChange={setDirectRole}
                  />
                </div>
                <Button
                  onClick={createDirectly}
                  disabled={creating || !directEmail.trim()}
                >
                  {creating ? <Spinner /> : <KeyRound />}
                  {creating ? tx("Creating…") : tx("Create account")}
                </Button>
              </div>

              {credentials && (
                /* Shown exactly once — the password is only stored as a hash. */
                <Alert variant="success">
                  <KeyRound />
                  <AlertTitle>
                    {tx(
                      "Account created. Copy these credentials now — they cannot be shown again."
                    )}
                  </AlertTitle>
                  <AlertDescription className="text-foreground">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-sm">
                      <dt className="text-muted-foreground">{tx("Email")}</dt>
                      <dd className="break-all">{credentials.email}</dd>
                      <dt className="text-muted-foreground">
                        {tx("Password")}
                      </dt>
                      <dd className="break-all">{credentials.password}</dd>
                    </dl>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyCredentials}
                      >
                        {copied ? <Check /> : <Copy />}
                        {copied ? tx("Copied") : tx("Copy")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCredentials(null)}
                      >
                        {tx("Done")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tx(
                        "Ask them to change it after the first sign-in via “Forgot password?”."
                      )}
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {directError && <ErrorAlert>{directError}</ErrorAlert>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle>{tx("Members")}</CardTitle>
          <CardDescription>
            {loading
              ? tx("Loading…")
              : members.length === 1
                ? tx("1 person has access.")
                : tx("{n} people have access.", { n: members.length })}
          </CardDescription>
        </CardHeader>
        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-56" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title={tx("No members yet.")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Name")}</TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Email")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Role")}
                </TableHead>
                <TableHead className="pr-6">
                  <span className="sr-only">{tx("Actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-6 whitespace-normal @2xl/main:whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs uppercase">
                          {(m.user.name || m.user.email).slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      {narrow ? (
                        // Phones: email and role stack under the name.
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium break-words">
                            {m.user.name || "—"}
                          </p>
                          <p className="text-xs break-all text-muted-foreground">
                            {m.user.email}
                          </p>
                          <Badge
                            variant={roleVariant(m.role)}
                            className="capitalize"
                          >
                            {m.role}
                          </Badge>
                        </div>
                      ) : (
                        <span className="font-medium">
                          {m.user.name || "—"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground @2xl/main:table-cell">
                    {!narrow && m.user.email}
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    {!narrow && (
                      <Badge
                        variant={roleVariant(m.role)}
                        className="capitalize"
                      >
                        {m.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {m.userId !== myUserId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busyId === m.id}
                        onClick={() => removeMember(m.id)}
                      >
                        {tx("Remove")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {invitations.length > 0 && (
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="border-b pb-4 [.border-b]:pb-4">
            <CardTitle>{tx("Pending invitations")}</CardTitle>
            <CardDescription>
              {tx("Waiting for the invited person to accept.")}
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Email")}</TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Role")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Expires")}
                </TableHead>
                <TableHead className="pr-6">
                  <span className="sr-only">{tx("Actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-6 font-medium break-all whitespace-normal @2xl/main:break-normal @2xl/main:whitespace-nowrap">
                    {i.email}
                    {narrow && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
                        <Badge
                          variant={roleVariant(i.role)}
                          className="capitalize"
                        >
                          {i.role}
                        </Badge>
                        <span>
                          expires {new Date(i.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    {!narrow && (
                      <Badge
                        variant={roleVariant(i.role)}
                        className="capitalize"
                      >
                        {i.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground @2xl/main:table-cell">
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === i.id}
                      onClick={() => cancelInvitation(i.id)}
                    >
                      {tx("Cancel")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
