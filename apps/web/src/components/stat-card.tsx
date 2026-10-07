import type { ComponentType, ReactNode } from "react";
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
 * The key figures of a page, as one band divided by hairlines rather than
 * a row of separate cards: they are read together, as one line of state.
 */
export function StatBand({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * One figure in a StatBand: label, number, optional hint. A value of zero
 * is greyed out on purpose — a wall of red zeros reads as an alarm.
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
    <div className={cn("space-y-2 bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
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
          "tabular text-2xl font-semibold leading-none tracking-tight",
          muted ? "text-muted-foreground/50" : TONE_TEXT[tone]
        )}
      >
        {value}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
