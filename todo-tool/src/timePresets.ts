export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function clampToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

export function tomorrowAtLocalTime(now: Date, hour: number, minute: number): number {
  const d = clampToMinute(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return toUnixSeconds(d);
}

export function nextWorkdayAtLocalTime(now: Date, hour: number, minute: number): number {
  // Workday: Mon-Fri (getDay(): 1-5). Weekend: Sat=6, Sun=0.
  let d = clampToMinute(now);
  d.setHours(hour, minute, 0, 0);

  const isWorkday = (date: Date) => {
    const day = date.getDay();
    return day >= 1 && day <= 5;
  };

  // If "today at hh:mm" is still upcoming and is a workday, allow it.
  if (isWorkday(d) && now.getTime() <= d.getTime()) {
    return toUnixSeconds(d);
  }

  // Otherwise, advance to the next workday.
  do {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, minute, 0, 0);
  } while (!isWorkday(d));

  return toUnixSeconds(d);
}

