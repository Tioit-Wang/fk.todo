import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import "./App.css";

import { completeTask, createTask, deleteTask, dismissForced, loadState, snoozeTask, updateTask } from "./api";
import { formatDue } from "./date";
import { newTask, setReminder, setRepeat, toggleImportant, visibleQuickTasks } from "./logic";
import type { RepeatRule, Task } from "./types";

const QUICK_TABS = [
  { id: "todo", label: "待完成" },
  { id: "done", label: "已完成" },
  { id: "all", label: "全部" },
] as const;


const REMINDER_KIND_OPTIONS = [
  { id: "none", label: "不提醒" },
  { id: "normal", label: "普通" },
  { id: "forced", label: "强制" },
] as const;

const REPEAT_OPTIONS: RepeatRule[] = [
  { type: "none" },
  { type: "daily", workday_only: false },
  { type: "daily", workday_only: true },
  { type: "weekly", days: [1, 2, 3, 4, 5] },
  { type: "weekly", days: [6, 7] },
  { type: "monthly", day: 1 },
  { type: "yearly", month: 1, day: 1 },
];

function formatRepeat(rule: RepeatRule) {
  switch (rule.type) {
    case "none":
      return "不循环";
    case "daily":
      return rule.workday_only ? "每日(仅工作日)" : "每日";
    case "weekly":
      return `每周(${rule.days.join(",")})`;
    case "monthly":
      return `每月(${rule.day}号)`;
    case "yearly":
      return `每年(${rule.month}-${rule.day})`;
  }
}

// ============================================================================
// ICON COMPONENTS (SVG placeholders - inline for no dependencies)
// ============================================================================
const Icons = {
  Star: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Calendar: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Bell: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Repeat: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Plus: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Check: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Grid: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  List: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  Filter: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Sort: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="6" x2="11" y2="6" />
      <line x1="4" y1="12" x2="11" y2="12" />
      <line x1="4" y1="18" x2="13" y2="18" />
      <polyline points="15 15 18 18 21 15" />
      <line x1="18" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Trash: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Move: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  ),
  Clock: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  X: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  AlertCircle: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Snooze: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 11h6L4 19h6" />
      <path d="M14 7h6l-6 8h6" />
    </svg>
  ),
};

