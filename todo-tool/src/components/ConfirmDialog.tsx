import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "../i18n";
import { IconButton } from "./IconButton";
import { Icons } from "./icons";

type ConfirmTone = "default" | "danger";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string | null;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const confirmLabel = confirmText ?? t("common.confirm");
  const showCancel = cancelText !== null;
  const cancelLabel = cancelText ?? t("common.cancel");

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
          <IconButton className="icon-btn" onClick={onCancel} label={t("common.close")} title={t("common.close")}>
            <Icons.X />
          </IconButton>
        </div>

        <div className="confirm-actions">
          {showCancel && (
            <button type="button" className="confirm-btn ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-btn ${tone === "danger" ? "danger" : "primary"}`}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

