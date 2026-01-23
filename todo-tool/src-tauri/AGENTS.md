# todo-tool/src-tauri (Backend) - Agent Guide

本文件面向在 `todo-tool/src-tauri` 修改 Rust 后端/本地存储/调度器/Tauri wiring 的 agent。
前端/UI 相关请看：`todo-tool/AGENTS.md`。

## 0) 技术栈与约束

- Rust edition 2021（crate：`todo-tool`，lib 名：`todo_tool_lib`）
- Tauri v2（多窗口：main/quick/reminder；托盘；全局快捷键；通知插件）
- 持久化：本地 JSON 文件（原子写入 + 自动备份轮转）
- 调度：`tokio::time::interval`（1s 轮询扫描提醒）

重要约束（测试/覆盖率）：

- `src/lib.rs::run()` 会启动真实运行时与无限循环调度器，不适合单元测试直接执行。
- 当前策略：将核心逻辑拆到可测试函数（例如 `collect_due_tasks`、`*_impl`），并用 `cfg(all(feature = "app", not(test)))` 避免测试构建触发 GUI/loop（支持 `--no-default-features` 跑 core-only 单测）。
- 后端测试用例设计文档：`todo-tool/src-tauri/testcases/README.md`

## 1) 开发/测试命令（在 `todo-tool/src-tauri/` 执行）

- 单元测试（library）：`cargo test --lib`
- 格式化：`cargo fmt`
- 静态检查：`cargo clippy --lib -- -D warnings`
- 覆盖率（可选）：`cargo llvm-cov --lib --summary-only`

## 2) 模块地图（谁负责什么）

- `src/lib.rs`：Tauri Builder wiring（插件、窗口创建、tray、shortcut、scheduler、invoke_handler）
- `src/models.rs`：数据模型（Task/Settings/RepeatRule/ReminderConfig…），serde snake_case
- `src/events.rs`：事件常量与 payload（`state_updated` / `reminder_fired`）
- `src/state.rs`：内存态 AppState（Arc<Mutex<...>>），任务/设置 CRUD + schema_version 输出
- `src/storage.rs`：data.json/settings.json 读写、原子写入、备份目录轮转（保留 5 份）
- `src/commands.rs`：Tauri commands（invoke）+ 持久化/备份判定 +（大量）单测覆盖
- `src/scheduler.rs`：1s 轮询筛选 due reminders，emit 事件，forced 时显示 reminder window
- `src/repeat.rs`：循环任务下一期 due_at 计算（含 DST/边界处理 + 单测）
- `src/tray.rs`：托盘菜单 + tooltip（待办数量）计算
- `src/windows.rs`：show/hide 辅助（避免散落在各处的 window API 调用）

## 3) 前后端契约（Rust 侧要守的规则）

前端通过 `invoke` 调用你的 commands，并依赖两类事件：

- `state_updated`：任何会影响 tasks/settings 的操作都应 emit（通常通过 `persist()` 完成）
- `reminder_fired`：调度器触发提醒列表（payload 为 `Vec<Task>`）

类型一致性：

- Rust：`todo-tool/src-tauri/src/models.rs`
- TS：`todo-tool/src/types.ts`
- 字段命名 snake_case、时间戳单位为“秒”

如果你新增/修改字段：

- 必须考虑旧 JSON 数据能否反序列化：
  - 用 `#[serde(default)]` / `#[serde(default = "...")]` 提供兜底
  - 不要引入必须字段且无默认值（会导致启动时 load 失败）

## 4) 新增/修改 command 的推荐模式

`src/commands.rs` 当前采用可测试架构：

- 业务逻辑写在 `*_impl(ctx, state, ...)`（纯 Rust，可单测）
- 真正的 Tauri command 是薄 wrapper：`#[tauri::command] fn foo(app: AppHandle, state: State<AppState>, ...)`
- 通过 `CommandCtx` trait 抽象：
  - app_data_dir 获取
  - emit state_updated
  - 更新 tray tooltip
  - shortcut 注册/回滚

新增一个 command 时的步骤：

1. 在 `src/commands.rs` 添加：
   - `fn your_command_impl(ctx: &impl CommandCtx, state: &AppState, ...) -> CommandResult<T>`
   - `#[tauri::command] pub fn your_command(app: AppHandle, state: State<AppState>, ...) -> CommandResult<T>`
2. 在 `src/lib.rs` 的 `invoke_handler![]` 注册该 command
3. 前端补 `todo-tool/src/api.ts` wrapper（以及 types 如有变更）
4. 为 `*_impl` 写单元测试（优先覆盖成功 + 失败/边界路径）

持久化约定：

- 任何改变 tasks/settings 的 command，通常都应调用 `persist(ctx, state)`
- `persist()` 会：
  - 确保目录存在
  - 决定是否自动备份（并更新 `settings.last_backup_at`）
  - 保存 tasks/settings
  - 更新 tray tooltip
  - emit `state_updated`

## 5) 调度器（提醒触发）规则

实现位置：`todo-tool/src-tauri/src/scheduler.rs`

