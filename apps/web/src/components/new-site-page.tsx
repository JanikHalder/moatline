import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Rocket,
  XCircle,
} from "lucide-react";
import {
  api,
  type ClientListItem,
  type ProvisionOptions,
  type ProvisionRun,
  type TemplateEnvKey,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/error-alert";
import { useT } from "@/lib/i18n";

const NONE = "none";
const HOST = "host";
const NEW = "new";

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Following a run: each step with what it did. */
function RunView({
  runId,
  serverIp,
}: {
  runId: string;
  serverIp: string | null;
}) {
  const t = useT();
  const [run, setRun] = useState<ProvisionRun | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api
        .getProvisionRun(runId)
        .then((r) => {
          if (stop) return;
          setRun(r);
          if (r.status === "running") setTimeout(load, 2000);
        })
        .catch(() => !stop && setTimeout(load, 5000));
    load();
    return () => {
      stop = true;
    };
  }, [runId]);
  if (!run) return <Skeleton className="h-64 rounded-lg" />;
  const domainStep = run.steps.find((s) => s.key === "domain");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {run.status === "running" && <Spinner />}
          {run.name}
        </CardTitle>
        <CardDescription>
          {run.status === "running"
            ? t("Setting everything up — this page follows along.")
            : run.status === "done"
              ? t("Done. The first build runs in Dokploy now.")
              : t("Stopped at a step — what was created so far stays.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="space-y-2">
          {run.steps.map((s) => (
            <li key={s.key} className="flex gap-2">
              {s.status === "done" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : s.status === "failed" ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : s.status === "skipped" ? (
                <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : s.status === "running" ? (
                <Spinner className="mt-0.5 size-4 shrink-0" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span className="font-medium">{t(s.label)}</span>
                {s.detail && (
                  <span
                    className={`block break-words text-xs ${s.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {s.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {domainStep?.status === "done" && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="font-medium">{t("Last step is yours: DNS")}</p>
            <p className="text-muted-foreground">
              {serverIp
                ? t(
                    "Point the domain's A record to {ip}. The certificate is issued as soon as it resolves.",
                    { ip: serverIp }
                  )
                : t(
                    "Point the domain's A record to your Dokploy server. The certificate is issued as soon as it resolves."
                  )}
            </p>
          </div>
        )}
        {run.repositoryId && (
          <Button asChild variant="outline">
            <Link to="/repos/$repoId" params={{ repoId: run.repositoryId }}>
              {t("Open the repository")}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A new site in one go: GitHub repository from a template, Dokploy project,
 * database with backup, application, domain, first deploy, monitoring.
 */
export function NewSitePage() {
  const t = useT();
  const [opts, setOpts] = useState<ProvisionOptions | null>(null);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(NONE);
  const [domain, setDomain] = useState("");
  const [sourceKind, setSourceKind] = useState<"template" | "existing">(
    "template"
  );
  const [template, setTemplate] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [repoTouched, setRepoTouched] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [existing, setExisting] = useState("");
  const [branch, setBranch] = useState("main");
  const [envTarget, setEnvTarget] = useState(NEW);
  const [projectName, setProjectName] = useState("");
  const [serverId, setServerId] = useState(HOST);
  const [providerId, setProviderId] = useState("");
  const [database, setDatabase] = useState<"postgres" | "mongo" | "none">(
    "postgres"
  );
  const [destination, setDestination] = useState(NONE);
  const [envKeys, setEnvKeys] = useState<TemplateEnvKey[]>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [autoHeal, setAutoHeal] = useState(true);

  useEffect(() => {
    api
      .getProvisionOptions()
      .then((o) => {
        setOpts(o);
        setTemplate(o.templates[0] ?? "");
        setOwner(o.owners[1] ?? o.owners[0] ?? "");
        if (o.dokploy.ok) {
          setProviderId(o.dokploy.githubProviders[0]?.id ?? "");
          setDestination(o.dokploy.destinations[0]?.id ?? NONE);
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("Failed to load"))
      );
    api
      .getClients()
      .then(setClients)
      .catch(() => setClients([]));
  }, [t]);

  // The template's .env.example decides which variables the app gets.
  const envRepo = sourceKind === "template" ? template : existing;
  useEffect(() => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(envRepo)) return setEnvKeys([]);
    api
      .getTemplateEnv(envRepo)
      .then(setEnvKeys)
      .catch(() => setEnvKeys([]));
  }, [envRepo]);

  const slug = slugify(name);
  useEffect(() => {
    if (!repoTouched) setRepo(slug);
  }, [slug, repoTouched]);
  const client = clients.find((c) => c.id === clientId);
  useEffect(() => {
    setProjectName(client?.name ?? name);
  }, [client?.name, name]);

  const dk = opts?.dokploy.ok ? opts.dokploy : null;
  const serverIp = useMemo(
    () =>
      serverId === HOST
        ? null
        : (dk?.servers.find((s) => s.id === serverId)?.ip ?? null),
    [dk, serverId]
  );
  const domainOk =
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain.trim().toLowerCase()
    );
  const sourceOk =
    sourceKind === "template"
      ? !!template && !!owner && !!repo
      : /^[\w.-]+\/[\w.-]+$/.test(existing);
  const ready =
    !!dk &&
    !!name.trim() &&
    domainOk &&
    sourceOk &&
    !!providerId &&
    (envTarget !== NEW || !!projectName.trim());

  const submit = async () => {
    if (!dk) return;
    setBusy(true);
    setError(null);
    try {
      const env =
        envTarget === NEW
          ? null
          : dk.environments.find((e) => e.id === envTarget);
      const r = await api.startProvision({
        name: name.trim(),
        clientId: clientId === NONE ? null : clientId,
        source:
          sourceKind === "template"
            ? { kind: "template", template, owner, repo, private: isPrivate }
            : { kind: "existing", fullName: existing.trim() },
        branch: branch.trim() || "main",
        environment: env
          ? { id: env.id, legacy: env.legacy }
          : { newProject: projectName.trim() },
        serverId: serverId === HOST ? null : serverId,
        githubProviderId: providerId,
        database,
        backupDestinationId: destination === NONE ? null : destination,
        domain: domain.trim().toLowerCase(),
        env: Object.fromEntries(
          Object.entries(envValues).filter(([, v]) => v.trim())
        ),
        envKeys: envKeys.map(({ key, example }) => ({ key, example })),
        autoHeal,
      });
      setRunId(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not start"));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader
      title={t("New site")}
      description={t(
        "Repository from your template, Dokploy app with database and backup, domain, first deploy and monitoring — in one go."
      )}
    />
  );

  if (runId)
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        <RunView runId={runId} serverIp={serverIp} />
      </div>
    );
  if (!opts)
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        {error ? (
          <ErrorAlert>{error}</ErrorAlert>
        ) : (
          <Skeleton className="h-96 rounded-lg" />
        )}
      </div>
    );

  // Without both connections the form cannot work — say what is missing
  // and where to set it, instead of a form that fails at the end.
  if (!opts.dokploy.ok || opts.githubError)
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>{t("First, two connections")}</CardTitle>
            <CardDescription>
              {t(
                "Moatline creates the repository on GitHub and the app on Dokploy — for that it needs access to both."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                {
                  ok: opts.dokploy.ok,
                  label: t("Dokploy"),
                  hint: opts.dokploy.ok ? null : opts.dokploy.error,
                },
                {
                  ok: !opts.githubError,
                  label: t("GitHub token"),
                  hint: opts.githubError,
                },
              ] as const
            ).map((c) => (
              <div
                key={c.label}
                className="flex items-start gap-3 rounded-lg border px-4 py-3"
              >
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {c.label}{" "}
                    <span className="font-normal text-muted-foreground">
                      {c.ok ? t("connected") : t("not connected")}
                    </span>
                  </p>
                  {c.hint && (
                    <p className="text-xs text-muted-foreground">{t(c.hint)}</p>
                  )}
                </div>
              </div>
            ))}
            <Button asChild>
              <Link to="/settings">{t("Connect in the settings")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="max-w-3xl space-y-6">
      {header}
      {error && <ErrorAlert>{error}</ErrorAlert>}

      <Card>
        <CardHeader>
          <CardTitle>{t("1. Site")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="ns-name" label={t("Name")}>
            <Input
              id="ns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Müller Bau"
            />
          </Field>
          <Field id="ns-client" label={t("Client")}>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="ns-client" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("No client")}</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="ns-domain"
            label={t("Domain")}
            hint={t("HTTPS with Let's Encrypt; set the DNS afterwards.")}
          >
            <Input
              id="ns-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="www.mueller-bau.at"
              className="font-mono"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("2. Code")}</CardTitle>
          <CardDescription>
            {t("A new repository from a GitHub template, or one that exists.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sourceKind}
            onValueChange={(v) =>
              v && setSourceKind(v as "template" | "existing")
            }
            className="justify-start"
          >
            <ToggleGroupItem value="template">
              {t("From template")}
            </ToggleGroupItem>
            <ToggleGroupItem value="existing">
              {t("Existing repository")}
            </ToggleGroupItem>
          </ToggleGroup>
          {sourceKind === "template" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="ns-template"
                label={t("Template")}
                hint={
                  opts.templates.length
                    ? undefined
                    : t(
                        "No template repository found — mark one as template in its GitHub settings."
                      )
                }
              >
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger id="ns-template" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {opts.templates.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="ns-owner" label={t("Owner")}>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger id="ns-owner" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {opts.owners.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="ns-repo" label={t("Repository name")}>
                <Input
                  id="ns-repo"
                  value={repo}
                  onChange={(e) => {
                    setRepoTouched(true);
                    setRepo(e.target.value);
                  }}
                  className="font-mono"
                />
              </Field>
              <div className="flex items-center gap-2 self-end pb-2">
                <Switch
                  id="ns-private"
                  checked={isPrivate}
                  onCheckedChange={setIsPrivate}
                />
                <Label htmlFor="ns-private">{t("Private")}</Label>
              </div>
            </div>
          ) : (
            <Field id="ns-existing" label={t("Repository")}>
              <Input
                id="ns-existing"
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
                placeholder="owner/repo"
                className="font-mono"
              />
            </Field>
          )}
          <Field id="ns-branch" label={t("Branch")}>
            <Input
              id="ns-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="max-w-48 font-mono"
            />
          </Field>
        </CardContent>
      </Card>

      {dk && (
        <Card>
          <CardHeader>
            <CardTitle>{t("3. Dokploy")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="ns-env" label={t("Project")}>
              <Select value={envTarget} onValueChange={setEnvTarget}>
                <SelectTrigger id="ns-env" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>{t("New project")}</SelectItem>
                  {dk.environments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.project}
                      {e.legacy ? "" : ` / ${e.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {envTarget === NEW && (
              <Field id="ns-project" label={t("Project name")}>
                <Input
                  id="ns-project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </Field>
            )}
            <Field id="ns-server" label={t("Server")}>
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger id="ns-server" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HOST}>{t("Dokploy host")}</SelectItem>
                  {dk.servers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.ip ? ` (${s.ip})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="ns-provider"
              label={t("GitHub access in Dokploy")}
              hint={
                dk.githubProviders.length
                  ? undefined
                  : t("Connect GitHub in Dokploy first (Settings → Git).")
              }
            >
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger id="ns-provider" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {dk.githubProviders.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ns-db" label={t("Database")}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={database}
                onValueChange={(v) => v && setDatabase(v as typeof database)}
                className="justify-start"
              >
                <ToggleGroupItem value="postgres">PostgreSQL</ToggleGroupItem>
                <ToggleGroupItem value="mongo">MongoDB</ToggleGroupItem>
                <ToggleGroupItem value="none">{t("None")}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {database !== "none" && (
              <Field
                id="ns-backup"
                label={t("Backup")}
                hint={t("Daily at 03:00, the last 14 kept.")}
              >
                <Select value={destination} onValueChange={setDestination}>
                  <SelectTrigger id="ns-backup" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("No backup")}</SelectItem>
                    {dk.destinations.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {dk ? t("4. Environment variables") : t("3. Environment variables")}
          </CardTitle>
          <CardDescription>
            {envKeys.length
              ? t(
                  "From the template's .env.example. Database, secrets and URLs fill themselves."
                )
              : t(
                  "The repository has no .env.example — add variables in Dokploy later."
                )}
          </CardDescription>
        </CardHeader>
        {envKeys.length > 0 && (
          <CardContent className="grid gap-3">
            {envKeys.map((k) => (
              <div
                key={k.key}
                className="grid items-center gap-2 sm:grid-cols-[14rem_1fr]"
              >
                <Label htmlFor={`env-${k.key}`} className="font-mono text-xs">
                  {k.key}
                </Label>
                {k.auto && !envValues[k.key] ? (
                  <button
                    type="button"
                    className="text-left"
                    onClick={() =>
                      setEnvValues((v) => ({ ...v, [k.key]: " " }))
                    }
                  >
                    <Badge variant="secondary">
                      {k.auto === "database"
                        ? t("automatic: connection to the new database")
                        : k.auto === "secret"
                          ? t("automatic: random secret")
                          : t("automatic: the site's URL")}
                    </Badge>
                  </button>
                ) : (
                  <Input
                    id={`env-${k.key}`}
                    value={envValues[k.key] ?? ""}
                    onChange={(e) =>
                      setEnvValues((v) => ({ ...v, [k.key]: e.target.value }))
                    }
                    placeholder={k.example}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-2">
            <Switch
              id="ns-heal"
              checked={autoHeal}
              onCheckedChange={setAutoHeal}
            />
            <Label htmlFor="ns-heal">
              {t("Restart automatically when the site stays down")}
            </Label>
          </div>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? <Spinner /> : <Rocket />}
            {t("Create site")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