// ============================================================================
// QUICK WINDOW VIEW
// ============================================================================
function QuickWindow({
  tab,
  tasks,
  expandedTaskId,
  inputValue,
  dueTimePreview,
  onTabChange,
  onInputChange,
  onAddTask,
  onToggleComplete,
  onToggleImportant,
  onDeleteTask,
  onExpandSteps,
  onSetReminderKind,
  onSetRepeat,
}: {
  tab: (typeof QUICK_TABS)[number]["id"];
  tasks: Task[];
  expandedTaskId: string | null;
  inputValue: string;
  dueTimePreview: string;
  onTabChange: (tab: (typeof QUICK_TABS)[number]["id"]) => void;
  onInputChange: (value: string) => void;
  onAddTask: () => void;
  onToggleComplete: (task: Task) => void;
  onToggleImportant: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onExpandSteps: (task: Task) => void;
  onSetReminderKind: (task: Task, kind: "none" | "normal" | "forced") => void;
  onSetRepeat: (task: Task, rule: RepeatRule) => void;
}) {
  return (
    <div className="quick-window">
      <div className="quick-filter-tabs">
        {QUICK_TABS.map((t) => (
          <button
            key={t.id}
            className={`quick-filter-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="quick-task-list">
        {tasks.map((task) => {
          const expanded = expandedTaskId === task.id;
          return (
            <div key={task.id} className={`quick-task-item ${task.completed ? "completed" : ""}`}>
              <div className="quick-task-row">
                <button className="task-checkbox" onClick={() => onToggleComplete(task)}>
                  {task.completed && <Icons.Check />}
                </button>

                <div className="task-content">
                  <span className="task-title">{task.title}</span>
                  <div className="task-meta">
                    <span className="task-due-time">
                      <Icons.Clock />
                      {formatDue(task.due_at)}
                    </span>
                    {task.repeat.type !== "none" && (
                      <span className="task-chip" title={formatRepeat(task.repeat)}>
                        <Icons.Repeat />
                      </span>
                    )}
                    {task.reminder.kind !== "none" && (
                      <span className={`task-chip ${task.reminder.kind === "forced" ? "danger" : ""}`}>
                        <Icons.Bell />
                      </span>
                    )}
                  </div>
                </div>

                <div className="task-icons">
                  <button
                    className={`task-icon-btn important ${task.important ? "active" : ""}`}
                    onClick={() => onToggleImportant(task)}
                    title="重要"
                  >
                    <Icons.Star />
                  </button>
                  <button className="task-icon-btn" onClick={() => onDeleteTask(task)} title="删除">
                    <Icons.Trash />
                  </button>
                  <button className="task-icon-btn expand" onClick={() => onExpandSteps(task)} title="展开">
                    {expanded ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="quick-task-steps">
                  <div className="inline-config">
                    <div className="inline-config-group">
                      <span className="inline-config-label">提醒</span>
                      <div className="inline-config-buttons">
                        {REMINDER_KIND_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            className={`pill ${task.reminder.kind === opt.id ? "active" : ""}`}
                            onClick={() => onSetReminderKind(task, opt.id)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="inline-config-group">
                      <span className="inline-config-label">循环</span>
                      <div className="inline-config-buttons">
                        {REPEAT_OPTIONS.map((rule) => (
                          <button
                            key={formatRepeat(rule)}
                            className={`pill ${formatRepeat(task.repeat) === formatRepeat(rule) ? "active" : ""}`}
                            onClick={() => onSetRepeat(task, rule)}
                          >
                            {formatRepeat(rule)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {task.steps.length === 0 ? (
                    <div className="steps-empty">无步骤</div>
                  ) : (
                    task.steps.map((s) => (
                      <div key={s.id} className={`step-item ${s.completed ? "completed" : ""}`}>
                        <button className="step-checkbox">{s.completed && <Icons.Check />}</button>
                        <span className="step-title">{s.title}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="quick-input-bar">
        <div className="quick-input-wrapper">
          <input
            type="text"
            className="quick-input"
            placeholder="输入任务内容，回车添加"
            value={inputValue}
            onChange={(e) => onInputChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddTask();
            }}
          />
          <div className="quick-input-actions">
            <button className="quick-input-btn" title="到期时间（默认 18:00）" disabled>
              <Icons.Calendar />
            </button>
            <button className="quick-input-btn" title="提醒（在展开里设置）" disabled>
              <Icons.Bell />
            </button>
            <button className="quick-input-btn" title="循环（在展开里设置）" disabled>
              <Icons.Repeat />
            </button>
            <button className="quick-input-btn" title="重要（创建后可切换）" disabled>
              <Icons.Star />
            </button>
          </div>
        </div>
        <div className="quick-due-preview">
          <Icons.Clock />
          <span>{dueTimePreview}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WINDOW VIEW
// ============================================================================
function MainWindow() {
  return (
    <div className="main-window">
      <header className="main-header">
        <div className="main-header-left">
          <h1 className="main-title">主界面（四象限）</h1>
          <div className="main-hint">该部分逻辑在 t6 完成</div>
        </div>
      </header>
      <div className="main-content">
        <div className="quadrant-grid">
          <div className="quadrant quadrant-red">
            <div className="quadrant-header">
              <h2 className="quadrant-title">重要且紧急</h2>
              <span className="quadrant-sublabel">Do First</span>
            </div>
            <div className="quadrant-empty">待实现</div>
          </div>
          <div className="quadrant quadrant-amber">
            <div className="quadrant-header">
              <h2 className="quadrant-title">重要不紧急</h2>
              <span className="quadrant-sublabel">Schedule</span>
            </div>
            <div className="quadrant-empty">待实现</div>
          </div>
          <div className="quadrant quadrant-blue">
            <div className="quadrant-header">
              <h2 className="quadrant-title">紧急不重要</h2>
              <span className="quadrant-sublabel">Delegate</span>
            </div>
            <div className="quadrant-empty">待实现</div>
          </div>
          <div className="quadrant quadrant-gray">
            <div className="quadrant-header">
              <h2 className="quadrant-title">不重要不紧急</h2>
              <span className="quadrant-sublabel">Eliminate</span>
            </div>
            <div className="quadrant-empty">待实现</div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// REMINDER OVERLAY VIEW
// ============================================================================
function ReminderOverlay({
  task,
  onDismiss,
  onSnooze5,
  onComplete,
}: {
  task: Task | null;
  onDismiss: () => void;
  onSnooze5: () => void;
  onComplete: () => void;
}) {
  if (!task) {
    return (
      <div className="reminder-overlay">
        <div className="reminder-banner">
          <div className="reminder-content">
            <div className="reminder-header">
              <Icons.AlertCircle />
              <span className="reminder-label">No reminder</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const isOverdue = !task.completed && task.due_at < now;

  return (
    <div className="reminder-overlay">
      <div className="reminder-banner">
        <div className="reminder-indicator"></div>

        <div className="reminder-content">
          <div className="reminder-header">
            <Icons.AlertCircle />
            <span className="reminder-label">{isOverdue ? "逾期" : "提醒"}</span>
          </div>

          <h2 className="reminder-title">{task.title}</h2>

          <div className="reminder-meta">
            <span className="reminder-time">
              <Icons.Clock />
              {formatDue(task.due_at)}
            </span>
            {task.important && (
              <span className="reminder-important">
                <Icons.Star />
                重要
              </span>
            )}
          </div>
        </div>

        <div className="reminder-actions">
          <button className="reminder-btn secondary" onClick={onDismiss}>
            <Icons.X />
            <span>关闭提醒</span>
          </button>
          <button className="reminder-btn secondary" onClick={onSnooze5}>
            <Icons.Snooze />
            <span>稍后 5 分钟</span>
          </button>
          <button className="reminder-btn primary" onClick={onComplete}>
            <Icons.Check />
            <span>立即完成</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================
function App() {
  const getViewFromHash = (): "quick" | "main" | "reminder" => {
    const raw = window.location.hash.replace("#", "");
    const path = raw.startsWith("/") ? raw.slice(1) : raw;
    const view = path.split("/")[0];
    if (view === "main") return "main";
    if (view === "reminder") return "reminder";
    return "quick";
  };

  const [view, setView] = useState<"quick" | "main" | "reminder">(getViewFromHash());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<(typeof QUICK_TABS)[number]["id"]>("todo");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>("");

  const dueTimePreview = useMemo(() => {
    const d = new Date();
    const due = new Date(d);
    due.setHours(18, 0, 0, 0);
    if (d.getTime() > due.getTime()) {
      due.setDate(due.getDate() + 1);
    }
    const weekday = due.toLocaleDateString(undefined, { weekday: "short" });
    const date = due.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
    return `${weekday} ${date} 18:00`;
  }, []);

  useEffect(() => {
    const onHash = () => setView(getViewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let unlistenState: (() => void) | null = null;
    let unlistenReminder: (() => void) | null = null;

    (async () => {
      const res = await loadState();
      if (res.ok && res.data) {
        setTasks(res.data[0]);
      }

      unlistenState = await listen("state_updated", (event) => {
        const payload = event.payload as { tasks?: Task[] } | any;
        if (payload && Array.isArray(payload.tasks)) {
          setTasks(payload.tasks);
        }
      });

      unlistenReminder = await listen("reminder_fired", (event) => {
        const payload = event.payload as Task[];
        if (Array.isArray(payload) && payload.length > 0) {
          // Open reminder view; pick the first task for MVP.
          (window.location.hash as any) = "#/reminder";
        }
      });
    })();

    return () => {
      if (unlistenState) unlistenState();
      if (unlistenReminder) unlistenReminder();
    };
  }, []);

  const quickTasks = useMemo(() => visibleQuickTasks(tasks, tab, new Date()), [tasks, tab]);

  async function handleAddTask() {
    const title = inputValue.trim();
    if (!title) return;
    const task = newTask(title, new Date());
    setInputValue("");
    await createTask(task);
  }

  async function handleToggleComplete(task: Task) {
    if (task.completed) {
      // MVP: don't support un-complete (keeps backend simple); can be added later.
      return;
    }
    await completeTask(task.id);
  }

  async function handleToggleImportant(task: Task) {
    await updateTask(toggleImportant(task));
  }

  async function handleDeleteTask(task: Task) {
    if (!confirm("确认删除该任务？")) return;
    await deleteTask(task.id);
  }

  function handleExpand(task: Task) {
    setExpandedTaskId((prev) => (prev === task.id ? null : task.id));
  }

  async function handleSetReminderKind(task: Task, kind: "none" | "normal" | "forced") {
    await updateTask(setReminder(task, kind));
  }

  async function handleSetRepeat(task: Task, rule: RepeatRule) {
    await updateTask(setRepeat(task, rule));
  }

  const reminderTask = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const due = tasks
      .filter((t) => !t.completed && t.reminder.kind !== "none" && !t.reminder.forced_dismissed)
      .filter((t) => {
        const target = t.reminder.snoozed_until ?? t.reminder.remind_at;
        if (!target) return false;
        const last = t.reminder.last_fired_at ?? 0;
        return now >= target && last < target;
      })
      .sort((a, b) => {
        if (a.important !== b.important) return a.important ? -1 : 1;
        return a.due_at - b.due_at;
      });
    return due[0] ?? null;
  }, [tasks]);

  async function handleReminderSnooze5() {
    if (!reminderTask) return;
    const until = Math.floor(Date.now() / 1000) + 5 * 60;
    await snoozeTask(reminderTask.id, until);
  }

  async function handleReminderDismiss() {
    if (!reminderTask) return;
    await dismissForced(reminderTask.id);
  }

  async function handleReminderComplete() {
    if (!reminderTask) return;
    await completeTask(reminderTask.id);
  }

  return (
    <div className="app-container">
      {view === "quick" && (
        <QuickWindow
          tab={tab}
          tasks={quickTasks}
          expandedTaskId={expandedTaskId}
          inputValue={inputValue}
          dueTimePreview={dueTimePreview}
          onTabChange={setTab}
          onInputChange={setInputValue}
          onAddTask={handleAddTask}
          onToggleComplete={handleToggleComplete}
          onToggleImportant={handleToggleImportant}
          onDeleteTask={handleDeleteTask}
          onExpandSteps={handleExpand}
          onSetReminderKind={handleSetReminderKind}
          onSetRepeat={handleSetRepeat}
        />
      )}

      {view === "main" && <MainWindow />}

      {view === "reminder" && (
        <ReminderOverlay
          task={reminderTask}
          onDismiss={handleReminderDismiss}
          onSnooze5={handleReminderSnooze5}
          onComplete={handleReminderComplete}
        />
      )}
    </div>
  );
}

export default App;
