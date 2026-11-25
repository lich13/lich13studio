# Android

支持 Android 12（API 31）以上、ARM64。发布目标为 API 36，制品验证包含 16 KiB 内存页兼容。

Tauri Android 库仍需要 SDK 36，并使用 `kotlin-android`，AGP 9 暂时设置 `android.builtInKotlin=false` 和 `android.newDsl=false`；升级 AGP 10 前需等依赖支持内置 Kotlin 后移除这两项。JVM 字节码目标与构建时使用的 JDK 版本独立。

## 环境与构建

Node、pnpm 和 Rust 使用当前稳定版；Rust 需要 `aarch64-linux-android` target。Android 使用 JDK 27、SDK 37.2、Build Tools 37.0.0、NDK 30.0.16248370、Gradle 9.9.0、AGP 9.5.1、Kotlin 2.4.21。按实际安装位置配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`；后续通过官方工具成组更新这些 Android 版本记录。

```sh
pnpm install --frozen-lockfile
pnpm build:tauri:web
cargo +stable tauri android build --debug --target aarch64 --apk --ci
```

调试 APK 在 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`。正式构建可用 `pnpm tauri:build:android`；签名材料须先按下节配置。

## 签名

`node scripts/android-signing.mjs` 创建独立发布密钥，默认放在用户配置目录，拒绝覆盖已有材料。`--github` 可将其写入本仓库 Actions secrets，不打印内容。密钥和 properties 不能提交 Git；后续升级必须沿用同一签名。

设置 `LICH13_ANDROID_SIGNING_PROPERTIES` 指向私密 properties 后执行：

```sh
pnpm tauri:build:android
python3 scripts/verify-android.py src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Release 提供签名 APK 和 `SHA256SUMS`。本地调试包不能替代正式签名验证。

## 设备检查

CI 为 API 31／36 模拟器构建单独的 x86_64 debug APK。`LICH13_ANDROID_TEST_ABI=x86_64` 不允许用于 release；`app/src/androidTest` 不进入正式应用。

`python3 scripts/android-fixture.py` 提供回环模拟接口，端口 18765；模拟器用 `adb reverse tcp:18765 tcp:18765` 访问。只使用虚拟凭据，指标只记录请求形状与计数。

## `ccswitch://` 服务商导入

Android 端在 `MainActivity`（`singleTask`）注册 `ccswitch://` 深度链接接管，并在引导页与服务商设置页提供粘贴导入入口（桌面端不注册该协议）：

- 兼容 `ccswitch://v1/import?resource=provider` V1 规范（支持逗号分隔多端点取首项、`apiFormat` 覆盖 `app` 默认格式，以及 Base64 内联 `config` 的 Claude `env`、Codex `auth` + `config.toml`、Grok Build `[model.*]` 与累加式应用 JSON），仅放行最终协议为 `anthropic` 或 `openai_responses` 的静态凭据配置，拒绝 `configUrl`、`env_key` 间接凭据及动态环境变量／文件／命令语法，忽略且不执行 `usageScript`。
- 收到 Intent 后立即置空 `intent.data`，链接仅暂存于有界内存队列（上限 8 条／8192 字符），经用户确认（API Key 打码展示，可调整名称与平台）后加密写入 Android Keystore。

## 文件与后台任务

Android 数据与桌面独立，依靠备份迁移，不自动跨设备同步。系统 SAF 负责选择和导出文件，附件复制到私有受管目录。默认备份排除凭据，包含时必须加密；导入凭据写入 Keystore。

聊天运行期间显示前台通知，可停止全部活动任务。强制退出、进程终止或 Android dataSync 系统时间预算耗尽会结束请求，不自动重发。模型请求没有应用层超时，不等于不受系统限制。
