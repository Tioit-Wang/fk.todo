import { getVersion } from "@tauri-apps/api/app";

async function getPackageVersionFallback(): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  try {
    // Only for dev/debug builds (when Tauri APIs may be unavailable).
    const pkg = (await import("../package.json")) as { default?: { version?: string } };
    const version = pkg.default?.version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

export async function getAppVersion(): Promise<string | null> {
  try {
    const version = await getVersion();
    if (typeof version === "string" && version.trim()) return version.trim();
  } catch {
    // Ignore; fall back for non-Tauri environments.
  }
  return await getPackageVersionFallback();
}

