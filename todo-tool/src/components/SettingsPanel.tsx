import { useEffect, useState } from "react";

import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { createBackup, importBackup, listBackups, restoreBackup, type BackupEntry } from "../api";
import type { BackupSchedule, Settings } from "../types";

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
  settings,
  onClose,
  onUpdateSettings,
}: {
  open: boolean;
  settings: Settings | null;
  onClose: () => void;
  onUpdateSettings: (next: Settings) => Promise<boolean>;
}) {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");

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
    if (!confirm("恢复将覆盖当前数据，确认继续？")) return;
    await restoreBackup(name);
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    if (!confirm("恢复将覆盖当前数据，确认继续？")) return;
    await importBackup(importPath.trim());
    setImportPath("");
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
          <h2>设置</h2>
          <button type="button" className="task-icon-btn" onClick={onClose} aria-label="关闭设置" title="关闭">
            <Icons.X />
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <label>快捷键</label>
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
            <label>主题</label>
            <select
              value={settings.theme}
              onChange={(event) =>
                void onUpdateSettings({
                  ...settings,
                  theme: event.currentTarget.value,
                })
              }
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <div className="settings-row">
            <label>快捷界面毛玻璃</label>
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
              {settings.quick_blur_enabled ? "开启" : "关闭"}
            </button>
          </div>
          <div className="settings-row">
            <label>提示音</label>
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
              {settings.sound_enabled ? "开启" : "关闭"}
            </button>
          </div>
          <div className="settings-row">
            <label>关闭行为</label>
            <select
              value={settings.close_behavior}
              onChange={(event) =>
                void onUpdateSettings({
                  ...settings,
                  close_behavior: event.currentTarget.value as Settings["close_behavior"],
                })
              }
            >
              <option value="hide_to_tray">隐藏到托盘</option>
              <option value="exit">退出应用</option>
            </select>
          </div>
          <div className="settings-row">
            <label>强制提醒颜色</label>
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
            <label>通知权限</label>
            <span className="settings-status">{permissionStatus === "granted" ? "已授权" : "未授权"}</span>
            <button type="button" className="pill" onClick={() => void requestNotificationPermission()}>
              请求权限
            </button>
            {permissionStatus !== "granted" && (
              <button type="button" className="pill" onClick={() => void openNotificationSettings()}>
                <Icons.ExternalLink />
                系统设置
              </button>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <label>自动备份</label>
            <select
              value={settings.backup_schedule}
              onChange={(event) =>
                void onUpdateSettings({
                  ...settings,
                  backup_schedule: event.currentTarget.value as BackupSchedule,
                })
              }
            >
              <option value="none">不备份</option>
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
            <button type="button" className="pill" onClick={() => void handleCreateBackup()}>
              手动备份
            </button>
          </div>
          <div className="settings-row">
            <label>备份列表</label>
            <button type="button" className="pill" onClick={() => void refreshBackups()}>
              刷新
            </button>
          </div>
          <div className="backup-list">
            {backups.length === 0 ? (
              <div className="backup-empty">暂无备份</div>
            ) : (
              backups.map((backup) => (
                <div key={backup.name} className="backup-item">
                  <span>{backup.name}</span>
                  <button type="button" className="pill" onClick={() => void handleRestoreBackup(backup.name)}>
                    恢复
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="settings-row">
            <label>导入备份</label>
            <input
              placeholder="输入备份文件路径"
              value={importPath}
              onChange={(event) => setImportPath(event.currentTarget.value)}
            />
            <button
              type="button"
              className="pill"
              onClick={() => void handleImportBackup()}
              disabled={!importPath.trim()}
              title={!importPath.trim() ? "请输入备份文件路径" : "导入恢复"}
            >
              导入恢复
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
