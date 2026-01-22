import { useCallback, useEffect, useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { getAppVersion } from "../version";
import {
  createBackup,
  createTask,
  deleteBackup,
  deleteTasks,
  exportTasksCsv,
  exportTasksJson,
  exportTasksMarkdown,
  importBackup,
  listBackups,
  restoreBackup,
  setShortcutCaptureActive,
  type BackupEntry,
} from "../api";
import { useI18n } from "../i18n";
import { buildAiNovelAssistantSampleTasks, taskIsAiNovelAssistantSample } from "../sampleData";
import { captureShortcutFromEvent } from "../shortcut";
import { normalizeTheme } from "../theme";
import type { BackupSchedule, MinimizeBehavior, Settings, Task } from "../types";

import { WindowTitlebar } from "../components/WindowTitlebar";
import { useToast } from "../components/ToastProvider";
import { useConfirmDialog } from "../components/useConfirmDialog";
import { Icons } from "../components/icons";
import { detectPlatform } from "../platform";

type PermissionStatus = "unknown" | "granted" | "denied";
type ManualUpdateCheckResult =
  | { status: "update"; version: string }
  | { status: "none" }
  | { status: "error"; error: string };

export function SettingsView({
  tasks,
  settings,
  onUpdateSettings,
  updateBusy,
  onCheckUpdate,
  onBack,
}: {
  tasks: Task[];
  settings: Settings | null;
  onUpdateSettings: (
    next: Settings,
    options?: { toastError?: boolean; toastErrorMessage?: string },
  ) => Promise<boolean>;
  updateBusy: boolean;
  onCheckUpdate: () => Promise<ManualUpdateCheckResult>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { requestConfirm, dialog: confirmDialog } = useConfirmDialog();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [shortcutCapturing, setShortcutCapturing] = useState(false);
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [sampleDeleteBusy, setSampleDeleteBusy] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] =
    useState<ManualUpdateCheckResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleBack() {
    setShortcutCapturing(false);
    setShortcutHint(null);
    if (settings) {
      const nextShortcut = shortcutDraft.trim();
      if (nextShortcut && nextShortcut !== settings.shortcut) {
        const ok = await onUpdateSettings(
          { ...settings, shortcut: nextShortcut },
          { toastErrorMessage: t("settings.shortcutInvalid") },
        );
        if (!ok) return;
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

  const refreshPermissionStatus = useCallback(async () => {
    try {
      const granted = await isPermissionGranted();
      setPermissionStatus(granted ? "granted" : "denied");
    } catch {
      setPermissionStatus("unknown");
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    try {
      const result = await requestPermission();
      setPermissionStatus(result === "granted" ? "granted" : "denied");
    } catch {
      setPermissionStatus("unknown");
    } finally {
      setTimeout(() => void refreshPermissionStatus(), 500);
    }
  }, [refreshPermissionStatus]);

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
    const ok = await requestConfirm({
      title: t("settings.backup.restore"),
      description: t("settings.backup.restoreConfirm"),
      confirmText: t("common.restore"),
      cancelText: t("common.cancel"),
    });
    if (!ok) return;
    await restoreBackup(name);
  }

  async function handleDeleteBackup(name: string) {
    const ok = await requestConfirm({
      title: t("settings.backup.delete"),
      description: t("settings.backup.deleteConfirm", { name }),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    await deleteBackup(name);
    await refreshBackups();
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    const ok = await requestConfirm({
      title: t("settings.backup.import"),
      description: t("settings.backup.restoreConfirm"),
      confirmText: t("common.restore"),
      cancelText: t("common.cancel"),
    });
    if (!ok) return;
    await importBackup(importPath.trim());
    setImportPath("");
  }

  async function handleExport(kind: "json" | "csv" | "md") {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const res =
        kind === "json"
          ? await exportTasksJson()
          : kind === "csv"
            ? await exportTasksCsv()
            : await exportTasksMarkdown();
      if (res.ok && res.data) {
        setExportPath(res.data);
      } else {
        setExportError(res.error ?? "unknown error");
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyExportPath() {
    if (!exportPath) return;
    try {
      await navigator.clipboard.writeText(exportPath);
      toast.notify(t("settings.export.copied"), { tone: "success" });
    } catch {
      await requestConfirm({
        title: t("settings.export.copy"),
        description: exportPath,
        confirmText: t("common.close"),
        cancelText: null,
      });
    }
  }

  async function handleAddAiNovelAssistantSamples() {
    if (!settings) return;
    if (seedBusy) return;
    const samples = buildAiNovelAssistantSampleTasks(new Date());
    const alreadySeeded = tasks.some(taskIsAiNovelAssistantSample);

    const ok = await requestConfirm({
      title: t("settings.samples.add"),
      description: alreadySeeded
        ? t("settings.samples.confirm.duplicate", { count: samples.length })
        : t("settings.samples.confirm.fresh", { count: samples.length }),
      confirmText: t("common.confirm"),
      cancelText: t("common.cancel"),
    });
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
        await requestConfirm({
          title: t("settings.samples"),
          description: t("settings.samples.result.partial", {
            created,
            total: samples.length,
            errors: errorLines,
          }),
          confirmText: t("common.close"),
          cancelText: null,
          tone: "danger",
        });
      } else {
        toast.notify(t("settings.samples.result.ok", { created }), {
          tone: "success",
        });
      }
    } finally {
      setSeedBusy(false);
    }
  }

  async function handleDeleteAiNovelAssistantSamples() {
    if (sampleDeleteBusy) return;
    const sampleTasks = tasks.filter(taskIsAiNovelAssistantSample);
    if (sampleTasks.length === 0) return;
    const ok = await requestConfirm({
      title: t("settings.samples.delete"),
      description: t("settings.samples.deleteConfirm", { count: sampleTasks.length }),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    setSampleDeleteBusy(true);
    try {
      await deleteTasks(sampleTasks.map((task) => task.id));
    } finally {
      setSampleDeleteBusy(false);
    }
  }

  const applyShortcutDraft = useCallback(
    async (nextOverride?: string) => {
      if (!settings) return;
      const nextShortcut = (nextOverride ?? shortcutDraft).trim();
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
    },
    [onUpdateSettings, settings, shortcutDraft],
  );

  // When settings load, sync drafts and refresh side-effecty data (permission, backups).
  useEffect(() => {
    if (!settings) return;
    setShortcutDraft(settings.shortcut);
  }, [settings?.shortcut]);

  useEffect(() => {
    if (!shortcutCapturing) return;
    setShortcutHint(t("settings.shortcutHint"));
    void setShortcutCaptureActive(true).catch(() => {});

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setShortcutCapturing(false);
        setShortcutHint(null);
        return;
      }

      const result = captureShortcutFromEvent(event);
      if ("error" in result) {
        setShortcutHint(
          result.error === "need_modifier"
            ? t("settings.shortcutNeedModifier")
            : t("settings.shortcutNeedKey"),
        );
        return;
      }

      setShortcutCapturing(false);
      setShortcutHint(null);
      setShortcutDraft(result.shortcut);
      void applyShortcutDraft(result.shortcut);
    };

    const handleBlur = () => {
      setShortcutCapturing(false);
      setShortcutHint(null);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      void setShortcutCaptureActive(false).catch(() => {});
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, [shortcutCapturing, t, applyShortcutDraft]);

  // Refresh side-effecty data when the settings page mounts.
  useEffect(() => {
    void refreshPermissionStatus();
    void refreshBackups();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    const handleFocus = () => void refreshPermissionStatus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshPermissionStatus();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshPermissionStatus]);

  // Fetch app version once (best-effort).
  useEffect(() => {
    let disposed = false;
    void getAppVersion()
      .then((version) => {
        if (disposed) return;
        setAppVersion(version ?? "");
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  async function handleCheckUpdate() {
    if (import.meta.env.DEV) return;
    if (updateBusy || updateCheckBusy) return;
    setUpdateCheckBusy(true);
    setUpdateCheckResult(null);
    try {
      const res = await onCheckUpdate();
      setUpdateCheckResult(res);
    } finally {
      setUpdateCheckBusy(false);
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

  const updateStatus = (() => {
    if (import.meta.env.DEV) {
      return { tone: "info", text: t("settings.update.devDisabled") };
    }
    if (updateCheckBusy) {
      return { tone: "info", text: t("settings.update.checking") };
    }
    if (!updateCheckResult) return null;
    if (updateCheckResult.status === "none") {
      return { tone: "success", text: t("settings.update.latest") };
    }
    if (updateCheckResult.status === "update") {
      return {
        tone: "warning",
        text: t("settings.update.available", { version: updateCheckResult.version }),
      };
    }
    const error =
      updateCheckResult.error.length > 160
        ? `${updateCheckResult.error.slice(0, 157)}...`
        : updateCheckResult.error;
    return {
      tone: "danger",
      text: t("settings.update.checkFailed", { error }),
    };
  })();

  const themeValue = useMemo(
    () => (settings ? normalizeTheme(settings.theme) : "retro"),
    [settings?.theme],
  );
  const permissionLabel = useMemo(() => {
    if (permissionStatus === "granted") return t("settings.permission.granted");
    if (permissionStatus === "denied") return t("settings.permission.denied");
    return t("settings.permission.unknown");
  }, [permissionStatus, t]);

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
                 <label>{t("settings.update.currentVersion")}</label>
                 <span className="settings-status">
                   {appVersion === null ? t("common.loading") : appVersion || "-"}
                 </span>
               </div>
               <div className="settings-row">
                 <label>{t("settings.update")}</label>
                 <button
                   type="button"
                   className="pill"
                   onClick={() => void handleCheckUpdate()}
                   disabled={import.meta.env.DEV || updateBusy || updateCheckBusy}
                 >
                   {t("settings.update.check")}
                 </button>
                 {updateStatus && (
                   <span className={`settings-status ${updateStatus.tone}`}>{updateStatus.text}</span>
                 )}
               </div>
             </div>

             <div className="settings-section">
              <div className="settings-row">
                <label>{t("settings.shortcut")}</label>
                <button
                  type="button"
                  className={`shortcut-capture ${shortcutCapturing ? "capturing" : ""}`}
                  onClick={() => {
                    if (shortcutCapturing) {
                      setShortcutCapturing(false);
                      setShortcutHint(null);
                      return;
                    }
                    setShortcutCapturing(true);
                  }}
                  title={t("settings.shortcutHint")}
                >
                  {shortcutCapturing
                    ? t("settings.shortcutCapturing")
                    : shortcutDraft || t("settings.shortcutCapture")}
                </button>
                {shortcutHint && <span className="settings-status">{shortcutHint}</span>}
              </div>
              <div className="settings-row">
                <label>{t("settings.theme")}</label>
                <select
                  value={themeValue}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      theme: event.currentTarget.value,
                    })
                  }
                >
                  <option value="retro">{t("settings.theme.retro")}</option>
                  <option value="tech">{t("settings.theme.tech")}</option>
                  <option value="calm">{t("settings.theme.calm")}</option>
                  <option value="vscode">{t("settings.theme.vscode")}</option>
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
                  {permissionLabel}
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
                <label>{t("settings.export")}</label>
                <button type="button" className="pill" onClick={() => void handleExport("json")} disabled={exportBusy}>
                  {t("settings.export.json")}
                </button>
                <button type="button" className="pill" onClick={() => void handleExport("csv")} disabled={exportBusy}>
                  {t("settings.export.csv")}
                </button>
                <button type="button" className="pill" onClick={() => void handleExport("md")} disabled={exportBusy}>
                  {t("settings.export.md")}
                </button>
                {exportError && <span className="settings-status danger">{t("settings.export.failed", { error: exportError })}</span>}
              </div>
              {exportPath && (
                <div className="settings-row">
                  <label>{t("settings.export.last")}</label>
                  <span className="settings-status">{exportPath}</span>
                  <button type="button" className="pill" onClick={() => void handleCopyExportPath()}>
                    {t("settings.export.copy")}
                  </button>
                </div>
              )}
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

      {confirmDialog}
    </div>
  );
}
