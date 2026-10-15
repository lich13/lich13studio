# Android

支持 Android 12（API 31）以上、ARM64。发布目标为 API 36，制品验证包含 16 KiB 内存页兼容。

## 环境与构建

Node 与 pnpm 版本分别取 `.nvmrc`、`package.json#packageManager`。使用 Rust stable 及 `aarch64-linux-android` target、Tauri CLI 2.10.1、JDK 21、SDK 36／build-tools 36.0.0、NDK 28.2.13676358。按实际安装位置配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`。

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

`python3 scripts/android-fixture.py` 提供回环模拟接口及 CCswitch 示例页，端口 18765；模拟器用 `adb reverse tcp:18765 tcp:18765` 访问。只使用虚拟凭据，指标只记录请求形状与计数。

## 文件、后台与导入

Android 数据与桌面独立，依靠备份迁移，不自动跨设备同步。系统 SAF 负责选择和导出文件，附件复制到私有受管目录。默认备份排除凭据，包含时必须加密；导入凭据写入 Keystore。

聊天和模型测试运行期间显示前台通知，可停止全部活动任务。强制退出、进程终止或 Android dataSync 系统时间预算耗尽会结束请求，不自动重发。模型请求没有应用层超时，不等于不受系统限制。

仅注册 `ccswitch`，遵循 Android 协议处理程序选择。导入必须确认，消费后清除 Intent 数据，不执行 usageScript。
