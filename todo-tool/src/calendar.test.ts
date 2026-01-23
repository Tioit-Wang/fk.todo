import { describe, expect, it } from "vitest";

import { buildMonthGrid, monthKey, startOfLocalDay, weekdayIndexMonday } from "./calendar";
import { formatLocalDateKey } from "./date";

describe("calendar helpers", () => {
  it("monthKey formats YYYY-MM", () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
    expect(monthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });

  it("weekdayIndexMonday uses Monday=0..Sunday=6", () => {
    expect(weekdayIndexMonday(new Date(2026, 0, 5))).toBe(0); // 2026-01-05 is Monday
    expect(weekdayIndexMonday(new Date(2026, 0, 11))).toBe(6); // 2026-01-11 is Sunday
  });

  it("buildMonthGrid returns a stable 6x7 grid and marks today", () => {
    const cursorMonth = new Date(2026, 0, 1);
    const today = startOfLocalDay(new Date(2026, 0, 15));
    const cells = buildMonthGrid(cursorMonth, today);

    expect(cells).toHaveLength(42);
    expect(cells.some((c) => c.isToday)).toBe(true);

    const expectedStart = formatLocalDateKey(new Date(2025, 11, 29)); // Monday of the week containing 2026-01-01
    expect(cells[0].key).toBe(expectedStart);
    expect(cells[0].date.getDay()).toBe(1); // Monday
  });
});

