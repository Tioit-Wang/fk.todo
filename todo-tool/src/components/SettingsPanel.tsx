import { useEffect, useState } from "react";

import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { createBackup, createTask, importBackup, listBackups, restoreBackup, type BackupEntry } from "../api";
import { useI18n } from "../i18n";
import { buildAiNovelAssistantSampleTasks, taskIsAiNovelAssistantSample } from "../sampleData";
import type { BackupSchedule, Settings, Task } from "../types";

import { IconButton } from "./IconButton";
import { Icons } from "./icons";

type PermissionStatus = "unknown" | "granted" | "denied";

function detectPlatform(): "windows" | "macos" | "linux" | "unknown" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macos")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function SettingsPanel({
  open,
  tasks,
  settings,
  onClose,
  onUpdateSettings,
}: {
  open: boolean;
  tasks: Task[];
  settings: Settings | null;
  onClose: () => void;
  onUpdateSettings: (next: Settings) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function refreshPermissionStatus() {
    try {
      const granted = await isPermissionGranted();
      setPermissionStatus(granted ? "granted" : "denied");
    } catch {
      setPermissionStatus("unknown");
    }
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
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    await restoreBackup(name);
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    await importBackup(importPath.trim());
    setImportPath("");
  }

  async function handleAddAiNovelAssistantSamples() {
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

  // When the panel opens, sync drafts and refresh side-effecty data (permission, backups).
  useEffect(() => {
    if (!open || !settings) return;
    setShortcutDraft(settings.shortcut);
    void refreshPermissionStatus();
    void refreshBackups();
  }, [open, settings?.shortcut, settings]);

  if (!open || !settings) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
        <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>{t("settings.title")}</h2>
            <IconButton className="task-icon-btn" onClick={onClose} label={t("common.close")} title={t("common.close")}>
              <Icons.X />
            </IconButton>
          </div>

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
          </div>
        </div>
      </div>
    </div>
  );
}
