import { useMemo, useState, type DragEvent } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { swapSortOrder } from "../api";
import { NotificationBanner } from "../components/NotificationBanner";
import { IconButton } from "../components/IconButton";
import { TaskCard } from "../components/TaskCard";
import { TaskComposer, type TaskComposerDraft } from "../components/TaskComposer";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { useI18n } from "../i18n";
import { isDueInFuture, isDueToday, isDueTomorrow, isOverdue } from "../scheduler";
import type { Settings, Task } from "../types";

type MainSortId = "due" | "created" | "manual";
type DueFilterId = "all" | "overdue" | "today" | "tomorrow" | "future";
type ImportanceFilterId = "all" | "important" | "normal";
type RepeatFilterId = "all" | "repeat" | "none";
type ReminderFilterId = "all" | "remind" | "none" | "forced" | "normal";
type ListTabId = "all" | "overdue" | "today" | "tomorrow" | "future" | "completed";

export function MainView({
  tasks,
  settings,
  normalTasks,
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
  const { t } = useI18n();
  const [mainView, setMainView] = useState<"quadrant" | "list">("list");
  const [listTab, setListTab] = useState<ListTabId>("today");

  const [dueFilter, setDueFilter] = useState<DueFilterId>("all");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilterId>("all");
  const [repeatFilter, setRepeatFilter] = useState<RepeatFilterId>("all");
  const [reminderFilter, setReminderFilter] = useState<ReminderFilterId>("all");
  const [mainSort, setMainSort] = useState<MainSortId>("due");

  const mainSortOptions = useMemo(
    () => [
      { id: "due", label: t("sort.due") },
      { id: "created", label: t("sort.created") },
      { id: "manual", label: t("sort.manual") },
    ],
    [t],
  );

  const dueFilterOptions = useMemo(
    () => [
      { id: "all", label: t("filter.all") },
      { id: "overdue", label: t("filter.overdue") },
      { id: "today", label: t("filter.today") },
      { id: "tomorrow", label: t("filter.tomorrow") },
      { id: "future", label: t("filter.future") },
    ],
    [t],
  );

  const importanceFilterOptions = useMemo(
    () => [
      { id: "all", label: t("filter.all") },
      { id: "important", label: t("filter.important") },
      { id: "normal", label: t("filter.normal") },
    ],
    [t],
  );

  const repeatFilterOptions = useMemo(
    () => [
      { id: "all", label: t("filter.all") },
      { id: "repeat", label: t("filter.repeat") },
      { id: "none", label: t("filter.noRepeat") },
    ],
    [t],
  );

  const reminderFilterOptions = useMemo(
    () => [
      { id: "all", label: t("filter.all") },
      { id: "remind", label: t("filter.remindAny") },
      { id: "none", label: t("filter.remindNone") },
      { id: "forced", label: t("filter.remindForced") },
      { id: "normal", label: t("filter.remindNormal") },
    ],
    [t],
  );

  const quadrants = useMemo(
    () => [
      { id: 1, title: t("quadrant.q1.title"), sublabel: t("quadrant.q1.sublabel"), className: "quadrant-red" },
      { id: 2, title: t("quadrant.q2.title"), sublabel: t("quadrant.q2.sublabel"), className: "quadrant-amber" },
      { id: 3, title: t("quadrant.q3.title"), sublabel: t("quadrant.q3.sublabel"), className: "quadrant-blue" },
      { id: 4, title: t("quadrant.q4.title"), sublabel: t("quadrant.q4.sublabel"), className: "quadrant-gray" },
    ],
    [t],
  );

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
      { id: "all", label: t("main.tab.all"), tasks: all },
      { id: "overdue", label: t("main.tab.overdue"), tasks: overdue },
      { id: "today", label: t("main.tab.today"), tasks: today },
      { id: "tomorrow", label: t("main.tab.tomorrow"), tasks: tomorrow },
      { id: "future", label: t("main.tab.future"), tasks: future },
      { id: "completed", label: t("main.tab.completed"), tasks: completed },
    ];
  }, [sortedTasks, t]);

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
      // Best-effort: if the platform disallows the requested action, keep the window usable.
    }
  }

  return (
    <div className="main-window">
      <WindowTitlebar
        variant="main"
        title={t("app.name")}
        onMinimize={handleMinimize}
        right={
          <div className="main-titlebar-actions">
            <div className="segment" role="tablist" aria-label={t("main.view.label")}>
              <button
                type="button"
                className={`segment-btn ${mainView === "list" ? "active" : ""}`}
                onClick={() => setMainView("list")}
                aria-selected={mainView === "list"}
              >
                {t("main.view.list")}
              </button>
              <button
                type="button"
                className={`segment-btn ${mainView === "quadrant" ? "active" : ""}`}
                onClick={() => setMainView("quadrant")}
                aria-selected={mainView === "quadrant"}
              >
                {t("main.view.quadrant")}
              </button>
            </div>
            <IconButton
              className="icon-btn"
              onClick={() => {
                window.location.hash = "#/main/settings";
              }}
              title={t("main.settings")}
              label={t("main.settings")}
            >
              <Icons.Settings />
            </IconButton>
          </div>
        }
      />

      <div className="main-content">
        <NotificationBanner tasks={normalTasks} onSnooze={onNormalSnooze} onComplete={onNormalComplete} />

        <div className="main-filters">
          <div className="filter-group">
            <Icons.Filter />
            <select value={dueFilter} onChange={(event) => setDueFilter(event.currentTarget.value as DueFilterId)}>
              {dueFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={importanceFilter}
              onChange={(event) => setImportanceFilter(event.currentTarget.value as ImportanceFilterId)}
            >
              {importanceFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select value={repeatFilter} onChange={(event) => setRepeatFilter(event.currentTarget.value as RepeatFilterId)}>
              {repeatFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={reminderFilter}
              onChange={(event) => setReminderFilter(event.currentTarget.value as ReminderFilterId)}
            >
              {reminderFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <Icons.Sort />
            <select value={mainSort} onChange={(event) => setMainSort(event.currentTarget.value as MainSortId)}>
              {mainSortOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mainView === "quadrant" && (
          <div className="quadrant-grid">
            {quadrants.map((quad) => (
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
                    <div className="quadrant-empty">{t("common.emptyTasks")}</div>
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
            <div className="list-tabs" role="tablist" aria-label={t("main.listTabs")}>
              {listSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`list-tab ${listTab === section.id ? "active" : ""}`}
                  onClick={() => setListTab(section.id as ListTabId)}
                  aria-selected={listTab === section.id}
                >
                  <span>{section.label}</span>
                  <span className="list-tab-count">{section.tasks.length}</span>
                </button>
              ))}
            </div>

            <div className="list-panel" role="tabpanel">
              {activeListSection.tasks.length === 0 ? (
                <div className="list-empty">{t("common.emptyTasks")}</div>
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

      </div>

      <div className="main-input-bar">
        <TaskComposer onSubmit={onCreateFromComposer} />
      </div>
    </div>
  );
}
