import { getLang, translate } from "@/lib/i18n";
export const SCHEDULE_OPTIONS = [
  { value: "", label: "Off", cron: null as string | null },
  { value: "hourly", label: "Hourly", cron: "0 * * * *" },
  { value: "daily", label: "Daily (03:00)", cron: "0 3 * * *" },
  { value: "weekly", label: "Weekly (Mon 03:00)", cron: "0 3 * * 1" },
];

export function cronToScheduleValue(cron: string | null): string {
  return SCHEDULE_OPTIONS.find((o) => o.cron === cron)?.value ?? "";
}

export function scheduleValueToCron(value: string): string | null {
  return SCHEDULE_OPTIONS.find((o) => o.value === value)?.cron ?? null;
}

/** Human label for a stored cron, falling back to the raw pattern. */
export function scheduleLabel(cron: string | null): string {
  if (!cron) return translate(getLang(), "Off");
  const label = SCHEDULE_OPTIONS.find((o) => o.cron === cron)?.label;
  return label ? translate(getLang(), label) : cron;
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "in 4 hours" / "12 minutes ago", falling back to "just now". */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = then - Date.now();
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "minute");
}

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(getLang() === "de" ? "de-AT" : undefined);
}
