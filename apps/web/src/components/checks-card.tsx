import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Pencil,
  Play,
  Plus,
  Route,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CheckInput,
  type CheckStep,
  type SyntheticCheck,
} from "@/lib/api";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

type Presets = Record<
  string,
  { name: string; steps: CheckStep[]; variables: string[] }
>;

/** ${names} the steps use — they get an input each (stored encrypted). */
function variablesOf(steps: CheckStep[]): string[] {
  const names = new Set<string>();
  for (const s of steps)
    for (const field of [s.path, s.body ?? "", s.expectText ?? ""])
      for (const m of field.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]{0,40})\}/g))
        names.add(m[1]!);
  return [...names];
}

function StepEditor({
  step,
  onChange,
  onRemove,
}: {
  step: CheckStep;
  onChange: (s: CheckStep) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const hasBody = step.method === "POST" || step.method === "PUT";
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex gap-2">
        <Select
          value={step.method}
          onValueChange={(v) =>
            onChange({ ...step, method: v as CheckStep["method"] })
          }
        >
          <SelectTrigger className="w-28" aria-label={t("Method")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["GET", "POST", "PUT", "HEAD"].map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={step.path}
          onChange={(e) => onChange({ ...step, path: e.target.value })}
          placeholder="/admin"
          className="font-mono"
          aria-label={t("Path")}
        />
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={t("Remove step")}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {hasBody && (
        <div className="flex gap-2">
          <Select
            value={step.contentType ?? "json"}
            onValueChange={(v) =>
              onChange({ ...step, contentType: v as CheckStep["contentType"] })
            }
          >
            <SelectTrigger className="w-28" aria-label={t("Body type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="form">Form</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            value={step.body ?? ""}
            onChange={(e) => onChange({ ...step, body: e.target.value })}
            placeholder='{"email":"${email}","password":"${password}"}'
            className="min-h-14 font-mono text-xs"
            aria-label={t("Body")}
          />
        </div>
      )}
      <div className="grid grid-cols-[6rem_1fr_6rem] gap-2">
        <Input
          type="number"
          value={step.expectStatus ?? ""}
          onChange={(e) =>
            onChange({
              ...step,
              expectStatus: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder="2xx/3xx"
          aria-label={t("Expected status")}
        />
        <Input
          value={step.expectText ?? ""}
          onChange={(e) =>
            onChange({ ...step, expectText: e.target.value || undefined })
          }
          placeholder={t("Text the page must contain (optional)")}
          aria-label={t("Expected text")}
        />
        <Input
          type="number"
          value={step.maxMs ?? ""}
          onChange={(e) =>
            onChange({
              ...step,
              maxMs: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder="10000 ms"
          aria-label={t("Time limit in ms")}
        />
      </div>
    </div>
  );
}

function CheckDialog({
  repoId,
  presets,
  editing,
  open,
  onOpenChange,
  onSaved,
}: {
  repoId: string;
  presets: Presets;
  editing: SyntheticCheck | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<CheckStep[]>([]);
  const [interval, setInterval_] = useState(15);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSteps(editing?.steps ?? [{ method: "GET", path: "/" }]);
    setInterval_(editing?.intervalMinutes ?? 15);
    setSecrets({});
  }, [open, editing]);

  const vars = useMemo(() => variablesOf(steps), [steps]);

  const save = async () => {
    setSaving(true);
    try {
      const filled = Object.fromEntries(
        Object.entries(secrets).filter(([, v]) => v)
      );
      const body: CheckInput = {
        name: name.trim(),
        steps,
        intervalMinutes: interval,
        // Editing: only replace the stored values when new ones were typed.
        ...(editing
          ? Object.keys(filled).length
            ? { secrets: filled }
            : {}
          : { secrets: filled }),
      };
      if (editing) await api.updateCheck(repoId, editing.id, body);
      else await api.createCheck(repoId, body);
      toast.success(
        editing ? t("Check saved") : t("Check added — first run started")
      );
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("Edit check") : t("New check")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Steps run in order against the live URL; cookies carry over, so a login holds. Use ${name} for values that are stored encrypted."
            )}
          </DialogDescription>
        </DialogHeader>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(presets).map(([key, p]) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => {
                  setName(p.name);
                  setSteps(p.steps);
                }}
              >
                {t(p.name)}
              </Button>
            ))}
          </div>
        )}
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="check-name">{t("Name")}</Label>
              <Input
                id="check-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="check-interval">{t("Every (minutes)")}</Label>
              <Input
                id="check-interval"
                type="number"
                min={5}
                value={interval}
                onChange={(e) =>
                  setInterval_(Math.max(5, Number(e.target.value) || 15))
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            {steps.map((s, i) => (
              <StepEditor
                key={i}
                step={s}
                onChange={(next) =>
                  setSteps(steps.map((x, j) => (j === i ? next : x)))
                }
                onRemove={
                  steps.length > 1
                    ? () => setSteps(steps.filter((_, j) => j !== i))
                    : undefined
                }
              />
            ))}
            {steps.length < 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() =>
                  setSteps([...steps, { method: "GET", path: "/" }])
                }
              >
                <Plus />
                {t("Add step")}
              </Button>
            )}
          </div>
          {vars.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">
                {t("Values (stored encrypted)")}
              </p>
              {vars.map((v) => (
                <div
                  key={v}
                  className="grid grid-cols-[8rem_1fr] items-center gap-2"
                >
                  <Label htmlFor={`var-${v}`} className="font-mono text-xs">
                    {v}
                  </Label>
                  <Input
                    id={`var-${v}`}
                    type={/pass|secret|token/i.test(v) ? "password" : "text"}
                    value={secrets[v] ?? ""}
                    onChange={(e) =>
                      setSecrets({ ...secrets, [v]: e.target.value })
                    }
                    placeholder={
                      editing?.hasSecrets ? t("Stored — type to replace") : ""
                    }
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {t("Use a dedicated test user with as few rights as possible.")}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={saving || !name.trim() || !steps.length}
          >
            {saving && <Spinner />}
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** User journeys against the live site: login, a page's content, a form. */
export function ChecksCard({ repoId }: { repoId: string }) {
  const t = useT();
  const [data, setData] = useState<{
    presets: Presets;
    checks: SyntheticCheck[];
  } | null>(null);
  const [editing, setEditing] = useState<SyntheticCheck | null>(null);
  const [dialog, setDialog] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = () =>
    api
      .getChecks(repoId)
      .then(setData)
      .catch(() => setData({ presets: {}, checks: [] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [repoId]);

  const run = async (c: SyntheticCheck) => {
    setRunning(c.id);
    try {
      const r = await api.runCheck(repoId, c.id);
      if (r.ok) toast.success(t("All steps passed"));
      else toast.error(r.steps.find((s) => !s.ok)?.error ?? t("Check failed"));
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Check failed"));
    } finally {
      setRunning(null);
    }
  };

  const remove = async (c: SyntheticCheck) => {
    await api.deleteCheck(repoId, c.id).catch(() => null);
    void load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="size-4" />
          {t("Checks")}
        </CardTitle>
        <CardDescription>
          {t(
            "More than “the site answers”: a login, a page's content, a form — step by step. Two failures in a row open an incident."
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialog(true);
            }}
          >
            <Plus />
            {t("Add check")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : data.checks.length === 0 ? (
          <p className="text-muted-foreground">
            {t(
              "No checks yet. Start from a template, e.g. the Payload admin login."
            )}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.checks.map((c) => (
              <li key={c.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {c.lastOk == null ? (
                    <Badge variant="outline">{t("not run yet")}</Badge>
                  ) : c.lastOk ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("every {n} min", { n: c.intervalMinutes })}
                    {c.lastRunAt && `, ${formatRelative(c.lastRunAt)}`}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => run(c)}
                      disabled={running === c.id}
                      aria-label={t("Run now")}
                    >
                      {running === c.id ? <Spinner /> : <Play />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditing(c);
                        setDialog(true);
                      }}
                      aria-label={t("Edit")}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(c)}
                      aria-label={t("Delete")}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>
                {c.lastResult && (
                  <ol className="space-y-0.5 font-mono text-xs">
                    {c.lastResult.map((s, i) => (
                      <li
                        key={i}
                        className={
                          s.ok ? "text-muted-foreground" : "text-destructive"
                        }
                      >
                        {s.ok ? "✓" : "✗"} {s.step}
                        {s.status != null && ` — ${s.status}`}
                        {s.ms != null && `, ${s.ms} ms`}
                        {s.error && ` — ${s.error}`}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {data && (
        <CheckDialog
          repoId={repoId}
          presets={data.presets}
          editing={editing}
          open={dialog}
          onOpenChange={setDialog}
          onSaved={load}
        />
      )}
    </Card>
  );
}
