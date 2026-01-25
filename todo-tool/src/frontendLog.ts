import { invoke } from "@tauri-apps/api/core";

export type FrontendLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack}` : "";
    return `${err.name}: ${err.message}${stack}`;
  }
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function frontendLog(
  level: FrontendLogLevel,
  message: string,
  context?: unknown,
) {
  try {
    await invoke<boolean>("frontend_log", { level, message, context });
  } catch {
    // Best-effort: logging must never break UI flows (and may run in non-Tauri contexts).
  }
}

