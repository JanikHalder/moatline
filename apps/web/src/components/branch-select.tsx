import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tx } from "@/lib/i18n";
import { cleanRepoUrl, looksLikeRepoUrl } from "@/lib/git-host";

/**
 * The repository's branches, read with the organization's token for its
 * Git host.
 * Falls back to a text field when they cannot be listed (no token, no
 * access), so a branch can always be set.
 */
export function BranchSelect({
  id,
  githubUrl,
  value,
  onChange,
}: {
  id: string;
  githubUrl: string;
  value: string;
  onChange: (branch: string) => void;
}) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = looksLikeRepoUrl(githubUrl) ? cleanRepoUrl(githubUrl) : null;

  useEffect(() => {
    setBranches(null);
    setFailed(false);
    if (!key) return;
    // Typing a URL changes it per keystroke: wait until it settles.
    const t = setTimeout(() => {
      api
        .getBranches(key)
        .then((r) => setBranches(r.branches ?? []))
        .catch(() => setFailed(true));
    }, 400);
    return () => clearTimeout(t);
  }, [key]);

  if (!key || failed || (branches && branches.length === 0)) {
    return (
      <Input
        id={id}
        placeholder="main"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
    );
  }
  const options =
    branches && value && !branches.includes(value)
      ? [value, ...branches]
      : (branches ?? []);
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={branches === null}
    >
      <SelectTrigger id={id} className="w-full font-mono">
        <SelectValue
          placeholder={
            branches === null ? tx("Loading branches…") : tx("Branch")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((b) => (
          <SelectItem key={b} value={b} className="font-mono">
            {b}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
