# todo-tool/UNFINISHED.md（项目现状 & 关键文件索引）

本文件用于“快速定位代码入口 + 记录当前已实现能力 + 标注接下来优先级”。

## 1) 快速入口（先看这些）

前端（React/TS）：

- UI 入口：`todo-tool/src/App.tsx`
- 样式入口：`todo-tool/src/App.css`
- Tauri commands 封装：`todo-tool/src/api.ts`
- 事件常量：`todo-tool/src/events.ts`
- 跨边界类型契约：`todo-tool/src/types.ts`
- 主要视图：
  - 主窗口：`todo-tool/src/views/MainView.tsx`
  - 快捷窗口：`todo-tool/src/views/QuickView.tsx`
  - 强制提醒：`todo-tool/src/components/ForcedReminderOverlay.tsx`（由 `todo-tool/src/App.tsx` 的 reminder 分支驱动）
  - 设置窗口：`todo-tool/src/views/SettingsView.tsx`
  - 日历：`todo-tool/src/views/CalendarView.tsx`
  - 今日：`todo-tool/src/views/TodayView.tsx`

后端（Rust/Tauri）：

- Rust 入口（窗口创建 / 插件 / invoke_handler）：`todo-tool/src-tauri/src/lib.rs`
- 数据模型（serde snake_case）：`todo-tool/src-tauri/src/models.rs`
- Commands（invoke + 可测试 *_impl）：`todo-tool/src-tauri/src/commands.rs`
- 内存态（AppState）：`todo-tool/src-tauri/src/state.rs`
- 存储（data.json/settings.json + 原子写入 + 备份轮转）：`todo-tool/src-tauri/src/storage.rs`
- 调度器（提醒扫描与触发）：`todo-tool/src-tauri/src/scheduler.rs`
- 事件契约（state_updated / reminder_fired）：`todo-tool/src-tauri/src/events.rs`
- 托盘：`todo-tool/src-tauri/src/tray.rs`
- 窗口辅助：`todo-tool/src-tauri/src/windows.rs`

## 2) 当前已实现能力（以代码为事实来源）

- 多窗口：`main / quick / reminder / settings`（见 `todo-tool/src-tauri/src/lib.rs` 的 window builders）
- Project 与 Task.project_id：
  - Rust：`Project` / `Task.project_id`（见 `todo-tool/src-tauri/src/models.rs`）
  - 前端：对 project_id 做运行时兜底（见 `todo-tool/src/App.tsx` 的 `normalizeTask()`）
  - inbox 作为默认/兜底项目（多处以 `"inbox"` 作为默认值）
- 提醒体系：
  - ReminderKind：`none / normal / forced`
  - 调度：1 秒扫描（见 `todo-tool/src-tauri/src/scheduler.rs` 的 `collect_due_tasks`）
  - 事件：`reminder_fired`（Rust emit，前端消费）
- 本地存储与备份：
  - 主要文件：`data.json` / `settings.json`
  - 备份目录：`backups/`（最多保留 5 份）
  - 原子写入：临时文件 + rename（见 `todo-tool/src-tauri/src/storage.rs`）
- 日志（排障）：
  - 目录：同 `app_data_dir()`（与 `settings.json` 同目录）
  - 文件：`mustdo.log`（按 100MB 滚动，最多保留 30 份历史文件；见 `todo-tool/src-tauri/src/logging.rs`）
- 导入/导出（以 commands 为准）：JSON/CSV/Markdown 等（见 `todo-tool/src-tauri/src/commands.rs` 与 `todo-tool/src/api.ts`）
- 全局快捷键 + 托盘：
  - 插件：global shortcut / tray（见 `todo-tool/src-tauri/src/lib.rs`、`todo-tool/src-tauri/src/tray.rs`）
- 设置：
  - 基础项：theme/language/shortcut/close_behavior/minimize_behavior/备份计划等（见 `todo-tool/src/types.ts` 与 `todo-tool/src-tauri/src/models.rs`）

## 3) 当前约束（做改动时必须记住）

- 跨边界“契约”必须同步：`todo-tool/src/types.ts` ↔ `todo-tool/src-tauri/src/models.rs`
- 字段命名 snake_case；时间戳单位为“秒”（不是毫秒）
- Rust tests 不要启动真实 GUI/无限 loop（优先测 `*_impl` / `collect_due_tasks`）

## 4) 待做清单（Roadmap）

需求与里程碑请以 `REQUIREMENTS_PLAN.zh-CN.md` 为准（M1~M4）。

建议按“风险最小化”的顺序推进：

1. 先做纯前端 UI/交互（不动数据结构）
2. 再做数据结构与迁移（先加字段 + default，避免破坏性变更）
3. 最后再做调度器/提醒策略升级（需要 Rust + 前端联动 + 单测补齐）
