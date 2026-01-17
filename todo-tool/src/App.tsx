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

import {
  completeTask,
  createBackup,
  createTask,
  deleteTask,
  deleteTasks,
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
import { defaultDueAt, isDueInFuture, isDueToday, isDueTomorrow, isOverdue } from "./scheduler";
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

const QUICK_DUE_PRESETS = [
  { id: "today", label: "今天 18:00", offsetDays: 0 },
  { id: "tomorrow", label: "明天 18:00", offsetDays: 1 },
  { id: "dayAfter", label: "后天 18:00", offsetDays: 2 },
] as const;

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
  if (!task.sort_order) {
    return { ...task, sort_order: task.created_at * 1000 };
  }
  return task;
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

// ============================================================================
// ICON COMPONENTS
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
  Edit: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  Settings: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
  Pin: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 17v5" />
      <path d="M5 9h14l-1 6H6l-1-6Z" />
      <path d="M5 9V6l7-4 7 4v3" />
    </svg>
  ),
  ArrowUp: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 15 12 9 18 15" />
    </svg>
  ),
  ArrowDown: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ExternalLink: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3h7v7" />
      <path d="M10 14L21 3" />
      <path d="M5 7v14h14v-5" />
    </svg>
  ),
};

// ============================================================================
// TASK CARD
// ============================================================================
function TaskCard({
  task,
  mode,
  expanded,
  selectable,
  selected,
  showNotes,
  showMove,
  draggable,
  onDragStart,
  onMoveUp,
  onMoveDown,
  onToggleSelect,
  onToggleComplete,
  onToggleImportant,
  onDelete,
  onExpand,
  onUpdate,
}: {
  task: Task;
  mode: "quick" | "main";
  expanded: boolean;
  selectable?: boolean;
  selected?: boolean;
  showNotes?: boolean;
  showMove?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleSelect?: () => void;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onDelete: () => void;
  onExpand: () => void;
  onUpdate: (task: Task) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDueAt, setDraftDueAt] = useState(task.due_at);
  const [draftReminderKind, setDraftReminderKind] = useState<ReminderKind>(task.reminder.kind);
  const [draftReminderOffset, setDraftReminderOffset] = useState<number>(getReminderOffset(task));
  const [draftRepeat, setDraftRepeat] = useState<RepeatRule>(task.repeat);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? "");
  const [newStepTitle, setNewStepTitle] = useState("");

  useEffect(() => {
    if (!expanded) return;
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffset(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setNewStepTitle("");
  }, [expanded, task]);

  const now = Math.floor(Date.now() / 1000);
  const overdue = isOverdue(task, now);

  function handleSave() {
    const title = draftTitle.trim();
    if (!title) return;
    const next: Task = {
      ...task,
      title,
      due_at: draftDueAt,
      repeat: draftRepeat,
      reminder: buildReminderConfig(draftReminderKind, draftDueAt, draftReminderOffset),
      notes: showNotes ? draftNotes.trim() || undefined : task.notes,
      updated_at: now,
    };
    onUpdate(next);
  }

  function handleReset() {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffset(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
  }

  function handleAddStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    const ts = Math.floor(Date.now() / 1000);
    const next: Task = {
      ...task,
      steps: [
        ...task.steps,
        {
          id: crypto.randomUUID(),
          title,
          completed: false,
          created_at: ts,
        },
      ],
      updated_at: ts,
    };
    setNewStepTitle("");
    onUpdate(next);
  }

  function toggleStep(stepId: string) {
    const ts = Math.floor(Date.now() / 1000);
    const nextSteps = task.steps.map((step) => {
      if (step.id !== stepId) return step;
      const completed = !step.completed;
      return {
        ...step,
        completed,
        completed_at: completed ? ts : undefined,
      };
    });
    onUpdate({ ...task, steps: nextSteps, updated_at: ts });
  }

  function removeStep(stepId: string) {
    const ts = Math.floor(Date.now() / 1000);
    onUpdate({ ...task, steps: task.steps.filter((step) => step.id !== stepId), updated_at: ts });
  }

  return (
    <div
      className={`task-card ${mode} ${task.completed ? "completed" : ""} ${overdue ? "overdue" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className={`task-row ${selectable ? "selectable" : ""}`}>
        {selectable && (
          <button
            type="button"
            className={`task-select ${selected ? "selected" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect?.();
            }}
            title={selected ? "取消选择" : "选择"}
            aria-label={selected ? "取消选择任务" : "选择任务"}
            aria-pressed={selected}
          >
            {selected && <Icons.Check />}
          </button>
        )}
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
            onClick={onExpand}
            title={expanded ? "收起" : "编辑"}
            aria-label={expanded ? "收起编辑" : "展开编辑"}
          >
            {expanded ? <Icons.ChevronDown /> : <Icons.Edit />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="task-details">
          <div className="task-edit-row">
            <input
              className="task-edit-title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
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
            <button
              type="button"
              className="task-edit-btn"
              onClick={handleSave}
              disabled={!draftTitle.trim()}
              title={!draftTitle.trim() ? "标题不能为空" : "保存"}
            >
              保存
            </button>
            <button type="button" className="task-edit-btn ghost" onClick={handleReset} title="重置">
              重置
            </button>
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
                />
                <button
                  type="button"
                  className="step-add-btn"
                  onClick={handleAddStep}
                  disabled={!newStepTitle.trim()}
                  title={!newStepTitle.trim() ? "请输入步骤内容" : "添加步骤"}
                  aria-label="添加步骤"
                >
                  <Icons.Plus />
                </button>
              </div>
            </div>
            {task.steps.length === 0 ? (
              <div className="steps-empty">无步骤</div>
            ) : (
              task.steps.map((step) => (
                <div key={step.id} className={`step-item ${step.completed ? "completed" : ""}`}>
                  <button
                    type="button"
                    className="step-checkbox"
                    onClick={() => toggleStep(step.id)}
                    aria-label={step.completed ? "标记步骤为未完成" : "标记步骤为完成"}
                    aria-pressed={step.completed}
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
                rows={3}
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.currentTarget.value)}
              />
            </div>
          )}
        </div>
      )}
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
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>("");
  const [quickConfigOpen, setQuickConfigOpen] = useState(false);
  const [draftDueAt, setDraftDueAt] = useState<number>(defaultDueAt(new Date()));
  const [draftImportant, setDraftImportant] = useState(false);
  const [draftRepeat, setDraftRepeat] = useState<RepeatRule>({ type: "none" });
  const [draftReminderKind, setDraftReminderKind] = useState<ReminderKind>("none");
  const [draftReminderOffset, setDraftReminderOffset] = useState<number>(10);

  const [forcedQueueIds, setForcedQueueIds] = useState<string[]>([]);
  const [normalQueueIds, setNormalQueueIds] = useState<string[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<"unknown" | "granted" | "denied">("unknown");

  const [mainView, setMainView] = useState<"quadrant" | "list">("quadrant");
  const [dueFilter, setDueFilter] = useState<(typeof DUE_FILTER_OPTIONS)[number]["id"]>("all");
  const [importanceFilter, setImportanceFilter] = useState<
    (typeof IMPORTANCE_FILTER_OPTIONS)[number]["id"]
  >("all");
  const [repeatFilter, setRepeatFilter] = useState<(typeof REPEAT_FILTER_OPTIONS)[number]["id"]>("all");
  const [reminderFilter, setReminderFilter] = useState<(typeof REMINDER_FILTER_OPTIONS)[number]["id"]>("all");
  const [mainSort, setMainSort] = useState<(typeof MAIN_SORT_OPTIONS)[number]["id"]>("due");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedQuadrants, setCollapsedQuadrants] = useState<Record<number, boolean>>({
    1: false,
    2: false,
    3: false,
    4: false,
  });

  const [showSettings, setShowSettings] = useState(false);
  const [backups, setBackups] = useState<{ name: string; modified_at: number }[]>([]);
  const [importPath, setImportPath] = useState("");

  const quickWindowApplied = useRef(false);
  const quickSaveTimer = useRef<number | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  const dueTimePreview = useMemo(() => formatDue(draftDueAt), [draftDueAt]);

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
    document.documentElement.dataset.view = view;
  }, [view]);

  useEffect(() => {
    (async () => {
      const granted = await isPermissionGranted();
      setPermissionStatus(granted ? "granted" : "denied");
    })();
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (settings.quick_tab) {
      setTab(settings.quick_tab as typeof QUICK_TABS[number]["id"]);
    }
    if (settings.quick_sort) {
      setQuickSort(settings.quick_sort as QuickSortMode);
    }
  }, [settings?.quick_tab, settings?.quick_sort, settings]);

  useEffect(() => {
    if (!settings) return;
    if (settings.quick_tab !== tab || settings.quick_sort !== quickSort) {
      handleUpdateSettings({
        ...settings,
        quick_tab: tab,
        quick_sort: quickSort,
      });
    }
  }, [tab, quickSort, settings]);

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
      appWindow.setAlwaysOnTop(settings.quick_always_on_top);
      quickWindowApplied.current = true;
    }

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

    (async () => {
      unlistenMoved = await appWindow.onMoved(scheduleSave);
      unlistenResized = await appWindow.onResized(scheduleSave);
    })();

    return () => {
      if (unlistenMoved) unlistenMoved();
      if (unlistenResized) unlistenResized();
      if (quickSaveTimer.current) {
        window.clearTimeout(quickSaveTimer.current);
      }
    };
  }, [view, settings]);

  useEffect(() => {
    if (view !== "quick") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        getCurrentWindow().hide();
      }
    };
    const onBlur = () => {
      getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [view]);

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
      return;
    }
    if (result.data) {
      setSettings(result.data);
    }
  }

  async function handleAddTask() {
    const title = inputValue.trim();
    if (!title) return;
    const task = newTask(title, new Date());
    task.due_at = draftDueAt;
    task.important = draftImportant;
    task.repeat = draftRepeat;
    task.reminder = buildReminderConfig(draftReminderKind, draftDueAt, draftReminderOffset);
    task.updated_at = Math.floor(Date.now() / 1000);
    setInputValue("");
    setDraftRepeat({ type: "none" });
    setDraftImportant(false);
    setDraftReminderKind("none");
    setDraftReminderOffset(10);
    setDraftDueAt(defaultDueAt(new Date()));
    await createTask(task);
  }

  async function handleToggleComplete(task: Task) {
    if (task.completed) return;
    await completeTask(task.id);
  }

  async function handleToggleImportant(task: Task) {
    const now = Math.floor(Date.now() / 1000);
    await updateTask({ ...task, important: !task.important, updated_at: now });
  }

  async function handleDeleteTask(task: Task) {
    if (!confirm("确认删除该任务？")) return;
    await deleteTask(task.id);
  }

  function handleExpand(task: Task) {
    setExpandedTaskId((prev) => (prev === task.id ? null : task.id));
  }

  async function handleUpdateTask(next: Task) {
    await updateTask(next);
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

  function updateSelection(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  async function handleBatchComplete() {
    const list = Array.from(selectedIds);
    for (const id of list) {
      const task = tasks.find((item) => item.id === id);
      if (task && !task.completed) {
        await completeTask(id);
      }
    }
    setSelectedIds(new Set());
  }

  async function handleBatchDelete() {
    const list = Array.from(selectedIds);
    if (list.length === 0) return;
    if (!confirm(`确认删除 ${list.length} 条任务？`)) return;
    await deleteTasks(list);
    setSelectedIds(new Set());
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
    setSelectedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of Array.from(next)) {
        if (!tasks.find((task) => task.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  useEffect(() => {
    if (!expandedTaskId) return;
    if (!tasks.find((task) => task.id === expandedTaskId)) {
      setExpandedTaskId(null);
    }
  }, [tasks, expandedTaskId]);

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

  const quickDueSunday = useMemo(() => {
    const now = new Date();
    const target = new Date(now);
    const day = target.getDay();
    const diff = (7 - day) % 7;
    target.setDate(target.getDate() + diff);
    target.setHours(18, 0, 0, 0);
    if (diff === 0 && now.getTime() > target.getTime()) {
      target.setDate(target.getDate() + 7);
    }
    return Math.floor(target.getTime() / 1000);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    refreshBackups();
  }, [showSettings]);

  return (
    <div className="app-container">
      {view === "quick" && (
        <div className="quick-window">
          <div className="quick-header" data-tauri-drag-region>
            <div className="quick-header-actions" data-tauri-drag-region="false">
              <button
                type="button"
                className={`quick-header-btn icon-only ${settings?.quick_always_on_top ? "active" : ""}`}
                onClick={handleToggleAlwaysOnTop}
                title="置顶"
                aria-label="置顶"
              >
                <Icons.Pin />
              </button>
              <button
                type="button"
                className="quick-header-btn icon-only"
                onClick={() => getCurrentWindow().hide()}
                title="关闭"
                aria-label="关闭"
              >
                <Icons.X />
              </button>
            </div>
          </div>

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
                expanded={expandedTaskId === task.id}
                onToggleComplete={() => handleToggleComplete(task)}
                onToggleImportant={() => handleToggleImportant(task)}
                onDelete={() => handleDeleteTask(task)}
                onExpand={() => handleExpand(task)}
                onUpdate={(next) => handleUpdateTask(next)}
              />
            ))}
          </div>

          <div className="quick-input-bar">
            <div className="quick-input-wrapper">
              <input
                type="text"
                className="quick-input"
                placeholder="输入任务内容，回车添加"
                value={inputValue}
                onChange={(e) => setInputValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTask();
                }}
              />
              <div className="quick-input-actions">
                <button
                  type="button"
                  className={`quick-input-btn ${quickConfigOpen ? "active" : ""}`}
                  onClick={() => setQuickConfigOpen((prev) => !prev)}
                  title="到期时间"
                  aria-label="设置到期时间"
                  aria-pressed={quickConfigOpen}
                >
                  <Icons.Calendar />
                </button>
                <button
                  type="button"
                  className={`quick-input-btn ${draftReminderKind !== "none" ? "active" : ""}`}
                  onClick={() => setQuickConfigOpen(true)}
                  title="提醒"
                  aria-label="提醒设置"
                  aria-pressed={draftReminderKind !== "none"}
                >
                  <Icons.Bell />
                </button>
                <button
                  type="button"
                  className={`quick-input-btn ${draftRepeat.type !== "none" ? "active" : ""}`}
                  onClick={() => setQuickConfigOpen(true)}
                  title="循环"
                  aria-label="循环设置"
                  aria-pressed={draftRepeat.type !== "none"}
                >
                  <Icons.Repeat />
                </button>
                <button
                  type="button"
                  className={`quick-input-btn ${draftImportant ? "active" : ""}`}
                  onClick={() => setDraftImportant((prev) => !prev)}
                  title="重要"
                  aria-label={draftImportant ? "取消标记重要" : "标记为重要"}
                  aria-pressed={draftImportant}
                >
                  <Icons.Star />
                </button>
              </div>
            </div>
            <div className="quick-due-preview">
              <Icons.Clock />
              <span>{dueTimePreview}</span>
            </div>
            {quickConfigOpen && (
              <div className="quick-config-panel">
                <div className="quick-config-row">
                  <span className="quick-config-label">到期时间</span>
                  <div className="quick-config-buttons">
                    {QUICK_DUE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="pill"
                        onClick={() => {
                          const base = new Date();
                          const target = new Date(base);
                          target.setDate(target.getDate() + preset.offsetDays);
                          target.setHours(18, 0, 0, 0);
                          setDraftDueAt(Math.floor(target.getTime() / 1000));
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <button type="button" className="pill" onClick={() => setDraftDueAt(quickDueSunday)}>
                      本周日 18:00
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    className="quick-config-input"
                    value={toDateTimeLocal(draftDueAt)}
                    onChange={(event) => {
                      const next = fromDateTimeLocal(event.currentTarget.value);
                      if (next) setDraftDueAt(next);
                    }}
                  />
                </div>

                <div className="quick-config-row">
                  <span className="quick-config-label">提醒</span>
                  <div className="quick-config-buttons">
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
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {draftReminderKind !== "none" && (
                    <div className="quick-config-inline">
                      <span>提前</span>
                      <input
                        type="number"
                        min={0}
                        className="inline-input"
                        value={draftReminderOffset}
                        onChange={(event) => setDraftReminderOffset(Number(event.currentTarget.value) || 0)}
                      />
                      <span>分钟</span>
                    </div>
                  )}
                </div>

                <div className="quick-config-row">
                  <span className="quick-config-label">循环</span>
                  <div className="quick-config-buttons">
                    {REPEAT_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`pill ${draftRepeat.type === opt.id ? "active" : ""}`}
                        onClick={() => setDraftRepeat(defaultRepeatRule(opt.id))}
                        aria-pressed={draftRepeat.type === opt.id}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {draftRepeat.type === "daily" && (
                    <div className="quick-config-inline">
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
                      >
                        仅工作日
                      </button>
                    </div>
                  )}
                  {draftRepeat.type === "weekly" && (
                    <div className="quick-config-buttons">
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
                          >
                            周{day.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {draftRepeat.type === "monthly" && (
                    <div className="quick-config-inline">
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
                      />
                      <span>号</span>
                    </div>
                  )}
                  {draftRepeat.type === "yearly" && (
                    <div className="quick-config-inline">
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
                      />
                      <span>号</span>
                    </div>
                  )}
                </div>

                <div className="quick-config-row">
                  <span className="quick-config-label">重要</span>
                  <button
                    type="button"
                    className={`pill ${draftImportant ? "active" : ""}`}
                    onClick={() => setDraftImportant((prev) => !prev)}
                    aria-pressed={draftImportant}
                  >
                    <Icons.Star />
                    {draftImportant ? "重要" : "未标记"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === "main" && (
        <div className="main-window">
          <header className="main-header">
            <div className="main-header-left">
              <h1 className="main-title">任务管理</h1>
              <div className="main-subtitle">四象限 + 列表视图</div>
            </div>
            <div className="main-header-actions">
              <button
                type="button"
                className={`main-toggle ${mainView === "quadrant" ? "active" : ""}`}
                onClick={() => setMainView("quadrant")}
                aria-pressed={mainView === "quadrant"}
              >
                <Icons.Grid />
                四象限
              </button>
              <button
                type="button"
                className={`main-toggle ${mainView === "list" ? "active" : ""}`}
                onClick={() => setMainView("list")}
                aria-pressed={mainView === "list"}
              >
                <Icons.List />
                列表
              </button>
              <button type="button" className="main-toggle" onClick={() => setShowSettings(true)}>
                <Icons.Settings />
                设置
              </button>
            </div>
          </header>

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

          {selectedIds.size > 0 && (
            <div className="batch-bar">
              <span>已选择 {selectedIds.size} 项</span>
              <button type="button" className="batch-btn" onClick={handleBatchComplete}>
                批量完成
              </button>
              <button type="button" className="batch-btn danger" onClick={handleBatchDelete}>
                批量删除
              </button>
            </div>
          )}

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
                    <button
                      type="button"
                      className="quadrant-toggle"
                      onClick={() =>
                        setCollapsedQuadrants((prev) => ({
                          ...prev,
                          [quad.id]: !prev[quad.id],
                        }))
                      }
                      aria-expanded={!collapsedQuadrants[quad.id]}
                      aria-controls={`quadrant-list-${quad.id}`}
                    >
                      {collapsedQuadrants[quad.id] ? "展开" : "收起"}
                    </button>
                  </div>

                  <div className="quadrant-add">
                    <input
                      placeholder="添加任务，回车创建"
                      onKeyDown={async (event) => {
                        if (event.key !== "Enter") return;
                        const title = event.currentTarget.value.trim();
                        if (!title) return;
                        const task = newTask(title, new Date());
                        task.quadrant = quad.id;
                        task.updated_at = Math.floor(Date.now() / 1000);
                        await createTask(task);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>

                  {!collapsedQuadrants[quad.id] && (
                    <div className="quadrant-list" id={`quadrant-list-${quad.id}`}>
                      {tasksByQuadrant[quad.id].length === 0 ? (
                        <div className="quadrant-empty">暂无任务</div>
                      ) : (
                        tasksByQuadrant[quad.id].map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            mode="main"
                            expanded={expandedTaskId === task.id}
                            selectable
                            selected={selectedIds.has(task.id)}
                            showNotes
                            showMove={mainSort === "manual"}
                            draggable
                            onDragStart={(event) => handleDragStart(task, event)}
                            onMoveUp={() => handleMoveTask(task, "up", tasksByQuadrant[quad.id])}
                            onMoveDown={() => handleMoveTask(task, "down", tasksByQuadrant[quad.id])}
                            onToggleSelect={() => updateSelection(task.id)}
                            onToggleComplete={() => handleToggleComplete(task)}
                            onToggleImportant={() => handleToggleImportant(task)}
                            onDelete={() => handleDeleteTask(task)}
                            onExpand={() => handleExpand(task)}
                            onUpdate={(next) => handleUpdateTask(next)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {mainView === "list" && (
            <div className="list-view">
              {listSections.map((section) => (
                <div key={section.id} className="list-section">
                  <div className="list-section-header">{section.label}</div>
                  {section.tasks.length === 0 ? (
                    <div className="list-empty">暂无任务</div>
                  ) : (
                    section.tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        mode="main"
                        expanded={expandedTaskId === task.id}
                        selectable
                        selected={selectedIds.has(task.id)}
                        showNotes
                        showMove={mainSort === "manual"}
                        draggable
                        onDragStart={(event) => handleDragStart(task, event)}
                        onMoveUp={() => handleMoveTask(task, "up", section.tasks)}
                        onMoveDown={() => handleMoveTask(task, "down", section.tasks)}
                        onToggleSelect={() => updateSelection(task.id)}
                        onToggleComplete={() => handleToggleComplete(task)}
                        onToggleImportant={() => handleToggleImportant(task)}
                        onDelete={() => handleDeleteTask(task)}
                        onExpand={() => handleExpand(task)}
                        onUpdate={(next) => handleUpdateTask(next)}
                      />
                    ))
                  )}
                </div>
              ))}
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
                      value={settings.shortcut}
                      onChange={(event) =>
                        handleUpdateSettings({
                          ...settings,
                          shortcut: event.currentTarget.value,
                        })
                      }
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
    </div>
  );
}

export default App;
