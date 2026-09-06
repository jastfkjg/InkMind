/** Calendar-day labels for the library, with exact dates retained in a tooltip. */
export function relativeEditTime(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const elapsed = date.getTime() - now.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsed) < 60_000) return format.format(0, "second");
  if (Math.abs(elapsed) < 3_600_000) return format.format(Math.trunc(elapsed / 60_000), "minute");
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  if (days === 0) return format.format(Math.trunc(elapsed / 3_600_000), "hour");
  if (Math.abs(days) < 7) return format.format(days, "day");
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
