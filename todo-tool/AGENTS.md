# todo-tool (Frontend) - Agent Guide

本文件面向在 `todo-tool/src` 里修改 UI/交互逻辑的 agent。
后端/Rust 相关请看：`todo-tool/src-tauri/AGENTS.md`。

## 0) 技术栈与约束

- React 19 + TypeScript（Vite）
- Tauri v2 JS API：
  - `@tauri-apps/api`（window / event / invoke）
  - `@tauri-apps/plugin-notification`（系统通知 + action）
  - `@tauri-apps/plugin-opener`（打开系统设置页等）
- 路由：未使用 react-router；通过 `window.location.hash` + window label 决定视图。
- 样式：纯 CSS（集中在 `todo-tool/src/App.css`），通过 CSS variables + `data-theme`/`data-view` 做主题/窗口态切换。

## 1) 快速开始（在 `todo-tool/` 执行）

- 安装：`npm ci`
- 开发：`npm run tauri dev`
- 仅校验 TS + 构建：`npm run build`

Vite 端口固定：1420（见 `todo-tool/vite.config.ts`），被占用会直接失败。

## 2) 目录地图（前端）

- `todo-tool/src/App.tsx`：顶层状态与事件桥接（loadState/state_updated/reminder_fired）
- `todo-tool/src/views/QuickView.tsx`：快捷窗口（类似 launcher）
- `todo-tool/src/views/MainView.tsx`：主界面（列表/四象限、筛选、手动排序）
- `todo-tool/src/components/*`：可复用 UI 组件
- `todo-tool/src/api.ts`：对 Rust commands 的 invoke 封装（前端“后端 SDK”）
- `todo-tool/src/types.ts`：跨边界数据结构（必须与 Rust `models.rs` 一致）
- `todo-tool/src/App.css`：主题变量、布局、组件样式（大部分 UI 视觉都在这里）

## 3) 窗口与视图模型（非常重要）

应用有 4 个窗口/视图：

- main：主界面（启动时创建，URL `/#/main`）
- quick：快捷窗口（启动时创建，URL `/#/quick`，默认隐藏）
- reminder：强制提醒窗口（按需创建，URL `/#/reminder`，默认隐藏）
- settings：设置窗口（按需创建，URL `/#/settings`，默认隐藏）

注意（为什么要按需创建部分窗口）：

- WebView2 在 Windows 下偶发 `PostMessage failed ... 0x80070718`（配额不足）时，通常与启动阶段并发创建过多 Webview/窗口导致的消息队列压力有关。
- 当前策略：优先保证 `main/quick` 常驻，`reminder/settings` 由后端在需要时创建（见 `todo-tool/src-tauri/src/windows.rs`）。

`todo-tool/src/App.tsx` 用两件事推断当前视图：

- `window.location.hash`（当 label 不可用时）
- `getCurrentWindow().label`（Tauri 多窗口更可靠）

注意：

- “系统通知 action 的处理”只在 quick 窗口实例里注册（避免多窗口重复执行）。
- reminder 窗口是全屏透明 overlay：前端在进入 reminder view 时调用 `setSize/setPosition` 覆盖全屏。

## 4) 前后端事件与状态流

启动流程（前端）：

1. `loadState()`（invoke `load_state`）拉取 `[Task[], Settings]`
2. 监听 `state_updated`：
   - Rust 每次持久化后都会 emit（任务/设置变更、备份恢复等）
3. 监听 `reminder_fired`：
   - payload 为 `Task[]`（已按 important/due_at 排序）
   - 前端分流：
     - `forced`：进入强制提醒队列（显示 overlay）
     - `normal`：进入普通提醒队列（显示 NotificationBanner + 尝试系统通知）

普通提醒的系统通知策略（见 `todo-tool/src/App.tsx`）：

- 仅 main 窗口负责 `sendNotification`（避免重复通知）
- quick 窗口负责处理通知 action（“稍后 5 分钟 / 完成”），并把 quick 拉到前台

