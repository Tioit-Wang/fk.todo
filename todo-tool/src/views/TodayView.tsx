import { useEffect, useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { formatDue, formatLocalDateKey } from "../date";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { useI18n } from "../i18n";
import { taskMatchesQuery } from "../search";
import type { Settings, Task } from "../types";

// TodayView is intentionally single-purpose: pick today's focus tasks.
export function TodayView({
  tasks,
  settings,
  onUpdateSettings,
  onBack,
}: {
  tasks: Task[];
  settings: Settings | null;
  onUpdateSettings: (next: Settings) => Promise<boolean>;
  onBack: () => void;
}) {
  const { t } = useI18n();

  const todayKey = formatLocalDateKey(new Date());

  const persistedFocusIds = useMemo(() => {
    if (!settings) return [];
    if (settings.today_focus_date !== todayKey) return [];
    return settings.today_focus_ids ?? [];
  }, [settings, todayKey]);

  const [draftFocusIds, setDraftFocusIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [focusSearch, setFocusSearch] = useState("");
  const [focusHint, setFocusHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep draft in sync with persisted value, unless the user started editing.
  useEffect(() => {
    if (!settings) return;
    if (dirty) return;
    setDraftFocusIds(persistedFocusIds.slice(0, 3));
  }, [settings, persistedFocusIds, dirty]);

  // Drop invalid focus ids (task deleted or completed) from the draft.
  useEffect(() => {
    if (draftFocusIds.length === 0) return;
    const allowed = new Set(tasks.filter((task) => !task.completed).map((task) => task.id));
    setDraftFocusIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [tasks, draftFocusIds.length]);

  const focusCandidates = useMemo(() => {
    const list = tasks
      .filter((task) => !task.completed)
      .slice()
      .sort((a, b) => a.due_at - b.due_at || a.created_at - b.created_at);
    return list.filter((task) => taskMatchesQuery(task, focusSearch));
  }, [tasks, focusSearch]);

  function toggleDraftFocus(taskId: string) {
    setDirty(true);
    setDraftFocusIds((prev) => {
      if (prev.includes(taskId)) {
        setFocusHint(null);
        return prev.filter((id) => id !== taskId);
      }
      if (prev.length >= 3) {
        setFocusHint(t("today.focus.limit"));
        return prev;
      }
      setFocusHint(null);
      return [...prev, taskId];
    });
  }

  async function handleSaveFocus() {
    if (!settings) return;
    if (saving) return;
    setSaving(true);
    try {
      const nextIds = draftFocusIds.slice(0, 3);
      await onUpdateSettings({
        ...settings,
        today_focus_date: todayKey,
        today_focus_ids: nextIds,
        today_prompted_date: todayKey,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
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
        title={t("today.title")}
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
        <div className="today-toolbar">
          <div className="today-toolbar-left">
            <div className="today-toolbar-title">{t("today.section.focus")}</div>
            <div className="today-toolbar-subtitle">{t("today.focus.count", { count: draftFocusIds.length })}</div>
          </div>
          <div className="today-toolbar-actions">
            <button
              type="button"
              className="pill active"
              onClick={() => void handleSaveFocus()}
              disabled={!settings || saving}
            >
              {saving ? t("common.saving") : t("today.focus.save")}
            </button>
          </div>
        </div>

        <div className="focus-picker">
          <div className="focus-picker-row">
            <Icons.Search />
            <input
              className="search-input"
              value={focusSearch}
              onChange={(event) => {
                setFocusSearch(event.currentTarget.value);
                setDirty(true);
              }}
              placeholder={t("today.focus.searchPlaceholder")}
            />
            <button
              type="button"
              className="pill"
              onClick={() => {
                setFocusSearch("");
                setDirty(true);
              }}
              disabled={!focusSearch.trim()}
              title={t("search.clear")}
            >
              {t("search.clear")}
            </button>
          </div>

          <div className="focus-picker-hint">{focusHint ?? t("today.focus.hint")}</div>

          <div className="focus-picker-list">
            {focusCandidates.length === 0 ? (
              <div className="list-empty">{t("common.emptyTasks")}</div>
            ) : (
              focusCandidates.map((task) => {
                const selected = draftFocusIds.includes(task.id);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`focus-picker-item ${selected ? "selected" : ""}`}
                    onClick={() => toggleDraftFocus(task.id)}
                    aria-pressed={selected}
                  >
                    <span className="focus-picker-check" aria-hidden="true">
                      {selected && <Icons.Check />}
                    </span>
                    <span className="focus-picker-item-body">
                      <span className="focus-picker-item-title">{task.title}</span>
                      <span className="focus-picker-item-meta">
                        <Icons.Clock />
                        {formatDue(task.due_at)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

