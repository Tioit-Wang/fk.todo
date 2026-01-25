import { useEffect, useMemo, useRef, useState } from "react";

import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";

import {
  TaskComposer,
  type TaskComposerDraft,
} from "../components/TaskComposer";
import { NotificationBanner } from "../components/NotificationBanner";
import { IconButton } from "../components/IconButton";
import { TaskCard } from "../components/TaskCard";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { describeError, frontendLog } from "../frontendLog";
import { useI18n } from "../i18n";
import { visibleQuickTasks, type QuickSortMode, type QuickTab } from "../logic";
import {
  computeRescheduleDueAt,
  rescheduleTask,
  type ReschedulePresetId,
} from "../reschedule";
import { taskMatchesQuery } from "../search";
import type { SnoozePresetId } from "../snooze";
import type { Settings, Task } from "../types";

function isQuickTab(value: string): value is QuickTab {
  return (
    value === "todo" || value === "today" || value === "all" || value === "done"
  );
}

function isQuickSort(value: string): value is QuickSortMode {
  return value === "default" || value === "created";
}

const QUICK_WINDOW_INNER = { width: 500, height: 650 } as const;

export function QuickView({
  tasks,
  settings,
  normalTasks,
  onUpdateSettings,
  onUpdateTask,
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
  onUpdateSettings: (next: Settings) => Promise<boolean>;
  onUpdateTask: (next: Task) => Promise<void> | void;
  onCreateFromComposer: (
    draft: TaskComposerDraft,
  ) => Promise<boolean | void> | boolean | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onNormalSnooze: (task: Task, preset: SnoozePresetId) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<QuickTab>("todo");
  const [quickSort, setQuickSort] = useState<QuickSortMode>("default");
  const [now, setNow] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState("");

  const quickWindowApplied = useRef(false);
  const quickSaveTimer = useRef<number | null>(null);
  const settingsRef = useRef<Settings | null>(settings);
  const tabLockedRef = useRef(false);
  const sortLockedRef = useRef(false);

  const quickTabs = useMemo<{ id: QuickTab; label: string }[]>(
    () => [
      { id: "todo", label: t("quick.tab.todo") },
      { id: "today", label: t("quick.tab.today") },
      { id: "all", label: t("quick.tab.all") },
      { id: "done", label: t("quick.tab.done") },
    ],
    [t],
  );

  const quickSortOptions = useMemo(
    () => [
      { id: "default", label: t("quick.sort.default") },
      { id: "created", label: t("quick.sort.created") },
    ],
    [t],
  );

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Load persisted quick view prefs (tab/sort) once settings arrive or change.
  useEffect(() => {
    if (!settings) return;
    if (settings.quick_tab && !tabLockedRef.current) {
      setTab(isQuickTab(settings.quick_tab) ? settings.quick_tab : "todo");
    }
    if (settings.quick_sort && !sortLockedRef.current) {
      setQuickSort(
        isQuickSort(settings.quick_sort) ? settings.quick_sort : "default",
      );
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
      quickWindowApplied.current = true;
      void (async () => {
        try {
          const saved = settings.quick_bounds;
          const hasSaved =
            Boolean(saved) &&
            [saved?.x, saved?.y].every(
              (value) => typeof value === "number" && Number.isFinite(value),
            );

          const monitor = await currentMonitor().catch(() => null);
          const workArea = monitor?.workArea;
          const areaX = workArea?.position.x ?? monitor?.position.x ?? 0;
          const areaY = workArea?.position.y ?? monitor?.position.y ?? 0;
          const logicalAreaW =
            window.screen.availWidth ||
            window.screen.width ||
            window.innerWidth;
          const logicalAreaH =
            window.screen.availHeight ||
            window.screen.height ||
            window.innerHeight;
          const scale =
            monitor?.scaleFactor ??
            (await appWindow
              .scaleFactor()
              .catch(() => window.devicePixelRatio || 1));
          const areaW =
            workArea?.size.width ??
            monitor?.size.width ??
            Math.round(logicalAreaW * scale);
          const areaH =
            workArea?.size.height ??
            monitor?.size.height ??
            Math.round(logicalAreaH * scale);

          const width = Math.round(QUICK_WINDOW_INNER.width * scale);
          const height = Math.round(QUICK_WINDOW_INNER.height * scale);

          await appWindow
            .setSize(new PhysicalSize(width, height))
            .catch(() => {});

          const shouldApplySaved = hasSaved
            ? await (async () => {
                try {
                  const monitors = await availableMonitors();
                  if (monitors.length === 0) return true;
                  const minVisiblePx = 40;
                  const rect = {
                    x: saved!.x,
                    y: saved!.y,
                    width,
                    height,
                  };
                  return monitors.some((monitor) => {
                    const mx = monitor.workArea.position.x;
                    const my = monitor.workArea.position.y;
                    const mw = monitor.workArea.size.width;
                    const mh = monitor.workArea.size.height;
                    const ix = Math.max(rect.x, mx);
                    const iy = Math.max(rect.y, my);
                    const ax = Math.min(rect.x + rect.width, mx + mw);
                    const ay = Math.min(rect.y + rect.height, my + mh);
                    const iw = Math.max(0, ax - ix);
                    const ih = Math.max(0, ay - iy);
                    return iw >= minVisiblePx && ih >= minVisiblePx;
                  });
                } catch {
                  // Best-effort: if monitor APIs fail, trust persisted bounds.
                  return true;
                }
              })()
            : false;

          if (hasSaved && shouldApplySaved) {
            await appWindow
              .setPosition(new PhysicalPosition(saved!.x, saved!.y))
              .catch(() => {});
            return;
          }

          const centerX = areaX + Math.round((areaW - width) / 2);
          const centerY = areaY + Math.round((areaH - height) / 2);
          const offsetY = Math.round(areaH * 0.15);
          const y = Math.min(
            areaY + areaH - height,
            Math.max(areaY, centerY + offsetY),
          );
          await appWindow
            .setPosition(new PhysicalPosition(centerX, y))
            .catch(() => {});

          // If the saved bounds are off-screen, persist the corrected position so the quick window
          // remains reachable after monitor/layout changes.
          if (hasSaved && !shouldApplySaved) {
            const base = settingsRef.current ?? settings;
            void onUpdateSettings({
              ...base,
              quick_bounds: {
                x: centerX,
                y,
                width,
                height,
              },
            }).catch(() => {});
          }
        } catch {
          // Best-effort: if window APIs fail, keep the quick window usable with default bounds.
        }
      })();
    }

    // Some platforms lose the always-on-top state after hide()/show() cycles.
    // Re-assert it whenever settings change.
    void appWindow.setAlwaysOnTop(settings.quick_always_on_top).catch(() => {});

    const scheduleSave = () => {
      if (quickSaveTimer.current) {
        clearTimeout(quickSaveTimer.current);
      }
      quickSaveTimer.current = window.setTimeout(async () => {
        try {
          const [pos, size] = await Promise.all([
            appWindow.outerPosition(),
            appWindow.innerSize(),
          ]);

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
    let unlistenFocus: (() => void) | null = null;

    (async () => {
      try {
        const moved = await appWindow.onMoved(scheduleSave);
        if (disposed) {
          moved();
          return;
        }
        unlistenMoved = moved;
      } catch (err) {
        void frontendLog("warn", "quick window onMoved subscription failed", {
          err: describeError(err),
        });
      }

      try {
        const focused = await appWindow.onFocusChanged(({ payload }) => {
          if (!payload) return;
          void appWindow
            .setAlwaysOnTop(settingsRef.current?.quick_always_on_top ?? false)
            .catch(() => {});
        });
        if (disposed) {
          focused();
          return;
        }
        unlistenFocus = focused;
      } catch (err) {
        void frontendLog("warn", "quick window onFocusChanged subscription failed", {
          err: describeError(err),
        });
      }
    })();

    return () => {
      disposed = true;
      if (unlistenMoved) unlistenMoved();
      if (unlistenFocus) unlistenFocus();
      if (quickSaveTimer.current) {
        window.clearTimeout(quickSaveTimer.current);
      }
    };
  }, [settings, onUpdateSettings]);

  const quickTasks = useMemo(() => {
    const visible = visibleQuickTasks(tasks, tab, now, quickSort);
    return visible.filter((task) => taskMatchesQuery(task, searchQuery));
  }, [tasks, tab, now, quickSort, searchQuery]);

  async function handleReschedule(task: Task, preset: ReschedulePresetId) {
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const nextDueAt = computeRescheduleDueAt(task, preset, now);
    await onUpdateTask(rescheduleTask(task, nextDueAt, nowSeconds));
  }

  async function handleToggleAlwaysOnTop() {
    if (!settings) return;
    const next = {
      ...settings,
      quick_always_on_top: !settings.quick_always_on_top,
    };
    const ok = await onUpdateSettings(next);
    if (ok) {
      await getCurrentWindow().setAlwaysOnTop(next.quick_always_on_top);
    }
  }

  return (
    <div
      className={`quick-window ${settings?.quick_blur_enabled === false ? "blur-off" : ""}`}
    >
      <WindowTitlebar
        variant="quick"
        pinned={settings?.quick_always_on_top}
        onTogglePin={handleToggleAlwaysOnTop}
      />

      <NotificationBanner
        tasks={normalTasks}
        onSnooze={onNormalSnooze}
        onComplete={onNormalComplete}
      />

      <div className="quick-filter-tabs">
        {quickTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`quick-filter-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => {
              tabLockedRef.current = true;
              setTab(t.id);
            }}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
        <div className="quick-sort">
          <Icons.Sort />
          <select
            value={quickSort}
            onChange={(event) => {
              sortLockedRef.current = true;
              setQuickSort(event.currentTarget.value as QuickSortMode);
            }}
          >
            {quickSortOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="quick-search">
        <Icons.Search />
        <input
          className="search-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={t("search.placeholder")}
        />
        <IconButton
          className="icon-btn"
          onClick={() => setSearchQuery("")}
          title={t("search.clear")}
          label={t("search.clear")}
          disabled={!searchQuery.trim()}
        >
          <Icons.X />
        </IconButton>
      </div>

      <div className="quick-task-list">
        {quickTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            mode="quick"
            onToggleComplete={() => onToggleComplete(task)}
            onToggleImportant={() => onToggleImportant(task)}
            onReschedulePreset={(preset) => void handleReschedule(task, preset)}
            onUpdateTask={onUpdateTask}
            onDelete={() => onRequestDelete(task)}
            onEdit={() => onEditTask(task)}
          />
        ))}
      </div>

      <div className="quick-input-bar">
        <TaskComposer
          placeholder={settings?.ai_enabled ? t("composer.placeholderAi") : undefined}
          onSubmit={onCreateFromComposer}
        />
      </div>
    </div>
  );
}
