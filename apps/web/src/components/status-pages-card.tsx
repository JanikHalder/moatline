import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Radio, Trash2 } from "lucide-react";
import {
  api,
  type RepoListItem,
  type StatusPage,
  type StatusPageInput,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ErrorAlert } from "@/components/error-alert";
import { slugifyOrgName } from "@/lib/org-slug";
import { tx } from "@/lib/i18n";

const empty: StatusPageInput = {
  title: "",
  slug: "",
  description: null,
  components: [],
  published: false,
};

const pageUrl = (slug: string) => `${window.location.origin}/status/${slug}`;

/**
 * Public status pages for customers: chosen sites, uptime day by day,
 * outages. Hosted here, so they stay up when the sites go down.
 */
export function StatusPagesCard() {
  const [pages, setPages] = useState<StatusPage[] | null>(null);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [editing, setEditing] = useState<{
    id: string | null;
    form: StatusPageInput;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .getStatusPages()
      .then((r) => setPages(r.pages))
      .catch(() => setPages([]));
  useEffect(() => {
    void load();
    api
      .getRepos()
      .then(setRepos)
      .catch(() => setRepos([]));
  }, []);

  const set = (patch: Partial<StatusPageInput>) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  const toggleSite = (r: RepoListItem, on: boolean) => {
    if (!editing) return;
    const comps = editing.form.components.filter(
      (c) => c.repositoryId !== r.id
    );
    set({
      components: on ? [...comps, { repositoryId: r.id, name: r.name }] : comps,
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...editing.form,
        description: editing.form.description?.trim() || null,
      };
      if (editing.id) await api.updateStatusPage(editing.id, body);
      else await api.createStatusPage(body);
      toast.success(tx("Status page saved"));
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: StatusPage) => {
    try {
      await api.deleteStatusPage(p.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not delete"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="size-4 text-muted-foreground" />
          {tx("Status pages")}
        </CardTitle>
        <CardDescription>
          {tx(
            "A public page for your customers: which sites are up, uptime day by day, past outages. It stays up when your servers go down."
          )}
        </CardDescription>
        {!editing && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing({ id: null, form: empty })}
            >
              <Plus />
              {tx("New status page")}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {pages && pages.length > 0 && !editing && (
          <ul className="divide-y rounded-md border">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.title}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    /status/{p.slug} ·{" "}
                    {tx("{n} sites", { n: p.components.length })}
                  </span>
                </span>
                <Badge variant={p.published ? "success" : "outline"}>
                  {p.published ? tx("published") : tx("draft")}
                </Badge>
                {p.published && (
                  <Button
                    asChild
                    size="icon"
                    variant="ghost"
                    className="size-8"
                  >
                    <a
                      href={pageUrl(p.slug)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={tx("Open")}
                    >
                      <ExternalLink />
                    </a>
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={tx("Edit")}
                  onClick={() =>
                    setEditing({
                      id: p.id,
                      form: {
                        title: p.title,
                        slug: p.slug,
                        description: p.description,
                        components: p.components,
                        published: p.published,
                      },
                    })
                  }
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={tx("Delete")}
                  onClick={() => void remove(p)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <div className="grid gap-4 rounded-md border p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sp-title">{tx("Title")}</Label>
                <Input
                  id="sp-title"
                  value={editing.form.title}
                  placeholder={tx("Acme status")}
                  onChange={(e) =>
                    set({
                      title: e.target.value,
                      // The address follows the title until edited by hand.
                      ...(!editing.id &&
                      editing.form.slug === slugifyOrgName(editing.form.title)
                        ? { slug: slugifyOrgName(e.target.value) }
                        : {}),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sp-slug">{tx("Address")}</Label>
                <div className="flex items-center rounded-md border bg-muted/40 pl-3 text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">/status/</span>
                  <Input
                    id="sp-slug"
                    value={editing.form.slug}
                    onChange={(e) =>
                      set({ slug: e.target.value.toLowerCase() })
                    }
                    className="border-0 bg-background font-mono shadow-none"
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sp-desc">{tx("Description (optional)")}</Label>
              <Input
                id="sp-desc"
                value={editing.form.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>{tx("Sites on the page")}</Label>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {repos.map((r) => {
                  const on = editing.form.components.some(
                    (c) => c.repositoryId === r.id
                  );
                  return (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => toggleSite(r, v === true)}
                      />
                      <span className="min-w-0 truncate">{r.name}</span>
                      {!r.liveUrl && (
                        <span className="text-xs text-muted-foreground">
                          {tx("no live URL")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <Switch
                checked={editing.form.published}
                onCheckedChange={(v) => set({ published: v })}
              />
              {tx("Published — anyone with the link can see it")}
            </label>
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={
                  busy || !editing.form.title.trim() || !editing.form.slug
                }
              >
                {tx("Save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                {tx("Cancel")}
              </Button>
            </div>
          </div>
        )}

        {pages?.length === 0 && !editing && (
          <p className="text-muted-foreground">{tx("No status page yet.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
