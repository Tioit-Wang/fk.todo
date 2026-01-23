import { useEffect, useMemo, useRef, useState } from "react";

import type { PluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

import "./App.css";

import type { TaskComposerDraft } from "./components/TaskComposer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ForcedReminderOverlay } from "./components/ForcedReminderOverlay";
import { TaskEditModal } from "./components/TaskEditModal";
import { useToast } from "./components/ToastProvider";
import { useConfirmDialog } from "./components/useConfirmDialog";
import { MainView } from "./views/MainView";
import { QuickView } from "./views/QuickView";
import { SettingsView } from "./views/SettingsView";
import { CalendarView } from "./views/CalendarView";

import {
  bulkCompleteTasks,
  bulkUpdateTasks,
  completeTask,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  deleteTasks,
  dismissForced,
  loadState,
  snoozeTask,
  showSettingsWindow,
  updateProject,
  updateSettings,
  updateTask,
} from "./api";
import { formatDue, formatLocalDateKey } from "./date";
import { I18nProvider, makeTranslator, resolveAppLanguage } from "./i18n";
import { newTask } from "./logic";
import { TAURI_NAVIGATE } from "./events";
import { detectPlatform } from "./platform";
import { buildReminderConfig } from "./reminder";
import { computeSnoozeUntilSeconds, type SnoozePresetId } from "./snooze";
import { normalizeTheme } from "./theme";
import type { Project, Settings, Task } from "./types";
import { TodayView } from "./views/TodayView";

const NOTIFICATION_ACTION_TYPE = "todo-reminder";
const NOTIFICATION_ACTION_SNOOZE_5 = "snooze5";
const NOTIFICATION_ACTION_SNOOZE_15 = "snooze15";
const NOTIFICATION_ACTION_SNOOZE_1H = "snooze1h";
const NOTIFICATION_ACTION_SNOOZE_TOMORROW = "snoozeTomorrow";
const NOTIFICATION_ACTION_COMPLETE = "complete";

function normalizeTask(task: Task) {
  const sort_order = task.sort_order || task.created_at * 1000;
  const quadrant = [1, 2, 3, 4].includes(task.quadrant) ? task.quadrant : 1;
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const project_id =
    typeof task.project_id === "string" && task.project_id.trim()
      ? task.project_id
      : "inbox";
  return { ...task, sort_order, quadrant, tags, project_id };
}

function normalizeProject(project: Project) {
  const sort_order = project.sort_order || project.created_at * 1000;
  const pinned = Boolean(project.pinned);
  const name = typeof project.name === "string" ? project.name : "";
  return { ...project, sort_order, pinned, name };
}

function normalizeSettings(settings: Settings): Settings {
  // Keep runtime guards so older persisted settings (or partial payloads) don't break the UI.
  const today_focus_ids = Array.isArray(settings.today_focus_ids)
    ? settings.today_focus_ids.filter((id) => typeof id === "string")
    : [];
  const today_focus_date =
    typeof settings.today_focus_date === "string"
      ? settings.today_focus_date
      : undefined;
  const today_prompted_date =
    typeof settings.today_prompted_date === "string"
      ? settings.today_prompted_date
      : undefined;
  const reminder_repeat_interval_sec =
    typeof settings.reminder_repeat_interval_sec === "number" &&
    Number.isFinite(settings.reminder_repeat_interval_sec)
      ? Math.max(0, Math.floor(settings.reminder_repeat_interval_sec))
      : 10 * 60;
  const reminder_repeat_max_times =
    typeof settings.reminder_repeat_max_times === "number" &&
    Number.isFinite(settings.reminder_repeat_max_times)
      ? Math.max(0, Math.floor(settings.reminder_repeat_max_times))
      : 0;
  return {
    ...settings,
    today_focus_ids,
    today_focus_date,
    today_prompted_date,
    reminder_repeat_interval_sec,
    reminder_repeat_max_times,
  };
}

function reconcileById<T extends { id: string }>(
  prev: T[],
  incoming: T[],
  isSame: (prevItem: T, nextItem: T) => boolean,
): T[] {
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return incoming;

  // Fast path: identical order + same items => keep the old array reference
  // so React can skip downstream work.
  if (prev.length === incoming.length) {
    let allSame = true;
    for (let i = 0; i < incoming.length; i += 1) {
      const nextItem = incoming[i];
      const prevItem = prev[i];
      if (prevItem?.id !== nextItem.id || !isSame(prevItem, nextItem)) {
        allSame = false;
        break;
      }
    }
    if (allSame) return prev;
  }

  const prevById = new Map(prev.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const existing = prevById.get(item.id);
    return existing && isSame(existing, item) ? existing : item;
  });
}

