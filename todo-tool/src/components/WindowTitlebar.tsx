import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

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

export function WindowTitlebar({ variant, title, pinned, onTogglePin, onMinimize, right }: WindowTitlebarProps) {
  const showPin = variant === "quick";
  const appWindow = getCurrentWindow();

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Let buttons/inputs behave normally; dragging is only for empty titlebar space.
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, input, select, textarea")) return;

    // The quick window auto-hides itself when it loses focus (launcher-like behavior).
    // On Windows, starting a native drag can momentarily blur the webview. We emit a hint
    // so the quick window can ignore that transient focus loss and avoid "minimize on drag".
    window.dispatchEvent(new CustomEvent("fk.todo:window-drag-start"));
    void appWindow.startDragging();
  }

  return (
    <div className={`window-titlebar ${variant}`} onPointerDown={handlePointerDown}>
      <div className="window-titlebar-left">
        <div className="traffic-lights" aria-label="Window controls">
          <button
            type="button"
            className="traffic-light red"
            title="关闭"
            aria-label="关闭"
            onClick={() => {
              // Use close() to respect backend close-behavior hooks.
              void appWindow.close();
            }}
          />
          <button
            type="button"
            className="traffic-light yellow"
            title="最小化"
            aria-label="最小化"
            onClick={() => {
              if (onMinimize) {
                void onMinimize();
              } else {
                void appWindow.minimize();
              }
            }}
          />
          {showPin && (
            <button
              type="button"
              className={`traffic-light green ${pinned ? "active" : ""}`}
              title={pinned ? "取消置顶" : "置顶"}
              aria-label={pinned ? "取消置顶" : "置顶"}
              aria-pressed={Boolean(pinned)}
              onClick={() => {
                void onTogglePin?.();
              }}
            />
          )}
        </div>
      </div>

      <div className="window-titlebar-center" data-tauri-drag-region>
        {title && <div className="window-titlebar-title">{title}</div>}
      </div>

      <div className="window-titlebar-right">
        {right}
      </div>
    </div>
  );
}
