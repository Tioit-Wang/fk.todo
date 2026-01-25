import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

import { DOM_WINDOW_DRAG_START } from "../events";
import { describeError, frontendLog } from "../frontendLog";
import { useI18n } from "../i18n";

type Variant = "quick" | "main";

type WindowTitlebarProps = {
  variant: Variant;
  title?: string;
  // For the quick window we repurpose the green "zoom" button as a pin toggle.
  pinned?: boolean;
  onTogglePin?: () => void | Promise<void>;
  onMinimize?: () => void | Promise<void>;
  // Extra controls (view tabs / settings, etc.)
  right?: ReactNode;
};

export function WindowTitlebar({
  variant,
  title,
  pinned,
  onTogglePin,
  onMinimize,
  right,
}: WindowTitlebarProps) {
  const { t } = useI18n();
  const showPin = variant === "quick";
  const appWindow = getCurrentWindow();

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Let buttons/inputs behave normally; dragging is only for empty titlebar space.
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, input, select, textarea")) return;

    // The quick window auto-hides itself when it loses focus (launcher-like behavior).
    // On Windows, starting a native drag can momentarily blur the webview. We emit a hint
    // so the quick window can ignore that transient focus loss and avoid "minimize on drag".
    window.dispatchEvent(new CustomEvent(DOM_WINDOW_DRAG_START));
    void appWindow.startDragging().catch((err) => {
      console.warn("window startDragging failed", err);
      void frontendLog("warn", "window.startDragging failed", {
        variant,
        err: describeError(err),
      });
    });
  }

  return (
    <div
      className={`window-titlebar ${variant}`}
      onPointerDown={handlePointerDown}
    >
      <div className="window-titlebar-left">
        <div className="traffic-lights" aria-label={t("window.controls")}>
          <button
            type="button"
            className="traffic-light red"
            title={t("window.close")}
            aria-label={t("window.close")}
            onClick={() => {
              // Use close() to respect backend close-behavior hooks.
              void appWindow.close().catch(async (err) => {
                console.warn("window close failed; falling back to hide()", err);
                void frontendLog("warn", "window.close failed; falling back to hide", {
                  variant,
                  err: describeError(err),
                });
                try {
                  await appWindow.hide();
                } catch (hideErr) {
                  console.warn("window hide fallback failed", hideErr);
                  void frontendLog("error", "window.hide fallback failed", {
                    variant,
                    err: describeError(hideErr),
                  });
                }
              });
            }}
          />
          <button
            type="button"
            className="traffic-light yellow"
            title={t("window.minimize")}
            aria-label={t("window.minimize")}
            onClick={() => {
              if (onMinimize) {
                void Promise.resolve(onMinimize()).catch((err) => {
                  console.warn("window custom onMinimize failed", err);
                  void frontendLog("warn", "window custom onMinimize failed", {
                    variant,
                    err: describeError(err),
                  });
                });
              } else {
                void appWindow.minimize().catch(async (err) => {
                  console.warn("window minimize failed; falling back to hide()", err);
                  void frontendLog(
                    "warn",
                    "window.minimize failed; falling back to hide",
                    { variant, err: describeError(err) },
                  );
                  try {
                    await appWindow.hide();
                  } catch (hideErr) {
                    console.warn("window hide fallback failed", hideErr);
                    void frontendLog("error", "window.hide fallback failed", {
                      variant,
                      err: describeError(hideErr),
                    });
                  }
                });
              }
            }}
          />
          {showPin && (
            <button
              type="button"
              className={`traffic-light green ${pinned ? "active" : ""}`}
              title={pinned ? t("window.unpin") : t("window.pin")}
              aria-label={pinned ? t("window.unpin") : t("window.pin")}
              aria-pressed={Boolean(pinned)}
              onClick={() => {
                void Promise.resolve(onTogglePin?.()).catch(() => {});
              }}
            />
          )}
        </div>
      </div>

      <div className="window-titlebar-center" data-tauri-drag-region>
        {title && <div className="window-titlebar-title">{title}</div>}
      </div>

      <div className="window-titlebar-right">{right}</div>
    </div>
  );
}
