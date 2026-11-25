# Tauri discovers custom commands and argument fields using reflection.
-keep class com.lich13.studio.MobileRuntimePlugin { *; }
-keep class com.lich13.studio.MobileArgs { *; }
# Static JNI entry points must retain their declared Java names.
-keep class com.lich13.studio.BackgroundService { *; }
-keepclasseswithmembernames class com.lich13.studio.MainActivity { native <methods>; }
