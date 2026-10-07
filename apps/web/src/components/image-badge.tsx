import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ImageStatus } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";

const year = (iso: string) => iso.slice(0, 4);

/** In the container table: only when something is wrong with the image. */
export function ImageBadge({ status }: { status?: ImageStatus }) {
  const t = useT();
  const v = status?.verdict;
  if (v?.status === "unmaintained")
    return (
      <Badge variant="destructive-soft" className="mt-1 font-sans">
        {t("not maintained since {year}", { year: year(v.since) })}
      </Badge>
    );
  if (v?.status === "outdated")
    return (
      <Badge variant="warning" className="mt-1 font-sans">
        {t("newer build available")}
      </Badge>
    );
  return null;
}

/** In the container sheet: what it means and what helps. */
export function ImageVerdictNote({ status }: { status?: ImageStatus }) {
  const t = useT();
  const v = status?.verdict;
  if (v?.status === "unmaintained")
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>
          {t("Image no longer maintained — since {date}", {
            date: v.since.slice(0, 10),
          })}
        </AlertTitle>
        <AlertDescription>
          {t(
            "No new image has been published for it in over a year. A restart, reboot or redeploy runs the same old build again — its vulnerabilities stay. Replace it with a maintained image or drop the service."
          )}
        </AlertDescription>
      </Alert>
    );
  if (v?.status === "outdated")
    return (
      <Alert variant="warning">
        <RefreshCw />
        <AlertTitle>{t("A newer build of this image exists")}</AlertTitle>
        <AlertDescription>
          {t(
            "The tag was published again after this image was built. Pull it and recreate the container (redeploy) to get the fixes."
          )}
        </AlertDescription>
      </Alert>
    );
  return null;
}
