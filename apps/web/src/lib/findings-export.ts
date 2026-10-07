import { toast } from "sonner";
import { api } from "@/lib/api";
import { tx } from "@/lib/i18n";

/** Copy a repository's findings as markdown, ready to paste into an agent. */
export async function copyFindings(repoId: string): Promise<void> {
  try {
    const md = await api.getFindingsMarkdown(repoId);
    await navigator.clipboard.writeText(md);
    toast.success(tx("Findings copied — paste them into your coding agent"));
  } catch (e) {
    toast.error(
      e instanceof Error ? e.message : tx("Could not copy the findings")
    );
  }
}

/** Save a repository's findings as findings-<name>.md. */
export async function downloadFindings(
  repoId: string,
  name: string
): Promise<void> {
  try {
    const md = await api.getFindingsMarkdown(repoId);
    const url = URL.createObjectURL(
      new Blob([md], { type: "text/markdown;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `findings-${name.replace(/[^\w.-]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(
      e instanceof Error ? e.message : tx("Could not download the findings")
    );
  }
}
