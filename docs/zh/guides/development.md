# 开发与检查

## 环境

Node 使用根目录 `.nvmrc`（当前 24.21.0），pnpm 使用 `package.json` 的 `packageManager`（当前 12.11.2）。Rust 使用本机已安装的 stable，不为常规检查更换工具链。原生应用需要 Tauri 2 的平台构建依赖；Android 另见 [Android](../../android.md)。

Windows 需 Visual Studio C++ 工具与 Windows SDK；脚本 `run-in-vsdevcmd.mjs` 负责对应架构环境。macOS 需要 Xcode Command Line Tools。Linux CI 安装 WebKitGTK 4.1、Ayatana AppIndicator、librsvg、libdbus（系统凭据库 Secret Service）与 patchelf。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

依赖变动时才更新锁文件。不要删除缓存来代替故障定位。`.env.example` 只用于开发者主动运行的辅助脚本；普通聊天在应用内配置提供商，不能把真实凭据写进源码。

## 同一套检查定义

```sh
pnpm run ci                 # 前端检查、测试、Web 构建和原生检查
pnpm ci:frontend        # CI 前端 job 使用相同定义
pnpm ci:rust            # cargo +stable fmt / clippy / test
```

`ci:basic-check` 包含静态检查、格式、类型、国际化、隐私与技能检查。pre-commit 调用它，不自动修改待提交文件。完整前端检查还运行 renderer、升级迁移、内置目录校验和构建。CI 单独运行 `pnpm audit --audit-level high` 与固定版本 `cargo audit`，高危／严重告警阻断合并；暂无法修复的条目（仅能通过主版本升级或上游无修复）记录在 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas` 与 CI 的 `--ignore` 参数中。所有 job 均设置 `timeout-minutes`，Android 模拟器步骤单独限时 40 分钟；Actions 继续固定到提交 SHA。

检查器职责：Biome 负责格式和 Tailwind 类顺序；Oxlint 负责通用及类型静态规则；ESLint 负责 React、导入排序、i18n 和日志项目规则，已有 Oxlint 规则映射关闭重复项。`pnpm lint` 为开发者主动修复入口，不作为只读 CI 检查。

针对性检查可直接运行对应测试文件，提交证据必须来自该提交的完整快照。应用功能与界面验收使用虚拟接口，未执行项目须明确标记。

## 候选清理扫描

```sh
npm exec --yes --ignore-scripts --package=knip@6.41.0 -- knip --no-progress
npm exec --yes --ignore-scripts --package=depcheck@1.4.7 -- depcheck
cargo +stable machete --skip-target-dir src-tauri
```

Knip 入口见 `knip.json`，包括多窗口、worker、包导出及手动 CLI。cargo-machete 使用已核验的 0.9.2。扫描不是删除许可：动态加载、类型兼容、历史迁移和构建资源必须另核引用。

## 构建

```sh
pnpm build:mac
pnpm build:windows:x64
pnpm build:windows:arm64
pnpm tauri:build:android
```

`vite.config.ts` 仅构建 React 主窗口和快捷助手，Tauri 读取 `out/renderer` 打包。`.github/workflows/release-build.yml` 手动运行且 version 留空时只生成制品；只有标签或显式版本输入才发布。

工作流 Action 固定提交，Node／pnpm 与本地共用版本源，原生依赖使用 Cargo.lock。平台 SDK 和签名环境也影响产物，不能把构建输入固定等同于不同机器逐字节相同。
