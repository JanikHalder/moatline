import { tx } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

export type Severity =
  | "critical"
  | "high"
  | "medium"
  | "moderate"
  | "low"
  | "info";

/** Sort key, most severe first. "medium" and "moderate" are the same level. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  moderate: 2,
  low: 3,
  info: 4,
};

// Critical is the only solid badge, so it still stands out in a table that is
// otherwise full of tinted "high" ones.
const SEVERITY_VARIANT: Record<
  Severity,
  "destructive" | "destructive-soft" | "warning" | "secondary" | "outline"
> = {
  critical: "destructive",
  high: "destructive-soft",
  medium: "warning",
  moderate: "warning",
  low: "secondary",
  info: "outline",
};

/**
 * Badge for an advisory severity. Accepts the npm audit scale (moderate) as
 * well as the CVSS one (medium); anything unknown renders neutral.
 */
export function SeverityBadge({
  severity,
  count,
  className,
}: {
  severity: Severity | (string & {});
  /** Renders "3 critical" instead of just "critical". */
  count?: number;
  className?: string;
}) {
  const variant = SEVERITY_VARIANT[severity as Severity] ?? "outline";
  return (
    <Badge variant={variant} className={className}>
      {count != null ? `${count} ${tx(severity)}` : tx(severity)}
    </Badge>
  );
}
