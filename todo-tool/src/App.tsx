import { useEffect, useMemo, useRef, useState } from "react";

import type { PluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { isPermissionGranted, onAction, registerActionTypes, sendNotification } from "@tauri-apps/plugin-notification";

import "./App.css";

import type { TaskComposerDraft } from "./components/TaskComposer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ForcedReminderOverlay } from "./components/ForcedReminderOverlay";
import { TaskEditModal } from "./components/TaskEditModal";
import { MainView } from "./views/MainView";
import { QuickView } from "./views/QuickView";
import { SettingsView } from "./views/SettingsView";

import { completeTask, createTask, deleteTask, dismissForced, loadState, snoozeTask, updateSettings, updateTask } from "./api";
import { formatDue } from "./date";
import { newTask } from "./logic";
import { TAURI_NAVIGATE } from "./events";
import { detectPlatform } from "./platform";
import { buildReminderConfig } from "./reminder";
import type { Settings, Task } from "./types";

const NOTIFICATION_ACTION_TYPE = "todo-reminder";
const NOTIFICATION_ACTION_SNOOZE = "snooze";
const NOTIFICATION_ACTION_COMPLETE = "complete";

function normalizeTask(task: Task) {
  const sort_order = task.sort_order || task.created_at * 1000;
  const quadrant = [1, 2, 3, 4].includes(task.quadrant) ? task.quadrant : 1;
  return { ...task, sort_order, quadrant };
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
  const getViewFromHash = (): "quick" | "main" | "reminder" => {
    const raw = window.location.hash.replace("#", "");
    const path = raw.startsWith("/") ? raw.slice(1) : raw;
    const view = path.split("/")[0];
    const label = getCurrentWindow().label;
    if (label === "main" || label === "quick" || label === "reminder") return label;
    if (view === "main" || view === "quick" || view === "reminder") return view;
    return "main";
  };

  const [view, setView] = useState<"quick" | "main" | "reminder">(getViewFromHash());
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  const [confirmDeleteBusy, setConfirmDeleteBusy] = useState(false);

  const [forcedQueueIds, setForcedQueueIds] = useState<string[]>([]);
  const [normalQueueIds, setNormalQueueIds] = useState<string[]>([]);

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
      const listener = await listen<{ hash: string }>(TAURI_NAVIGATE, ({ payload }) => {
        const next = typeof payload?.hash === "string" ? payload.hash : "";
        if (!next) return;
        window.location.hash = next;
      });

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

  // Notification actions (OS-level buttons) should only be handled by the quick window.
  useEffect(() => {
    if (getViewFromHash() !== "quick") return;
    let disposed = false;
    let actionListener: PluginListener | null = null;

    registerActionTypes([
      {
        id: NOTIFICATION_ACTION_TYPE,
        actions: [
          { id: NOTIFICATION_ACTION_SNOOZE, title: "稍后 5 分钟" },
          { id: NOTIFICATION_ACTION_COMPLETE, title: "完成" },
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
        const taskId = typeof payload.extra?.taskId === "string" ? payload.extra.taskId : null;

        if (taskId) {
          if (actionId === NOTIFICATION_ACTION_SNOOZE) {
            const until = Math.floor(Date.now() / 1000) + 5 * 60;
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
  }, []);

  // Load initial state and subscribe to backend events.
  useEffect(() => {
    let disposed = false;
    let unlistenState: (() => void) | null = null;
    let unlistenReminder: (() => void) | null = null;

    void (async () => {
      const res = await loadState();
      if (res.ok && res.data) {
        const [loadedTasks, loadedSettings] = res.data;
        setTasks(loadedTasks.map(normalizeTask));
        setSettings(loadedSettings);
      }

      const stateListener = await listen("state_updated", (event) => {
        const payload = event.payload as { tasks?: Task[]; settings?: Settings };
        if (payload.tasks) {
          setTasks(payload.tasks.map(normalizeTask));
        }
        if (payload.settings) {
          setSettings(payload.settings);
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
        if (settingsRef.current?.sound_enabled && getViewFromHash() === "quick") {
          playBeep();
        }

        const forced = payload.filter((task) => task.reminder.kind === "forced");
        const normal = payload.filter((task) => task.reminder.kind === "normal");

        if (forced.length > 0) {
          setForcedQueueIds((prev) => mergeUniqueIds(prev, forced.map((task) => task.id)));
        }

        if (normal.length > 0) {
          setNormalQueueIds((prev) => mergeUniqueIds(prev, normal.map((task) => task.id)));

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
                    title: "普通提醒",
                    body: `${task.title} (${formatDue(task.due_at)})`,
                    actionTypeId: NOTIFICATION_ACTION_TYPE,
                    extra: { taskId: task.id },
                    silent: settingsRef.current ? !settingsRef.current.sound_enabled : false,
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
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    document.documentElement.dataset.view = view;
  }, [view]);

  useEffect(() => {
    const platform = document.documentElement.dataset.platform ?? detectPlatform();
    document.documentElement.dataset.platform = platform;

    // We use custom chrome + rounded UI in Windows (especially for transparent windows).
    // Native window shadows can introduce a rectangular outline, so disable them and let the
    // frontend render a consistent shadow instead.
    //
    // On macOS, the system window shadow/corners generally look correct already, and we avoid
    // relying on `transparent` without enabling private APIs.
    if (platform === "windows") {
      void getCurrentWindow().setShadow(false).catch(() => {});
    }
  }, []);

  // Global Escape behavior:
  // - If a modal is open, close it (let modal components handle their own Escape when possible).
  // - Otherwise, in quick window: hide (launcher-like).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDeleteTaskId) return;
      if (editingTaskId) {
        setEditingTaskId(null);
        return;
      }
      if (view === "quick") {
        void getCurrentWindow().hide().catch(() => {});
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
        return task && !task.completed && task.reminder.kind === "forced" && !task.reminder.forced_dismissed;
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
      void getCurrentWindow().hide().catch(() => {});
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
      const [loadedTasks, loadedSettings] = res.data;
      setTasks(loadedTasks.map(normalizeTask));
      setSettings(loadedSettings);
    }
  }

  async function handleUpdateSettings(next: Settings): Promise<boolean> {
    const previous = settingsRef.current ?? settings;
    setSettings(next);
    const result = await updateSettings(next);
    if (!result.ok) {
      if (previous) {
        setSettings(previous);
      }
      if (result.error) {
        alert(result.error);
      }
      return false;
    }
    if (result.data) {
      setSettings(result.data);
    }
    return true;
  }

  async function handleCreateFromComposer(draft: TaskComposerDraft) {
    const task = newTask(draft.title, new Date());
    task.due_at = draft.due_at;
    task.important = draft.important;
    task.repeat = draft.repeat;
    task.reminder = buildReminderConfig(draft.reminder_kind, draft.due_at, draft.reminder_offset_minutes);
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
      const ok = confirm("该任务为循环任务，取消完成不会删除已经生成的下一期任务，仍要继续吗？");
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
        alert(result.error ?? "删除失败");
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

  function handleEditTask(task: Task) {
    setEditingTaskId(task.id);
  }

  async function handleReminderSnooze5() {
    if (!reminderTask) return;
    const taskId = reminderTask.id;
    const until = Math.floor(Date.now() / 1000) + 5 * 60;

    // Update UI first so the overlay reacts instantly (show next reminder or hide if none).
    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0) void getCurrentWindow().hide().catch(() => {});
      return next;
    });

    await snoozeTask(taskId, until);
  }

  async function handleReminderDismiss() {
    if (!reminderTask) return;
    const taskId = reminderTask.id;

    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0) void getCurrentWindow().hide().catch(() => {});
      return next;
    });

    await dismissForced(taskId);
  }

  async function handleReminderComplete() {
    if (!reminderTask) return;
    const taskId = reminderTask.id;

    setForcedQueueIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (next.length === 0) void getCurrentWindow().hide().catch(() => {});
      return next;
    });

    await completeTask(taskId);
  }

  async function handleNormalSnooze(task: Task) {
    const until = Math.floor(Date.now() / 1000) + 5 * 60;
    await snoozeTask(task.id, until);
    setNormalQueueIds((prev) => prev.filter((id) => id !== task.id));
  }

  async function handleNormalComplete(task: Task) {
    await completeTask(task.id);
    setNormalQueueIds((prev) => prev.filter((id) => id !== task.id));
  }

  const mainPage = (() => {
    const raw = locationHash.replace("#", "");
    const path = raw.startsWith("/") ? raw.slice(1) : raw;
    const parts = path.split("/").filter(Boolean);

    // Supported routes for the main window:
    // - #/main
    // - #/main/settings
    // - #/settings (handy when triggered from native code)
    if (parts[0] === "settings") return "settings";
    if (parts[0] === "main" && parts[1] === "settings") return "settings";
    return "home";
  })();

  useEffect(() => {
    // Settings is a dedicated page; ensure no task modals leak into it.
    if (view !== "main") return;
    if (mainPage !== "settings") return;
    setEditingTaskId(null);
    setConfirmDeleteTaskId(null);
  }, [view, mainPage]);

  return (
    <div className="app-container">
      {view === "quick" && (
        <QuickView
          tasks={tasks}
          settings={settings}
          normalTasks={normalTasks}
          isModalOpen={Boolean(editingTaskId) || Boolean(confirmDeleteTaskId)}
          onUpdateSettings={handleUpdateSettings}
          onCreateFromComposer={handleCreateFromComposer}
          onToggleComplete={handleToggleComplete}
          onToggleImportant={handleToggleImportant}
          onRequestDelete={handleRequestDelete}
          onEditTask={handleEditTask}
          onNormalSnooze={handleNormalSnooze}
          onNormalComplete={handleNormalComplete}
        />
      )}

      {view === "main" && mainPage === "settings" && (
        <SettingsView
          tasks={tasks}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onBack={() => {
            window.location.hash = "#/main";
          }}
        />
      )}

      {view === "main" && mainPage === "home" && (
        <MainView
          tasks={tasks}
          settings={settings}
          normalTasks={normalTasks}
          onUpdateTask={handleUpdateTask}
          onRefreshState={refreshState}
          onCreateFromComposer={handleCreateFromComposer}
          onToggleComplete={handleToggleComplete}
          onToggleImportant={handleToggleImportant}
          onRequestDelete={handleRequestDelete}
          onEditTask={handleEditTask}
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
          onSnooze5={handleReminderSnooze5}
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
        open={Boolean(deleteCandidate)}
        title="确认删除任务？"
        description={deleteCandidate ? deleteCandidate.title : undefined}
        confirmText={confirmDeleteBusy ? "删除中..." : "删除"}
        cancelText="取消"
        tone="danger"
        busy={confirmDeleteBusy}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (confirmDeleteBusy) return;
          setConfirmDeleteTaskId(null);
        }}
      />
    </div>
  );
}

export default App;
