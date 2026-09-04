/**
 * SSR-stable date/time formatting.
 *
 * `Date#toLocaleString()` resolves locale and timezone from the runtime
 * environment, so the Node server (container: en-US, UTC) and the browser
 * (user's locale/timezone, e.g. de-DE, Europe/Berlin) render the same
 * timestamp differently — "9/3/2026, 10:23:46 AM" vs "03.09.2026, 12:23:46".
 * That made timestamps flip between slashes and dots depending on whether a
 * page was server-rendered (refresh) or reached via client-side navigation
 * (login) — see issue #233 — and caused hydration text mismatches.
 *
 * These helpers pin both locale and timezone so server and client render
 * byte-identical output. Event/audit timestamps are shown in UTC.
 */
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** e.g. "03/09/2026, 14:05:09" (UTC, independent of server/browser locale). */
export function formatDateTimeUtc(value: Date | number | string): string {
  return dateTimeFormat.format(value instanceof Date ? value : new Date(value));
}
