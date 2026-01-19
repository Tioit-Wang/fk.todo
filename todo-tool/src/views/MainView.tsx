import { useMemo, useState, type DragEvent } from "react";

import { swapSortOrder } from "../api";
import { NotificationBanner } from "../components/NotificationBanner";
import { SettingsPanel } from "../components/SettingsPanel";
import { TaskCard } from "../components/TaskCard";
import { TaskComposer, type TaskComposerDraft } from "../components/TaskComposer";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { isDueInFuture, isDueToday, isDueTomorrow, isOverdue } from "../scheduler";
import type { Settings, Task } from "../types";

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

const QUADRANTS = [
  { id: 1, title: "重要且紧急", sublabel: "Do First", className: "quadrant-red" },
  { id: 2, title: "重要不紧急", sublabel: "Schedule", className: "quadrant-amber" },
  { id: 3, title: "紧急不重要", sublabel: "Delegate", className: "quadrant-blue" },
  { id: 4, title: "不重要不紧急", sublabel: "Eliminate", className: "quadrant-gray" },
] as const;

export function MainView({
  tasks,
  settings,
  normalTasks,
  onUpdateSettings,
  onUpdateTask,
  onRefreshState,
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
  onRefreshState: () => Promise<void>;
  onCreateFromComposer: (draft: TaskComposerDraft) => Promise<void> | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onNormalSnooze: (task: Task) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
}) {
  const [mainView, setMainView] = useState<"quadrant" | "list">("list");
  const [listTab, setListTab] = useState<"all" | "overdue" | "today" | "tomorrow" | "future" | "completed">("today");

  const [dueFilter, setDueFilter] = useState<(typeof DUE_FILTER_OPTIONS)[number]["id"]>("all");
  const [importanceFilter, setImportanceFilter] = useState<(typeof IMPORTANCE_FILTER_OPTIONS)[number]["id"]>("all");
  const [repeatFilter, setRepeatFilter] = useState<(typeof REPEAT_FILTER_OPTIONS)[number]["id"]>("all");
  const [reminderFilter, setReminderFilter] = useState<(typeof REMINDER_FILTER_OPTIONS)[number]["id"]>("all");
  const [mainSort, setMainSort] = useState<(typeof MAIN_SORT_OPTIONS)[number]["id"]>("due");

  const [showSettings, setShowSettings] = useState(false);

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
    const all: Task[] = [];
    const overdue: Task[] = [];
    const today: Task[] = [];
    const tomorrow: Task[] = [];
    const future: Task[] = [];
    const completed: Task[] = [];

    sortedTasks.forEach((task) => {
      all.push(task);
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
      { id: "all", label: "全部", tasks: all },
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
      await onRefreshState();
    }
  }

  function handleDropToQuadrant(quadrant: number, taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.quadrant === quadrant) return;
    const now = Math.floor(Date.now() / 1000);
    void onUpdateTask({
      ...task,
      quadrant,
      sort_order: Date.now(),
      updated_at: now,
    });
  }

  function handleDragStart(task: Task, event: DragEvent) {
    event.dataTransfer.setData("text/plain", task.id);
  }

  return (
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
        <NotificationBanner tasks={normalTasks} onSnooze={onNormalSnooze} onComplete={onNormalComplete} />

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
            <select value={importanceFilter} onChange={(event) => setImportanceFilter(event.currentTarget.value as any)}>
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
            <select value={reminderFilter} onChange={(event) => setReminderFilter(event.currentTarget.value as any)}>
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
                        onMoveUp={() => void handleMoveTask(task, "up", tasksByQuadrant[quad.id])}
                        onMoveDown={() => void handleMoveTask(task, "down", tasksByQuadrant[quad.id])}
                        onToggleComplete={() => onToggleComplete(task)}
                        onToggleImportant={() => onToggleImportant(task)}
                        onDelete={() => onRequestDelete(task)}
                        onEdit={() => onEditTask(task)}
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
                    onMoveUp={() => void handleMoveTask(task, "up", activeListSection.tasks)}
                    onMoveDown={() => void handleMoveTask(task, "down", activeListSection.tasks)}
                    onToggleComplete={() => onToggleComplete(task)}
                    onToggleImportant={() => onToggleImportant(task)}
                    onDelete={() => onRequestDelete(task)}
                    onEdit={() => onEditTask(task)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        <SettingsPanel
          open={showSettings}
          tasks={tasks}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onUpdateSettings={onUpdateSettings}
        />
      </div>

      <div className="main-input-bar">
        <TaskComposer onSubmit={onCreateFromComposer} />
      </div>
    </div>
  );
}
