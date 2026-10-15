# 本仓库维护说明

来源为 [tray-icon 0.21.3](https://github.com/tauri-apps/tray-icon/tree/a0081a3b833ab3382d2c8d2142df76ccaabaadf6)，许可为 MIT OR Apache-2.0。`LICENSE-MIT`、`LICENSE-APACHE` 与 `LICENSE.spdx` 保留上游原文。

## 保留本地副本的原因

macOS 27 在托盘图标永久挂载 NSMenu 时会丢失左键事件。本仓库将 [PR #365](https://github.com/tauri-apps/tray-icon/pull/365) 的临时菜单挂载修复回移到 0.21.3，经 `src-tauri/Cargo.toml` 的 `[patch.crates-io]` 接入，保持现有 Tauri 依赖组合。

上游合并提交为 `42eb44ea1507d51b68a8b2fbb0d96a9c85f5b4cd`；本仓库引入提交为 `5c5559f725b45c24b88e293f3641b2aeb2a496fb`。差异集中在 macOS 托盘事件：右键时临时设置菜单、执行系统菜单点击并随后清除；左键保留事件转发。现有源文件与 Git 历史是差异的权威记录。

## 升级

1. 核对新 tray-icon 是否已包含等价修复以及与当前 Tauri／Rust 的依赖兼容。
2. 对照上述上游版本和本地源文件，确认其他平台没有意外改动；保留原版权文件。
3. 更新锁文件并运行原生 fmt、clippy、测试和桌面 CI 构建。
4. 将 macOS 27 左／右键、菜单重入和主动打开行为列为用户验收。
5. 上游版本足够后才移除 Cargo patch 和此 vendor 副本，不能只删除目录。
