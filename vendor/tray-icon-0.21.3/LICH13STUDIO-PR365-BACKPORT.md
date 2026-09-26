# lich13studio tray-icon backport

This vendored copy keeps tray-icon `0.21.3` and carries the macOS menu
attachment fix from [tray-icon PR #365](https://github.com/tauri-apps/tray-icon/pull/365).

On macOS 27, permanently attaching an `NSMenu` to the status item can swallow
left-button events. The backport retains the menu on the tray target and
attaches it only around the native right-click `performClick` call, then
removes it immediately. This is intentionally limited to the compatible
`0.21.3` API used by this application.
