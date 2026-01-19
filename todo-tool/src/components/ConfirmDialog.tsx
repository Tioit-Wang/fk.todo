import { useEffect, useMemo, useRef } from "react";

import { Icons } from "./icons";

type ConfirmTone = "default" | "danger";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const icon = useMemo(() => {
    if (tone === "danger") return <Icons.Trash />;
    return <Icons.AlertCircle />;
  }, [tone]);

  useEffect(() => {
    if (!open) return;
    // Focus the confirm button so Enter works immediately, and keyboard users have a clear target.
    confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        // Avoid re-trigger while busy (e.g. network / invoke).
        if (busy) return;
        event.preventDefault();
        void onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-header">
          <div className={`confirm-icon ${tone}`}>
            {icon}
          </div>
          <div className="confirm-title">
            <div className="confirm-title-text">{title}</div>
            {description && <div className="confirm-description">{description}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="关闭" title="关闭">
            <Icons.X />
          </button>
        </div>

        <div className="confirm-actions">
          <button type="button" className="confirm-btn ghost" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-btn ${tone === "danger" ? "danger" : "primary"}`}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

