import { useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { buildMonthGrid, monthKey, startOfLocalDay } from "../calendar";
import { formatLocalDateKey, sameLocalDate } from "../date";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { NotificationBanner } from "../components/NotificationBanner";
import { TaskCard } from "../components/TaskCard";
import { useI18n } from "../i18n";
import type { Settings, Task } from "../types";

export function CalendarView({
  tasks,
  settings,
  normalTasks,
  onNormalSnooze,
  onNormalComplete,
  onUpdateTask,
  onToggleComplete,
  onToggleImportant,
  onRequestDelete,
  onEditTask,
  onBack,
}: {
  tasks: Task[];
  settings: Settings | null;
  normalTasks: Task[];
  onNormalSnooze: (task: Task) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
  onUpdateTask: (next: Task) => Promise<void> | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();

  const today = useMemo(() => startOfLocalDay(new Date()), []);

  const [cursorMonth, setCursorMonth] = useState(() => {
    const d = new Date(today);
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date(today));
  const [showCompleted, setShowCompleted] = useState(false);

  const cursorMonthKey = useMemo(() => monthKey(cursorMonth), [cursorMonth]);

  const cells = useMemo(() => buildMonthGrid(cursorMonth, today), [cursorMonth, today]);

  const taskCountsByDay = useMemo(() => {
    const map = new Map<string, { total: number; important: number; overdue: number }>();
    const nowSec = Math.floor(Date.now() / 1000);
    for (const task of tasks) {
      if (!showCompleted && task.completed) continue;
      const key = formatLocalDateKey(new Date(task.due_at * 1000));
      const cur = map.get(key) ?? { total: 0, important: 0, overdue: 0 };
      cur.total += 1;
      if (task.important) cur.important += 1;
      if (!task.completed && task.due_at < nowSec) cur.overdue += 1;
      map.set(key, cur);
    }
    return map;
  }, [tasks, showCompleted]);

  const selectedKey = useMemo(() => formatLocalDateKey(selectedDay), [selectedDay]);
  const selectedTasks = useMemo(() => {
    const list = tasks
      .filter((task) => (showCompleted ? true : !task.completed))
      .filter((task) => sameLocalDate(task.due_at, Math.floor(selectedDay.getTime() / 1000)))
      .slice()
      .sort((a, b) => a.due_at - b.due_at || a.created_at - b.created_at);
    return list;
  }, [tasks, selectedDay, showCompleted]);

  const selectedTitle = useMemo(() => {
    const yyyy = selectedDay.getFullYear();
    const mm = String(selectedDay.getMonth() + 1).padStart(2, "0");
    const dd = String(selectedDay.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [selectedDay]);

  async function handleMinimize() {
    const appWindow = getCurrentWindow();
    const behavior = settings?.minimize_behavior ?? "hide_to_tray";
    try {
      if (behavior === "minimize") {
        await appWindow.minimize();
        return;
      }
      await appWindow.hide();
    } catch {
      // Best-effort.
    }
  }

  function goToMonth(offset: number) {
    setCursorMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + offset, 1);
      return next;
    });
  }

  function goToToday() {
    setCursorMonth(() => {
      const next = new Date(today);
      next.setDate(1);
      return next;
    });
    setSelectedDay(new Date(today));
  }

  return (
    <div className="main-window calendar-window">
      <WindowTitlebar
        variant="main"
        title={t("calendar.title")}
        onMinimize={handleMinimize}
        right={
          <button type="button" className="main-toggle" onClick={onBack} title={t("common.back")}>
            <span className="settings-back-icon" aria-hidden="true">
              <Icons.ChevronRight />
            </span>
            {t("common.back")}
          </button>
        }
      />

      <div className="main-content">
        <NotificationBanner tasks={normalTasks} onSnooze={onNormalSnooze} onComplete={onNormalComplete} />

        <div className="calendar-toolbar">
          <div className="calendar-toolbar-left">
            <button type="button" className="pill" onClick={() => goToMonth(-1)} aria-label={t("calendar.prevMonth")}>
              {t("calendar.prevMonth")}
            </button>
            <div className="calendar-month">{cursorMonthKey}</div>
            <button type="button" className="pill" onClick={() => goToMonth(1)} aria-label={t("calendar.nextMonth")}>
              {t("calendar.nextMonth")}
            </button>
            <button type="button" className="pill" onClick={goToToday} aria-label={t("calendar.today")}>
              {t("calendar.today")}
            </button>
          </div>
          <div className="calendar-toolbar-right">
            <button
              type="button"
              className={`pill ${showCompleted ? "active" : ""}`}
              onClick={() => setShowCompleted((prev) => !prev)}
              aria-pressed={showCompleted}
            >
              {showCompleted ? t("calendar.hideCompleted") : t("calendar.showCompleted")}
            </button>
          </div>
        </div>

        <div className="calendar-layout">
          <div className="calendar-grid" role="grid" aria-label={t("calendar.title")}>
            <div className="calendar-weekdays" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6, 7].map((id) => (
                <div key={id} className="calendar-weekday">
                  {t(`weekday.${id}`)}
                </div>
              ))}
            </div>
            <div className="calendar-cells">
              {cells.map((cell) => {
                const selected = cell.key === selectedKey;
                const counts = taskCountsByDay.get(cell.key);
                const hasTasks = Boolean(counts && counts.total > 0);
                const isMuted = !cell.inMonth;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      "calendar-day",
                      selected ? "selected" : "",
                      cell.isToday ? "today" : "",
                      isMuted ? "muted" : "",
                      hasTasks ? "has-tasks" : "",
                    ].join(" ")}
                    onClick={() => {
                      setSelectedDay(new Date(cell.date));
                      // Keep the month cursor consistent with the selected day.
                      if (!cell.inMonth) {
                        const next = new Date(cell.date);
                        next.setDate(1);
                        setCursorMonth(next);
                      }
                    }}
                    aria-pressed={selected}
                  >
                    <div className="calendar-day-top">
                      <span className="calendar-day-number">{cell.date.getDate()}</span>
                      {counts && counts.total > 0 && (
                        <span
                          className={[
                            "calendar-day-count",
                            counts.overdue > 0 ? "overdue" : counts.important > 0 ? "important" : "",
                          ].join(" ")}
                          title={t("calendar.taskCount", { count: counts.total })}
                        >
                          {counts.total}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="calendar-side">
            <div className="calendar-side-header">
              <div className="calendar-side-title">{selectedTitle}</div>
              <div className="calendar-side-subtitle">
                {t("calendar.selectedCount", { count: selectedTasks.length })}
              </div>
            </div>

            <div className="calendar-task-list">
              {selectedTasks.length === 0 ? (
                <div className="list-empty">{t("calendar.empty")}</div>
              ) : (
                selectedTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    mode="main"
                    selectable={false}
                    onToggleComplete={() => void onToggleComplete(task)}
                    onToggleImportant={() => void onToggleImportant(task)}
                    onDelete={() => onRequestDelete(task)}
                    onEdit={() => onEditTask(task)}
                    onUpdateTask={onUpdateTask}
                    showNotesPreview
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
