# Rust 后端测试用例（todo-tool/src-tauri）

本文档用于记录 `todo-tool/src-tauri/src` 下 **所有 Rust 源文件** 的功能点与测试用例设计，并与代码中的单元测试实现保持一致。

## 目标

- 覆盖 Rust 后端核心业务逻辑：任务状态管理、存储、重复规则计算、提醒筛选、命令处理等。
- 覆盖率目标：对 `todo_tool_lib`（library target）执行 `cargo llvm-cov --lib` 时达到 **100% 行覆盖率**。

## 覆盖率范围说明（非常重要）

- 覆盖率以 **library target `todo_tool_lib`** 为统计范围（`cargo llvm-cov --lib`）。
- Tauri GUI/运行时入口（例如 `src/lib.rs::run`）会启动真实运行时并包含无限循环调度器等行为，不适合在单元测试中直接执行。
  - 这类入口在 `cfg(test)` 下会被替换/跳过（仅影响测试构建，不影响发布构建）。
  - 其核心逻辑被拆分并通过可测试模块覆盖；入口本身通过编译保证与少量非 GUI 的单元测试间接验证。

## 如何运行

在 `todo-tool/src-tauri` 目录下：

1) 运行测试

```bash
cargo test --lib
```

2) 生成覆盖率（需要已安装 `cargo-llvm-cov` 与 `llvm-tools-preview`）

```bash
cargo llvm-cov --lib --summary-only
```

如需 HTML 报告：

```bash
cargo llvm-cov --lib --html
```

## 用例矩阵（逐文件 / 逐功能）

### `build.rs`

- `main()`
  - 用例：编译期运行 build script（Cargo 默认行为）。
  - 说明：build script 不纳入 `--lib` 覆盖率统计范围，保持为最小逻辑即可。

### `src/main.rs`

- `main()`
  - 用例：二进制入口仅调用 `todo_tool_lib::run()`。
  - 说明：本项目覆盖率统计以 `--lib` 为准，`src/main.rs` 不在统计范围；但会随 `cargo test` 的编译过程被动校验。

### `src/lib.rs`

- 模块声明：`commands/events/models/repeat/scheduler/state/storage/tray/windows`
  - 用例：编译期/链接期校验模块组织无误。
- `run()`
  - 功能：构建 Tauri App（插件、窗口、托盘、全局快捷键、调度器、事件处理、命令注册）。
  - 测试策略：
    - `cfg(test)` 下不直接启动 Tauri 运行循环；
    - 核心逻辑通过各模块单测覆盖（详见下方各文件）。

### `src/events.rs`

- 常量：`EVENT_REMINDER`, `EVENT_STATE_UPDATED`
  - 用例：构造并序列化/拷贝事件 payload 时不出错（覆盖常量使用场景）。
- `StatePayload { tasks, settings }`
  - 用例：可构造、可序列化（由命令/调度器相关测试间接覆盖）。

### `src/models.rs`

- `ReminderKind` / `ReminderConfig::default()`
  - 用例：默认值正确（kind=none，字段均为 None/false）。
- `RepeatRule`（serde tag = "type"）
  - 用例：各枚举变体序列化/反序列化正确；字段缺失/默认行为符合预期。
- `Task` / `Step`
  - 用例：serde snake_case 字段映射正确；`sort_order` 缺失时默认=0。
- `Settings::default()`
  - 用例：默认快捷键/主题/备份策略等字段正确。
  - 用例：serde `#[serde(default)]` 与 `#[serde(default = "...")]` 的字段缺失时能补齐默认值。
- `BackupSchedule` 默认值
  - 用例：反序列化缺失时默认 `daily`。
- 私有默认函数
  - 用例：通过反序列化缺失字段触发（例如 `default_forced_color()`）。

### `src/state.rs`

- `AppState::new(tasks, settings)`
  - 用例：task.sort_order 为 0 时自动填充为 `created_at * 1000`。
- `tasks_file()` / `settings_file()`
  - 用例：schema_version 正确；内容等于当前内存态克隆。
- `tasks()` / `settings()`
  - 用例：返回克隆，外部修改不影响内部。
- `add_task()` / `update_task()`
  - 用例：新增、更新按 task.id 生效；更新不存在 id 时不 panic。
- `replace_tasks()`
  - 用例：批量替换时同样补齐 sort_order。
- `swap_sort_order(first, second, updated_at)`
  - 用例：两任务均存在时交换 sort_order 并更新 updated_at；任一不存在返回 false。
