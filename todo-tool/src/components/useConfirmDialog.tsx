import { useCallback, useRef, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmTone = "default" | "danger";

export type ConfirmRequest = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string | null;
  tone?: ConfirmTone;
};

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const open = Boolean(request);

  const close = useCallback((result: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolver?.(result);
  }, []);

  const requestConfirm = useCallback(
    (next: ConfirmRequest): Promise<boolean> => {
      // Avoid stacking confirmations; callers should wait for the previous one.
      if (resolverRef.current) return Promise.resolve(false);

      setRequest(next);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  const dialog = (
    <ConfirmDialog
      open={open}
      title={request?.title ?? ""}
      description={request?.description}
      confirmText={request?.confirmText}
      cancelText={request?.cancelText}
      tone={request?.tone}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { requestConfirm, dialog, open };
}
