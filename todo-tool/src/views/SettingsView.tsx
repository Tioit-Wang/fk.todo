import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  createBackup,
  createTask,
  deleteBackup,
  deleteTasks,
  importBackup,
  listBackups,
  restoreBackup,
  type BackupEntry,
} from "../api";
import { useI18n } from "../i18n";
import { buildAiNovelAssistantSampleTasks, taskIsAiNovelAssistantSample } from "../sampleData";
import type { BackupSchedule, MinimizeBehavior, Settings, Task } from "../types";

import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { detectPlatform } from "../platform";

type PermissionStatus = "unknown" | "granted" | "denied";

export function SettingsView({
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
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);
  const [sampleDeleteBusy, setSampleDeleteBusy] = useState(false);

  async function handleBack() {
    if (settings) {
      const nextShortcut = shortcutDraft.trim();
      if (nextShortcut && nextShortcut !== settings.shortcut) {
        const ok = await onUpdateSettings({ ...settings, shortcut: nextShortcut });
        if (!ok) {
          alert(t("settings.shortcutInvalid"));
          return;
        }
      }
    }
    onBack();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void handleBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, shortcutDraft, onUpdateSettings, onBack, t]);

  async function refreshPermissionStatus() {
    try {
      const granted = await isPermissionGranted();
      setPermissionStatus(granted ? "granted" : "denied");
    } catch {
      setPermissionStatus("unknown");
    }
  }

  async function requestNotificationPermission() {
    try {
      const result = await requestPermission();
      setPermissionStatus(result === "granted" ? "granted" : "denied");
    } catch {
      setPermissionStatus("unknown");
    }
  }

  async function openNotificationSettings() {
    const target = detectPlatform();
    if (target === "windows") {
      await openUrl("ms-settings:notifications").catch(() => {});
      return;
    }
    if (target === "macos") {
      await openUrl("x-apple.systempreferences:com.apple.preference.notifications").catch(() => {});
      return;
    }
  }

  async function refreshBackups() {
    const res = await listBackups();
    if (res.ok && res.data) {
      setBackups(res.data);
    }
  }

  async function handleCreateBackup() {
    await createBackup();
    await refreshBackups();
  }

  async function handleRestoreBackup(name: string) {
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    await restoreBackup(name);
  }

  async function handleDeleteBackup(name: string) {
    if (!confirm(t("settings.backup.deleteConfirm", { name }))) return;
    await deleteBackup(name);
    await refreshBackups();
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    await importBackup(importPath.trim());
    setImportPath("");
  }

  async function handleAddAiNovelAssistantSamples() {
    if (!settings) return;
    if (seedBusy) return;
    const samples = buildAiNovelAssistantSampleTasks(new Date());
    const alreadySeeded = tasks.some(taskIsAiNovelAssistantSample);

    const ok = alreadySeeded
      ? confirm(t("settings.samples.confirm.duplicate", { count: samples.length }))
      : confirm(t("settings.samples.confirm.fresh", { count: samples.length }));
    if (!ok) return;

    setSeedBusy(true);
    try {
      // Best-effort backup before polluting the dataset with demo tasks.
      await createBackup().catch(() => {});
      await refreshBackups();

      const errors: string[] = [];
      let created = 0;
      for (const task of samples) {
        const res = await createTask(task);
        if (!res.ok) {
          errors.push(res.error ?? `unknown error: ${task.title}`);
        } else {
          created += 1;
        }
      }

      if (errors.length > 0) {
        const errorLines =
          errors.slice(0, 5).join("\n") + (errors.length > 5 ? "\n..." : "");
        alert(
          t("settings.samples.result.partial", {
            created,
            total: samples.length,
            errors: errorLines,
          }),
        );
      } else {
        alert(t("settings.samples.result.ok", { created }));
      }
    } finally {
      setSeedBusy(false);
    }
  }

  async function handleDeleteAiNovelAssistantSamples() {
    if (sampleDeleteBusy) return;
    const sampleTasks = tasks.filter(taskIsAiNovelAssistantSample);
    if (sampleTasks.length === 0) return;
    const ok = confirm(
      t("settings.samples.deleteConfirm", { count: sampleTasks.length }),
    );
    if (!ok) return;
    setSampleDeleteBusy(true);
    try {
      await deleteTasks(sampleTasks.map((task) => task.id));
    } finally {
      setSampleDeleteBusy(false);
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
    const ok = await onUpdateSettings({ ...settings, shortcut: nextShortcut });
    if (!ok) {
      // Keep the input consistent with persisted settings on failure.
      setShortcutDraft(settings.shortcut);
    }
  }

  // When settings load, sync drafts and refresh side-effecty data (permission, backups).
  useEffect(() => {
    if (!settings) return;
    setShortcutDraft(settings.shortcut);
  }, [settings?.shortcut]);

  // Refresh side-effecty data when the settings page mounts.
  useEffect(() => {
    void refreshPermissionStatus();
    void refreshBackups();
  }, []);

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
        title={t("settings.title")}
        onMinimize={handleMinimize}
        right={
          <button
            type="button"
            className="main-toggle"
            onClick={() => void handleBack()}
            title={t("common.back")}
          >
            <span className="settings-back-icon" aria-hidden="true">
              <Icons.ChevronRight />
            </span>
            {t("common.back")}
          </button>
        }
      />

      <div className="main-content settings-page">
        {!settings ? (
          <div className="settings-empty">{t("common.loading")}</div>
        ) : (
          <div className="settings-panel settings-page-panel">
            <div className="settings-section">
              <div className="settings-row">
                <label>{t("settings.shortcut")}</label>
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
                <label>{t("settings.theme")}</label>
                <select
                  value={settings.theme}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      theme: event.currentTarget.value,
                    })
                  }
                >
                  <option value="light">{t("settings.theme.light")}</option>
                  <option value="dark">{t("settings.theme.dark")}</option>
                </select>
              </div>
              <div className="settings-row">
                <label>{t("settings.language")}</label>
                <select
                  value={settings.language}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      language: event.currentTarget.value as Settings["language"],
                    })
                  }
                >
                  <option value="auto">{t("settings.language.auto")}</option>
                  <option value="zh">{t("settings.language.zh")}</option>
                  <option value="en">{t("settings.language.en")}</option>
                </select>
              </div>
              <div className="settings-row">
                <label>{t("settings.quickBlur")}</label>
                <button
                  type="button"
                  className={`pill ${settings.quick_blur_enabled ? "active" : ""}`}
                  onClick={() =>
                    void onUpdateSettings({
                      ...settings,
                      quick_blur_enabled: !settings.quick_blur_enabled,
                    })
                  }
                  aria-pressed={settings.quick_blur_enabled}
                >
                  {settings.quick_blur_enabled ? t("common.on") : t("common.off")}
                </button>
              </div>
              <div className="settings-row">
                <label>{t("settings.sound")}</label>
                <button
                  type="button"
                  className={`pill ${settings.sound_enabled ? "active" : ""}`}
                  onClick={() =>
                    void onUpdateSettings({
                      ...settings,
                      sound_enabled: !settings.sound_enabled,
                    })
                  }
                  aria-pressed={settings.sound_enabled}
                >
                  {settings.sound_enabled ? t("common.on") : t("common.off")}
                </button>
              </div>
              <div className="settings-row">
                <label>{t("settings.minimizeBehavior")}</label>
                <select
                  value={settings.minimize_behavior}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      minimize_behavior: event.currentTarget.value as MinimizeBehavior,
                    })
                  }
                >
                  <option value="hide_to_tray">{t("settings.minimizeBehavior.hide")}</option>
                  <option value="minimize">{t("settings.minimizeBehavior.minimize")}</option>
                </select>
              </div>
              <div className="settings-row">
                <label>{t("settings.closeBehavior")}</label>
                <select
                  value={settings.close_behavior}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      close_behavior: event.currentTarget.value as Settings["close_behavior"],
                    })
                  }
                >
                  <option value="hide_to_tray">{t("settings.closeBehavior.hide")}</option>
                  <option value="exit">{t("settings.closeBehavior.exit")}</option>
                </select>
              </div>
              <div className="settings-row">
                <label>{t("settings.forcedColor")}</label>
                <input
                  type="color"
                  value={settings.forced_reminder_color}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      forced_reminder_color: event.currentTarget.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <label>{t("settings.notificationPermission")}</label>
                <span className="settings-status">
                  {permissionStatus === "granted" ? t("settings.permission.granted") : t("settings.permission.denied")}
                </span>
                <button type="button" className="pill" onClick={() => void requestNotificationPermission()}>
                  {t("settings.permission.request")}
                </button>
                {permissionStatus !== "granted" && (
                  <button type="button" className="pill" onClick={() => void openNotificationSettings()}>
                    <Icons.ExternalLink />
                    {t("settings.permission.systemSettings")}
                  </button>
                )}
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <label>{t("settings.backup")}</label>
                <select
                  value={settings.backup_schedule}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      backup_schedule: event.currentTarget.value as BackupSchedule,
                    })
                  }
                >
                  <option value="none">{t("settings.backup.none")}</option>
                  <option value="daily">{t("settings.backup.daily")}</option>
                  <option value="weekly">{t("settings.backup.weekly")}</option>
                  <option value="monthly">{t("settings.backup.monthly")}</option>
                </select>
                <button type="button" className="pill" onClick={() => void handleCreateBackup()}>
                  {t("settings.backup.manual")}
                </button>
              </div>
              <div className="settings-row">
                <label>{t("settings.backup.list")}</label>
                <button type="button" className="pill" onClick={() => void refreshBackups()}>
                  {t("common.refresh")}
                </button>
              </div>
              <div className="backup-list">
                {backups.length === 0 ? (
                  <div className="backup-empty">{t("settings.backup.empty")}</div>
                ) : (
                  backups.map((backup) => (
                    <div key={backup.name} className="backup-item">
                      <span>{backup.name}</span>
                      <button type="button" className="pill" onClick={() => void handleRestoreBackup(backup.name)}>
                        {t("settings.backup.restore")}
                      </button>
                      <button type="button" className="pill" onClick={() => void handleDeleteBackup(backup.name)}>
                        {t("settings.backup.delete")}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="settings-row">
                <label>{t("settings.backup.import")}</label>
                <input
                  placeholder={t("settings.backup.importPlaceholder")}
                  value={importPath}
                  onChange={(event) => setImportPath(event.currentTarget.value)}
                />
                <button
                  type="button"
                  className="pill"
                  onClick={() => void handleImportBackup()}
                  disabled={!importPath.trim()}
                  title={!importPath.trim() ? t("settings.backup.importHintEmpty") : t("settings.backup.importAction")}
                >
                  {t("settings.backup.importAction")}
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <label>{t("settings.samples")}</label>
                <button
                  type="button"
                  className="pill"
                  onClick={() => void handleAddAiNovelAssistantSamples()}
                  disabled={seedBusy}
                  title={t("settings.samples.tooltip")}
                >
                  {seedBusy ? t("settings.samples.adding") : t("settings.samples.add")}
                </button>
                <button
                  type="button"
                  className="pill"
                  onClick={() => void handleDeleteAiNovelAssistantSamples()}
                  disabled={sampleDeleteBusy || tasks.every((task) => !taskIsAiNovelAssistantSample(task))}
                  title={t("settings.samples.deleteTooltip")}
                >
                  {sampleDeleteBusy ? t("settings.samples.deleting") : t("settings.samples.delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
