import { formatLocalDateKey } from "./date";

export function startOfLocalDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Monday = 0 ... Sunday = 6
export function weekdayIndexMonday(date: Date) {
  const day = date.getDay(); // 0=Sun..6=Sat
  return (day + 6) % 7;
}

export function startOfWeekMonday(date: Date) {
  const d = startOfLocalDay(date);
  return addDays(d, -weekdayIndexMonday(d));
}

export function monthKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export type CalendarCell = {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
};

export function buildMonthGrid(cursorMonth: Date, today: Date): CalendarCell[] {
  const monthStart = new Date(cursorMonth);
  monthStart.setDate(1);
  const gridStart = startOfWeekMonday(monthStart);
  const todayKey = formatLocalDateKey(today);

  const list: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const key = formatLocalDateKey(date);
    const inMonth = date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear();
    const isToday = key === todayKey;
    list.push({ date, key, inMonth, isToday });
  }
  return list;
}

