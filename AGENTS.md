# fk.todo / MustDo（必做清单） - Agent Guide (Global)

本仓库是一个「桌面级 Todo 工具」项目（品牌：MustDo / 必做清单）：Tauri v2（Rust）+ React + TypeScript（Vite）。

如果你是自动化/AI 代理（agent），请先读这份全局说明，再按任务进入前端或后端的专用 AGENTS 文档：

- 语言约束：自然语言使用中文。
- 前端（React/TS + UI）：`todo-tool/AGENTS.md`
- 后端（Rust/Tauri commands + storage/scheduler）：`todo-tool/src-tauri/AGENTS.md`

另外两份“事实来源”文档也很重要：

- PRD（需求）：`REQUIREMENTS_PLAN.zh-CN.md`
- 项目现状/关键文件索引：`todo-tool/UNFINISHED.md`

## 1) 仓库结构（以 workspace 根目录为准）

- `todo-tool/`：应用主体（Vite 前端 + Tauri 配置 + Rust 后端子项目）
  - `todo-tool/src/`：React/TypeScript 前端
  - `todo-tool/src-tauri/`：Rust 后端（Tauri app + commands + storage + scheduler）
- `.github/workflows/release.yml`：发布流水线（push tag `V*` 触发，多平台构建 + 发布 GitHub Release）
- `REQUIREMENTS_PLAN.zh-CN.md`：需求/规划（MVP + 迭代路线）

## 2) 关键命令（开发/构建/测试）

前端/整体（在 `todo-tool/` 下执行）：

- 安装依赖：`npm ci`
- 开发运行（Tauri）：`npm run tauri dev`
- 仅构建前端：`npm run build`
- 预览前端：`npm run preview`
- 构建（不打包 installer，CI 用）：`npm exec -- tauri build --no-bundle`
- 构建（带 bundle）：`npm run tauri build`

后端（在 `todo-tool/src-tauri/` 下执行）：

- 单元测试（library）：`cargo test --lib`
- 格式化：`cargo fmt`
- 静态检查：`cargo clippy --lib -- -D warnings`
- 覆盖率（可选，需要 cargo-llvm-cov）：`cargo llvm-cov --lib --summary-only`

平台依赖（Linux CI/本地）：

- WebKit/GTK 等依赖见：`.github/workflows/release.yml`

## 3) 架构概览（前后端边界）

这不是传统“前后端服务”项目，而是桌面应用：

- “前端”：`todo-tool/src` 的 React UI，负责交互、渲染、通知 UI、调用 Tauri commands。
- “后端”：`todo-tool/src-tauri` 的 Rust 逻辑，负责本地数据持久化、调度器、托盘、全局快捷键、窗口控制。

跨边界交互方式：

1. 前端通过 `invoke` 调用 Rust commands（见 `todo-tool/src/api.ts`）。
2. Rust 在变更后通过事件推送状态（`state_updated`）给前端（见 `todo-tool/src-tauri/src/events.rs`）。
3. Rust 调度器触发提醒事件（`reminder_fired`），前端决定 UI 展示与系统通知策略。

必须保持一致的“契约”：

- TS 类型：`todo-tool/src/types.ts`
- Rust 模型：`todo-tool/src-tauri/src/models.rs`
- 字段命名规则：snake_case（serde / JSON / TS 一致）

## 4) 数据与存储（本地 JSON + 备份）

数据保存在系统 app data 目录（由 Tauri `app_data_dir()` 提供），典型文件：

- `data.json`：任务数据（TasksFile，含 schema_version）
- `settings.json`：设置（SettingsFile，含 schema_version）
- `backups/`：备份目录（最多保留 5 份，自动轮转）

写入策略（Rust 实现）：

- 原子写入：临时文件 + rename 覆盖（避免崩溃导致 JSON 损坏）
- 备份：按 settings 中的 schedule 决定是否生成（Daily/Weekly/Monthly/None）

## 5) CI/CD 与发布产物

GitHub Actions：`.github/workflows/release.yml` 在 push tag `V*` 时执行（多平台打包并发布 GitHub Release）：

- 版本一致性 guard：tag version 必须与 `todo-tool/package.json`、`todo-tool/src-tauri/Cargo.toml`、`todo-tool/src-tauri/tauri.conf.json` 完全一致
- 构建矩阵：ubuntu/windows/macos（包含 macOS aarch64 + x86_64）
- 打包方式：通过 `tauri-apps/tauri-action@v0` 生成 installer/bundle（Linux AppImage / Windows NSIS / macOS DMG）
- finalize：生成并上传 `latest.json`，并在所有平台产物齐备后再把 release 从 draft 发布（预览版 `-bate` 不覆盖 `/releases/latest`）

