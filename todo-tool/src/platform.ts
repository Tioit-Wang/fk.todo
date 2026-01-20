export type Platform = "windows" | "macos" | "linux" | "unknown";

export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

