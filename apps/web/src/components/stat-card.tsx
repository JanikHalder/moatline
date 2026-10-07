import type { ComponentType, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "destructive" | "warning" | "success";

const TONE_TEXT: Record<StatTone, string> = {
  default: "text-foreground",
  destructive: "text-destructive",
  warning: "text-warning",
  success: "text-success",
};

const TONE_DOT: Record<StatTone, string> = {
  default: "bg-muted-foreground/50",
  destructive: "bg-destructive",
  warning: "bg-warning",
  success: "bg-success",
};

/**
 * A single KPI tile: label, big number, optional hint. A value of zero is
 * greyed out on purpose — a wall of red zeros reads as an alarm.
 */
export function StatCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  /** Optional lucide icon shown top-right; without it a tone dot is shown. */
  icon?: ComponentType<{ className?: string }>;
  tone?: StatTone;
  className?: string;
}) {
  const muted = value === 0 || value === "0";
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            {!Icon && (
              <span
                aria-hidden
                className={cn("size-2 rounded-full", TONE_DOT[tone])}
              />
            )}
            {label}
          </span>
          {Icon && <Icon className="size-4 text-muted-foreground" />}
        </div>
        <div
          className={cn(
            "tabular text-3xl font-semibold leading-none tracking-tight",
            muted ? "text-muted-foreground/40" : TONE_TEXT[tone]
          )}
        >
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
