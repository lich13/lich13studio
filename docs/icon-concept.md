# 图标资源维护

初始图标方案已完成落地。正式应用图标在 `src-tauri/icons`，由 `src-tauri/tauri.conf.json` 引用；Android 资源在 `src-tauri/gen/android/app/src/main/res`。

Rust 托盘直接使用 `build/tray_icon.png`。旧窗口和托盘的未引用图标已删除。

模型图标位于 `src/renderer/src/assets/images/models`，通过统一解析入口使用本地资源。OpenAI 明暗图标的上游来源和 AGPL 原文保存在相邻说明及许可证文件中。初始候选图标和重复的 Electron 打包图标不再作为构建来源。
