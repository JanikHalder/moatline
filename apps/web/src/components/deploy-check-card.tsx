import { Box, CircleAlert, Download } from "lucide-react";
import { toast } from "sonner";
import { api, type DeployCheck } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

async function downloadHowto(repoId: string, name: string) {
  try {
    const md = await api.getHowtoMarkdown(repoId, name);
    const url = URL.createObjectURL(
      new Blob([md], { type: "text/markdown;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : tx("Could not download"));
  }
}

/**
 * Next.js standalone (and related) deploy footprint from the last branch scan.
 */
export function DeployCheckCard({
  repoId,
  check,
}: {
  repoId: string;
  check: DeployCheck | null;
}) {
  if (!check?.next.usesNext) return null;
  const findings = check.findings;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Box className="size-4 text-muted-foreground" />
          {tx("Deploy image")}
          {findings.length === 0 ? (
            <Badge variant="outline" className="text-success">
              {tx("standalone ok")}
            </Badge>
          ) : (
            <Badge variant="destructive-soft">
              <CircleAlert className="size-3" />
              {findings.length === 1
                ? findings[0]!.title
                : tx("{n} deploy issues", { n: findings.length })}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {tx(
            "Whether Next.js builds a small standalone image for Dokploy — large images fill the host."
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            {tx("checked")} {formatRelative(check.checkedAt)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="divide-y rounded-md border text-xs">
          <li className="flex justify-between gap-3 px-3 py-2">
            <span>{tx("output: standalone")}</span>
            <span className="font-mono">
              {check.next.configStandalone == null
                ? tx("no next.config")
                : check.next.configStandalone
                  ? "yes"
                  : "no"}
            </span>
          </li>
          <li className="flex justify-between gap-3 px-3 py-2">
            <span>{tx("start → standalone server")}</span>
            <span className="font-mono">
              {check.next.startUsesStandalone ? "yes" : "no"}
            </span>
          </li>
          <li className="flex justify-between gap-3 px-3 py-2">
            <span>{tx("Dockerfile copies standalone")}</span>
            <span className="font-mono">
              {check.next.dockerfileStandalone ? "yes" : "no"}
            </span>
          </li>
        </ul>
        {findings.map((f) => (
          <div
            key={f.id}
            className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          >
            <p className="font-medium">{f.title}</p>
            <p className="text-xs text-muted-foreground">{f.detail}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => downloadHowto(repoId, f.howto)}
            >
              <Download className="size-3" />
              {tx("Download howto (.md)")}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
