# Tauri discovers custom commands and argument fields using reflection.
-keep class com.lich13.studio.MobileRuntimePlugin { *; }
-keep class com.lich13.studio.MobileArgs { *; }
# Static JNI cancellation must retain its declared Java name.
-keep class com.lich13.studio.BackgroundService { *; }
