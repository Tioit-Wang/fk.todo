import { tomorrowAtLocalTime } from "./timePresets";

export type SnoozePresetId = "m5" | "m15" | "h1" | "tomorrow0900";

export function computeSnoozeUntilSeconds(
  preset: SnoozePresetId,
  now: Date = new Date(),
): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (preset === "m5") return nowSeconds + 5 * 60;
  if (preset === "m15") return nowSeconds + 15 * 60;
  if (preset === "h1") return nowSeconds + 60 * 60;
  return tomorrowAtLocalTime(now, 9, 0);
}

