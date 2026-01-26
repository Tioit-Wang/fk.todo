export function formatDue(ts: number) {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function toDateTimeLocal(ts: number) {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function fromDateTimeLocal(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.floor(parsed.getTime() / 1000);
}

// Parse "YYYY-MM-DD h:m:s" (also accepts "YYYY-MM-DD hh:mm" / "YYYY-MM-DDThh:mm[:ss]").
// We avoid `Date.parse` on space-separated strings because it's runtime-dependent.
export function parseLocalDateTimeString(value: string) {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace("T", " ");
  const parts = normalized.split(/\s+/);
  if (parts.length < 2) return null;

  const [datePart, timePart] = parts;
  const [yStr, mStr, dStr] = datePart.split("-");
  const [hhStr, mmStr, ssStr] = timePart.split(":");

  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  const ss = ssStr == null || ssStr === "" ? 0 : Number(ssStr);

  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss)
  ) {
    return null;
  }

  const dt = new Date(y, m - 1, d, hh, mm, ss, 0);
  if (Number.isNaN(dt.getTime())) return null;

  // Guard against Date auto-rollover (e.g. 2026-02-31).
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== hh ||
    dt.getMinutes() !== mm ||
    dt.getSeconds() !== ss
  ) {
    return null;
  }

  return Math.floor(dt.getTime() / 1000);
}

export function todayMidnight(now: Date) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function sameLocalDate(a: number, b: number) {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function formatLocalDateKey(now: Date) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
