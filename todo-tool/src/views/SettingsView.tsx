import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { createBackup, createTask, importBackup, listBackups, restoreBackup, type BackupEntry } from "../api";
import { buildAiNovelAssistantSampleTasks, taskIsAiNovelAssistantSample } from "../sampleData";
import type { BackupSchedule, MinimizeBehavior, Settings, Task } from "../types";

import { WindowTitlebar } from "../components/WindowTitlebar";
import { Icons } from "../components/icons";
import { detectPlatform } from "../platform";

type PermissionStatus = "unknown" | "granted" | "denied";

function formatMinimizeBehavior(value: MinimizeBehavior): string {
  switch (value) {
    case "hide_to_tray":
      return "隐藏到托盘";
    case "minimize":
      return "最小化到任务栏";
    default:
      return value;
  }
}

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
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [importPath, setImportPath] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);

  async function handleBack() {
    if (settings) {
      const nextShortcut = shortcutDraft.trim();
      if (nextShortcut && nextShortcut !== settings.shortcut) {
        const ok = await onUpdateSettings({ ...settings, shortcut: nextShortcut });
        if (!ok) {
          alert("快捷键无效，未保存。请修正后再返回。");
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
  }, [settings, shortcutDraft, onUpdateSettings, onBack]);

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
      const sorted = [...res.data].sort((a, b) => b.modified_at - a.modified_at);
      setBackups(sorted);
    }
  }

  async function handleCreateBackup() {
    await createBackup();
    await refreshBackups();
  }

  async function handleRestoreBackup(name: string) {
    if (!confirm("恢复将覆盖当前任务数据（不影响设置），确认继续？")) return;
    await restoreBackup(name);
  }

  async function handleImportBackup() {
    if (!importPath.trim()) return;
    if (!confirm("恢复将覆盖当前任务数据（不影响设置），确认继续？")) return;
    await importBackup(importPath.trim());
    setImportPath("");
  }

  async function handleAddAiNovelAssistantSamples() {
    if (!settings) return;
    if (seedBusy) return;
    const samples = buildAiNovelAssistantSampleTasks(new Date());
    const alreadySeeded = tasks.some(taskIsAiNovelAssistantSample);

    const ok = alreadySeeded
      ? confirm(`检测到已有 AI 小说助手示例任务。\n继续添加将产生重复（共 ${samples.length} 条）。\n仍然继续吗？`)
      : confirm(`将向当前数据添加 ${samples.length} 条示例任务（AI 小说助手开发计划）。\n建议：添加前会自动创建一次备份。\n继续吗？`);
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
        alert(
          `已添加 ${created}/${samples.length} 条示例任务。\n部分失败：\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? "\n..." : ""}`,
        );
      } else {
        alert(`已添加 ${created} 条示例任务。`);
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
        title="设置"
        onMinimize={handleMinimize}
        right={
          <button type="button" className="main-toggle" onClick={() => void handleBack()} title="返回主界面">
            <span className="settings-back-icon" aria-hidden="true">
              <Icons.ChevronRight />
            </span>
            返回
          </button>
        }
      />

      <div className="main-content settings-page">
        {!settings ? (
          <div className="settings-empty">加载中...</div>
        ) : (
          <div className="settings-panel settings-page-panel">
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
                <label>最小化行为</label>
                <select
                  value={settings.minimize_behavior}
                  onChange={(event) =>
                    void onUpdateSettings({
                      ...settings,
                      minimize_behavior: event.currentTarget.value as MinimizeBehavior,
                    })
                  }
                >
                  <option value="hide_to_tray">{formatMinimizeBehavior("hide_to_tray")}</option>
                  <option value="minimize">{formatMinimizeBehavior("minimize")}</option>
                </select>
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

            <div className="settings-section">
              <div className="settings-row">
                <label>示例数据</label>
                <button
                  type="button"
                  className="pill"
                  onClick={() => void handleAddAiNovelAssistantSamples()}
                  disabled={seedBusy}
                  title="向当前记录追加一批 AI 小说助手开发计划相关的示例任务"
                >
                  {seedBusy ? "添加中..." : "添加 AI 小说助手示例任务"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
