# 发布说明（Tauri Updater + GitHub Releases）

本仓库使用 Tauri v2 updater 插件，并将更新产物发布到 GitHub Releases。

更新策略：**单通道**。所有发布都作为 `releases/latest` 的候选（`prerelease=false`），客户端固定从：

`https://github.com/Tioit-Wang/fk.todo/releases/latest/download/latest.json`

检查更新。

---

## 0) 强制约定（必须遵守）

### 0.1 Tag 约定（强制）

- 只能使用 **大写 V** 的 tag：`V<version>`
- 禁止使用 `v<version>`（小写 v）或其它格式
- `version` 必须符合：
  - 稳定版：`YYYYMMDD.<当月第N次发布>.<补丁>`
  - 预览版：`YYYYMMDD.<当月第N次发布>.<补丁>-bate[.N]`

示例：

- `V20260121.1.0`
- `V20260121.1.2-bate.1`

### 0.2 版本号必须三处一致（强制）

每次发布前，必须确保以下三个文件中的版本号完全一致（逐字符一致）：

- `todo-tool/package.json`
- `todo-tool/src-tauri/Cargo.toml`
- `todo-tool/src-tauri/tauri.conf.json`

CI 会在 release workflow 的 guard 阶段强校验，不一致将直接失败（不会发布，不会生成 `latest.json`）。

### 0.3 仅新密钥策略（重要限制）

本项目只关注当前（最新）updater 签名公钥配置。

这意味着：**如果历史已发布版本内置的是旧公钥，则它无法验证新签名产物，因而无法通过自动更新升级到新版本**。

这种情况下只能手动下载安装包升级（这是预期限制，不做旧密钥兼容）。

---

## 1) 一次标准发布流程

### 1.0 生成 updater 签名密钥（仅首次/更换密钥时需要）

在 `todo-tool/` 下执行（PowerShell）：

```powershell
.\node_modules\.bin\tauri signer generate -w "$env:USERPROFILE\.tauri\fk.todo.key"
```

- 私钥文件务必妥善保管，不要提交到仓库。
- 将命令输出的 **public key** 写入：`todo-tool/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。

### 1.0.1 配置 GitHub Actions secrets（CI 发布需要）

在 GitHub 仓库：`Settings -> Secrets and variables -> Actions`

- `TAURI_SIGNING_PRIVATE_KEY`：建议直接填私钥内容（而不是路径）
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：如果生成私钥时设置了密码则填写，否则无需

### 1.1 更新版本号（三处同步）

编辑并同步版本号到相同的 `version`（三处必须一致）：

- `todo-tool/package.json`
- `todo-tool/src-tauri/Cargo.toml`
- `todo-tool/src-tauri/tauri.conf.json`

### 1.2 运行本地自检脚本（推荐）

在仓库根目录执行（PowerShell）：

```powershell
.\scripts\check-release-version.ps1 -Tag V<version>
```

例如：

```powershell
.\scripts\check-release-version.ps1 -Tag V20260121.1.2-bate.1
```

### 1.3 打 tag 并推送（触发发布）

```bash
git tag V<version>
git push origin V<version>
```

只要 tag 满足约定且指向 release branch（`main`/`master`）上的提交，`.github/workflows/release.yml` 会：

- 构建各平台安装包
- 上传到 GitHub Release
- 上传 `latest.json`（updater 元数据）

### 1.4 运行时更新源（固定）

应用检查更新的地址为：

`https://github.com/Tioit-Wang/fk.todo/releases/latest/download/latest.json`

---

## 2) 常见问题排查

### 2.1 为什么没触发发布？

只会在推送 `V*` tag 时触发（注意是大写 V）。小写 `v*` 不会触发。

### 2.2 为什么客户端没有提示更新？

常见原因：

- `latest.json` 不存在或未上传（发布流程失败/被 guard 拒绝）
- tag 的 version 与应用实际版本号不一致，导致版本比较结果不符合预期
- 客户端是旧公钥版本，无法验证新签名（仅新密钥策略下的已知限制）
