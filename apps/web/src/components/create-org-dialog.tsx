import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { slugifyOrgName } from "@/lib/org-slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/error-alert";
import { tx } from "@/lib/i18n";

export function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: createError } = await authClient.organization.create(
        {
          name: trimmed,
          slug: slugifyOrgName(trimmed),
        }
      );
      if (createError || !data) {
        setError(createError?.message ?? "Could not create the organization.");
        return;
      }
      await authClient.organization.setActive({ organizationId: data.id });
      onCreated();
      onOpenChange(false);
      setName("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : tx("Could not create the organization.")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tx("Create organization")}</DialogTitle>
          <DialogDescription>
            {tx(
              "Repositories, scans and members all live inside an organization."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="create-org-name">{tx("Name")}</Label>
          <Input
            id="create-org-name"
            placeholder={tx("Organization name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            autoFocus
          />
        </div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tx("Cancel")}
          </Button>
          <Button onClick={create} disabled={loading || !name.trim()}>
            {loading && <Spinner />}
            {tx("Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
