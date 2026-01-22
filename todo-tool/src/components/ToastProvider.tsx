import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { Icons } from "./icons";

export type ToastTone = "default" | "success" | "danger";

export type ToastOptions = {
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  notify: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, options?: ToastOptions) => {
      const text = (message ?? "").trim();
      if (!text) return;

      const tone: ToastTone = options?.tone ?? "default";
      const durationMs = Math.min(15_000, Math.max(1200, options?.durationMs ?? 3200));

      const id = crypto.randomUUID();
      const toast: ToastItem = { id, message: text, tone };

      setItems((prev) => [...prev, toast].slice(-5));

      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`} role="status">
            <span className="toast-icon" aria-hidden="true">
              {item.tone === "success" ? <Icons.Check /> : item.tone === "danger" ? <Icons.AlertCircle /> : <Icons.AlertCircle />}
            </span>
            <span className="toast-message">{item.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <Icons.X />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider />");
  }
  return ctx;
}

