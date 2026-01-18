import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { PluginListener } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import "./App.css";

import { TaskComposer, type TaskComposerDraft } from "./components/TaskComposer";
import { WindowTitlebar } from "./components/WindowTitlebar";
import { Icons } from "./components/icons";

import {
  completeTask,
  createBackup,
  createTask,
  deleteTask,
  dismissForced,
  importBackup,
  listBackups,
  loadState,
  restoreBackup,
  snoozeTask,
  swapSortOrder,
  updateSettings,
  updateTask,
} from "./api";
import { formatDue, fromDateTimeLocal, toDateTimeLocal } from "./date";
import { newTask, visibleQuickTasks, type QuickSortMode } from "./logic";
import { isDueInFuture, isDueToday, isDueTomorrow, isOverdue } from "./scheduler";
import type { BackupSchedule, ReminderKind, RepeatRule, Settings, Task } from "./types";

const QUICK_TABS = [
  { id: "todo", label: "待完成" },
  { id: "done", label: "已完成" },
  { id: "all", label: "全部" },
] as const;

const QUICK_SORT_OPTIONS = [
  { id: "default", label: "默认排序" },
  { id: "created", label: "创建时间" },
] as const;

const MAIN_SORT_OPTIONS = [
  { id: "due", label: "到期时间" },
  { id: "created", label: "添加时间" },
  { id: "manual", label: "手动排序" },
] as const;

const DUE_FILTER_OPTIONS = [
  { id: "all", label: "全部" },
  { id: "overdue", label: "逾期" },
  { id: "today", label: "今天" },
  { id: "tomorrow", label: "明天" },
  { id: "future", label: "未来" },
] as const;

const IMPORTANCE_FILTER_OPTIONS = [
  { id: "all", label: "全部" },
  { id: "important", label: "重要" },
  { id: "normal", label: "不重要" },
] as const;

const REPEAT_FILTER_OPTIONS = [
  { id: "all", label: "全部" },
  { id: "repeat", label: "循环" },
  { id: "none", label: "不循环" },
] as const;

const REMINDER_FILTER_OPTIONS = [
  { id: "all", label: "全部" },
  { id: "remind", label: "有提醒" },
  { id: "none", label: "不提醒" },
  { id: "forced", label: "强制" },
  { id: "normal", label: "普通" },
] as const;

const REMINDER_KIND_OPTIONS = [
  { id: "none", label: "不提醒" },
  { id: "normal", label: "普通" },
  { id: "forced", label: "强制" },
] as const;

const REPEAT_TYPE_OPTIONS = [
  { id: "none", label: "不循环" },
  { id: "daily", label: "每日" },
  { id: "weekly", label: "每周" },
  { id: "monthly", label: "每月" },
  { id: "yearly", label: "每年" },
] as const;

const WEEKDAY_OPTIONS = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 7, label: "日" },
] as const;

const NOTIFICATION_ACTION_TYPE = "todo-reminder";
const NOTIFICATION_ACTION_SNOOZE = "snooze";
const NOTIFICATION_ACTION_COMPLETE = "complete";

const QUADRANTS = [
  { id: 1, title: "重要且紧急", sublabel: "Do First", className: "quadrant-red" },
  { id: 2, title: "重要不紧急", sublabel: "Schedule", className: "quadrant-amber" },
  { id: 3, title: "紧急不重要", sublabel: "Delegate", className: "quadrant-blue" },
  { id: 4, title: "不重要不紧急", sublabel: "Eliminate", className: "quadrant-gray" },
];

function formatRepeat(rule: RepeatRule) {
  switch (rule.type) {
    case "none":
      return "不循环";
    case "daily":
      return rule.workday_only ? "每日(仅工作日)" : "每日";
    case "weekly":
      return `每周(${rule.days
        .map((day) => WEEKDAY_OPTIONS.find((opt) => opt.id === day)?.label ?? day)
        .join(",")})`;
    case "monthly":
      return `每月(${rule.day}号)`;
    case "yearly":
      return `每年(${rule.month}-${rule.day})`;
  }
}

function defaultRepeatRule(type: RepeatRule["type"]): RepeatRule {
  const now = new Date();
  switch (type) {
    case "daily":
      return { type: "daily", workday_only: false };
    case "weekly":
      return { type: "weekly", days: [1, 2, 3, 4, 5] };
    case "monthly":
      return { type: "monthly", day: Math.min(31, Math.max(1, now.getDate())) };
    case "yearly":
      return { type: "yearly", month: now.getMonth() + 1, day: now.getDate() };
    case "none":
    default:
      return { type: "none" };
  }
}

function getReminderOffset(task: Task) {
  if (task.reminder.kind === "none") return 0;
  const defaultRemindAt = task.reminder.kind === "normal" ? task.due_at - 10 * 60 : task.due_at;
  const remindAt = task.reminder.remind_at ?? defaultRemindAt;
  const offset = Math.round((task.due_at - remindAt) / 60);
  return Math.max(0, offset);
}

function buildReminderConfig(kind: ReminderKind, dueAt: number, offsetMinutes: number) {
  if (kind === "none") {
    return { kind: "none", forced_dismissed: false } as Task["reminder"];
  }
  const now = Math.floor(Date.now() / 1000);
  const remindAt = Math.max(dueAt - offsetMinutes * 60, now);
  return {
    kind,
    remind_at: remindAt,
    snoozed_until: undefined,
    forced_dismissed: false,
    last_fired_at: undefined,
  } as Task["reminder"];
}

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

