# Android

Requires Android 12 (API 31) or newer, ARM64. The release targets API 36 and supports 16 KiB memory pages.

## Build

Install Node 24, pnpm 10.27, Rust with `aarch64-linux-android`, Tauri CLI 2.10.1, JDK 21, Android SDK 36 / build-tools 36.0.0 and NDK 28.2.13676358. Set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` for those installations.

```sh
pnpm install --frozen-lockfile
pnpm build:tauri:web
cargo tauri android build --debug --target aarch64 --apk --ci
```

The APK is under `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`.

## Release signing

`node scripts/android-signing.mjs` creates one independent release key in `~/.config/lich13studio/android-signing/` and refuses to replace existing material. Keep both files outside Git. `--github` stores the key and properties in this repository's Actions secrets without printing their contents.

```sh
export LICH13_ANDROID_SIGNING_PROPERTIES="$HOME/.config/lich13studio/android-signing/release.properties"
cargo tauri android build --target aarch64 --apk --ci
python3 scripts/verify-android.py src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

The same key is required for future installed-app upgrades. GitHub Release includes a signed APK and `SHA256SUMS` alongside macOS and Windows packages.

## Device checks

CI builds a separate x86_64 debug APK for API 31/36 emulators. `LICH13_ANDROID_TEST_ABI=x86_64` is rejected for release builds. `app/src/androidTest` is instrumentation-only and is not packaged in the application. Local release acceptance uses ARM64 emulators, including a 16 KiB API 36 image.

`python3 scripts/android-fixture.py` starts the loopback-only streaming fixture and CCswitch sample page on port 18765. Use `adb reverse tcp:18765 tcp:18765` for an emulator. Its metrics contain request shape and counters, never credentials or chat content. Do not use production credentials in this fixture.

## Data and background tasks

Android data is independent from desktop data. Backups transfer data between devices; there is no automatic cross-device synchronization. Credentials are excluded by default. Including them requires an encrypted backup password that is never retained. Imported credentials move into Android Keystore-backed storage.

Active chats and model tests use a foreground notification with a Stop action. Returning to the app restores the current session. Force-stop, process termination and Android's `dataSync` time budget stop outstanding work; the app does not resend it. Notification permission is requested when the first task starts.

Only `ccswitch` is registered. Android handles selection between multiple installed protocol handlers. The app confirms each import and clears consumed Intent data; it never executes attached usage scripts.