- `complete_task(task_id)`
  - 用例：存在时标记完成并返回克隆；不存在返回 None。
  - 用例：完成时清理 snooze、写入 last_fired_at。
- `remove_task()` / `remove_tasks()`
  - 用例：删除单个/批量 id 生效；不包含的 id 不影响其它任务。
- `mark_reminder_fired(task, at)`
  - 用例：存在时更新 last_fired_at；不存在时无副作用。
- `update_settings(settings)`
  - 用例：覆盖旧 settings。

### `src/storage.rs`

- `Storage::ensure_dirs()`
  - 用例：创建 backups 目录成功；在非法路径上返回 Io 错误。
- `save_tasks(with_backup = false/true)` / `save_settings()`
  - 用例：原子写入 JSON；存在旧文件时创建备份；备份数量超过上限时清理。
- `load_tasks()` / `load_settings()`
  - 用例：读取并反序列化成功；文件不存在/JSON 无效返回错误。
- `list_backups()`
  - 用例：返回 (name, modified_at) 列表；顺序按 modified 时间排序；时间获取失败时回退为 0。
- `restore_backup(filename)` / `restore_from_path(source)`
  - 用例：可恢复并覆盖 data.json；返回恢复出的 TasksFile。
- `StorageError` Display/From
  - 用例：Io/Json 分支格式化输出覆盖。

### `src/repeat.rs`

- `next_due_timestamp(due_at, repeat)`
  - 用例：RepeatRule::None 返回同一日期时间（同一 timestamp 或等价 timestamp）。
  - 用例：Daily（workday_only=false/true）分别覆盖普通 + 跳过周末逻辑。
  - 用例：Weekly days 为空与非空两条路径。
  - 用例：Monthly/Yearly 的 day/month clamp（0、超过范围、2 月边界）。
  - 用例：时间换算的 DST/歧义/不存在场景（通过可控时区在单元测试里覆盖）。

### `src/scheduler.rs`

- `collect_due_tasks(state, now)`
  - 用例：过滤 completed / reminder none / forced dismissed。
  - 用例：target_time 优先级：snoozed_until > remind_at > default_target。
  - 用例：last_fired_at >= target 时不重复触发。
  - 用例：排序：important 优先，其次 due_at 升序。
  - 说明：调度器的无限循环/异步 spawn 不适合单元测试直接跑，核心筛选逻辑在本函数覆盖。

### `src/tray.rs`

- `pending_count(tasks)`
  - 用例：统计未完成且「已超时」或「今天到期」任务数量。
  - 用例：completed 任务不计入；极端 timestamp（无法解析为本地时间）不计入。
- `update_tray_count(app, tasks)`
  - 用例：计算 tooltip 文案；无托盘实例时不 panic（测试环境通常无真实 tray）。

### `src/windows.rs`

- `show_reminder_window(app)` / `hide_quick_window(app)`
  - 用例：窗口存在时调用 show/hide；窗口不存在时无副作用、不 panic。

### `src/commands.rs`

- `CommandResult<T>` + `ok()` / `err()`
  - 用例：成功/失败结构体构造正确。
- 自动备份判定
  - `should_auto_backup(settings, now)`
  - `is_new_day/week/month(last, now)`：last=None 与 last=Some 分支；同一天/同周/同月与跨天/跨周/跨月。
- 核心命令（均需覆盖成功与失败路径）
  - `load_state`：读取任务/设置、更新 state.settings；覆盖 app_data_dir/ensure_dirs 出错分支。
  - `create_task` / `update_task`：sort_order=0 自动填充；persist 失败返回 error。
  - `swap_sort_order`：不存在 id 返回 "task not found"；存在则 persist。
  - `complete_task`：
    - 不存在 id 返回 error；
    - RepeatRule::None：只完成并持久化；
    - RepeatRule != None：创建下一次任务并重置提醒字段。
  - `update_settings`：
    - shortcut 不变：仅持久化；
    - shortcut 无效：返回 error；
    - 注册失败：尝试回滚旧快捷键；
    - 持久化失败：回滚 settings 与快捷键。
  - `snooze_task` / `dismiss_forced`：存在/不存在 task 两分支；persist 失败。
  - `delete_task` / `delete_tasks`：删除成功；persist 失败。
  - 备份相关：
    - `list_backups`：成功与失败；
    - `create_backup`：成功与失败；更新 last_backup_at；
    - `restore_backup` / `import_backup`：成功与失败；替换 tasks 并 emit state_updated。