## 6) 版本号规范（SemVer 兼容）

本项目版本号遵循 SemVer 结构：`MAJOR.MINOR.PATCH[-PRERELEASE]`，但每一段的含义按下面约定解释：

- `MAJOR`：发布日期，格式 `YYYYMMDD`（例如 `20260121`）。
- `MINOR`：当月第 N 次发布（从 1 开始递增；跨月重置）。
- `PATCH`：同一次发布的补丁/热修复序号（从 0 开始递增）。
- `PRERELEASE`：发布通道标识：
  - 预览版：`-bate`（如需同一版本多次预览，可使用 `-bate.1` / `-bate.2`...）。
  - 正式版：不带 `-...` 后缀（例如 `20260121.1.0`）。

示例（对应格式：`[日期].[当月的几次发布].[补丁]-[预览/正式发布]`）：

- `20260121.1.0-bate`：2026-01-21，当月第 1 次发布的预览版。
- `20260121.1.0`：对应的正式发布。
- `20260121.1.1`：同一次发布的第 1 个补丁（热修复）。

发布用的 Git tag 约定以 `V` 开头并包含完整版本号（例如 `V20260121.1.0-bate`）。

## 7) 修改指南（给 agent 的默认做法）

当你要实现一个需求/修复问题时，优先按下面顺序收敛风险：

1. 找“真实入口”：
   - UI 入口：`todo-tool/src/App.tsx`
   - Rust 入口：`todo-tool/src-tauri/src/lib.rs`
2. 如果涉及数据结构或跨边界字段：
   - 同步修改 `todo-tool/src/types.ts` 与 `todo-tool/src-tauri/src/models.rs`
   - 关注 serde default（避免旧数据反序列化失败）
3. 如果新增/修改 command：
   - Rust：新增 `*_impl` + `#[tauri::command]` wrapper，并注册到 `invoke_handler![]`
   - TS：补 `todo-tool/src/api.ts` wrapper
4. 跑最小验证：
   - 前端：`npm run build`
   - 后端：`cargo test --lib`

## 8) 推荐技能（Codex skills）

如果运行环境已安装 Codex skills（例如 rust-skills / react-best-practices），建议按场景优先使用下列技能来减少走弯路与降低改动风险：

- Rust 后端（Tauri commands / storage / scheduler）：
  - `rust-router`：Rust 问题总入口（编译错误、设计取舍、crate 对比/最佳实践等）。
  - `m01-ownership` / `m02-resource` / `m03-mutability` / `m04-zero-cost`：处理 ownership/borrow/trait bounds 等典型编译错误（例如 E0382/E0502/E0277），避免“为了过编译到处 clone”。
  - `m06-error-handling` / `m13-domain-error`：command 错误分层（用户可读 vs 内部可诊断）、是否可恢复/是否需要重试。
  - `m07-concurrency` / `m12-lifecycle`：tokio 调度、Arc/Mutex 状态共享、后台任务生命周期、Drop/清理时机。
  - `m09-domain` / `m05-type-driven`：Task/Settings 等领域建模、schema 演进、默认值/不变量约束。
  - `m11-ecosystem` / `rust-deps-visualizer`：crate/feature 选择、依赖树、体积与版本冲突排查。
  - `coding-guidelines` / `m15-anti-pattern`：Rust 风格与反模式扫描（clone/unwrap、锁跨 await、过度共享状态等）。
  - `unsafe-checker`：出现 `unsafe` / FFI / 裸指针相关改动时必须使用。
- 前端（React/TS + UI）：
  - `react-best-practices`：列表/状态订阅/渲染性能/拆包等优化建议（即使不是 Next.js 也有参考价值）。
- 读代码与影响面分析（通常需要 LSP 支持；若不可用则用 `rg` 手动替代）：
  - `rust-code-navigator`：跳转定义/查找引用
  - `rust-call-graph`：调用关系（谁调用了/调用了谁）
  - `rust-symbol-analyzer`：项目结构与符号总览
  - `rust-trait-explorer`：trait 实现关系梳理
  - `rust-refactor-helper`：重构前的影响面分析

---

更详细的工作流与注意事项请看：

- 前端：`todo-tool/AGENTS.md`
- 后端：`todo-tool/src-tauri/AGENTS.md`