function detectPlatform(): "windows" | "macos" | "linux" | "unknown" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macos")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
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

// (Icons are now in `src/components/icons.tsx`.)

// ============================================================================
// TASK CARD
// ============================================================================
function TaskCard({
  task,
  mode,
  showMove,
  draggable,
  onDragStart,
  onMoveUp,
  onMoveDown,
  onToggleComplete,
  onToggleImportant,
  onDelete,
  onEdit,
}: {
  task: Task;
  mode: "quick" | "main";
  showMove?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const overdue = isOverdue(task, now);

  return (
    <div
      className={`task-card ${mode} q${task.quadrant} ${task.completed ? "completed" : ""} ${overdue ? "overdue" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className="task-row">
        <button
          type="button"
          className="task-checkbox"
          onClick={onToggleComplete}
          title={task.completed ? "标记为未完成" : "标记为完成"}
          aria-label={task.completed ? "标记为未完成" : "标记为完成"}
          aria-pressed={task.completed}
        >
          {task.completed && <Icons.Check />}
        </button>

        <div className="task-content">
          <span className="task-title">{task.title}</span>
          <div className="task-meta">
            <span className="task-due-time">
              <Icons.Clock />
              {formatDue(task.due_at)}
            </span>
            {task.important && (
              <span className="task-chip important">
                <Icons.Star />
              </span>
            )}
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
          {showMove && (
            <>
              <button type="button" className="task-icon-btn" onClick={onMoveUp} title="上移" aria-label="上移">
                <Icons.ArrowUp />
              </button>
              <button type="button" className="task-icon-btn" onClick={onMoveDown} title="下移" aria-label="下移">
                <Icons.ArrowDown />
              </button>
            </>
          )}
          <button
            type="button"
            className={`task-icon-btn important ${task.important ? "active" : ""}`}
            onClick={onToggleImportant}
            title={task.important ? "取消重要" : "标记重要"}
            aria-label={task.important ? "取消标记重要" : "标记为重要"}
            aria-pressed={task.important}
          >
            <Icons.Star />
          </button>
          <button type="button" className="task-icon-btn" onClick={onDelete} title="删除" aria-label="删除任务">
            <Icons.Trash />
          </button>
          <button
            type="button"
            className="task-icon-btn"
            onClick={onEdit}
            title="编辑"
            aria-label="编辑任务"
          >
            <Icons.Edit />
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskEditModal({
  task,
  showNotes,
  onSave,
  onClose,
}: {
  task: Task;
  showNotes: boolean;
  onSave: (next: Task) => Promise<void> | void;
  onClose: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDueAt, setDraftDueAt] = useState(task.due_at);
  const [draftReminderKind, setDraftReminderKind] = useState<ReminderKind>(task.reminder.kind);
  const [draftReminderOffset, setDraftReminderOffset] = useState<number>(getReminderOffset(task));
  const [draftRepeat, setDraftRepeat] = useState<RepeatRule>(task.repeat);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? "");
  const [draftSteps, setDraftSteps] = useState(task.steps);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffset(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setDraftSteps(task.steps);
    setNewStepTitle("");
    setSaving(false);
  }, [task.id]);

  function handleReset() {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffset(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setDraftSteps(task.steps);
    setNewStepTitle("");
  }

  function handleAddStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    const ts = Math.floor(Date.now() / 1000);
    setDraftSteps((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title,
        completed: false,
        created_at: ts,
      },
    ]);
    setNewStepTitle("");
  }

  function toggleStep(stepId: string) {
    const ts = Math.floor(Date.now() / 1000);
    setDraftSteps((prev) =>
      prev.map((step) => {
        if (step.id !== stepId) return step;
        const completed = !step.completed;
        return {
          ...step,
          completed,
          completed_at: completed ? ts : undefined,
        };
      }),
    );
  }

  function removeStep(stepId: string) {
    setDraftSteps((prev) => prev.filter((step) => step.id !== stepId));
  }

  async function handleSave() {
    const title = draftTitle.trim();
    if (!title) return;
    const now = Math.floor(Date.now() / 1000);
    const next: Task = {
      ...task,
      title,
      due_at: draftDueAt,
      repeat: draftRepeat,
      reminder: buildReminderConfig(draftReminderKind, draftDueAt, draftReminderOffset),
      steps: draftSteps,
      notes: showNotes ? draftNotes.trim() || undefined : task.notes,
      updated_at: now,
    };
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-modal-overlay" role="dialog" aria-modal="true" aria-label="编辑任务" onClick={onClose}>
      <div className="task-modal" onClick={(event) => event.stopPropagation()}>
        <div className="task-modal-header">
          <div className="task-modal-title">
            <span>编辑任务</span>
            <span className="task-modal-subtitle">{formatDue(task.due_at)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭编辑" title="关闭">
            <Icons.X />
          </button>
        </div>

        <div className="task-modal-body">
          <div className="task-modal-row">
            <input
              className="task-edit-title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder="任务标题"
            />
            <input
              className="task-edit-due"
              type="datetime-local"
              value={toDateTimeLocal(draftDueAt)}
              onChange={(event) => {
                const next = fromDateTimeLocal(event.currentTarget.value);
                if (next) setDraftDueAt(next);
              }}
            />
          </div>

          <div className="task-modal-actions">
            <button type="button" className="task-edit-btn ghost" onClick={handleReset} disabled={saving}>
              重置
            </button>
            <div className="task-modal-actions-right">
              <button type="button" className="task-edit-btn ghost" onClick={onClose} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className="task-edit-btn"
                onClick={() => void handleSave()}
                disabled={saving || !draftTitle.trim()}
                title={!draftTitle.trim() ? "标题不能为空" : "保存"}
              >
                保存
              </button>
            </div>
          </div>

          <div className="inline-config">
            <div className="inline-config-group">
              <span className="inline-config-label">提醒</span>
              <div className="inline-config-buttons">
                {REMINDER_KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${draftReminderKind === opt.id ? "active" : ""}`}
                    onClick={() => {
                      setDraftReminderKind(opt.id);
                      setDraftReminderOffset(opt.id === "normal" ? 10 : 0);
                    }}
                    aria-pressed={draftReminderKind === opt.id}
                    disabled={saving}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {draftReminderKind !== "none" && (
                <div className="inline-config-extra">
                  <span>提前</span>
                  <input
                    type="number"
                    min={0}
                    className="inline-input"
                    value={draftReminderOffset}
                    onChange={(event) => setDraftReminderOffset(Number(event.currentTarget.value) || 0)}
                    disabled={saving}
                  />
                  <span>分钟</span>
                </div>
              )}
            </div>

            <div className="inline-config-group">
              <span className="inline-config-label">循环</span>
              <div className="inline-config-buttons">
                {REPEAT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${draftRepeat.type === opt.id ? "active" : ""}`}
                    onClick={() => setDraftRepeat(defaultRepeatRule(opt.id))}
                    aria-pressed={draftRepeat.type === opt.id}
                    disabled={saving}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {draftRepeat.type === "daily" && (
                <div className="inline-config-extra">
                  <button
                    type="button"
                    className={`pill ${draftRepeat.workday_only ? "active" : ""}`}
                    onClick={() =>
                      setDraftRepeat({
                        type: "daily",
                        workday_only: !draftRepeat.workday_only,
                      })
                    }
                    aria-pressed={draftRepeat.workday_only}
                    disabled={saving}
                  >
                    仅工作日
                  </button>
                </div>
              )}
              {draftRepeat.type === "weekly" && (
                <div className="inline-config-buttons">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const selected = draftRepeat.days.includes(day.id);
                    return (
                      <button
                        key={day.id}
                        type="button"
                        className={`pill ${selected ? "active" : ""}`}
                        onClick={() => {
                          const nextDays = selected
                            ? draftRepeat.days.filter((value) => value !== day.id)
                            : [...draftRepeat.days, day.id];
                          if (nextDays.length === 0) return;
                          setDraftRepeat({ type: "weekly", days: nextDays.sort() });
                        }}
                        aria-pressed={selected}
                        disabled={saving}
                      >
                        周{day.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftRepeat.type === "monthly" && (
                <div className="inline-config-extra">
                  <span>每月</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={31}
                    value={draftRepeat.day}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "monthly",
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                    disabled={saving}
                  />
                  <span>号</span>
                </div>
              )}
              {draftRepeat.type === "yearly" && (
                <div className="inline-config-extra">
                  <span>每年</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={12}
                    value={draftRepeat.month}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "yearly",
                        month: Math.min(12, Math.max(1, Number(event.currentTarget.value) || 1)),
                        day: draftRepeat.day,
                      })
                    }
                    disabled={saving}
                  />
                  <span>月</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={31}
                    value={draftRepeat.day}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "yearly",
                        month: draftRepeat.month,
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                    disabled={saving}
                  />
                  <span>号</span>
                </div>
              )}
            </div>
          </div>

          <div className="steps-section">
            <div className="steps-header">
              <span>步骤</span>
              <div className="steps-add">
                <input
                  className="steps-input"
                  placeholder="添加步骤"
                  value={newStepTitle}
                  onChange={(event) => setNewStepTitle(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddStep();
                  }}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="step-add-btn"
                  onClick={handleAddStep}
                  disabled={saving || !newStepTitle.trim()}
                  title={!newStepTitle.trim() ? "请输入步骤内容" : "添加步骤"}
                  aria-label="添加步骤"
                >
                  <Icons.Plus />
                </button>
              </div>
            </div>
            {draftSteps.length === 0 ? (
              <div className="steps-empty">无步骤</div>
            ) : (
              draftSteps.map((step) => (
                <div key={step.id} className={`step-item ${step.completed ? "completed" : ""}`}>
                  <button
                    type="button"
                    className="step-checkbox"
                    onClick={() => toggleStep(step.id)}
                    aria-label={step.completed ? "标记步骤为未完成" : "标记步骤为完成"}
                    aria-pressed={step.completed}
                    disabled={saving}
                  >
                    {step.completed && <Icons.Check />}
                  </button>
                  <span className="step-title">{step.title}</span>
                  <button
                    type="button"
                    className="step-delete"
                    onClick={() => removeStep(step.id)}
                    title="删除步骤"
                    aria-label="删除步骤"
                    disabled={saving}
                  >
                    <Icons.X />
                  </button>
                </div>
              ))
            )}
          </div>

          {showNotes && (
            <div className="notes-section">
              <div className="notes-header">备注</div>
              <textarea
                className="notes-input"
                rows={4}
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.currentTarget.value)}
                disabled={saving}
              />
            </div>
          )}
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
  color,
  onDismiss,
  onSnooze5,
  onComplete,
}: {
  task: Task | null;
  color: string;
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
              <span className="reminder-label">无提醒</span>
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
      <div className="reminder-banner" style={{ backgroundColor: color }}>
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
          <button type="button" className="reminder-btn secondary" onClick={onDismiss}>
            <Icons.X />
            <span>关闭提醒</span>
          </button>
          <button type="button" className="reminder-btn secondary" onClick={onSnooze5}>
            <Icons.Snooze />
            <span>稍后 5 分钟</span>
          </button>
          <button type="button" className="reminder-btn primary" onClick={onComplete}>
            <Icons.Check />
            <span>立即完成</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationBanner({
  tasks,
  onSnooze,
  onComplete,
}: {
  tasks: Task[];
  onSnooze: (task: Task) => void;
  onComplete: (task: Task) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="notification-banner">
      <div className="notification-title">普通提醒</div>
      {tasks.map((task) => (
        <div key={task.id} className="notification-item">
          <span className="notification-text">{task.title}</span>
          <div className="notification-actions">
            <button type="button" className="pill" onClick={() => onSnooze(task)}>
              稍后 5 分钟
            </button>
            <button type="button" className="pill" onClick={() => onComplete(task)}>
              完成
            </button>
          </div>
        </div>
      ))}
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
    const label = getCurrentWindow().label;
    if (label === "main" || label === "quick" || label === "reminder") return label;
    if (view === "main" || view === "quick" || view === "reminder") return view;
    return "main";
  };

  const [view, setView] = useState<"quick" | "main" | "reminder">(getViewFromHash());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<(typeof QUICK_TABS)[number]["id"]>("todo");
  const [quickSort, setQuickSort] = useState<QuickSortMode>("default");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [forcedQueueIds, setForcedQueueIds] = useState<string[]>([]);
  const [normalQueueIds, setNormalQueueIds] = useState<string[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<"unknown" | "granted" | "denied">("unknown");

  const [mainView, setMainView] = useState<"quadrant" | "list">("list");
  const [listTab, setListTab] = useState<"overdue" | "today" | "tomorrow" | "future" | "completed">("today");
  const [dueFilter, setDueFilter] = useState<(typeof DUE_FILTER_OPTIONS)[number]["id"]>("all");
  const [importanceFilter, setImportanceFilter] = useState<
    (typeof IMPORTANCE_FILTER_OPTIONS)[number]["id"]
  >("all");
  const [repeatFilter, setRepeatFilter] = useState<(typeof REPEAT_FILTER_OPTIONS)[number]["id"]>("all");
  const [reminderFilter, setReminderFilter] = useState<(typeof REMINDER_FILTER_OPTIONS)[number]["id"]>("all");
  const [mainSort, setMainSort] = useState<(typeof MAIN_SORT_OPTIONS)[number]["id"]>("due");

  const [showSettings, setShowSettings] = useState(false);
  const [backups, setBackups] = useState<{ name: string; modified_at: number }[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");

  const quickWindowApplied = useRef(false);
  const quickSaveTimer = useRef<number | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  useEffect(() => {
    const onHash = () => setView(getViewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (getViewFromHash() !== "quick") return;
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

    (async () => {
      actionListener = await onAction(async (notification) => {
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
        const window = getCurrentWindow();
        void window.show();
        void window.setFocus();
      });
    })();

    return () => {
      if (actionListener) {
        actionListener.unregister();
      }
    };
  }, []);

  useEffect(() => {
    let unlistenState: (() => void) | null = null;
    let unlistenReminder: (() => void) | null = null;

    (async () => {
      const res = await loadState();
      if (res.ok && res.data) {
        const [loadedTasks, loadedSettings] = res.data;
        setTasks(loadedTasks.map(normalizeTask));
        setSettings(loadedSettings);
        setTab((loadedSettings.quick_tab as typeof QUICK_TABS[number]["id"]) ?? "todo");
        setQuickSort((loadedSettings.quick_sort as QuickSortMode) ?? "default");
      }

      unlistenState = await listen("state_updated", (event) => {
        const payload = event.payload as { tasks?: Task[]; settings?: Settings };
        if (payload.tasks) {
          setTasks(payload.tasks.map(normalizeTask));
        }
        if (payload.settings) {
          setSettings(payload.settings);
        }
      });

      unlistenReminder = await listen("reminder_fired", async (event) => {
        const payload = event.payload as Task[];
        if (!Array.isArray(payload) || payload.length === 0) return;

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
          const granted = await isPermissionGranted();
          setPermissionStatus(granted ? "granted" : "denied");
          if (granted && getViewFromHash() === "quick") {
            normal.forEach((task) => {
              sendNotification({
                title: "任务提醒",
                body: `${task.title} (${formatDue(task.due_at)})`,
                actionTypeId: NOTIFICATION_ACTION_TYPE,
                extra: { taskId: task.id },
                silent: settingsRef.current ? !settingsRef.current.sound_enabled : false,
              });
            });
          }
        }
      });
    })();

    return () => {
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
    if (!showSettings || !settings) return;
    setShortcutDraft(settings.shortcut);
  }, [showSettings, settings?.shortcut]);

  useEffect(() => {
    if (!showSettings) return;
    // Refresh permission status when opening the settings panel to avoid showing stale "unknown".
    (async () => {
      try {
        const granted = await isPermissionGranted();
        setPermissionStatus(granted ? "granted" : "denied");
      } catch {
        // Ignore environments where permission status isn't available.
      }
    })();
  }, [showSettings]);

  useEffect(() => {
    document.documentElement.dataset.view = view;
  }, [view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // Priority: close modals/overlays first.
      if (editingTaskId) {
        setEditingTaskId(null);
        return;
      }
      if (showSettings) {
        setShowSettings(false);
        return;
      }

      // Quick window: Esc hides the window (classic launcher behavior).
      if (view === "quick") {
        void getCurrentWindow().hide();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingTaskId, showSettings, view]);

  useEffect(() => {
    (async () => {
      const granted = await isPermissionGranted();
      setPermissionStatus(granted ? "granted" : "denied");
    })();
  }, []);

  useEffect(() => {
    // IMPORTANT: quick-tab UI state must only be synced inside the quick window.
    // Otherwise, multiple windows will fight each other via `update_settings` and cause tab "ping-pong".
    if (view !== "quick" || !settings) return;
    if (settings.quick_tab) {
      setTab(settings.quick_tab as typeof QUICK_TABS[number]["id"]);
    }
    if (settings.quick_sort) {
      setQuickSort(settings.quick_sort as QuickSortMode);
    }
  }, [view, settings?.quick_tab, settings?.quick_sort, settings]);

  useEffect(() => {
    if (view !== "quick" || !settings) return;
    if (settings.quick_tab !== tab || settings.quick_sort !== quickSort) {
      handleUpdateSettings({
        ...settings,
        quick_tab: tab,
        quick_sort: quickSort,
      });
    }
  }, [view, tab, quickSort, settings]);

  useEffect(() => {
    if (view !== "quick" || !settings) return;
    const appWindow = getCurrentWindow();
    if (!quickWindowApplied.current) {
      if (settings.quick_bounds) {
        const bounds = settings.quick_bounds;
        appWindow.setSize(new LogicalSize(bounds.width, bounds.height));
        appWindow.setPosition(new LogicalPosition(bounds.x, bounds.y));
      } else {
        appWindow.outerSize().then((size) => {
          const availableWidth = window.screen.availWidth || window.screen.width;
          const availableHeight = window.screen.availHeight || window.screen.height;
          const centerX = Math.max(0, Math.round((availableWidth - size.width) / 2));
          const centerY = Math.max(0, Math.round((availableHeight - size.height) / 2));
          const offsetY = Math.round(availableHeight * 0.15);
          appWindow.setPosition(new LogicalPosition(centerX, centerY + offsetY));
        });
      }
      quickWindowApplied.current = true;
    }

    // Some platforms lose the always-on-top state after hide()/show() cycles.
    // Re-assert it whenever we (re)enter the quick view.
    void appWindow.setAlwaysOnTop(settings.quick_always_on_top);

    const scheduleSave = () => {
      if (quickSaveTimer.current) {
        clearTimeout(quickSaveTimer.current);
      }
      quickSaveTimer.current = window.setTimeout(async () => {
        const [pos, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
        const nextSettings = {
          ...settings,
          quick_bounds: {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
          },
        };
        handleUpdateSettings(nextSettings);
      }, 2000);
    };

    let unlistenMoved: (() => void) | null = null;
    let unlistenResized: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    (async () => {
      unlistenMoved = await appWindow.onMoved(scheduleSave);
      unlistenResized = await appWindow.onResized(scheduleSave);
      unlistenFocus = await appWindow.onFocusChanged(({ payload }) => {
        if (!payload) return;
        void appWindow.setAlwaysOnTop(settingsRef.current?.quick_always_on_top ?? false);
      });
    })();

    return () => {
      if (unlistenMoved) unlistenMoved();
      if (unlistenResized) unlistenResized();
      if (unlistenFocus) unlistenFocus();
      if (quickSaveTimer.current) {
        window.clearTimeout(quickSaveTimer.current);
      }
    };
  }, [view, settings]);

  useEffect(() => {
    if (view !== "quick") return;
    const appWindow = getCurrentWindow();
    const onBlur = () => {
      // When pinned (always-on-top), do not auto-hide on focus loss.
      // This also prevents accidental hide while trying to drag the window.
      if (settingsRef.current?.quick_always_on_top) return;
      if (editingTaskId) return;
      void appWindow.hide();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
    };
  }, [view, editingTaskId]);

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

  const quickTasks = useMemo(() => visibleQuickTasks(tasks, tab, new Date(), quickSort), [tasks, tab, quickSort]);

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

  const editingTask = useMemo(() => {
    if (!editingTaskId) return null;
    return tasks.find((task) => task.id === editingTaskId) ?? null;
  }, [tasks, editingTaskId]);

  async function refreshState() {
    const res = await loadState();
    if (res.ok && res.data) {
      const [loadedTasks, loadedSettings] = res.data;
      setTasks(loadedTasks.map(normalizeTask));
      setSettings(loadedSettings);
      setTab((loadedSettings.quick_tab as typeof QUICK_TABS[number]["id"]) ?? "todo");
      setQuickSort((loadedSettings.quick_sort as QuickSortMode) ?? "default");
    }
  }

  async function handleUpdateSettings(next: Settings) {
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
      return;
    }
    if (result.data) {
      setSettings(result.data);
    }
  }

  async function applyShortcutDraft() {
    if (!settings) return;
    const nextShortcut = shortcutDraft.trim();
    if (!nextShortcut) {
      setShortcutDraft(settings.shortcut);
      return;
    }
    if (nextShortcut === settings.shortcut) return;
    await handleUpdateSettings({ ...settings, shortcut: nextShortcut });
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

  async function handleDeleteTask(task: Task) {
    if (!confirm("确认删除该任务？")) return;
    await deleteTask(task.id);
  }

  async function handleUpdateTask(next: Task) {
    await updateTask(next);
  }

  function handleEditTask(task: Task) {
    setEditingTaskId(task.id);
  }

  async function handleReminderSnooze5() {
    if (!reminderTask) return;
    const until = Math.floor(Date.now() / 1000) + 5 * 60;
    await snoozeTask(reminderTask.id, until);
    setForcedQueueIds((prev) => prev.filter((id) => id !== reminderTask.id));
  }

  async function handleReminderDismiss() {
    if (!reminderTask) return;
    await dismissForced(reminderTask.id);
    setForcedQueueIds((prev) => prev.filter((id) => id !== reminderTask.id));
  }

  async function handleReminderComplete() {
    if (!reminderTask) return;
    await completeTask(reminderTask.id);
    setForcedQueueIds((prev) => prev.filter((id) => id !== reminderTask.id));
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

  async function handleToggleAlwaysOnTop() {
    if (!settings) return;
    const next = { ...settings, quick_always_on_top: !settings.quick_always_on_top };
    await handleUpdateSettings(next);
    await getCurrentWindow().setAlwaysOnTop(next.quick_always_on_top);
  }

  async function requestNotificationPermission() {
    const result = await requestPermission();
    setPermissionStatus(result === "granted" ? "granted" : "denied");
  }

  async function openNotificationSettings() {
    const target = detectPlatform();
    if (target === "windows") {
      await openUrl("ms-settings:notifications");
      return;
    }
    if (target === "macos") {
      await openUrl("x-apple.systempreferences:com.apple.preference.notifications");
      return;
    }
  }

  async function refreshBackups() {
    const res = await listBackups();
    if (res.ok && res.data) {
      const sorted = [...res.data].sort((a, b) => b.modified_at - a.modified_at);
      setBackups(sorted);
    }
  }

  async function handleCreateBackup() {
    await createBackup();
    await refreshBackups();
  }

  async function handleRestoreBackup(name: string) {
    if (!confirm("恢复将覆盖当前数据，确认继续？")) return;
    await restoreBackup(name);
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    if (!confirm("恢复将覆盖当前数据，确认继续？")) return;
    await importBackup(importPath.trim());
    setImportPath("");
  }

  const filteredTasks = useMemo(() => {
    const now = new Date();
    return tasks.filter((task) => {
      if (dueFilter === "overdue" && !isOverdue(task, Math.floor(now.getTime() / 1000))) return false;
      if (dueFilter === "today" && !isDueToday(task, now)) return false;
      if (dueFilter === "tomorrow" && !isDueTomorrow(task, now)) return false;
      if (dueFilter === "future" && !isDueInFuture(task, now)) return false;

      if (importanceFilter === "important" && !task.important) return false;
      if (importanceFilter === "normal" && task.important) return false;

      if (repeatFilter === "repeat" && task.repeat.type === "none") return false;
      if (repeatFilter === "none" && task.repeat.type !== "none") return false;

      if (reminderFilter === "remind" && task.reminder.kind === "none") return false;
      if (reminderFilter === "none" && task.reminder.kind !== "none") return false;
      if (reminderFilter === "forced" && task.reminder.kind !== "forced") return false;
      if (reminderFilter === "normal" && task.reminder.kind !== "normal") return false;

      return true;
    });
  }, [tasks, dueFilter, importanceFilter, repeatFilter, reminderFilter]);

  const sortedTasks = useMemo(() => {
    const list = [...filteredTasks];
    if (mainSort === "created") {
      return list.sort((a, b) => a.created_at - b.created_at);
    }
    if (mainSort === "manual") {
      return list.sort((a, b) => a.sort_order - b.sort_order);
    }
    return list.sort((a, b) => a.due_at - b.due_at);
  }, [filteredTasks, mainSort]);

  const tasksByQuadrant = useMemo(() => {
    const map: Record<number, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
    sortedTasks.forEach((task) => {
      map[task.quadrant]?.push(task);
    });
    return map;
  }, [sortedTasks]);

  const listSections = useMemo(() => {
    const now = new Date();
    const overdue: Task[] = [];
    const today: Task[] = [];
    const tomorrow: Task[] = [];
    const future: Task[] = [];
    const completed: Task[] = [];

    sortedTasks.forEach((task) => {
      if (task.completed) {
        completed.push(task);
        return;
      }
      if (isOverdue(task, Math.floor(now.getTime() / 1000))) {
        overdue.push(task);
      } else if (isDueToday(task, now)) {
        today.push(task);
      } else if (isDueTomorrow(task, now)) {
        tomorrow.push(task);
      } else {
        future.push(task);
      }
    });

    return [
      { id: "overdue", label: "逾期", tasks: overdue },
      { id: "today", label: "今天", tasks: today },
      { id: "tomorrow", label: "明天", tasks: tomorrow },
      { id: "future", label: "未来", tasks: future },
      { id: "completed", label: "已完成", tasks: completed },
    ];
  }, [sortedTasks]);

  const activeListSection = useMemo(() => {
    return (
      listSections.find((section) => section.id === listTab) ??
      listSections[0] ??
      ({ id: listTab, label: "", tasks: [] } as { id: string; label: string; tasks: Task[] })
    );
  }, [listSections, listTab]);

  const quadrantCounts = useMemo(() => {
    const counts: Record<number, { total: number; completed: number }> = {
      1: { total: 0, completed: 0 },
      2: { total: 0, completed: 0 },
      3: { total: 0, completed: 0 },
      4: { total: 0, completed: 0 },
    };
    tasks.forEach((task) => {
      const entry = counts[task.quadrant];
      if (!entry) return;
      entry.total += 1;
      if (task.completed) entry.completed += 1;
    });
    return counts;
  }, [tasks]);

  async function handleMoveTask(task: Task, direction: "up" | "down", list: Task[]) {
    const index = list.findIndex((item) => item.id === task.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const current = list[index];
    const target = list[targetIndex];
    const result = await swapSortOrder(current.id, target.id);
    if (!result.ok) {
      await refreshState();
    }
  }

  function handleDropToQuadrant(quadrant: number, taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.quadrant === quadrant) return;
    const now = Math.floor(Date.now() / 1000);
    handleUpdateTask({
      ...task,
      quadrant,
      sort_order: Date.now(),
      updated_at: now,
    });
  }

  function handleDragStart(task: Task, event: DragEvent) {
    event.dataTransfer.setData("text/plain", task.id);
  }

  useEffect(() => {
    if (!editingTaskId) return;
    if (!tasks.some((task) => task.id === editingTaskId)) {
      setEditingTaskId(null);
    }
  }, [tasks, editingTaskId]);

  useEffect(() => {
    if (view === "reminder" && !reminderTask) {
      getCurrentWindow().hide();
    }
  }, [view, reminderTask]);

  useEffect(() => {
    if (view !== "reminder") return;
    const appWindow = getCurrentWindow();
    const availableWidth = window.screen.availWidth || window.screen.width;
    const availableHeight = window.screen.availHeight || window.screen.height;
    const bannerHeight = Math.round(availableHeight * 0.2);
    appWindow.setSize(new LogicalSize(availableWidth, bannerHeight));
    appWindow.setPosition(new LogicalPosition(0, Math.round((availableHeight - bannerHeight) / 2)));
  }, [view]);

  useEffect(() => {
    if (!showSettings) return;
    refreshBackups();
  }, [showSettings]);

  return (
    <div className="app-container">
      {view === "quick" && (
        <div className="quick-window">
          <WindowTitlebar
            variant="quick"
            pinned={settings?.quick_always_on_top}
            onTogglePin={handleToggleAlwaysOnTop}
          />

          <NotificationBanner tasks={normalTasks} onSnooze={handleNormalSnooze} onComplete={handleNormalComplete} />

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
              <select
                value={quickSort}
                onChange={(event) => setQuickSort(event.currentTarget.value as QuickSortMode)}
              >
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
                onToggleComplete={() => handleToggleComplete(task)}
                onToggleImportant={() => handleToggleImportant(task)}
                onDelete={() => handleDeleteTask(task)}
                onEdit={() => handleEditTask(task)}
              />
            ))}
          </div>

          <div className="quick-input-bar">
            <TaskComposer onSubmit={handleCreateFromComposer} />
          </div>
        </div>
      )}

      {view === "main" && (
        <div className="main-window">
          <WindowTitlebar
            variant="main"
            title="Todo Tool"
            right={
              <div className="main-titlebar-actions">
                <div className="segment" role="tablist" aria-label="Main view">
                  <button
                    type="button"
                    className={`segment-btn ${mainView === "list" ? "active" : ""}`}
                    onClick={() => setMainView("list")}
                    aria-selected={mainView === "list"}
                  >
                    列表
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${mainView === "quadrant" ? "active" : ""}`}
                    onClick={() => setMainView("quadrant")}
                    aria-selected={mainView === "quadrant"}
                  >
                    四象限
                  </button>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowSettings(true)}
                  title="设置"
                  aria-label="设置"
                >
                  <Icons.Settings />
                </button>
              </div>
            }
          />

          <div className="main-content">
            <NotificationBanner tasks={normalTasks} onSnooze={handleNormalSnooze} onComplete={handleNormalComplete} />

            <div className="main-filters">
              <div className="filter-group">
                <Icons.Filter />
                <select value={dueFilter} onChange={(event) => setDueFilter(event.currentTarget.value as any)}>
                  {DUE_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={importanceFilter}
                  onChange={(event) => setImportanceFilter(event.currentTarget.value as any)}
                >
                  {IMPORTANCE_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select value={repeatFilter} onChange={(event) => setRepeatFilter(event.currentTarget.value as any)}>
                  {REPEAT_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={reminderFilter}
                  onChange={(event) => setReminderFilter(event.currentTarget.value as any)}
                >
                  {REMINDER_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <Icons.Sort />
                <select value={mainSort} onChange={(event) => setMainSort(event.currentTarget.value as any)}>
                  {MAIN_SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

          {mainView === "quadrant" && (
            <div className="quadrant-grid">
              {QUADRANTS.map((quad) => (
                <div
                  key={quad.id}
                  className={`quadrant ${quad.className}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const id = event.dataTransfer.getData("text/plain");
                    if (id) handleDropToQuadrant(quad.id, id);
                  }}
                >
                  <div className="quadrant-header">
                    <div>
                      <h2 className="quadrant-title">{quad.title}</h2>
                      <span className="quadrant-sublabel">
                        {quad.sublabel} · {quadrantCounts[quad.id].completed}/{quadrantCounts[quad.id].total}
                      </span>
                    </div>
                  </div>

                  <div className="quadrant-list">
                    {tasksByQuadrant[quad.id].length === 0 ? (
                      <div className="quadrant-empty">暂无任务</div>
                    ) : (
                      tasksByQuadrant[quad.id].map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          mode="main"
                          showMove={mainSort === "manual"}
                          draggable
                          onDragStart={(event) => handleDragStart(task, event)}
                          onMoveUp={() => handleMoveTask(task, "up", tasksByQuadrant[quad.id])}
                          onMoveDown={() => handleMoveTask(task, "down", tasksByQuadrant[quad.id])}
                          onToggleComplete={() => handleToggleComplete(task)}
                          onToggleImportant={() => handleToggleImportant(task)}
                          onDelete={() => handleDeleteTask(task)}
                          onEdit={() => handleEditTask(task)}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {mainView === "list" && (
            <div className="list-view">
              <div className="list-tabs" role="tablist" aria-label="列表分组">
                {listSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`list-tab ${listTab === section.id ? "active" : ""}`}
                    onClick={() => setListTab(section.id as any)}
                    aria-selected={listTab === section.id}
                  >
                    <span>{section.label}</span>
                    <span className="list-tab-count">{section.tasks.length}</span>
                  </button>
                ))}
              </div>

              <div className="list-panel" role="tabpanel">
                {activeListSection.tasks.length === 0 ? (
                  <div className="list-empty">暂无任务</div>
                ) : (
                  activeListSection.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      mode="main"
                      showMove={mainSort === "manual"}
                      draggable
                      onDragStart={(event) => handleDragStart(task, event)}
                      onMoveUp={() => handleMoveTask(task, "up", activeListSection.tasks)}
                      onMoveDown={() => handleMoveTask(task, "down", activeListSection.tasks)}
                      onToggleComplete={() => handleToggleComplete(task)}
                      onToggleImportant={() => handleToggleImportant(task)}
                      onDelete={() => handleDeleteTask(task)}
                      onEdit={() => handleEditTask(task)}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {showSettings && settings && (
            <div className="settings-overlay" onClick={() => setShowSettings(false)}>
              <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
                <div className="settings-header">
                  <h2>设置</h2>
                  <button
                    type="button"
                    className="task-icon-btn"
                    onClick={() => setShowSettings(false)}
                    aria-label="关闭设置"
                    title="关闭"
                  >
                    <Icons.X />
                  </button>
                </div>

                <div className="settings-section">
                  <div className="settings-row">
                    <label>快捷键</label>
                    <input
                      value={shortcutDraft}
                      onChange={(event) => setShortcutDraft(event.currentTarget.value)}
                      onBlur={() => void applyShortcutDraft()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                  <div className="settings-row">
                    <label>主题</label>
                    <select
                      value={settings.theme}
                      onChange={(event) =>
                        handleUpdateSettings({
                          ...settings,
                          theme: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>提示音</label>
                    <button
                      type="button"
                      className={`pill ${settings.sound_enabled ? "active" : ""}`}
                      onClick={() =>
                        handleUpdateSettings({
                          ...settings,
                          sound_enabled: !settings.sound_enabled,
                        })
                      }
                      aria-pressed={settings.sound_enabled}
                    >
                      {settings.sound_enabled ? "开启" : "关闭"}
                    </button>
                  </div>
                  <div className="settings-row">
                    <label>关闭行为</label>
                    <select
                      value={settings.close_behavior}
                      onChange={(event) =>
                        handleUpdateSettings({
                          ...settings,
                          close_behavior: event.currentTarget.value as Settings["close_behavior"],
                        })
                      }
                    >
                      <option value="hide_to_tray">隐藏到托盘</option>
                      <option value="exit">退出应用</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>强制提醒颜色</label>
                    <input
                      type="color"
                      value={settings.forced_reminder_color}
                      onChange={(event) =>
                        handleUpdateSettings({
                          ...settings,
                          forced_reminder_color: event.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-row">
                    <label>通知权限</label>
                    <span className="settings-status">{permissionStatus === "granted" ? "已授权" : "未授权"}</span>
                    <button type="button" className="pill" onClick={requestNotificationPermission}>
                      请求权限
                    </button>
                    {permissionStatus !== "granted" && (
                      <button type="button" className="pill" onClick={openNotificationSettings}>
                        <Icons.ExternalLink />
                        系统设置
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-row">
                    <label>自动备份</label>
                    <select
                      value={settings.backup_schedule}
                      onChange={(event) =>
                        handleUpdateSettings({
                          ...settings,
                          backup_schedule: event.currentTarget.value as BackupSchedule,
                        })
                      }
                    >
                      <option value="none">不备份</option>
                      <option value="daily">每日</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                    </select>
                    <button type="button" className="pill" onClick={handleCreateBackup}>
                      手动备份
                    </button>
                  </div>
                  <div className="settings-row">
                    <label>备份列表</label>
                    <button type="button" className="pill" onClick={refreshBackups}>
                      刷新
                    </button>
                  </div>
                  <div className="backup-list">
                    {backups.length === 0 ? (
                      <div className="backup-empty">暂无备份</div>
                    ) : (
                      backups.map((backup) => (
                        <div key={backup.name} className="backup-item">
                          <span>{backup.name}</span>
                          <button type="button" className="pill" onClick={() => handleRestoreBackup(backup.name)}>
                            恢复
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="settings-row">
                    <label>导入备份</label>
                    <input
                      placeholder="输入备份文件路径"
                      value={importPath}
                      onChange={(event) => setImportPath(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      className="pill"
                      onClick={handleImportBackup}
                      disabled={!importPath.trim()}
                      title={!importPath.trim() ? "请输入备份文件路径" : "导入恢复"}
                    >
                      导入恢复
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>

          <div className="main-input-bar">
            <TaskComposer onSubmit={handleCreateFromComposer} />
          </div>
        </div>
      )}

      {view === "reminder" && settings && (
        <ReminderOverlay
          task={reminderTask}
          color={settings.forced_reminder_color}
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
    </div>
  );
}

export default App;
