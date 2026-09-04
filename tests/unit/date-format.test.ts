import { describe, expect, it } from "vitest";
import { formatDateTimeUtc } from "@/src/lib/date-format";

describe("formatDateTimeUtc", () => {
  it("formats a unix epoch (ms) deterministically in UTC, independent of runtime locale/timezone", () => {
    // 2026-09-03T10:45:09Z
    expect(formatDateTimeUtc(Date.UTC(2026, 8, 3, 10, 45, 9))).toBe("03/09/2026, 10:45:09");
  });

  it("handles midnight without rolling over to hour 24", () => {
    // 2026-09-03T00:00:00Z
    expect(formatDateTimeUtc(Date.UTC(2026, 8, 3, 0, 0, 0))).toBe(
      "03/09/2026, 00:00:00"
    );
  });

  it("accepts ISO strings and Date objects", () => {
    const expected = "03/09/2026, 10:45:09";
    expect(formatDateTimeUtc("2026-09-03T10:45:09Z")).toBe(expected);
    expect(formatDateTimeUtc(new Date("2026-09-03T10:45:09Z"))).toBe(expected);
  });

  it("is stable across environment locale overrides (SSR vs browser)", () => {
    // The bug in issue #233: toLocaleString() rendered "3.9.2026, ..." in a
    // de-DE browser but "9/3/2026, ..." on the en-US server. The pinned
    // formatter must ignore the ambient locale entirely.
    const result = formatDateTimeUtc(Date.UTC(2026, 8, 3, 10, 45, 9));
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
    expect(result).toBe("03/09/2026, 10:45:09");
  });
});
