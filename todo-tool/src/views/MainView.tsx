import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

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
import { describeError, frontendLog } from "../frontendLog";
import { useI18n } from "../i18n";
import {
  computeRescheduleDueAt,
  rescheduleTask,
  type ReschedulePresetId,
} from "../reschedule";
import type { SnoozePresetId } from "../snooze";
import type { Project, Settings, Task } from "../types";
import {
  buildCompletionSections,
  cycleMainSort,
  filterTasksByQuery,
  filterTasksByScope,
  findManualReorderTargetIndex,
  sortTasksWithPinnedImportant,
  type ListTabId,
  type MainScope,
  type MainSortId,
} from "./mainViewModel";

export function MainView({
  tasks,
  projects,
  settings,
  normalTasks,
  onUpdateTask,
  onUpdateProject,
  onDeleteProject,
  onBulkUpdate,
  onBulkComplete,
  onBulkDelete,
  onRefreshState,
  onCreateFromComposer,
  onCreateProject,
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
  projects: Project[];
  settings: Settings | null;
  normalTasks: Task[];
  onUpdateTask: (next: Task) => Promise<void> | void;
  onUpdateProject: (next: Project) => Promise<void> | void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  onBulkUpdate: (next: Task[]) => Promise<boolean>;
  onBulkComplete: (taskIds: string[]) => Promise<boolean>;
  onBulkDelete: (taskIds: string[]) => Promise<boolean>;
  onRefreshState: () => Promise<void>;
  onCreateFromComposer: (
    draft: TaskComposerDraft,
  ) => Promise<boolean | void> | boolean | void;
  onCreateProject: (name: string) => Promise<void> | void;
  onToggleComplete: (task: Task) => Promise<void> | void;
  onToggleImportant: (task: Task) => Promise<void> | void;
  onRequestDelete: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onOpenSettings: () => void;
  onOpenToday: () => void;
  onOpenCalendar: () => void;
  onNormalSnooze: (task: Task, preset: SnoozePresetId) => Promise<void> | void;
  onNormalComplete: (task: Task) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [mainView, setMainView] = useState<"quadrant" | "list">("list");
  const [listTab, setListTab] = useState<ListTabId>("open");

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmBulkComplete, setConfirmBulkComplete] = useState(false);

  const [mainSort, setMainSort] = useState<MainSortId>("due");
  const [searchQuery, setSearchQuery] = useState("");

  const [sidebarSelection, setSidebarSelection] = useState<
    "today" | "important" | "project"
  >("today");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("inbox");

  const [projectDraftOpen, setProjectDraftOpen] = useState(false);
  const [projectDraftName, setProjectDraftName] = useState("");
  const [projectDraftBusy, setProjectDraftBusy] = useState(false);
  const projectDraftRef = useRef<HTMLInputElement | null>(null);

  const [projectMenu, setProjectMenu] = useState<{
    projectId: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<
    string | null
  >(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(
    null,
  );
  const [renameDraftName, setRenameDraftName] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const renameProjectRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!projectDraftOpen) return;
    window.requestAnimationFrame(() => {
      projectDraftRef.current?.focus();
      projectDraftRef.current?.select();
    });
  }, [projectDraftOpen]);

  useEffect(() => {
    if (!renamingProjectId) return;
    window.requestAnimationFrame(() => {
      renameProjectRef.current?.focus();
      renameProjectRef.current?.select();
    });
  }, [renamingProjectId]);

  useEffect(() => {
    if (!projectMenu) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setProjectMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projectMenu]);

  useEffect(() => {
    if (sidebarSelection !== "project") return;
    if (projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId("inbox");
  }, [projects, sidebarSelection, selectedProjectId]);

  const orderedProjects = useMemo(() => {
    const list = [...projects];
    list.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [projects]);

  const projectsById = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project]));
  }, [projects]);

  async function handleToggleProjectPin(project: Project) {
    if (projectBusy) return;
    if (project.id === "inbox") return;
    setProjectBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      await Promise.resolve(
        onUpdateProject({
          ...project,
          pinned: !project.pinned,
          updated_at: now,
        }),
      );
    } finally {
      setProjectBusy(false);
    }
  }

  async function handleRenameProject(project: Project) {
    if (projectBusy) return;
    if (project.id === "inbox") return;
    const trimmed = renameDraftName.trim();
    if (!trimmed) return;
    if (trimmed === project.name) {
      setRenamingProjectId(null);
      setRenameDraftName("");
      return;
    }

    setProjectBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      await Promise.resolve(
        onUpdateProject({ ...project, name: trimmed, updated_at: now }),
      );
      setRenamingProjectId(null);
      setRenameDraftName("");
    } finally {
      setProjectBusy(false);
    }
  }

  async function handleConfirmDeleteProject() {
    const projectId = confirmDeleteProjectId;
    if (!projectId) return;
    if (projectBusy) return;
    if (projectId === "inbox") return;

    setProjectBusy(true);
    try {
      await Promise.resolve(onDeleteProject(projectId));
      setConfirmDeleteProjectId(null);
    } finally {
      setProjectBusy(false);
    }
  }

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

  const scope = useMemo<MainScope>(() => {
    if (sidebarSelection === "today") return { kind: "today" };
    if (sidebarSelection === "important") return { kind: "important" };
    return { kind: "project", projectId: selectedProjectId };
  }, [sidebarSelection, selectedProjectId]);

  const scopedTasks = useMemo(() => {
    const now = new Date();
    const base = filterTasksByScope(tasks, scope, now);
    const searched = filterTasksByQuery(base, searchQuery);
    return sortTasksWithPinnedImportant(searched, mainSort);
  }, [tasks, scope, searchQuery, mainSort]);

  const completionSections = useMemo(
    () => buildCompletionSections(scopedTasks),
    [scopedTasks],
  );

  const listSections = useMemo(
    () => [
      {
        id: "all" as const,
        label: t("main.tab.all"),
        tasks: completionSections.all,
      },
      {
        id: "open" as const,
        label: t("main.tab.open"),
        tasks: completionSections.open,
      },
      {
        id: "done" as const,
        label: t("main.tab.completed"),
        tasks: completionSections.done,
      },
    ],
    [completionSections, t],
  );

  const openScopedTasks = useMemo(
    () => scopedTasks.filter((task) => !task.completed),
    [scopedTasks],
  );

  const tasksByQuadrant = useMemo(() => {
    const map: Record<number, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
    openScopedTasks.forEach((task) => {
      map[task.quadrant]?.push(task);
    });
    return map;
  }, [openScopedTasks]);

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
    scopedTasks.forEach((task) => {
      const entry = counts[task.quadrant];
      if (!entry) return;
      entry.total += 1;
      if (task.completed) entry.completed += 1;
    });
    return counts;
  }, [scopedTasks]);

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
    const targetIndex = findManualReorderTargetIndex(list, task.id, direction);
    if (targetIndex === null) return;
    const target = list[targetIndex];
    const result = await swapSortOrder(task.id, target.id);
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
    } catch (err) {
      // Best-effort fallback: if hide/minimize fails (platform quirks), try minimize so the
      // user still gets a visible response to clicking the control.
      console.warn("main window minimize/hide failed", err);
      void frontendLog("warn", "main window minimize/hide failed", {
        behavior,
        err: describeError(err),
      });
      void appWindow.minimize().catch(() => {});
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

        <div className="main-split">
          <aside className="main-sidebar" aria-label={t("nav.sidebar")}>
            <div className="sidebar-section">
              <button
                type="button"
                className={`sidebar-item ${sidebarSelection === "today" ? "active" : ""}`}
                onClick={() => {
                  setSidebarSelection("today");
                  setListTab("open");
                  setMainView("list");
                }}
              >
                <Icons.Calendar />
                <span>{t("nav.today")}</span>
              </button>

              <button
                type="button"
                className={`sidebar-item ${sidebarSelection === "important" ? "active" : ""}`}
                onClick={() => {
                  setSidebarSelection("important");
                  setListTab("open");
                  setMainView("list");
                }}
              >
                <Icons.Star />
                <span>{t("nav.important")}</span>
              </button>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">{t("nav.projects")}</div>
                <IconButton
                  className="icon-btn"
                  onClick={() => {
                    setProjectDraftName("");
                    setProjectDraftOpen(true);
                  }}
                  title={t("nav.projects.add")}
                  label={t("nav.projects.add")}
                >
                  <Icons.Plus />
                </IconButton>
              </div>

              {projectDraftOpen && (
                <div className="sidebar-project-draft">
                  <input
                    ref={projectDraftRef}
                    className="sidebar-project-input"
                    value={projectDraftName}
                    onChange={(event) =>
                      setProjectDraftName(event.currentTarget.value)
                    }
                    placeholder={t("nav.projects.placeholder")}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setProjectDraftOpen(false);
                        setProjectDraftName("");
                        return;
                      }
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      if (projectDraftBusy) return;
                      const name = projectDraftName.trim();
                      if (!name) return;
                      setProjectDraftBusy(true);
                      Promise.resolve(onCreateProject(name))
                        .catch(() => {})
                        .finally(() => {
                          setProjectDraftBusy(false);
                          setProjectDraftOpen(false);
                          setProjectDraftName("");
                        });
                    }}
                  />
                  <button
                    type="button"
                    className="pill active"
                    disabled={projectDraftBusy || !projectDraftName.trim()}
                    onClick={() => {
                      if (projectDraftBusy) return;
                      const name = projectDraftName.trim();
                      if (!name) return;
                      setProjectDraftBusy(true);
                      Promise.resolve(onCreateProject(name))
                        .catch(() => {})
                        .finally(() => {
                          setProjectDraftBusy(false);
                          setProjectDraftOpen(false);
                          setProjectDraftName("");
                        });
                    }}
                  >
                    {projectDraftBusy ? t("common.saving") : t("common.add")}
                  </button>
                </div>
              )}

              <div className="sidebar-project-list">
                {orderedProjects.map((project) => {
                  const active =
                    sidebarSelection === "project" &&
                    project.id === selectedProjectId;
                  const isInbox = project.id === "inbox";
                  const label = isInbox ? t("nav.inbox") : project.name;
                  const renaming = renamingProjectId === project.id && !isInbox;

                  if (renaming) {
                    return (
                      <div
                        key={project.id}
                        className={`sidebar-item ${active ? "active" : ""}`}
                      >
                        <span
                          className="sidebar-project-dot"
                          aria-hidden="true"
                        />
                        <input
                          ref={renameProjectRef}
                          className="sidebar-project-input sidebar-project-rename-input"
                          value={renameDraftName}
                          onChange={(event) =>
                            setRenameDraftName(event.currentTarget.value)
                          }
                          placeholder={t("nav.projects.placeholder")}
                          disabled={projectBusy}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setRenamingProjectId(null);
                              setRenameDraftName("");
                              return;
                            }
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void handleRenameProject(project);
                          }}
                          onBlur={() => {
                            setRenamingProjectId(null);
                            setRenameDraftName("");
                          }}
                        />
                      </div>
                    );
                  }
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`sidebar-item ${active ? "active" : ""}`}
                      onClick={() => {
                        setSidebarSelection("project");
                        setSelectedProjectId(project.id);
                        setListTab("open");
                        setMainView("list");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        // Inbox has no context actions; avoid showing an empty menu.
                        if (project.id === "inbox") {
                          setProjectMenu(null);
                          return;
                        }
                        setProjectMenu({
                          projectId: project.id,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <span
                        className="sidebar-project-dot"
                        aria-hidden="true"
                      />
                      <span className="sidebar-project-name">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="main-pane">
            <div className="main-filters">
              <div className="filter-group search">
                <Icons.Search />
                <input
                  className="search-input"
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.currentTarget.value)
                  }
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
              <div className="filter-group">
                <button
                  type="button"
                  className="pill"
                  onClick={() => setMainSort((prev) => cycleMainSort(prev))}
                  title={t("sort.cycle")}
                >
                  <Icons.Sort />
                  <span>
                    {mainSort === "due"
                      ? t("sort.due")
                      : mainSort === "created"
                        ? t("sort.created")
                        : t("sort.manual")}
                  </span>
                </button>
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
                            onDragStart={(event) =>
                              handleDragStart(task, event)
                            }
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
                          void handleMoveTask(
                            task,
                            "up",
                            activeListSection.tasks,
                          )
                        }
                        onMoveDown={() =>
                          void handleMoveTask(
                            task,
                            "down",
                            activeListSection.tasks,
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
            )}
          </div>
        </div>
      </div>

      <div className="main-input-bar">
        <TaskComposer
          placeholder={settings?.ai_enabled ? t("composer.placeholderAi") : undefined}
          projectId={
            sidebarSelection === "project" ? selectedProjectId : "inbox"
          }
          onSubmit={onCreateFromComposer}
        />
      </div>

      {projectMenu &&
        (() => {
          const project = projectsById.get(projectMenu.projectId);
          if (!project) return null;
          const isInbox = project.id === "inbox";
          const left = Math.min(projectMenu.x, window.innerWidth - 220);
          const top = Math.min(projectMenu.y, window.innerHeight - 180);
          return (
            <div
              className="context-menu-overlay"
              onMouseDown={() => setProjectMenu(null)}
            >
              <div
                className="context-menu"
                style={{ left, top }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {!isInbox && (
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={projectBusy}
                    onClick={() => {
                      setProjectMenu(null);
                      void handleToggleProjectPin(project);
                    }}
                  >
                    <Icons.Pin />
                    <span>
                      {project.pinned
                        ? t("project.menu.unpin")
                        : t("project.menu.pin")}
                    </span>
                  </button>
                )}

                {!isInbox && (
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={projectBusy}
                    onClick={() => {
                      setProjectMenu(null);
                      setRenamingProjectId(project.id);
                      setRenameDraftName(project.name);
                    }}
                  >
                    <Icons.Edit />
                    <span>{t("project.menu.rename")}</span>
                  </button>
                )}

                {!isInbox && (
                  <button
                    type="button"
                    className="context-menu-item danger"
                    disabled={projectBusy}
                    onClick={() => {
                      setProjectMenu(null);
                      setConfirmDeleteProjectId(project.id);
                    }}
                  >
                    <Icons.Trash />
                    <span>{t("common.delete")}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}

      <ConfirmDialog
        open={
          Boolean(confirmDeleteProjectId) &&
          Boolean(
            confirmDeleteProjectId &&
            projectsById.get(confirmDeleteProjectId) &&
            confirmDeleteProjectId !== "inbox",
          )
        }
        title={t("project.confirmDelete.title", {
          name: projectsById.get(confirmDeleteProjectId ?? "")?.name ?? "",
        })}
        description={t("project.confirmDelete.description")}
        confirmText={projectBusy ? t("common.deleting") : t("common.delete")}
        cancelText={t("common.cancel")}
        tone="danger"
        busy={projectBusy}
        onConfirm={() => void handleConfirmDeleteProject()}
        onCancel={() => {
          if (projectBusy) return;
          setConfirmDeleteProjectId(null);
        }}
      />

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
