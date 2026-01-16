# 未完成内容清单（MVP Remaining Work）

> 生成时间：2026-01-16

## 当前已完成（可用/可编译）

- 工程已创建：Tauri v2 + React（`todo-tool/`）
- 插件：global shortcut、notification、tray（Rust 侧托盘菜单 + 快捷键注册）
- 数据层（Rust）：JSON 文件存储、原子写入、自动备份轮转（保留 5 份）
- 调度器（Rust）：1s 轮询扫描 due reminder，触发 `reminder_fired` 事件并尝试展示 reminder 窗口
- 快捷窗口（前端逻辑）：
  - 任务 CRUD（创建、更新、删除、完成）
  - 默认到期时间：最近一次 18:00（前端创建时设置）
  - quick 默认列表：逾期 + 今天
  - 排序：逾期优先 -> 到期时间 -> 重要 -> 创建时间
  - 任务展开区：可设置提醒（none/normal/forced），循环规则（RepeatRule）
- 强制提醒（前端/后端联动）：
  - Rust 调度触发窗口显示
  - 前端 `#/reminder` 界面支持：立即完成 / 稍后 5 分钟 / 关闭提醒
- 构建产物：已可 `npm run build` 与 `npm run tauri build` 生成安装包

## 未完成（必须补齐）

### 1) 主界面（四象限）完整实现（t6）

目前主界面仅是占位（`src/App.tsx` 的 `MainWindow()` 显示“待实现”）。缺失：

- 四象限真实数据渲染：按 `task.quadrant` 分组展示
- 四象限内任务操作：
  - 添加 / 编辑 / 删除 / 完成
  - 展开步骤（步骤 CRUD）
  - 备注编辑
- 拖拽跨象限：拖拽改变 `task.quadrant` 并持久化
- 视图切换：四象限视图 <-> 列表视图
- 筛选与排序（必须）：
  - 筛选：到期范围（逾期/今天/明天/未来/全部）、重要性、循环状态、提醒状态
  - 排序：到期时间、添加时间、手动排序
- 批量操作（必须）：
  - 批量删除
  - 批量标记完成

### 2) 步骤（Steps）逻辑（快捷窗口/主界面一致）

目前步骤只展示，不支持：
- 添加步骤
- 删除步骤
- 勾选步骤完成状态
- 删除任务时联动删除步骤（数据结构已支持，但 UI 未实现）

### 3) 系统通知权限引导（前端设置页缺失）

Rust 已接入 notification 插件，但缺少：
- 设置页 UI：检测权限、申请权限、权限被拒绝时的引导入口
- 普通提醒通知上的交互按钮（稍后/完成）在不同平台支持差异，需要确认实现方式（MVP 可退化为点击通知打开应用）

### 4) 快捷键自定义（Settings UI 缺失）

Rust 已支持更新设置后尝试重新注册快捷键，但缺少：
- 设置页 UI（编辑快捷键字符串）
- 冲突处理与错误提示（目前仅 best-effort）

### 5) Reminder 调度更严格的去重与队列

当前 scheduler 的去重策略为：`last_fired_at >= target => skip`。
仍需完善：
- 多任务同一时刻强制提醒：队列逐个展示（目前前端只取第一条）
- `forced` 与 `normal` 的区分行为：
  - normal 应该走系统通知
  - forced 才打开 overlay 窗口

### 6) 退出/关闭行为的完整一致性

Rust 对 main window close 已按 settings 处理（HideToTray/Exit），但：
- 缺少 Settings UI 让用户切换
- Quick window close 固定 hide（符合默认）

## 需要的下一步命令（开发者执行）

- 开发运行：
  - `cd todo-tool`
  - `npm run tauri dev`
- 打包：
  - `npm run tauri build`

## 关键文件位置

- 前端主逻辑：`todo-tool/src/App.tsx`
- 前端样式：`todo-tool/src/App.css`
- Rust 后端入口：`todo-tool/src-tauri/src/lib.rs`
- Rust commands：`todo-tool/src-tauri/src/commands.rs`
- Rust scheduler：`todo-tool/src-tauri/src/scheduler.rs`
- Rust storage：`todo-tool/src-tauri/src/storage.rs`
- PRD：`桌面级Todo工具需求文档.md`