当前策略：

- 每秒扫描一次（missed tick 采用 Skip）
- 过滤条件（`collect_due_tasks`）：
  - completed 跳过
  - reminder.kind == none 跳过
  - forced 且 forced_dismissed 跳过
  - 触发时间 target_time：
    - `snoozed_until` 优先
    - 其次 `remind_at`
    - 否则 default_target（normal：due-10min；forced：due）
  - 去重：`last_fired_at >= target_time` 表示已触发过，不再触发
- 排序：important 优先，其次 due_at 升序
- 触发时：
  - 对每个 task 写入 `last_fired_at`
  - `persist_reminder_state` 保存 tasks（不备份）并 emit `state_updated`
  - emit `reminder_fired`
  - 若包含 forced，则 show reminder window

注意：

- 调度器 loop 在 `cfg(all(feature = "app", not(test)))` 下运行；测试只覆盖 `collect_due_tasks`。
- 变更提醒语义时，必须同步前端（队列、通知策略、UI 文案）。

## 6) 循环任务规则

循环生成在 `complete_task_impl` 中发生：

- RepeatRule::None：完成后直接持久化并返回完成的 task
- RepeatRule != None：完成后生成“下一期任务”：
  - 新 id：`{old_id}-{timestamp}`
  - 重置 reminder（last_fired_at/forced_dismissed/snoozed_until）
  - due_at 通过 `repeat::next_due_timestamp(old_due_at, rule)` 计算

注意：

- `repeat.rs` 的时间计算使用 Local timezone，并对 DST/无效 timestamp 做了容错；改动要补齐单测。

## 7) 托盘与窗口行为

窗口行为集中在 `src/lib.rs`：

- quick 窗口 close => hide（prevent_close）
- main 窗口 close => 根据 settings.close_behavior：
  - Exit：直接退出
  - HideToTray：hide（prevent_close）

托盘：

- 菜单：打开快捷窗口/打开主界面/退出
- tooltip：`待办: N`（N=逾期未完成 + 今天到期未完成）

如果你新增窗口 API 能力或新插件：

- 检查并更新 capabilities：
  - `todo-tool/src-tauri/capabilities/*.json`

## 8) 常见坑（后端侧）

- 不要在 tests 里启动 `run()` 或调度器 loop；用 `*_impl`、`collect_due_tasks` 等纯逻辑入口测试。
- 对 settings/任务字段做破坏性变更时，优先“加字段 + default”而不是“改名/删字段”。
- I/O 错误要返回给前端：command 返回 `CommandResult` 的 error 字符串；不要直接 panic。
- 自动备份逻辑依赖 Local 时间（day/week/month）；涉及时间语义调整要补齐测试。

## 9) 推荐技能（Codex skills / 后端）

如果你的 Codex 环境已安装 rust-skills 相关 skills，后端侧建议按场景优先使用：

- Rust 总入口：
  - `rust-router`：Rust 编译错误/设计取舍/对比方案时的默认入口（会把问题路由到更具体的技能）。
- 编译器错误“定位类别”（ownership/borrow/trait bounds）：
  - `m01-ownership` / `m02-resource` / `m03-mutability` / `m04-zero-cost`：优先用它们定位根因，再决定是否需要 clone/Arc/Mutex/泛型约束调整。
- 领域建模与 schema 演进（`models.rs` / JSON 兼容）：
  - `m09-domain` + `m05-type-driven`：明确 Entity/Value Object、字段约束、不变量、默认值与迁移策略。
- 错误边界（command 返回、I/O 失败、数据损坏恢复）：
  - `m06-error-handling` + `m13-domain-error`：区分“可预期失败”与“bug/invariant”，决定用户提示/内部日志/是否可恢复。
- 并发、调度器与状态共享（`scheduler.rs` / `state.rs` / tokio）：
  - `m07-concurrency` + `m12-lifecycle`：Send/Sync、Arc/Mutex 选型、避免锁跨 `.await`、后台任务生命周期与 Drop 清理。
- 依赖与 feature 管理：
  - `m11-ecosystem` + `rust-deps-visualizer`：新增/裁剪 crate、feature 取舍、依赖树与版本冲突排查。
- 代码审查与“反模式”快速扫描：
  - `coding-guidelines` + `m15-anti-pattern`：clone/unwrap、全局可变状态、过度共享、复杂函数拆分等。
- Unsafe / FFI：
  - `unsafe-checker`：出现 `unsafe` / 裸指针 / ABI 相关改动时必须使用并补齐 `// SAFETY:` 说明。
- 读代码与影响面分析（通常需要 LSP 支持；若不可用则用 `rg` 手动替代）：
  - `rust-code-navigator` / `rust-call-graph` / `rust-symbol-analyzer` / `rust-trait-explorer` / `rust-refactor-helper`

需要查 crate 文档/版本/变更时：

- 可用 `rust-learner`（依赖浏览器/抓取链路的运行环境）；若不可用，直接以 docs.rs / crates.io 作为事实来源，并在代码里用 feature/版本号显式记录理由。
