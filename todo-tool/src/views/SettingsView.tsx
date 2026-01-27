import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { formatDue } from "../date";
import { getAppVersion } from "../version";
import { describeError, frontendLog } from "../frontendLog";
import {
  createBackup,
  createProject,
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
import {
  AI_NOVEL_SAMPLE_PROJECT_ID,
  buildAiNovelAssistantSampleProjects,
  buildAiNovelAssistantSampleTasks,
  taskIsAiNovelAssistantSample,
} from "../sampleData";
import { captureShortcutFromEvent } from "../shortcut";
import { normalizeTheme } from "../theme";
import type { BackupSchedule, Project, Settings, Task } from "../types";

import { WindowTitlebar } from "../components/WindowTitlebar";
import { useToast } from "../components/ToastProvider";
import { useConfirmDialog } from "../components/useConfirmDialog";
import { Icons } from "../components/icons";
import { Switch } from "../components/Switch";
import { detectPlatform } from "../platform";

type PermissionStatus = "unknown" | "granted" | "denied";
type ManualUpdateCheckResult =
  | { status: "update"; version: string }
  | { status: "none" }
  | { status: "error"; error: string };

export function SettingsView({
  tasks,
  projects,
  settings,
  onUpdateSettings,
  updateBusy,
  onCheckUpdate,
  onBack,
}: {
  tasks: Task[];
  projects: Project[];
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
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState<string | null>(null);
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
  const [deepseekKeyDraft, setDeepseekKeyDraft] = useState("");
  const [aiModelDraft, setAiModelDraft] = useState("deepseek-chat");
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const lastAiSettingsRef = useRef<{
    deepseekKey: string;
    aiModel: string;
    aiPrompt: string;
  } | null>(null);

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
      await openUrl(
        "x-apple.systempreferences:com.apple.preference.notifications",
      ).catch(() => {});
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
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Backup", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const ok = await requestConfirm({
        title: t("settings.backup.import"),
        description: t("settings.backup.restoreConfirm"),
        confirmText: t("common.restore"),
        cancelText: t("common.cancel"),
      });
      if (!ok) return;
      await importBackup(selected);
      setImportPath(selected);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.notify(message || t("common.unknownError"), {
        tone: "danger",
        durationMs: 6000,
      });
    }
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

  async function handleShowAbout() {
    await requestConfirm({
      title: t("settings.about.title"),
      description: t("settings.about.description"),
      confirmText: t("common.close"),
      cancelText: null,
    });
  }

  async function handleAddAiNovelAssistantSamples() {
    if (!settings) return;
    if (seedBusy) return;
    const now = new Date();
    const sampleProjects = buildAiNovelAssistantSampleProjects(now);
    const samples = buildAiNovelAssistantSampleTasks(
      now,
      AI_NOVEL_SAMPLE_PROJECT_ID,
    );
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

      // Create sample projects first so tasks can reference them.
      for (const project of sampleProjects) {
        if (projects.some((existing) => existing.id === project.id)) continue;
        const res = await createProject(project);
        if (!res.ok) {
          errors.push(res.error ?? `unknown error: ${project.name}`);
        }
      }

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
      description: t("settings.samples.deleteConfirm", {
        count: sampleTasks.length,
      }),
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
      const ok = await onUpdateSettings({
        ...settings,
        shortcut: nextShortcut,
      });
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

  // AI inputs are free-form text; avoid overwriting local edits on unrelated settings updates.
  useEffect(() => {
    if (!settings) {
      lastAiSettingsRef.current = null;
      setDeepseekKeyDraft("");
      setAiModelDraft("deepseek-chat");
      setAiPromptDraft("");
      return;
    }

    const nextKey = settings.deepseek_api_key ?? "";
    const nextModel = settings.ai_model ?? "deepseek-chat";
    const nextPrompt = settings.ai_prompt ?? "";

    const prev = lastAiSettingsRef.current;
    if (!prev) {
      lastAiSettingsRef.current = {
        deepseekKey: nextKey,
        aiModel: nextModel,
        aiPrompt: nextPrompt,
      };
      setDeepseekKeyDraft(nextKey);
      setAiModelDraft(nextModel);
      setAiPromptDraft(nextPrompt);
      return;
    }

    if (deepseekKeyDraft === prev.deepseekKey && nextKey !== prev.deepseekKey) {
      setDeepseekKeyDraft(nextKey);
    }
    if (aiModelDraft === prev.aiModel && nextModel !== prev.aiModel) {
      setAiModelDraft(nextModel);
    }
    if (aiPromptDraft === prev.aiPrompt && nextPrompt !== prev.aiPrompt) {
      setAiPromptDraft(nextPrompt);
    }

    lastAiSettingsRef.current = {
      deepseekKey: nextKey,
      aiModel: nextModel,
      aiPrompt: nextPrompt,
    };
  }, [settings]);

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
    } catch (err) {
      // Best-effort: logging must never break settings, but we want evidence when native
      // window controls stop responding (common dev-capability issue).
      void frontendLog("warn", "settings window minimize/hide failed", {
        behavior,
        err: describeError(err),
      });
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
        text: t("settings.update.available", {
          version: updateCheckResult.version,
        }),
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
  const aiPlaceholderItems = useMemo(
    () => [
      { token: "{{Now}}", desc: t("settings.ai.placeholder.now") },
      { token: "{{UserInput}}", desc: t("settings.ai.placeholder.userInput") },
      {
        token: "{{UserCurrentProjectId}}",
        desc: t("settings.ai.placeholder.currentProject"),
      },
      {
        token: "{{ProjectList}}",
        desc: t("settings.ai.placeholder.projectList"),
      },
      { token: "{{OpenTasks}}", desc: t("settings.ai.placeholder.openTasks") },
      {
        token: "{{UserSelectedReminder}}",
        desc: t("settings.ai.placeholder.selectedReminder"),
      },
      {
        token: "{{UserSelectedRepeat}}",
        desc: t("settings.ai.placeholder.selectedRepeat"),
      },
      {
        token: "{{WorkEndTime}}",
        desc: t("settings.ai.placeholder.workEndTime"),
      },
      { token: "{{mustdo_now}}", desc: t("settings.ai.placeholder.legacyNow") },
      {
        token: "{{mustdo_user_input}}",
        desc: t("settings.ai.placeholder.legacyUserInput"),
      },
      {
        token: "{{mustdo_selected_fields}}",
        desc: t("settings.ai.placeholder.legacySelectedFields"),
      },
      {
        token: "{{mustdo_output_schema}}",
        desc: t("settings.ai.placeholder.legacyOutputSchema"),
      },
    ],
    [t],
  );

  const scrollToSection = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="settings-window">
      <WindowTitlebar
        variant="main"
        title={t("settings.title")}
        onMinimize={handleMinimize}
      />

      <div className="settings-content">
        {!settings ? (
          <div className="settings-empty">{t("common.loading")}</div>
        ) : (
          <div className="settings-layout">
            <div className="settings-nav" aria-label={t("settings.nav")}>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-about")}
              >
                {t("settings.section.about")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-general")}
              >
                {t("settings.section.general")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-ai")}
              >
                {t("settings.section.ai")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-notifications")}
              >
                {t("settings.section.notifications")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-backups")}
              >
                {t("settings.section.backups")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-export")}
              >
                {t("settings.section.export")}
              </button>
              <button
                type="button"
                className="settings-nav-btn"
                onClick={() => scrollToSection("settings-samples")}
              >
                {t("settings.section.samples")}
              </button>
              <button
                type="button"
                className="settings-nav-close"
                onClick={() => void handleBack()}
              >
                {t("common.close")}
              </button>
            </div>

            <div className="settings-main">
              <section id="settings-about" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.about")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.update.currentVersion")}</label>
                    <span className="settings-status">
                      {appVersion === null
                        ? t("common.loading")
                        : appVersion || "-"}
                    </span>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.update")}</label>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleCheckUpdate()}
                      disabled={
                        import.meta.env.DEV || updateBusy || updateCheckBusy
                      }
                    >
                      {t("settings.update.check")}
                    </button>
                    {updateStatus && (
                      <span className={`settings-status ${updateStatus.tone}`}>
                        {updateStatus.text}
                      </span>
                    )}
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.update.behavior")}</label>
                    <select
                      value={settings?.update_behavior ?? "next_restart"}
                      onChange={(event) => {
                        if (!settings) return;
                        void onUpdateSettings({
                          ...settings,
                          update_behavior: event.currentTarget
                            .value as Settings["update_behavior"],
                        });
                      }}
                      disabled={updateBusy || updateCheckBusy}
                    >
                      <option value="auto">
                        {t("settings.update.behavior.auto")}
                      </option>
                      <option value="next_restart">
                        {t("settings.update.behavior.next_restart")}
                      </option>
                      <option value="disabled">
                        {t("settings.update.behavior.disabled")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.about.title")}</label>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleShowAbout()}
                    >
                      {t("settings.about.button")}
                    </button>
                  </div>
                </div>
              </section>

              <section id="settings-general" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.general")}
                  </h2>
                </div>
                <div className="settings-card-body">
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
                    {shortcutHint && (
                      <span className="settings-status">{shortcutHint}</span>
                    )}
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
                      <option value="elegant">
                        {t("settings.theme.elegant")}
                      </option>
                      <option value="web90s">
                        {t("settings.theme.web90s")}
                      </option>
                      <option value="tech">{t("settings.theme.tech")}</option>
                      <option value="calm">{t("settings.theme.calm")}</option>
                      <option value="cyberpunk">
                        {t("settings.theme.cyberpunk")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.uiRadius")}</label>
                    <select
                      value={settings.ui_radius}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          ui_radius: event.currentTarget
                            .value as Settings["ui_radius"],
                        })
                      }
                    >
                      <option value="theme">
                        {t("settings.uiRadius.theme")}
                      </option>
                      <option value="sharp">
                        {t("settings.uiRadius.sharp")}
                      </option>
                      <option value="round">
                        {t("settings.uiRadius.round")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.uiBorder")}</label>
                    <select
                      value={settings.ui_border}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          ui_border: event.currentTarget
                            .value as Settings["ui_border"],
                        })
                      }
                    >
                      <option value="theme">
                        {t("settings.uiBorder.theme")}
                      </option>
                      <option value="thin">
                        {t("settings.uiBorder.thin")}
                      </option>
                      <option value="thick">
                        {t("settings.uiBorder.thick")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.uiShadow")}</label>
                    <select
                      value={settings.ui_shadow}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          ui_shadow: event.currentTarget
                            .value as Settings["ui_shadow"],
                        })
                      }
                    >
                      <option value="theme">
                        {t("settings.uiShadow.theme")}
                      </option>
                      <option value="none">
                        {t("settings.uiShadow.none")}
                      </option>
                      <option value="soft">
                        {t("settings.uiShadow.soft")}
                      </option>
                      <option value="strong">
                        {t("settings.uiShadow.strong")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.language")}</label>
                    <select
                      value={settings.language}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          language: event.currentTarget
                            .value as Settings["language"],
                        })
                      }
                    >
                      <option value="auto">
                        {t("settings.language.auto")}
                      </option>
                      <option value="zh">{t("settings.language.zh")}</option>
                      <option value="en">{t("settings.language.en")}</option>
                    </select>
                  </div>

                  <div className="settings-row">
                    <label>{t("settings.quickBlur")}</label>
                    <Switch
                      checked={settings.quick_blur_enabled}
                      ariaLabel={t("settings.quickBlur")}
                      onChange={(nextEnabled) =>
                        void onUpdateSettings({
                          ...settings,
                          quick_blur_enabled: nextEnabled,
                        })
                      }
                    />
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.sound")}</label>
                    <Switch
                      checked={settings.sound_enabled}
                      ariaLabel={t("settings.sound")}
                      onChange={(nextEnabled) =>
                        void onUpdateSettings({
                          ...settings,
                          sound_enabled: nextEnabled,
                        })
                      }
                    />
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.closeBehavior")}</label>
                    <select
                      value={settings.close_behavior}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          close_behavior: event.currentTarget
                            .value as Settings["close_behavior"],
                        })
                      }
                    >
                      <option value="hide_to_tray">
                        {t("settings.closeBehavior.hide")}
                      </option>
                      <option value="exit">
                        {t("settings.closeBehavior.exit")}
                      </option>
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
              </section>

              <section id="settings-ai" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.ai")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.ai")}</label>
                    <Switch
                      checked={settings.ai_enabled}
                      ariaLabel={t("settings.ai")}
                      onChange={async (nextEnabled) => {
                        const nextKey = deepseekKeyDraft.trim();
                        const nextModel = aiModelDraft.trim();
                        if (nextEnabled) {
                          if (!nextKey) {
                            toast.notify(t("settings.ai.keyRequired"), {
                              tone: "danger",
                            });
                            return;
                          }
                          if (!nextModel) {
                            toast.notify(t("settings.ai.modelRequired"), {
                              tone: "danger",
                            });
                            return;
                          }
                        }
                        const ok = await onUpdateSettings({
                          ...settings,
                          ai_enabled: nextEnabled,
                          deepseek_api_key: nextKey,
                          ai_model: nextModel,
                          ai_prompt: aiPromptDraft,
                        });
                        if (!ok) return;
                        setDeepseekKeyDraft(nextKey);
                        setAiModelDraft(nextModel || "deepseek-chat");
                      }}
                    />
                    <span className="settings-status">
                      {t("settings.ai.vendor")}
                    </span>
                  </div>
                  {settings.ai_enabled && (
                    <>
                      <div className="settings-row">
                        <label>{t("settings.ai.model")}</label>
                        <select
                          value={aiModelDraft}
                          onChange={(event) => {
                            const nextModel = event.currentTarget.value;
                            const fallbackModel = settings.ai_model;
                            setAiModelDraft(nextModel);
                            void onUpdateSettings({
                              ...settings,
                              ai_model: nextModel,
                            }).then((ok) => {
                              if (ok) return;
                              setAiModelDraft(fallbackModel);
                            });
                          }}
                        >
                          <option value="deepseek-chat">
                            {t("settings.ai.modelDeepseekChat")}
                          </option>
                          <option value="deepseek-reasoner">
                            {t("settings.ai.modelDeepseekReasoner")}
                          </option>
                        </select>
                      </div>
                      <div className="settings-row">
                        <label>{t("settings.ai.apiKey")}</label>
                        <input
                          type="password"
                          value={deepseekKeyDraft}
                          placeholder={t("settings.ai.apiKeyPlaceholder")}
                          onChange={(event) =>
                            setDeepseekKeyDraft(event.target.value)
                          }
                          onBlur={() => {
                            const nextKey = deepseekKeyDraft.trim();
                            const fallbackKey = settings.deepseek_api_key;
                            if (nextKey === settings.deepseek_api_key) return;
                            void onUpdateSettings({
                              ...settings,
                              deepseek_api_key: nextKey,
                            }).then((ok) => {
                              if (ok) {
                                setDeepseekKeyDraft(nextKey);
                                return;
                              }
                              setDeepseekKeyDraft(fallbackKey);
                            });
                          }}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>

                      <div className="settings-row settings-row-multiline">
                        <label>{t("settings.ai.prompt")}</label>
                        <div>
                          <textarea
                            className="settings-textarea"
                            value={aiPromptDraft}
                            placeholder={t("settings.ai.promptPlaceholder")}
                            onChange={(event) =>
                              setAiPromptDraft(event.target.value)
                            }
                            onBlur={() => {
                              const fallbackPrompt = settings.ai_prompt;
                              if (aiPromptDraft === settings.ai_prompt) return;
                              void onUpdateSettings({
                                ...settings,
                                ai_prompt: aiPromptDraft,
                              }).then((ok) => {
                                if (ok) return;
                                setAiPromptDraft(fallbackPrompt);
                              });
                            }}
                            rows={8}
                          />
                          <div className="settings-placeholder-title">
                            {t("settings.ai.placeholderTitle")}
                          </div>
                          <ul className="settings-placeholder-list">
                            {aiPlaceholderItems.map((item) => (
                              <li
                                key={item.token}
                                className="settings-placeholder-item"
                              >
                                <span className="settings-placeholder-token">
                                  {item.token}
                                </span>
                                <span>{item.desc}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section id="settings-notifications" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.notifications")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.notificationPermission")}</label>
                    <span className="settings-status">{permissionLabel}</span>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void requestNotificationPermission()}
                    >
                      {t("settings.permission.request")}
                    </button>
                    {permissionStatus !== "granted" && (
                      <button
                        type="button"
                        className="pill"
                        onClick={() => void openNotificationSettings()}
                      >
                        <Icons.ExternalLink />
                        {t("settings.permission.systemSettings")}
                      </button>
                    )}
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.reminderRepeatInterval")}</label>
                    <select
                      value={settings.reminder_repeat_interval_sec}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          reminder_repeat_interval_sec: Number(
                            event.currentTarget.value,
                          ),
                        })
                      }
                    >
                      <option value={0}>
                        {t("settings.reminderRepeatInterval.off")}
                      </option>
                      <option value={5 * 60}>
                        {t("settings.reminderRepeatInterval.5m")}
                      </option>
                      <option value={10 * 60}>
                        {t("settings.reminderRepeatInterval.10m")}
                      </option>
                      <option value={30 * 60}>
                        {t("settings.reminderRepeatInterval.30m")}
                      </option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.reminderRepeatMaxTimes")}</label>
                    <select
                      value={settings.reminder_repeat_max_times}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          reminder_repeat_max_times: Number(
                            event.currentTarget.value,
                          ),
                        })
                      }
                    >
                      <option value={0}>
                        {t("settings.reminderRepeatMaxTimes.untilComplete")}
                      </option>
                      <option value={3}>
                        {t("settings.reminderRepeatMaxTimes.3")}
                      </option>
                      <option value={5}>
                        {t("settings.reminderRepeatMaxTimes.5")}
                      </option>
                      <option value={10}>
                        {t("settings.reminderRepeatMaxTimes.10")}
                      </option>
                    </select>
                  </div>
                </div>
              </section>

              <section id="settings-backups" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.backups")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.backup")}</label>
                    <select
                      value={settings.backup_schedule}
                      onChange={(event) =>
                        void onUpdateSettings({
                          ...settings,
                          backup_schedule: event.currentTarget
                            .value as BackupSchedule,
                        })
                      }
                    >
                      <option value="none">{t("settings.backup.none")}</option>
                      <option value="daily">
                        {t("settings.backup.daily")}
                      </option>
                      <option value="weekly">
                        {t("settings.backup.weekly")}
                      </option>
                      <option value="monthly">
                        {t("settings.backup.monthly")}
                      </option>
                    </select>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleCreateBackup()}
                    >
                      {t("settings.backup.manual")}
                    </button>
                  </div>
                  <div className="settings-row">
                    <label>{t("settings.backup.list")}</label>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void refreshBackups()}
                    >
                      {t("common.refresh")}
                    </button>
                  </div>
                  <div className="backup-list">
                    {backups.length === 0 ? (
                      <div className="backup-empty">
                        {t("settings.backup.empty")}
                      </div>
                    ) : (
                      backups.map((backup) => (
                        <div key={backup.name} className="backup-item">
                          <div className="backup-info">
                            <div className="backup-name">{backup.name}</div>
                            <div className="backup-meta">
                              {formatDue(backup.modified_at)}
                            </div>
                          </div>
                          <div className="backup-actions">
                            <button
                              type="button"
                              className="pill"
                              onClick={() =>
                                void handleRestoreBackup(backup.name)
                              }
                            >
                              {t("settings.backup.restore")}
                            </button>
                            <button
                              type="button"
                              className="pill"
                              onClick={() =>
                                void handleDeleteBackup(backup.name)
                              }
                            >
                              {t("settings.backup.delete")}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="settings-row settings-row-multiline">
                    <label>{t("settings.backup.import")}</label>
                    <div className="backup-import">
                      <button
                        type="button"
                        className="pill"
                        onClick={() => void handleImportBackup()}
                      >
                        {t("settings.backup.importAction")}
                      </button>
                      <span className="settings-status">
                        {importPath ?? t("settings.backup.importHintEmpty")}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section id="settings-export" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.export")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.export")}</label>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleExport("json")}
                      disabled={exportBusy}
                    >
                      {t("settings.export.json")}
                    </button>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleExport("csv")}
                      disabled={exportBusy}
                    >
                      {t("settings.export.csv")}
                    </button>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleExport("md")}
                      disabled={exportBusy}
                    >
                      {t("settings.export.md")}
                    </button>
                    {exportError && (
                      <span className="settings-status danger">
                        {t("settings.export.failed", { error: exportError })}
                      </span>
                    )}
                  </div>
                  {exportPath && (
                    <div className="settings-row">
                      <label>{t("settings.export.last")}</label>
                      <span className="settings-status">{exportPath}</span>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => void handleCopyExportPath()}
                      >
                        {t("settings.export.copy")}
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section id="settings-samples" className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">
                    {t("settings.section.samples")}
                  </h2>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <label>{t("settings.samples")}</label>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleAddAiNovelAssistantSamples()}
                      disabled={seedBusy}
                      title={t("settings.samples.tooltip")}
                    >
                      {seedBusy
                        ? t("settings.samples.adding")
                        : t("settings.samples.add")}
                    </button>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => void handleDeleteAiNovelAssistantSamples()}
                      disabled={
                        sampleDeleteBusy ||
                        tasks.every(
                          (task) => !taskIsAiNovelAssistantSample(task),
                        )
                      }
                      title={t("settings.samples.deleteTooltip")}
                    >
                      {sampleDeleteBusy
                        ? t("settings.samples.deleting")
                        : t("settings.samples.delete")}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
