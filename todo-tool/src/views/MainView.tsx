import { useEffect, useMemo, useState, type DragEvent } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { swapSortOrder } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NotificationBanner } from "../components/NotificationBanner";
import { IconButton } from "../components/IconButton";
import { TaskCard } from "../components/TaskCard";
import {
  TaskComposer,
  type TaskComposerDraft,
} from "../components/TaskComposer";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { useI18n } from "../i18n";
import {
  computeRescheduleDueAt,
  rescheduleTask,
  type ReschedulePresetId,
} from "../reschedule";
import {
  isDueInFuture,
  isDueToday,
  isDueTomorrow,
  isOverdue,
} from "../scheduler";
import { taskMatchesQuery } from "../search";
import type { Settings, Task } from "../types";

type MainSortId = "due" | "created" | "manual";
type DueFilterId = "all" | "overdue" | "today" | "tomorrow" | "future";
type ImportanceFilterId = "all" | "important" | "normal";
type RepeatFilterId = "all" | "repeat" | "none";
type ReminderFilterId = "all" | "remind" | "none" | "forced" | "normal";
type ListTabId =
  | "all"
  | "overdue"
  | "today"
  | "tomorrow"
  | "future"
  | "completed";

export function MainView({
  tasks,
  settings,
  normalTasks,
  onUpdateTask,
  onBulkUpdate,
  onBulkComplete,
  onBulkDelete,
  onRefreshState,
  onCreateFromComposer,
  onToggleComplete,
  onToggleImportant,
  onRequestDelete,
  onEditTask,
  onOpenSettings,
  onOpenToday,
  onOpenCalendar,
  onNormalSnooze,
  onNormalComplete,
}: {
  tasks: Task[];
  settings: Settings | null;
  normalTasks: Task[];
  onUpdateTask: (next: Task) => Promise<void> | void;
  onBulkUpdate: (next: Task[]) => Promise<boolean>;
  onBulkComplete: (taskIds: string[]) => Promise<boolean>;
  onBulkDelete: (taskIds: string[]) => Promise<boolean>;
  onRefreshState: () => Promise<void>;
  onCreateFromComposer: (draft: TaskComposerDraft) => Promise<void> | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onOpenSettings: () => void;
  onOpenToday: () => void;
  onOpenCalendar: () => void;
  onNormalSnooze: (task: Task) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [mainView, setMainView] = useState<"quadrant" | "list">("list");
  const [listTab, setListTab] = useState<ListTabId>("today");

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmBulkComplete, setConfirmBulkComplete] = useState(false);

  const [dueFilter, setDueFilter] = useState<DueFilterId>("all");
  const [importanceFilter, setImportanceFilter] =
    useState<ImportanceFilterId>("all");
  const [repeatFilter, setRepeatFilter] = useState<RepeatFilterId>("all");
  const [reminderFilter, setReminderFilter] = useState<ReminderFilterId>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [mainSort, setMainSort] = useState<MainSortId>("due");
  const [searchQuery, setSearchQuery] = useState("");

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

  const tagFilterOptions = useMemo(() => {
    const tags = new Set<string>();
    tasks.forEach((task) => {
      task.tags.forEach((tag) => {
        if (tag) tags.add(tag);
      });
    });

    const list = Array.from(tags).sort((a, b) => a.localeCompare(b));
    return [
      { id: "all", label: t("filter.tagAll") },
      { id: "none", label: t("filter.tagNone") },
      ...list.map((tag) => ({ id: tag, label: `#${tag}` })),
    ];
  }, [tasks, t]);

  const quadrants = useMemo(
    () => [
      {
        id: 1,
        title: t("quadrant.q1.title"),
        sublabel: t("quadrant.q1.sublabel"),
        className: "quadrant-red",
      },
      {
        id: 2,
        title: t("quadrant.q2.title"),
        sublabel: t("quadrant.q2.sublabel"),
        className: "quadrant-amber",
      },
      {
        id: 3,
        title: t("quadrant.q3.title"),
        sublabel: t("quadrant.q3.sublabel"),
        className: "quadrant-blue",
      },
      {
        id: 4,
        title: t("quadrant.q4.title"),
        sublabel: t("quadrant.q4.sublabel"),
        className: "quadrant-gray",
      },
    ],
    [t],
  );

  const filteredTasks = useMemo(() => {
    const now = new Date();
    return tasks.filter((task) => {
      if (
        dueFilter === "overdue" &&
        !isOverdue(task, Math.floor(now.getTime() / 1000))
      )
        return false;
      if (dueFilter === "today" && !isDueToday(task, now)) return false;
      if (dueFilter === "tomorrow" && !isDueTomorrow(task, now)) return false;
      if (dueFilter === "future" && !isDueInFuture(task, now)) return false;

      if (importanceFilter === "important" && !task.important) return false;
      if (importanceFilter === "normal" && task.important) return false;

      if (repeatFilter === "repeat" && task.repeat.type === "none")
        return false;
      if (repeatFilter === "none" && task.repeat.type !== "none") return false;

      if (reminderFilter === "remind" && task.reminder.kind === "none")
        return false;
      if (reminderFilter === "none" && task.reminder.kind !== "none")
        return false;
      if (reminderFilter === "forced" && task.reminder.kind !== "forced")
        return false;
      if (reminderFilter === "normal" && task.reminder.kind !== "normal")
        return false;

      if (tagFilter === "none" && task.tags.length > 0) return false;
      if (
        tagFilter !== "all" &&
        tagFilter !== "none" &&
        !task.tags.includes(tagFilter)
      )
        return false;

      if (!taskMatchesQuery(task, searchQuery)) return false;

      return true;
    });
  }, [
    tasks,
    dueFilter,
    importanceFilter,
    repeatFilter,
    reminderFilter,
    tagFilter,
    searchQuery,
  ]);

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
    const allOpen: Task[] = [];
    const allDone: Task[] = [];
    const overdue: Task[] = [];
    const todayOpen: Task[] = [];
    const todayDone: Task[] = [];
    const tomorrowOpen: Task[] = [];
    const tomorrowDone: Task[] = [];
    const futureOpen: Task[] = [];
    const futureDone: Task[] = [];
    const completed: Task[] = [];

    sortedTasks.forEach((task) => {
      if (task.completed) {
        allDone.push(task);
        completed.push(task);
      } else {
        allOpen.push(task);
      }
      if (isOverdue(task, Math.floor(now.getTime() / 1000))) {
        overdue.push(task);
      } else if (isDueToday(task, now)) {
        (task.completed ? todayDone : todayOpen).push(task);
      } else if (isDueTomorrow(task, now)) {
        (task.completed ? tomorrowDone : tomorrowOpen).push(task);
      } else if (isDueInFuture(task, now)) {
        (task.completed ? futureDone : futureOpen).push(task);
      }
    });

    return [
      { id: "all", label: t("main.tab.all"), tasks: [...allOpen, ...allDone] },
      { id: "overdue", label: t("main.tab.overdue"), tasks: overdue },
      {
        id: "today",
        label: t("main.tab.today"),
        tasks: [...todayOpen, ...todayDone],
      },
      {
        id: "tomorrow",
        label: t("main.tab.tomorrow"),
        tasks: [...tomorrowOpen, ...tomorrowDone],
      },
      {
        id: "future",
        label: t("main.tab.future"),
        tasks: [...futureOpen, ...futureDone],
      },
      { id: "completed", label: t("main.tab.completed"), tasks: completed },
    ];
  }, [sortedTasks, t]);

  const activeListSection = useMemo(() => {
    return (
      listSections.find((section) => section.id === listTab) ??
      listSections[0] ??
      ({ id: listTab, label: "", tasks: [] } as {
        id: string;
        label: string;
        tasks: Task[];
      })
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

  const bulkSelectedSet = useMemo(
    () => new Set(bulkSelectedIds),
    [bulkSelectedIds],
  );
  const bulkSelectedTasks = useMemo(() => {
    if (bulkSelectedIds.length === 0) return [];
    return tasks.filter((task) => bulkSelectedSet.has(task.id));
  }, [tasks, bulkSelectedIds.length, bulkSelectedSet]);
  const bulkSelectedIncomplete = useMemo(
    () => bulkSelectedTasks.filter((task) => !task.completed),
    [bulkSelectedTasks],
  );
  const bulkSelectedIncompleteIds = useMemo(
    () => bulkSelectedIncomplete.map((task) => task.id),
    [bulkSelectedIncomplete],
  );
  const bulkSelectedRepeatCount = useMemo(
    () =>
      bulkSelectedIncomplete.filter((task) => task.repeat.type !== "none")
        .length,
    [bulkSelectedIncomplete],
  );

  const bulkVisibleIds = useMemo(
    () => activeListSection.tasks.map((task) => task.id),
    [activeListSection],
  );

  useEffect(() => {
    // Keep selection stable across state updates (e.g. after persist), but drop ids that no longer exist.
    if (bulkSelectedIds.length === 0) return;
    const known = new Set(tasks.map((task) => task.id));
    setBulkSelectedIds((prev) => prev.filter((id) => known.has(id)));
  }, [tasks, bulkSelectedIds.length]);

  function toggleBulkSelected(taskId: string) {
    setBulkSelectedIds((prev) => {
      if (prev.includes(taskId)) return prev.filter((id) => id !== taskId);
      return [...prev, taskId];
    });
  }

  function clearBulkSelection() {
    setBulkSelectedIds([]);
  }

  function selectAllVisible() {
    setBulkSelectedIds(bulkVisibleIds);
  }

  async function handleBulkReschedule(preset: ReschedulePresetId) {
    if (bulkBusy) return;
    if (bulkSelectedIncomplete.length === 0) return;

    setBulkBusy(true);
    try {
      const now = new Date();
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const nextTasks = bulkSelectedIncomplete.map((task) => {
        const nextDueAt = computeRescheduleDueAt(task, preset, now);
        return rescheduleTask(task, nextDueAt, nowSeconds);
      });
      const ok = await onBulkUpdate(nextTasks);
      if (ok) clearBulkSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleConfirmBulkDelete() {
    if (bulkBusy) return;
    if (bulkSelectedIds.length === 0) return;

    setBulkBusy(true);
    try {
      const ok = await onBulkDelete(bulkSelectedIds);
      if (ok) {
        setConfirmBulkDelete(false);
        clearBulkSelection();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleConfirmBulkComplete() {
    if (bulkBusy) return;
    if (bulkSelectedIncompleteIds.length === 0) return;

    setBulkBusy(true);
    try {
      const ok = await onBulkComplete(bulkSelectedIncompleteIds);
      if (ok) {
        setConfirmBulkComplete(false);
        clearBulkSelection();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleMoveTask(
    task: Task,
    direction: "up" | "down",
    list: Task[],
  ) {
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

  async function handleReschedule(task: Task, preset: ReschedulePresetId) {
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const nextDueAt = computeRescheduleDueAt(task, preset, now);
    await onUpdateTask(rescheduleTask(task, nextDueAt, nowSeconds));
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

  const MAIN_VIEW_TAB_LIST = "main-view-tab-list";
  const MAIN_VIEW_TAB_QUADRANT = "main-view-tab-quadrant";
  const MAIN_VIEW_PANEL_LIST = "main-view-panel-list";
  const MAIN_VIEW_PANEL_QUADRANT = "main-view-panel-quadrant";
  const LIST_PANEL_ID = "main-list-panel";

  const focusElement = (id: string) => {
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id) as HTMLElement | null;
      el?.focus();
    });
  };

  const switchToList = () => {
    setMainView("list");
  };

  const switchToQuadrant = () => {
    // Bulk operations are list-only; switching views exits bulk mode.
    setBulkMode(false);
    clearBulkSelection();
    setConfirmBulkDelete(false);
    setConfirmBulkComplete(false);
    setMainView("quadrant");
  };

  return (
    <div className="main-window">
      <WindowTitlebar
        variant="main"
        title={t("app.name")}
        onMinimize={handleMinimize}
        right={
          <div className="main-titlebar-actions">
            <div
              className="segment"
              role="tablist"
              aria-label={t("main.view.label")}
            >
              <button
                id={MAIN_VIEW_TAB_LIST}
                type="button"
                role="tab"
                className={`segment-btn ${mainView === "list" ? "active" : ""}`}
                onClick={switchToList}
                aria-selected={mainView === "list"}
                aria-controls={MAIN_VIEW_PANEL_LIST}
                tabIndex={mainView === "list" ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  switchToQuadrant();
                  focusElement(MAIN_VIEW_TAB_QUADRANT);
                }}
              >
                {t("main.view.list")}
              </button>
              <button
                id={MAIN_VIEW_TAB_QUADRANT}
                type="button"
                role="tab"
                className={`segment-btn ${mainView === "quadrant" ? "active" : ""}`}
                onClick={switchToQuadrant}
                aria-selected={mainView === "quadrant"}
                aria-controls={MAIN_VIEW_PANEL_QUADRANT}
                tabIndex={mainView === "quadrant" ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  switchToList();
                  focusElement(MAIN_VIEW_TAB_LIST);
                }}
              >
                {t("main.view.quadrant")}
              </button>
            </div>
            <IconButton
              className="icon-btn"
              onClick={() => {
                onOpenToday();
              }}
              title={t("today.title")}
              label={t("today.title")}
            >
              <Icons.Clock />
            </IconButton>
            <IconButton
              className="icon-btn"
              onClick={() => {
                onOpenCalendar();
              }}
              title={t("calendar.title")}
              label={t("calendar.title")}
            >
              <Icons.Calendar />
            </IconButton>
            <IconButton
              className="icon-btn"
              onClick={() => {
                onOpenSettings();
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
        <NotificationBanner
          tasks={normalTasks}
          onSnooze={onNormalSnooze}
          onComplete={onNormalComplete}
        />

        <div className="main-filters">
          <div className="filter-group">
            <Icons.Filter />
            <select
              value={dueFilter}
              onChange={(event) =>
                setDueFilter(event.currentTarget.value as DueFilterId)
              }
            >
              {dueFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={importanceFilter}
              onChange={(event) =>
                setImportanceFilter(
                  event.currentTarget.value as ImportanceFilterId,
                )
              }
            >
              {importanceFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={repeatFilter}
              onChange={(event) =>
                setRepeatFilter(event.currentTarget.value as RepeatFilterId)
              }
            >
              {repeatFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={reminderFilter}
              onChange={(event) =>
                setReminderFilter(event.currentTarget.value as ReminderFilterId)
              }
            >
              {reminderFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.currentTarget.value)}
            >
              {tagFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <Icons.Sort />
            <select
              value={mainSort}
              onChange={(event) =>
                setMainSort(event.currentTarget.value as MainSortId)
              }
            >
              {mainSortOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group search">
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
          {mainView === "list" && (
            <div className="filter-group">
              <button
                type="button"
                className={`pill ${bulkMode ? "active" : ""}`}
                onClick={() => {
                  setBulkMode((prev) => {
                    const next = !prev;
                    if (!next) {
                      clearBulkSelection();
                      setConfirmBulkDelete(false);
                      setConfirmBulkComplete(false);
                    }
                    return next;
                  });
                }}
                aria-pressed={bulkMode}
                title={bulkMode ? t("batch.exit") : t("batch.toggle")}
              >
                {bulkMode ? t("batch.exit") : t("batch.toggle")}
              </button>
            </div>
          )}
        </div>

        {mainView === "list" && bulkMode && (
          <div className="batch-bar">
            <span>
              {t("batch.selected", { count: bulkSelectedIds.length })}
            </span>
            <button
              type="button"
              className="batch-btn"
              onClick={selectAllVisible}
              disabled={bulkBusy || bulkVisibleIds.length === 0}
              title={t("batch.selectAll")}
            >
              {t("batch.selectAll")}
            </button>
            <button
              type="button"
              className="batch-btn"
              onClick={clearBulkSelection}
              disabled={bulkBusy || bulkSelectedIds.length === 0}
              title={t("batch.clear")}
            >
              {t("batch.clear")}
            </button>
            <button
              type="button"
              className="batch-btn"
              onClick={() => setConfirmBulkComplete(true)}
              disabled={bulkBusy || bulkSelectedIncompleteIds.length === 0}
              title={t("batch.complete")}
            >
              {t("batch.complete")}
            </button>
            <button
              type="button"
              className="batch-btn danger"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkBusy || bulkSelectedIds.length === 0}
              title={t("batch.delete")}
            >
              {t("batch.delete")}
            </button>

            <span>{t("batch.reschedule")}</span>
            <button
              type="button"
              className="batch-btn"
              onClick={() => void handleBulkReschedule("plus10m")}
              disabled={bulkBusy || bulkSelectedIncompleteIds.length === 0}
            >
              {t("reschedule.plus10m")}
            </button>
            <button
              type="button"
              className="batch-btn"
              onClick={() => void handleBulkReschedule("plus1h")}
              disabled={bulkBusy || bulkSelectedIncompleteIds.length === 0}
            >
              {t("reschedule.plus1h")}
            </button>
            <button
              type="button"
              className="batch-btn"
              onClick={() => void handleBulkReschedule("tomorrow1800")}
              disabled={bulkBusy || bulkSelectedIncompleteIds.length === 0}
            >
              {t("reschedule.tomorrow1800")}
            </button>
            <button
              type="button"
              className="batch-btn"
              onClick={() => void handleBulkReschedule("nextWorkday0900")}
              disabled={bulkBusy || bulkSelectedIncompleteIds.length === 0}
            >
              {t("reschedule.nextWorkday0900")}
            </button>
          </div>
        )}

        {mainView === "quadrant" && (
          <div
            id={MAIN_VIEW_PANEL_QUADRANT}
            role="tabpanel"
            aria-labelledby={MAIN_VIEW_TAB_QUADRANT}
            className="quadrant-grid"
          >
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
                      {quad.sublabel} {quadrantCounts[quad.id].completed}/
                      {quadrantCounts[quad.id].total}
                    </span>
                  </div>
                </div>

                <div className="quadrant-list">
                  {tasksByQuadrant[quad.id].length === 0 ? (
                    <div className="quadrant-empty">
                      {t("common.emptyTasks")}
                    </div>
                  ) : (
                    tasksByQuadrant[quad.id].map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        mode="main"
                        showMove={mainSort === "manual"}
                        draggable
                        onDragStart={(event) => handleDragStart(task, event)}
                        onMoveUp={() =>
                          void handleMoveTask(
                            task,
                            "up",
                            tasksByQuadrant[quad.id],
                          )
                        }
                        onMoveDown={() =>
                          void handleMoveTask(
                            task,
                            "down",
                            tasksByQuadrant[quad.id],
                          )
                        }
                        onToggleComplete={() => onToggleComplete(task)}
                        onToggleImportant={() => onToggleImportant(task)}
                        onReschedulePreset={(preset) =>
                          void handleReschedule(task, preset)
                        }
                        onUpdateTask={onUpdateTask}
                        showNotesPreview
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
          <div
            id={MAIN_VIEW_PANEL_LIST}
            role="tabpanel"
            aria-labelledby={MAIN_VIEW_TAB_LIST}
            className="list-view"
          >
            <div
              className="list-tabs"
              role="tablist"
              aria-label={t("main.listTabs")}
            >
              {listSections.map((section, index) => {
                const selected = listTab === section.id;
                const tabId = `main-list-tab-${section.id}`;
                return (
                  <button
                    key={section.id}
                    id={tabId}
                    type="button"
                    role="tab"
                    className={`list-tab ${selected ? "active" : ""}`}
                    onClick={() => setListTab(section.id as ListTabId)}
                    aria-selected={selected}
                    aria-controls={LIST_PANEL_ID}
                    tabIndex={selected ? 0 : -1}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ArrowLeft" &&
                        event.key !== "ArrowRight"
                      )
                        return;
                      event.preventDefault();
                      if (listSections.length === 0) return;
                      const dir = event.key === "ArrowLeft" ? -1 : 1;
                      const nextIndex =
                        (index + dir + listSections.length) %
                        listSections.length;
                      const next = listSections[nextIndex];
                      setListTab(next.id as ListTabId);
                      focusElement(`main-list-tab-${next.id}`);
                    }}
                  >
                    <span>{section.label}</span>
                    <span className="list-tab-count">
                      {section.tasks.length}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className="list-panel"
              id={LIST_PANEL_ID}
              role="tabpanel"
              aria-labelledby={`main-list-tab-${listTab}`}
            >
              {activeListSection.tasks.length === 0 ? (
                <div className="list-empty">{t("common.emptyTasks")}</div>
              ) : (
                activeListSection.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    mode="main"
                    selectable={bulkMode}
                    selected={bulkSelectedSet.has(task.id)}
                    onToggleSelected={() => toggleBulkSelected(task.id)}
                    showMove={mainSort === "manual"}
                    draggable={!bulkMode}
                    onDragStart={(event) => handleDragStart(task, event)}
                    onMoveUp={() =>
                      void handleMoveTask(task, "up", activeListSection.tasks)
                    }
                    onMoveDown={() =>
                      void handleMoveTask(task, "down", activeListSection.tasks)
                    }
                    onToggleComplete={() => onToggleComplete(task)}
                    onToggleImportant={() => onToggleImportant(task)}
                    onReschedulePreset={(preset) =>
                      void handleReschedule(task, preset)
                    }
                    onUpdateTask={onUpdateTask}
                    showNotesPreview
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

      <ConfirmDialog
        open={confirmBulkComplete && bulkSelectedIncompleteIds.length > 0}
        title={t("batch.confirmComplete.title", {
          count: bulkSelectedIncompleteIds.length,
        })}
        description={
          bulkSelectedRepeatCount > 0
            ? t("batch.confirmComplete.descriptionWithRepeat", {
                repeat: bulkSelectedRepeatCount,
              })
            : t("batch.confirmComplete.description")
        }
        confirmText={bulkBusy ? t("common.saving") : t("batch.complete")}
        cancelText={t("common.cancel")}
        busy={bulkBusy}
        onConfirm={() => void handleConfirmBulkComplete()}
        onCancel={() => {
          if (bulkBusy) return;
          setConfirmBulkComplete(false);
        }}
      />

      <ConfirmDialog
        open={confirmBulkDelete && bulkSelectedIds.length > 0}
        title={t("batch.confirmDelete.title", {
          count: bulkSelectedIds.length,
        })}
        description={t("batch.confirmDelete.description")}
        confirmText={bulkBusy ? t("common.deleting") : t("batch.delete")}
        cancelText={t("common.cancel")}
        tone="danger"
        busy={bulkBusy}
        onConfirm={() => void handleConfirmBulkDelete()}
        onCancel={() => {
          if (bulkBusy) return;
          setConfirmBulkDelete(false);
        }}
      />
    </div>
  );
}
