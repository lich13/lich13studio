# 模块地图

以当前 0.1.38 源码为准。初始删除计划已完成，旧清单保存在 Git 历史中。

| 范围 | 主要入口 | 边界 |
| --- | --- | --- |
| 原生运行时 | `src-tauri/src/lib.rs`、`src-tauri/gen/android` | 窗口、HTTP、文件、后台服务 |
| 聊天与助手 | `src/renderer/src/pages/home`、`store/thunk/messageThunk.ts` | 渲染、消息生命周期、冻结请求目标 |
| 选择器 | `src/renderer/src/components/ModelProviderSelect.tsx` | 先模型后提供商，独立选择 |
| 请求构建 | `src/renderer/src/aiCore`、`packages/aiCore` | 两种协议、请求模式及强度降级 |
| 平台目录 | `packages/shared/modelCatalog`、`services/PlatformModelCatalogService.ts` | 公共同步、缓存与用户目录合并 |
| 持久化 | `packages/shared/stateMigration.ts`、`src/renderer/src/store`、`databases` | 迁移 223、保留历史数据 |
| 备份 | `services/BackupService.ts`、`src-tauri/src/backup_crypto.rs` | 本地／WebDAV、跨平台加密容器 |
| 凭据 | `src/renderer/src/services/mobile`、Rust 与 Android 原生代码 | 系统凭据库、Android Keystore 与引用迁移 |
| 构建 | `vite.config.ts`、`src-tauri/tauri.conf.json` | 前端构建与 Tauri 打包分离 |
| 检查 | `package.json` 的 `ci:*`、`.github/workflows` | 本地与 CI 共用定义 |

表中省略的 renderer 相对路径均相对于 `src/renderer/src`。
