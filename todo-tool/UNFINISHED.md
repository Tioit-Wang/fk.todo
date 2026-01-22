# 未完成内容清单（MustDo / 必做清单 · MVP Remaining Work）

> 生成时间：2026-01-16（更新：2026-01-22）

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

- 已全部完成（功能已对齐需求文档）

## 下一阶段增强（非 MVP / 体验与效率升级）

> 本节不属于 2026-01-16 版本的 MVP “必须补齐”范围，而是后续增强功能的推进清单。
> 详细拆解与验收标准见：`todo-tool/PLAN_TODO.md`（已全部完成）。

- [x] 批量选择与批量操作（完成/删除/推迟；仅列表视图）
- [x] 任务卡片展开层（步骤/备注摘要）
- [x] 搜索（title/notes/steps/tags）
- [x] 一键推迟/快速调度（含提醒联动）
- [x] 标签（tags）与筛选
- [x] 导出（JSON/CSV/Markdown）
- [x] 今日计划（今日焦点选择器（最多 3 个）+ 每日提示）

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
