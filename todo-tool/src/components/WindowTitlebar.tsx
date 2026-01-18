import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

type Variant = "quick" | "main";

type WindowTitlebarProps = {
  variant: Variant;
  title?: string;
  // For the quick window we repurpose the green "zoom" button as a pin toggle.
  pinned?: boolean;
  onTogglePin?: () => void | Promise<void>;
  // Extra controls (view tabs / settings, etc.)
  right?: ReactNode;
};

export function WindowTitlebar({ variant, title, pinned, onTogglePin, right }: WindowTitlebarProps) {
  const showPin = variant === "quick";
  const appWindow = getCurrentWindow();

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Let buttons/inputs behave normally; dragging is only for empty titlebar space.
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, input, select, textarea")) return;
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
              void appWindow.minimize();
            }}
          />
          <button
            type="button"
            className={`traffic-light green ${showPin && pinned ? "active" : ""}`}
            title={showPin ? (pinned ? "取消置顶" : "置顶") : "最大化/还原"}
            aria-label={showPin ? (pinned ? "取消置顶" : "置顶") : "最大化/还原"}
            aria-pressed={showPin ? Boolean(pinned) : undefined}
            onClick={() => {
              if (showPin) {
                void onTogglePin?.();
                return;
              }
              void appWindow.toggleMaximize();
            }}
          />
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
