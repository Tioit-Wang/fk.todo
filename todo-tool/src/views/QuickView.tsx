import { useEffect, useMemo, useRef, useState } from "react";

import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";

import { TaskComposer, type TaskComposerDraft } from "../components/TaskComposer";
import { NotificationBanner } from "../components/NotificationBanner";
import { TaskCard } from "../components/TaskCard";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { DOM_WINDOW_DRAG_START } from "../events";
import { visibleQuickTasks, type QuickSortMode, type QuickTab } from "../logic";
import type { Settings, Task } from "../types";

function isQuickTab(value: string): value is QuickTab {
  return value === "todo" || value === "today" || value === "all" || value === "done";
}

function isQuickSort(value: string): value is QuickSortMode {
  return value === "default" || value === "created";
}

const QUICK_TABS = [
  { id: "todo", label: "待完成" },
  { id: "today", label: "今日" },
  { id: "all", label: "全部" },
  { id: "done", label: "已完成" },
] as const;

const QUICK_SORT_OPTIONS = [
  { id: "default", label: "默认排序" },
  { id: "created", label: "创建时间" },
] as const;

export function QuickView({
  tasks,
  settings,
  normalTasks,
  isModalOpen,
  onUpdateSettings,
  onCreateFromComposer,
  onToggleComplete,
  onToggleImportant,
  onRequestDelete,
  onEditTask,
  onNormalSnooze,
  onNormalComplete,
}: {
  tasks: Task[];
  settings: Settings | null;
  normalTasks: Task[];
  isModalOpen: boolean;
  onUpdateSettings: (next: Settings) => Promise<boolean>;
  onCreateFromComposer: (draft: TaskComposerDraft) => Promise<void> | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onNormalSnooze: (task: Task) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<QuickTab>("todo");
  const [quickSort, setQuickSort] = useState<QuickSortMode>("default");

  const quickWindowApplied = useRef(false);
  const quickSaveTimer = useRef<number | null>(null);
  const settingsRef = useRef<Settings | null>(settings);
  const isModalOpenRef = useRef(isModalOpen);
  const ignoreFocusLossUntilRef = useRef(0);
  const focusLossCheckTimerRef = useRef<number | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isModalOpenRef.current = isModalOpen;
  }, [isModalOpen]);

  // Load persisted quick view prefs (tab/sort) once settings arrive or change.
  useEffect(() => {
    if (!settings) return;
    if (settings.quick_tab) {
      setTab(isQuickTab(settings.quick_tab) ? settings.quick_tab : "todo");
    }
    if (settings.quick_sort) {
      setQuickSort(isQuickSort(settings.quick_sort) ? settings.quick_sort : "default");
    }
  }, [settings?.quick_tab, settings?.quick_sort, settings]);

  // Persist quick view prefs back to Settings (only in the quick window).
  useEffect(() => {
    if (!settings) return;
    if (settings.quick_tab !== tab || settings.quick_sort !== quickSort) {
      void onUpdateSettings({
        ...settings,
        quick_tab: tab,
        quick_sort: quickSort,
      }).catch(() => {});
    }
  }, [settings, tab, quickSort, onUpdateSettings]);

  // Apply quick window bounds and keep them persisted (debounced).
  useEffect(() => {
    if (!settings) return;
    const appWindow = getCurrentWindow();

    if (!quickWindowApplied.current) {
      if (settings.quick_bounds) {
        const bounds = settings.quick_bounds;
        void appWindow.setSize(new LogicalSize(bounds.width, bounds.height)).catch(() => {});
        void appWindow.setPosition(new LogicalPosition(bounds.x, bounds.y)).catch(() => {});
      } else {
        void appWindow
          .outerSize()
          .then((size) => {
            const availableWidth = window.screen.availWidth || window.screen.width;
            const availableHeight = window.screen.availHeight || window.screen.height;
            const centerX = Math.max(0, Math.round((availableWidth - size.width) / 2));
            const centerY = Math.max(0, Math.round((availableHeight - size.height) / 2));
            const offsetY = Math.round(availableHeight * 0.15);
            void appWindow.setPosition(new LogicalPosition(centerX, centerY + offsetY)).catch(() => {});
          })
          .catch(() => {});
      }
      quickWindowApplied.current = true;
    }

    // Some platforms lose the always-on-top state after hide()/show() cycles.
    // Re-assert it whenever settings change.
    void appWindow.setAlwaysOnTop(settings.quick_always_on_top).catch(() => {});

    const scheduleSave = () => {
      // When the user drags/resizes the quick window on Windows, the native drag loop can
      // cause transient focus changes. Extend the grace period while movement is ongoing so
      // the window doesn't auto-hide mid-drag.
      if (Date.now() < ignoreFocusLossUntilRef.current) {
        ignoreFocusLossUntilRef.current = Math.max(ignoreFocusLossUntilRef.current, Date.now() + 800);
      }

      if (quickSaveTimer.current) {
        clearTimeout(quickSaveTimer.current);
      }
      quickSaveTimer.current = window.setTimeout(async () => {
        try {
          const [pos, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);

          // Use the latest settings snapshot to avoid overwriting newer changes (theme/sound/etc)
          // with a stale closure while we're only trying to persist window bounds.
          const base = settingsRef.current ?? settings;
          void onUpdateSettings({
            ...base,
            quick_bounds: {
              x: pos.x,
              y: pos.y,
              width: size.width,
              height: size.height,
            },
          }).catch(() => {});
        } catch {
          // Best-effort: if the window APIs fail (platform quirks), skip this save tick.
        }
      }, 2000);
    };

    let disposed = false;
    let unlistenMoved: (() => void) | null = null;
    let unlistenResized: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    (async () => {
      const moved = await appWindow.onMoved(scheduleSave);
      if (disposed) {
        moved();
        return;
      }
      unlistenMoved = moved;

      const resized = await appWindow.onResized(scheduleSave);
      if (disposed) {
        resized();
        return;
      }
      unlistenResized = resized;

      const focused = await appWindow.onFocusChanged(({ payload }) => {
        if (!payload) return;
        void appWindow.setAlwaysOnTop(settingsRef.current?.quick_always_on_top ?? false).catch(() => {});
      });
      if (disposed) {
        focused();
        return;
      }
      unlistenFocus = focused;
    })();

    return () => {
      disposed = true;
      if (unlistenMoved) unlistenMoved();
      if (unlistenResized) unlistenResized();
      if (unlistenFocus) unlistenFocus();
      if (quickSaveTimer.current) {
        window.clearTimeout(quickSaveTimer.current);
      }
    };
  }, [settings, onUpdateSettings]);

  // Auto-hide quick window when it loses focus (unless it's pinned or the edit modal is open).
  //
  // NOTE: Don't use the webview-level `window.blur` event here. On Windows, entering a native
  // drag loop can briefly blur the webview, which makes the quick window appear to minimize
  // or disappear while dragging. Using Tauri's window focus event + a small drag grace period
  // avoids that UX bug.
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const scheduleFocusLossCheck = (graceMs: number) => {
      ignoreFocusLossUntilRef.current = Math.max(ignoreFocusLossUntilRef.current, Date.now() + graceMs);
      if (focusLossCheckTimerRef.current) {
        window.clearTimeout(focusLossCheckTimerRef.current);
      }

      const tick = async () => {
        try {
          focusLossCheckTimerRef.current = null;
          const now = Date.now();
          if (now < ignoreFocusLossUntilRef.current) {
            // Grace period extended (e.g., continuous drag); re-check when it should have ended.
            const remaining = ignoreFocusLossUntilRef.current - now;
            focusLossCheckTimerRef.current = window.setTimeout(() => void tick(), remaining + 50);
            return;
          }
          if (settingsRef.current?.quick_always_on_top) return;
          if (isModalOpenRef.current) return;
          const focused = await appWindow.isFocused();
          if (!focused) void appWindow.hide().catch(() => {});
        } catch {
          // Best-effort: if focus APIs fail, don't auto-hide.
        }
      };

      focusLossCheckTimerRef.current = window.setTimeout(() => void tick(), graceMs + 50);
    };

    const onDragStart = () => scheduleFocusLossCheck(1200);
    window.addEventListener(DOM_WINDOW_DRAG_START, onDragStart as EventListener);

    let disposed = false;
    let unlistenFocus: (() => void) | null = null;
    (async () => {
      const focused = await appWindow.onFocusChanged(({ payload }) => {
        // payload === true => focused, payload === false => blurred.
        if (payload) return;
        if (Date.now() < ignoreFocusLossUntilRef.current) return;
        if (settingsRef.current?.quick_always_on_top) return;
        if (isModalOpenRef.current) return;
        void appWindow.hide().catch(() => {});
      });

      if (disposed) {
        focused();
        return;
      }
      unlistenFocus = focused;
    })();

    return () => {
      disposed = true;
      window.removeEventListener(DOM_WINDOW_DRAG_START, onDragStart as EventListener);
      if (focusLossCheckTimerRef.current) {
        window.clearTimeout(focusLossCheckTimerRef.current);
      }
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  const quickTasks = useMemo(() => visibleQuickTasks(tasks, tab, new Date(), quickSort), [tasks, tab, quickSort]);

  async function handleToggleAlwaysOnTop() {
    if (!settings) return;
    const next = { ...settings, quick_always_on_top: !settings.quick_always_on_top };
    const ok = await onUpdateSettings(next);
    if (ok) {
      await getCurrentWindow().setAlwaysOnTop(next.quick_always_on_top);
    }
  }

  return (
    <div className={`quick-window ${settings?.quick_blur_enabled === false ? "blur-off" : ""}`}>
      <WindowTitlebar variant="quick" pinned={settings?.quick_always_on_top} onTogglePin={handleToggleAlwaysOnTop} />

      <NotificationBanner tasks={normalTasks} onSnooze={onNormalSnooze} onComplete={onNormalComplete} />

      <div className="quick-filter-tabs">
        {QUICK_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`quick-filter-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
        <div className="quick-sort">
          <Icons.Sort />
          <select value={quickSort} onChange={(event) => setQuickSort(event.currentTarget.value as QuickSortMode)}>
            {QUICK_SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="quick-task-list">
        {quickTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            mode="quick"
            onToggleComplete={() => onToggleComplete(task)}
            onToggleImportant={() => onToggleImportant(task)}
            onDelete={() => onRequestDelete(task)}
            onEdit={() => onEditTask(task)}
          />
        ))}
      </div>

      <div className="quick-input-bar">
        <TaskComposer onSubmit={onCreateFromComposer} />
      </div>
    </div>
  );
}