强制提醒的交互（reminder view）：

- 完成：`completeTask(taskId)`
- 稍后 5 分钟：`snoozeTask(taskId, now+300)`
- 关闭提醒：`dismissForced(taskId)`

## 5) 数据模型约定（避免跨边界 drift）

TS 数据结构定义在：`todo-tool/src/types.ts`

关键点：

- 字段名使用 snake_case（与 Rust serde 一致）
- 时间戳：秒（unix seconds），不是毫秒
- `Task.due_at` 必填；前端创建时默认“最近一次 18:00”
- `Task.reminder`：
  - normal 默认：due_at - 10min
  - forced 默认：due_at
  - snooze 优先级：`snoozed_until > remind_at > default_target`（后端判定）

如果你新增字段：

- 必须同步修改 `todo-tool/src-tauri/src/models.rs`
- 需要考虑旧数据的反序列化：Rust 侧用 `#[serde(default)]` 或默认函数兜底

## 6) UI/交互实现约定

组件复用优先级：

1. 先看 `todo-tool/src/components/*` 是否已有可复用组件（TaskCard/TaskComposer/TaskEditModal/ConfirmDialog 等）
2. 再扩展 CSS（集中在 `todo-tool/src/App.css`，尽量用现有 CSS variables）
3. 避免引入新的 UI 框架（当前项目无 Tailwind/AntD 等）

主题/窗口态：

- 主题：`document.documentElement.dataset.theme = settings.theme`
- 视图：`document.documentElement.dataset.view = view`
- 平台：`document.documentElement.dataset.platform = detectPlatform()`（供 CSS 做平台分支）
- CSS 中针对 `:root[data-theme="light"|"dark"]` 与 `:root[data-view="quick"|"main"|"reminder"]` 进行分支

快捷窗口（QuickView）行为约定：

- 失焦自动隐藏（除非 pinned 或有 modal）
- 窗口 bounds（位置/大小）会 debounce（2s）写入 settings.quick_bounds
- pinned 状态写入 settings.quick_always_on_top，并在 focus 变化时重申 always-on-top（某些平台 hide/show 会丢状态）

## 7) 常见改动 checklist

新增一个 UI 功能（不改 Rust）：

- 是否只影响某个 view（quick/main/reminder）？
- 相关 state 是否应该由 Rust 下发（state_updated）还是纯前端本地态？
- 是否需要持久化？如果是，尽量走 settings（Rust 保存）而不是 localStorage

新增一个 Rust command（需要前端调用）：

- 在 `todo-tool/src/api.ts` 增加 wrapper
- 在 `todo-tool/src-tauri/src/lib.rs` 注册 invoke handler
- 如果返回结构变更，更新 `todo-tool/src/types.ts`

## 8) 常见坑（避免踩雷）

- 多窗口环境下不要重复注册全局监听（通知 action / beep / reminder）：
  - 当前约定：beep 只在 quick；系统通知只在 main；action 只在 quick。
- `Date.now()` 是毫秒；业务时间戳用秒。创建任务时注意混用风险。
- Reminder 的触发逻辑主要在后端；前端不要自己“推测触发”，而是响应 `reminder_fired`。

## 9) 推荐技能（Codex skills / 前端）

如果你的 Codex 环境已安装相关 skills，前端侧优先推荐：

- `react-best-practices`：做 UI 性能/交互体验优化时优先参考（避免不必要 rerender、减少瀑布式异步、控制 bundle 等）。

跨边界改动（types / invoke / events）时：

- 先对照全局 `AGENTS.md` 的“推荐技能”与契约约定（`types.ts` / `models.rs` / snake_case / 秒级时间戳）。
- 如果需要同时改 Rust：转到后端文档 `todo-tool/src-tauri/AGENTS.md`，并优先使用 `m09-domain` / `m05-type-driven` / `m06-error-handling` 来约束数据与错误边界。