function mergeUniqueIds(existing: string[], incoming: string[]) {
  if (incoming.length === 0) return existing;
  const next = [...existing];
  const seen = new Set(existing);
  for (const id of incoming) {
    if (!seen.has(id)) {
      next.push(id);
      seen.add(id);
    }
  }
  return next;
}

function playBeep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
    oscillator.onended = () => {
      context.close();
    };
  } catch {
    // Ignore audio errors in restricted environments.
  }
}

function App() {
  type AppView = "quick" | "main" | "reminder" | "settings";

  const getViewFromHash = (): AppView => {
    const raw = window.location.hash.replace("#", "");
    const path = raw.startsWith("/") ? raw.slice(1) : raw;
    const view = path.split("/")[0];
    const label = getCurrentWindow().label;
    if (
      label === "main" ||
      label === "quick" ||
      label === "reminder" ||
      label === "settings"
    )
      return label;
    if (
      view === "main" ||
      view === "quick" ||
      view === "reminder" ||
      view === "settings"
    )
      return view;
    return "main";
  };

  const [view, setView] = useState<AppView>(getViewFromHash());
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(
    null,
  );
  const [confirmDeleteBusy, setConfirmDeleteBusy] = useState(false);

  const [forcedQueueIds, setForcedQueueIds] = useState<string[]>([]);
  const [normalQueueIds, setNormalQueueIds] = useState<string[]>([]);

  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    downloaded: number;
    total?: number;
  } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showTodayPrompt, setShowTodayPrompt] = useState(false);

  type ManualUpdateCheckResult =
    | { status: "update"; version: string }
    | { status: "none" }
    | { status: "error"; error: string };

  type UpdateSettingsOptions = {
    toastError?: boolean;
    toastErrorMessage?: string;
  };

  const appLang = resolveAppLanguage(settings?.language);
  const t = useMemo(() => makeTranslator(appLang), [appLang]);
  const toast = useToast();
  const { requestConfirm, dialog: confirmDialog } = useConfirmDialog();

  // Keep a mutable pointer for async callbacks so we can read latest settings without stale closures.
  const settingsRef = useRef<Settings | null>(null);

  useEffect(() => {
    const onHash = () => {
      setLocationHash(window.location.hash);
      setView(getViewFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Backend-triggered navigation (tray menu, etc.). Keep it scoped to the main window.
  useEffect(() => {
    if (getCurrentWindow().label !== "main") return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const listener = await listen<{ hash: string }>(
        TAURI_NAVIGATE,
        ({ payload }) => {
          const next = typeof payload?.hash === "string" ? payload.hash : "";
          if (!next) return;
          window.location.hash = next;
        },
      );

      if (disposed) {
        listener();
        return;
      }
      unlisten = listener;
    })().catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Check for app updates once per launch. Keep it scoped to the main window to avoid multi-window prompts.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (getCurrentWindow().label !== "main") return;

    let disposed = false;
    let updateHandle: Update | null = null;

    void (async () => {
      const update = await check();
      if (disposed || !update) {
        if (update) void update.close().catch(() => {});
        return;
      }

      updateHandle = update;
      setPendingUpdate(update);
      setShowUpdatePrompt(true);
    })().catch((err) => {
      console.warn("updater check failed", err);
    });

    return () => {
      disposed = true;
      if (updateHandle) void updateHandle.close().catch(() => {});
    };
  }, []);

  // Notification actions (OS-level buttons) should only be handled by the quick window.
  useEffect(() => {
    if (getViewFromHash() !== "quick") return;
    let disposed = false;
    let actionListener: PluginListener | null = null;

    registerActionTypes([
      {
        id: NOTIFICATION_ACTION_TYPE,
        actions: [
          { id: NOTIFICATION_ACTION_SNOOZE_5, title: t("banner.snooze5") },
          { id: NOTIFICATION_ACTION_SNOOZE_15, title: t("banner.snooze15") },
          { id: NOTIFICATION_ACTION_SNOOZE_1H, title: t("banner.snooze1h") },
          {
            id: NOTIFICATION_ACTION_SNOOZE_TOMORROW,
            title: t("banner.snoozeTomorrowMorning"),
          },
          { id: NOTIFICATION_ACTION_COMPLETE, title: t("banner.complete") },
        ],
      },
    ]).catch(() => {});

    void (async () => {
      const listener = await onAction(async (notification) => {
        const payload = notification as {
          actionId?: string;
          actionIdentifier?: string;
          extra?: Record<string, unknown>;
        };
        const actionId = payload.actionId ?? payload.actionIdentifier ?? "";
        const taskId =
          typeof payload.extra?.taskId === "string"
            ? payload.extra.taskId
            : null;

        if (taskId) {
          const snoozePreset: SnoozePresetId | null =
            actionId === NOTIFICATION_ACTION_SNOOZE_5
              ? "m5"
              : actionId === NOTIFICATION_ACTION_SNOOZE_15
                ? "m15"
                : actionId === NOTIFICATION_ACTION_SNOOZE_1H
                  ? "h1"
                  : actionId === NOTIFICATION_ACTION_SNOOZE_TOMORROW
                    ? "tomorrow0900"
                    : null;

          if (snoozePreset) {
            const until = computeSnoozeUntilSeconds(snoozePreset);
            await snoozeTask(taskId, until);
            setNormalQueueIds((prev) => prev.filter((id) => id !== taskId));
          } else if (actionId === NOTIFICATION_ACTION_COMPLETE) {
            await completeTask(taskId);
            setNormalQueueIds((prev) => prev.filter((id) => id !== taskId));
          }
        }

        // Bring the quick window forward so the user sees the updated list immediately.
        const window = getCurrentWindow();
        void window.show().catch(() => {});
        void window.setFocus().catch(() => {});
      });

      if (disposed) {
        listener.unregister();
        return;
      }
      actionListener = listener;
    })().catch(() => {});

    return () => {
      disposed = true;
      if (actionListener) {
        actionListener.unregister();
      }
    };
  }, [t]);

  // Load initial state and subscribe to backend events.
  useEffect(() => {
    let disposed = false;
    let unlistenState: (() => void) | null = null;
    let unlistenReminder: (() => void) | null = null;

    void (async () => {
      const res = await loadState();
      if (res.ok && res.data) {
        setTasks((prev) => {
          const raw = res.data?.tasks ?? [];
          if (prev.length === raw.length) {
            let same = true;
            for (let i = 0; i < raw.length; i += 1) {
              if (
                prev[i]?.id !== raw[i]?.id ||
                prev[i]?.updated_at !== raw[i]?.updated_at
              ) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }

          const nextTasks = raw.map(normalizeTask);
          return reconcileById(prev, nextTasks, (a, b) => a.updated_at === b.updated_at);
        });
        setProjects((prev) => {
          const raw = res.data?.projects ?? [];
          if (prev.length === raw.length) {
            let same = true;
            for (let i = 0; i < raw.length; i += 1) {
              if (
                prev[i]?.id !== raw[i]?.id ||
                prev[i]?.updated_at !== raw[i]?.updated_at
              ) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }

          const nextProjects = raw.map(normalizeProject);
          return reconcileById(
            prev,
            nextProjects,
            (a, b) => a.updated_at === b.updated_at,
          );
        });
        setSettings(normalizeSettings(res.data.settings));
      }

      const stateListener = await listen("state_updated", (event) => {
        const payload = event.payload as {
          tasks?: Task[];
          projects?: Project[];
          settings?: Settings;
        };
        if (payload.tasks) {
          setTasks((prev) => {
            const raw = payload.tasks ?? [];
            if (prev.length === raw.length) {
              let same = true;
              for (let i = 0; i < raw.length; i += 1) {
                if (
                  prev[i]?.id !== raw[i]?.id ||
                  prev[i]?.updated_at !== raw[i]?.updated_at
                ) {
                  same = false;
                  break;
                }
              }
              if (same) return prev;
            }

            const nextTasks = raw.map(normalizeTask);
            return reconcileById(
              prev,
              nextTasks,
              (a, b) => a.updated_at === b.updated_at,
            );
          });
        }
        if (payload.projects) {
          setProjects((prev) => {
            const raw = payload.projects ?? [];
            if (prev.length === raw.length) {
              let same = true;
              for (let i = 0; i < raw.length; i += 1) {
                if (
                  prev[i]?.id !== raw[i]?.id ||
                  prev[i]?.updated_at !== raw[i]?.updated_at
                ) {
                  same = false;
                  break;
                }
              }
              if (same) return prev;
            }

            const nextProjects = raw.map(normalizeProject);
            return reconcileById(
              prev,
              nextProjects,
              (a, b) => a.updated_at === b.updated_at,
            );
          });
        }
        if (payload.settings) {
          setSettings(normalizeSettings(payload.settings));
        }
      });
      if (disposed) {
        stateListener();
        return;
      }
      unlistenState = stateListener;

      const reminderListener = await listen("reminder_fired", async (event) => {
        const payload = event.payload as Task[];
        if (!Array.isArray(payload) || payload.length === 0) return;

        // Beep only from the quick window instance to avoid duplicate sounds.
        if (
          settingsRef.current?.sound_enabled &&
          getViewFromHash() === "quick"
        ) {
          playBeep();
        }

        const forced = payload.filter(
          (task) => task.reminder.kind === "forced",
        );
        const normal = payload.filter(
          (task) => task.reminder.kind === "normal",
        );

        if (forced.length > 0) {
          setForcedQueueIds((prev) =>
            mergeUniqueIds(
              prev,
              forced.map((task) => task.id),
            ),
          );
        }

        if (normal.length > 0) {
          setNormalQueueIds((prev) =>
            mergeUniqueIds(
              prev,
              normal.map((task) => task.id),
            ),
          );

          // System-level notifications for normal reminders:
          // - Send from a single window instance to avoid duplicates (main window is always present).
          // - Keep the in-app banner (NotificationBanner) as the primary interaction surface.
          if (getViewFromHash() === "main") {
            let granted = false;
            try {
              granted = await isPermissionGranted();
            } catch {
              // If the permission check fails (platform differences), attempt to send anyway.
              granted = true;
            }
            if (granted) {
              normal.forEach((task) => {
                // `sendNotification` is typed as void on some platforms; wrap in Promise.resolve
                // so we can safely catch (whether it throws synchronously or returns a Promise).
                void Promise.resolve(
                  sendNotification({
                    title: t("banner.normalReminder"),
                    body: `${task.title} (${formatDue(task.due_at)})`,
                    actionTypeId: NOTIFICATION_ACTION_TYPE,
                    extra: { taskId: task.id },
                    silent: settingsRef.current
                      ? !settingsRef.current.sound_enabled
                      : false,
                  }),
                ).catch(() => {});
              });
            }
          }
        }
      });
      if (disposed) {
        reminderListener();
        return;
      }
      unlistenReminder = reminderListener;
    })().catch(() => {});

    return () => {
      disposed = true;
      if (unlistenState) unlistenState();
      if (unlistenReminder) unlistenReminder();
    };
  }, [t]);

  useEffect(() => {
    settingsRef.current = settings;
    if (!settings) return;
    document.documentElement.dataset.theme = normalizeTheme(settings.theme);
  }, [settings]);

  useEffect(() => {
    document.documentElement.lang = appLang;
  }, [appLang]);

  useEffect(() => {
    document.documentElement.dataset.view = view;
  }, [view]);

  useEffect(() => {
    const platform =
      document.documentElement.dataset.platform ?? detectPlatform();
    document.documentElement.dataset.platform = platform;

    // We use custom chrome + rounded UI in Windows (especially for transparent windows).
    // Disable native window shadows to keep the UI flat and consistent with our CSS.
    //
    // On macOS, the system window shadow/corners generally look correct already, and we avoid
    // relying on `transparent` without enabling private APIs.
    if (platform === "windows") {
      void getCurrentWindow()
        .setShadow(false)
        .catch(() => {});
    }
  }, []);

  // Global Escape behavior:
  // - If a modal is open, close it (let modal components handle their own Escape when possible).
  // - Otherwise, in quick window: hide (launcher-like).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (confirmDeleteTaskId) return;
      if (editingTaskId) {
        setEditingTaskId(null);
        return;
      }
      if (view === "quick") {
        void getCurrentWindow()
          .hide()
          .catch(() => {});
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDeleteTaskId, editingTaskId, view]);

  // Keep reminder queues in sync with current tasks (completed/dismissed tasks should drop out).
  useEffect(() => {
    setForcedQueueIds((prev) =>
      prev.filter((id) => {
        const task = tasks.find((item) => item.id === id);
        return (
          task &&
          !task.completed &&
          task.reminder.kind === "forced" &&
          !task.reminder.forced_dismissed
        );
      }),
    );
    setNormalQueueIds((prev) =>
      prev.filter((id) => {
        const task = tasks.find((item) => item.id === id);
        return task && !task.completed && task.reminder.kind === "normal";
      }),
    );
  }, [tasks]);

  const forcedTasks = useMemo(() => {
    return forcedQueueIds
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is Task => Boolean(task));
  }, [forcedQueueIds, tasks]);

  const normalTasks = useMemo(() => {
    return normalQueueIds
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is Task => Boolean(task));
  }, [normalQueueIds, tasks]);

  const reminderTask = forcedTasks[0] ?? null;
  const reminderQueueTotal = forcedTasks.length;
  const reminderQueueIndex = reminderTask ? 1 : 0;

  const deleteCandidate = useMemo(() => {
    if (!confirmDeleteTaskId) return null;
    return tasks.find((task) => task.id === confirmDeleteTaskId) ?? null;
  }, [tasks, confirmDeleteTaskId]);

  const editingTask = useMemo(() => {
    if (!editingTaskId) return null;
    return tasks.find((task) => task.id === editingTaskId) ?? null;
  }, [tasks, editingTaskId]);

  useEffect(() => {
    if (!editingTaskId) return;
    if (!tasks.some((task) => task.id === editingTaskId)) {
      setEditingTaskId(null);
    }
  }, [tasks, editingTaskId]);

  useEffect(() => {
    if (!confirmDeleteTaskId) return;
    if (!tasks.some((task) => task.id === confirmDeleteTaskId)) {
      setConfirmDeleteTaskId(null);
    }
  }, [tasks, confirmDeleteTaskId]);

  // Reminder window: if the queue is empty, hide it.
  useEffect(() => {
    if (view === "reminder" && !reminderTask) {
      void getCurrentWindow()
        .hide()
        .catch(() => {});
    }
  }, [view, reminderTask]);

  // Reminder window: full-screen transparent overlay.
  useEffect(() => {
    if (view !== "reminder") return;
    const appWindow = getCurrentWindow();

    (async () => {
      try {
        // Prefer the actual monitor bounds (multi-monitor / DPI aware). Fall back to browser
        // screen dimensions if the monitor API is unavailable.
        const monitor = await currentMonitor();
        if (monitor) {
          await appWindow.setSize(monitor.size);
          await appWindow.setPosition(monitor.position);
          return;
        }

        const screenWidth = window.screen.width || window.innerWidth;
        const screenHeight = window.screen.height || window.innerHeight;
        await appWindow.setSize(new LogicalSize(screenWidth, screenHeight));
        await appWindow.setPosition(new LogicalPosition(0, 0));
      } catch {
        // Best-effort: if the window API fails (platform quirks), keep the reminder usable.
      }
    })();
  }, [view]);

  async function refreshState() {
    const res = await loadState();
    if (res.ok && res.data) {
      setTasks(res.data.tasks.map(normalizeTask));
      setProjects(res.data.projects.map(normalizeProject));
      setSettings(normalizeSettings(res.data.settings));
    }
  }

  async function handleUpdateSettings(
    next: Settings,
    options?: UpdateSettingsOptions,
  ): Promise<boolean> {
    const previous = settingsRef.current ?? settings;
    setSettings(next);
    const result = await updateSettings(next);
    if (!result.ok) {
      if (previous) {
        setSettings(previous);
      }
      const message = options?.toastErrorMessage ?? result.error;
      if (options?.toastError !== false && message) {
        toast.notify(message, { tone: "danger", durationMs: 6000 });
      }
      return false;
    }
    if (result.data) {
      setSettings(normalizeSettings(result.data));
    }
    return true;
  }

  function handleOpenToday() {
    window.location.hash = "#/main/today";
  }

  function handleOpenCalendar() {
    window.location.hash = "#/main/calendar";
  }

  async function handleOpenSettingsWindow() {
    const res = await showSettingsWindow();
    if (!res.ok) {
      toast.notify(res.error ?? t("settings.openFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
    }
  }

  async function handleCreateProject(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const project: Project = {
      id: crypto.randomUUID(),
      name: trimmed,
      pinned: false,
      sort_order: Date.now(),
      created_at: nowSeconds,
      updated_at: nowSeconds,
    };

    const res = await createProject(project);
    if (!res.ok) {
      toast.notify(res.error ?? t("alert.operationFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
    }
  }

  async function handleUpdateProject(next: Project) {
    const res = await updateProject(next);
    if (!res.ok) {
      toast.notify(res.error ?? t("alert.operationFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
    }
  }

  async function handleDeleteProject(projectId: string) {
    const res = await deleteProject(projectId);
    if (!res.ok) {
      toast.notify(res.error ?? t("alert.operationFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
    }
  }

  async function handleCreateFromComposer(draft: TaskComposerDraft) {
    const task = newTask(draft.title, new Date(), draft.project_id);
    task.due_at = draft.due_at;
    task.important = draft.important;
    task.tags = draft.tags;
    task.repeat = draft.repeat;
    task.reminder = buildReminderConfig(
      draft.reminder_kind,
      draft.due_at,
      draft.reminder_offset_minutes,
    );
    task.updated_at = Math.floor(Date.now() / 1000);
    await createTask(task);
  }

  async function handleToggleComplete(task: Task) {
    const now = Math.floor(Date.now() / 1000);
    if (!task.completed) {
      await completeTask(task.id);
      return;
    }

    if (task.repeat.type !== "none") {
      const ok = await requestConfirm({
        title: t("confirm.uncompleteRepeatTask.title"),
        description: t("confirm.uncompleteRepeatTask"),
        confirmText: t("common.confirm"),
        cancelText: t("common.cancel"),
      });
      if (!ok) return;
    }

    await updateTask({
      ...task,
      completed: false,
      completed_at: undefined,
      updated_at: now,
    });
  }

  async function handleToggleImportant(task: Task) {
    const now = Math.floor(Date.now() / 1000);
    await updateTask({ ...task, important: !task.important, updated_at: now });
  }

  function handleRequestDelete(task: Task) {
    setConfirmDeleteTaskId(task.id);
  }

  async function handleConfirmDelete() {
    if (!deleteCandidate || confirmDeleteBusy) return;
    setConfirmDeleteBusy(true);
    try {
      const result = await deleteTask(deleteCandidate.id);
      if (!result.ok) {
        toast.notify(result.error ?? t("alert.deleteFailed"), {
          tone: "danger",
          durationMs: 6000,
        });
        return;
      }
      setConfirmDeleteTaskId(null);
    } finally {
      setConfirmDeleteBusy(false);
    }
  }

  async function handleUpdateTask(next: Task) {
    await updateTask(next);
  }

  async function handleBulkUpdate(nextTasks: Task[]): Promise<boolean> {
    if (nextTasks.length === 0) return true;
    const result = await bulkUpdateTasks(nextTasks);
    if (!result.ok) {
      toast.notify(result.error ?? t("alert.operationFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
      await refreshState();
      return false;
    }
    return true;
  }

  async function handleBulkComplete(taskIds: string[]): Promise<boolean> {
    if (taskIds.length === 0) return true;
    const result = await bulkCompleteTasks(taskIds);
    if (!result.ok) {
      toast.notify(result.error ?? t("alert.operationFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
      await refreshState();
      return false;
    }
    return true;
  }

  async function handleBulkDelete(taskIds: string[]): Promise<boolean> {
    if (taskIds.length === 0) return true;
    const result = await deleteTasks(taskIds);
    if (!result.ok) {
      toast.notify(result.error ?? t("alert.deleteFailed"), {
        tone: "danger",
        durationMs: 6000,
      });
      await refreshState();
      return false;
    }
    return true;
  }

  function handleEditTask(task: Task) {
    setEditingTaskId(task.id);
  }

  async function handleReminderSnooze(preset: SnoozePresetId) {
    if (!reminderTask) return;
    const taskId = reminderTask.id;
    const until = computeSnoozeUntilSeconds(preset);

    // Update UI first so the overlay reacts instantly (show next reminder or hide if none).
    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0)
        void getCurrentWindow()
          .hide()
          .catch(() => {});
      return next;
    });

    await snoozeTask(taskId, until);
  }

  async function handleReminderDismiss() {
    if (!reminderTask) return;
    const taskId = reminderTask.id;

    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0)
        void getCurrentWindow()
          .hide()
          .catch(() => {});
      return next;
    });

    await dismissForced(taskId);
  }

  async function handleReminderComplete() {
    if (!reminderTask) return;
    const taskId = reminderTask.id;

    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0)
        void getCurrentWindow()
          .hide()
          .catch(() => {});
      return next;
    });

    await completeTask(taskId);
  }

  async function handleNormalSnooze(task: Task, preset: SnoozePresetId) {
    const until = computeSnoozeUntilSeconds(preset);
    await snoozeTask(task.id, until);
    setNormalQueueIds((prev) => prev.filter((id) => id !== task.id));
  }

  async function handleNormalComplete(task: Task) {
    await completeTask(task.id);
    setNormalQueueIds((prev) => prev.filter((id) => id !== task.id));
  }

  function dismissUpdatePrompt() {
    if (updateBusy) return;
    setShowUpdatePrompt(false);
    setUpdateProgress(null);

    const update = pendingUpdate;
    setPendingUpdate(null);
    if (update) void update.close().catch(() => {});
  }

  async function handleUpdateConfirm() {
    if (!pendingUpdate) return;

    const update = pendingUpdate;
    setUpdateBusy(true);
    setUpdateError(null);
    setUpdateProgress(null);

    const onEvent = (event: DownloadEvent) => {
      if (event.event === "Started") {
        setUpdateProgress({ downloaded: 0, total: event.data.contentLength });
        return;
      }
      if (event.event === "Progress") {
        setUpdateProgress((prev) => ({
          downloaded: (prev?.downloaded ?? 0) + event.data.chunkLength,
          total: prev?.total,
        }));
        return;
      }
      if (event.event === "Finished") {
        setUpdateProgress((prev) => prev ?? { downloaded: 0 });
      }
    };

    try {
      await update.downloadAndInstall(onEvent);
      await relaunch();
    } catch (err) {
      console.error("update failed", err);
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdateBusy(false);
      setUpdateProgress(null);
      setShowUpdatePrompt(false);
      setPendingUpdate(null);
      void update.close().catch(() => {});
    }
  }

  async function handleUpdateErrorRetry() {
    if (import.meta.env.DEV) return;
    if (getCurrentWindow().label !== "main") return;

    setUpdateError(null);
    try {
      const update = await check();
      if (!update) return;
      setPendingUpdate(update);
      setShowUpdatePrompt(true);
    } catch (err) {
      console.warn("updater check failed", err);
      setUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleManualUpdateCheck(): Promise<ManualUpdateCheckResult> {
    if (import.meta.env.DEV) {
      return { status: "error", error: "updater disabled in dev mode" };
    }
    const label = getCurrentWindow().label;
    if (label !== "main" && label !== "settings") {
      return {
        status: "error",
        error: "updater must run in main/settings window",
      };
    }
    if (updateBusy) {
      return { status: "error", error: "updater is busy" };
    }

    try {
      const update = await check();
      if (!update) return { status: "none" };

      // Replace any existing pending handle to avoid leaking native resources.
      setPendingUpdate((prev) => {
        if (prev) void prev.close().catch(() => {});
        return update;
      });
      setShowUpdatePrompt(true);
      return { status: "update", version: update.version };
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const mainPage = (() => {
    const raw = locationHash.replace("#", "");
    const path = raw.startsWith("/") ? raw.slice(1) : raw;
    const parts = path.split("/").filter(Boolean);

    // Supported routes:
    // - main window: #/main, #/main/today, #/main/calendar
    // - settings window: #/settings
    // - legacy: #/main/settings (main window will redirect to settings window)
    if (parts[0] === "settings") return "settings";
    if (parts[0] === "main" && parts[1] === "settings") return "settings";
    if (parts[0] === "calendar") return "calendar";
    if (parts[0] === "main" && parts[1] === "calendar") return "calendar";
    if (parts[0] === "today") return "today";
    if (parts[0] === "main" && parts[1] === "today") return "today";
    return "home";
  })();

  useEffect(() => {
    // Legacy route: settings is now a separate window; redirect the main window back home.
    if (view !== "main") return;
    if (mainPage !== "settings") return;
    setEditingTaskId(null);
    setConfirmDeleteTaskId(null);
    void showSettingsWindow().catch(() => {});
    window.location.hash = "#/main";
  }, [view, mainPage]);

  // Daily "today focus" prompt: show it only in the main window home page and only once per day.
  useEffect(() => {
    if (view !== "main") return;
    if (getCurrentWindow().label !== "main") return;
    if (mainPage !== "home") return;
    if (!settings) return;

    const todayKey = formatLocalDateKey(new Date());
    const hasFocusToday =
      settings.today_focus_date === todayKey &&
      (settings.today_focus_ids?.length ?? 0) > 0;
    const promptedToday = settings.today_prompted_date === todayKey;

    setShowTodayPrompt(!hasFocusToday && !promptedToday);
  }, [
    view,
    mainPage,
    settings?.today_focus_date,
    settings?.today_prompted_date,
    settings?.today_focus_ids?.length,
    settings,
  ]);

  const updatePercent =
    updateProgress?.total && updateProgress.total > 0
      ? Math.min(
          100,
          Math.floor((updateProgress.downloaded / updateProgress.total) * 100),
        )
      : null;

  const updatePromptTitle = pendingUpdate
    ? t("update.foundWithVersion", { version: pendingUpdate.version })
    : t("update.found");
  const updatePromptDescription = (() => {
    if (!pendingUpdate) return undefined;

    if (updateBusy) {
      if (updatePercent !== null)
        return t("update.downloadingPercent", { percent: updatePercent });
      if (updateProgress?.downloaded) {
        const mb = Math.max(
          1,
          Math.round(updateProgress.downloaded / 1024 / 1024),
        );
        return t("update.downloadingMb", { mb });
      }
      return t("update.downloading");
    }

    const versionLine = t("update.versionLine", {
      current: pendingUpdate.currentVersion,
      next: pendingUpdate.version,
    });
    const notes = (pendingUpdate.body ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!notes) return versionLine;
    const shortNotes = notes.length > 200 ? `${notes.slice(0, 197)}...` : notes;
    return `${versionLine}. ${shortNotes}`;
  })();

  const updateConfirmText = updateBusy
    ? updatePercent === null
      ? t("update.updating")
      : t("update.updatingPercent", { percent: updatePercent })
    : t("update.updateNow");

  return (
    <I18nProvider lang={appLang}>
      <div className="app-container">
        {view === "quick" && (
          <QuickView
            tasks={tasks}
            settings={settings}
            normalTasks={normalTasks}
            onUpdateSettings={handleUpdateSettings}
            onUpdateTask={handleUpdateTask}
            onCreateFromComposer={handleCreateFromComposer}
            onToggleComplete={handleToggleComplete}
            onToggleImportant={handleToggleImportant}
            onRequestDelete={handleRequestDelete}
            onEditTask={handleEditTask}
            onNormalSnooze={handleNormalSnooze}
            onNormalComplete={handleNormalComplete}
          />
        )}

        {view === "settings" && (
          <SettingsView
            tasks={tasks}
            projects={projects}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            updateBusy={updateBusy}
            onCheckUpdate={handleManualUpdateCheck}
            onBack={() => {
              void getCurrentWindow()
                .hide()
                .catch(() => {});
            }}
          />
        )}

        {view === "main" && mainPage === "today" && (
          <TodayView
            tasks={tasks}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onBack={() => {
              window.location.hash = "#/main";
            }}
          />
        )}

        {view === "main" && mainPage === "calendar" && (
          <CalendarView
            tasks={tasks}
            settings={settings}
            normalTasks={normalTasks}
            onNormalSnooze={handleNormalSnooze}
            onNormalComplete={handleNormalComplete}
            onUpdateTask={handleUpdateTask}
            onToggleComplete={handleToggleComplete}
            onToggleImportant={handleToggleImportant}
            onRequestDelete={handleRequestDelete}
            onEditTask={handleEditTask}
            onBack={() => {
              window.location.hash = "#/main";
            }}
          />
        )}

        {view === "main" && mainPage === "home" && (
          <MainView
            tasks={tasks}
            projects={projects}
            settings={settings}
            normalTasks={normalTasks}
            onUpdateTask={handleUpdateTask}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onBulkUpdate={handleBulkUpdate}
            onBulkComplete={handleBulkComplete}
            onBulkDelete={handleBulkDelete}
            onRefreshState={refreshState}
            onCreateFromComposer={handleCreateFromComposer}
            onCreateProject={handleCreateProject}
            onToggleComplete={handleToggleComplete}
            onToggleImportant={handleToggleImportant}
            onRequestDelete={handleRequestDelete}
            onEditTask={handleEditTask}
            onOpenSettings={() => void handleOpenSettingsWindow()}
            onOpenToday={handleOpenToday}
            onOpenCalendar={handleOpenCalendar}
            onNormalSnooze={handleNormalSnooze}
            onNormalComplete={handleNormalComplete}
          />
        )}

        {view === "reminder" && settings && (
          <ForcedReminderOverlay
            task={reminderTask}
            color={settings.forced_reminder_color}
            queueIndex={reminderQueueIndex}
            queueTotal={reminderQueueTotal}
            onDismiss={handleReminderDismiss}
            onSnooze={handleReminderSnooze}
            onComplete={handleReminderComplete}
          />
        )}

        {editingTask && view !== "reminder" && (
          <TaskEditModal
            task={editingTask}
            showNotes={view === "main"}
            onSave={handleUpdateTask}
            onClose={() => setEditingTaskId(null)}
          />
        )}

        <ConfirmDialog
          open={
            showTodayPrompt &&
            Boolean(settings) &&
            view === "main" &&
            mainPage === "home"
          }
          title={t("today.prompt.title")}
          description={t("today.prompt.description")}
          confirmText={t("today.prompt.confirm")}
          cancelText={t("today.prompt.skip")}
          onConfirm={() => {
            if (!settings) return;
            const todayKey = formatLocalDateKey(new Date());
            void handleUpdateSettings({
              ...settings,
              today_prompted_date: todayKey,
            }).catch(() => {});
            setShowTodayPrompt(false);
            window.location.hash = "#/main/today";
          }}
          onCancel={() => {
            if (!settings) return;
            const todayKey = formatLocalDateKey(new Date());
            void handleUpdateSettings({
              ...settings,
              today_prompted_date: todayKey,
            }).catch(() => {});
            setShowTodayPrompt(false);
          }}
        />

        <ConfirmDialog
          open={showUpdatePrompt && Boolean(pendingUpdate)}
          title={updatePromptTitle}
          description={updatePromptDescription}
          confirmText={updateConfirmText}
          cancelText={t("update.later")}
          busy={updateBusy}
          onConfirm={handleUpdateConfirm}
          onCancel={dismissUpdatePrompt}
        />

        <ConfirmDialog
          open={Boolean(updateError)}
          title={t("update.failed")}
          description={updateError ?? undefined}
          confirmText={t("update.retry")}
          cancelText={t("common.close")}
          onConfirm={() => void handleUpdateErrorRetry()}
          onCancel={() => setUpdateError(null)}
        />

        <ConfirmDialog
          open={Boolean(deleteCandidate)}
          title={t("confirmDelete.title")}
          description={deleteCandidate ? deleteCandidate.title : undefined}
          confirmText={
            confirmDeleteBusy ? t("common.deleting") : t("common.delete")
          }
          cancelText={t("common.cancel")}
          tone="danger"
          busy={confirmDeleteBusy}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            if (confirmDeleteBusy) return;
            setConfirmDeleteTaskId(null);
          }}
        />

        {confirmDialog}
      </div>
    </I18nProvider>
  );
}

export default App;
