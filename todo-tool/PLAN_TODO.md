# MustDo 下一阶段全量实现计划（1/2/3/4/6/9/10）

> 本文档用于把“要做什么、怎么做、验收标准是什么”写清楚，方便研发/测试按清单推进与回归。
>
> 范围：对应你选择的功能编号 **1、2、3、4、6、9、10**  
> 约束：Tauri v2（Rust）+ React + TypeScript，跨边界字段 snake_case，时间戳单位=秒（unix seconds）。

## 0. 总目标（Outcome）

- 把 MustDo 从 “能用的 MVP” 提升为 “更高效、更可控、更能推动执行” 的桌面 Todo：
  - 更快：批量处理、搜索定位、一键推迟
  - 更清晰：任务卡片展开查看步骤/备注、标签分类
  - 更聚焦：今日焦点 3 件事 + 每日提示
  - 更可控：导出 JSON/CSV/Markdown

## 1. 功能清单（按编号）

### 1) 批量选择与批量操作（MainView）

- [x] 进入/退出批量模式
- [x] 多选（点击/全选/清空）
- [x] 批量完成（含循环任务：生成下一期）
- [x] 批量删除（走后端 delete_tasks，一次持久化）
- [x] 批量推迟（+10m/+1h/明天18:00/下个工作日9:00）
- [x] 批量仅在「列表」视图可用（切换到四象限会自动退出并清空选择）
- [x] 不支持批量移动象限（避免象限视图误操作与拖拽冲突）
- [x] 后端 bulk commands：减少多次 persist 与 state_updated 抖动

验收：
- 批量删除有二次确认；批量完成对循环任务有明确提示；所有批量操作完成后 UI 立即刷新且不丢任务。

### 2) 任务卡片展开层（TaskCard）

- [x] TaskCard 支持展开/收起
- [x] 展开/收起按钮固定在 action 最后（避免误点）
- [x] 展开显示 steps（可勾选完成/删除/新增）
- [x] 展开显示 notes 摘要（主界面显示，快捷窗口可不显示或只显示摘要）
- [x] 收起态也预览前 3 个 steps（更紧凑显示，超过显示 +N）

验收：
- 展开层对 steps 的改动会持久化；展开态不会因 state_updated 刷新而频繁丢失。

### 3) 全局搜索 / 快速定位

- [x] 主界面搜索输入框（title/notes/steps/tags）
- [x] 快捷窗口搜索（同范围，弱化 UI 即可）
- [x] 适度 debounce（输入不卡顿）
- [x] 单测覆盖：taskMatchesQuery / parseTags

验收：
- 1000+ 任务输入搜索不卡顿；搜索与筛选/排序可叠加。

### 4) 一键推迟/快速调度（TaskCard）

- [x] 单条任务一键推迟（+10m/+1h/明天18:00/下个工作日9:00）
- [x] 推迟会同步更新提醒（维持“提前量”语义，并重置 snooze/last_fired/forced_dismissed）

验收：
- 推迟后任务立即移动到正确分组；提醒会在新时间按规则触发（不会沿用旧 last_fired_at 导致不触发）。

### 6) 标签（tags）

- [x] 数据模型：Task.tags（默认 []，旧数据兼容）
- [x] 创建时支持 `#tag` 语法解析（TaskComposer）
- [x] 编辑时可维护 tags（TaskEditModal）
- [x] TaskCard 展示 tags（chips）
- [x] 主界面支持按 tag 筛选；搜索包含 tags

验收：
- 旧数据不报错；tags 可持久化/筛选/搜索。

### 9) 导出（SettingsView）

- [x] 后端 export commands（JSON/CSV/MD）写入 `app_data_dir/exports`
- [x] 设置页提供导出按钮并展示导出路径
- [x] 导出内容包含 tags/steps/notes（按格式合理呈现）

验收：
- 导出后文件可被外部工具打开（CSV/MD）；大数据量不崩溃。

### 10) 今日复盘 / 今日计划（TodayView）

- [x] 新增 `#/main/today` 页面：纯「今日焦点选择器」（最多 3 个、候选仅未完成、支持搜索）
- [x] Settings 持久化字段：today_focus_date / today_focus_ids / today_prompted_date（旧数据兼容）
- [x] 每天首次打开主界面：若未设置焦点，弹出提示（可“今天跳过”）
- [x] 选择器：从任务列表中选择 0-3 个焦点任务

验收：
- 同一天只提示一次；焦点任务删除/完成后自动从列表剔除；页面只承载“焦点选择”单一目的。

### 11) 交互基础设施（ConfirmDialog / Toast）

- [x] 所有确认弹窗使用自定义 `ConfirmDialog`（不使用 `window.confirm()`）
- [x] 所有轻提示/错误提示使用自定义 Toast / `ConfirmDialog`（不使用 `window.alert()`）
- [x] 单测守卫：禁止在 `src/` 中出现 `alert(`/`confirm(`（见 `todo-tool/tests/no-native-dialogs.test.ts`）

## 2. 数据契约变更（必须同步）

- Task：
  - [x] `tags: string[]`（默认 `[]`）
- Settings：
  - [x] `today_focus_date?: string`（本地日期 `YYYY-MM-DD`）
  - [x] `today_focus_ids: string[]`（最多 3 个）
  - [x] `today_prompted_date?: string`（避免一天弹多次）

涉及文件：
- 前端：`todo-tool/src/types.ts`
- 后端：`todo-tool/src-tauri/src/models.rs`

## 3. 最小验证命令（开发者）

前端（在 `todo-tool/`）：

```bash
npm test
npm run build
```

后端（在 `todo-tool/src-tauri/`，避免 GUI 依赖）：

```bash
cargo test --lib --no-default-features
```

## 4. 风险与处理策略

- 批量完成 + 循环任务：必须保证“生成下一期”的语义与单条完成一致。
- 推迟/改期 + 提醒：必须重置 `forced_dismissed/last_fired_at/snoozed_until`，否则会出现“永不再提醒”或“立即提醒”的异常。
- 多窗口：通知 action/提示音的注册范围不能打破现有约定（main 负责 sendNotification；quick 负责 action；quick 负责 beep）。
