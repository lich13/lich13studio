type TauriInvoke = (command: string) => Promise<unknown>

type StartupWindowHost = {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke
    }
  }
}

export async function shouldShowStartupWindow(host: StartupWindowHost = window): Promise<boolean> {
  const invoke = host.__TAURI__?.core?.invoke
  if (!invoke) {
    return true
  }

  try {
    return !(await invoke('is_startup_silent'))
  } catch {
    return true
  }
}

export async function showStartupWindow(host: StartupWindowHost = window): Promise<void> {
  const invoke = host.__TAURI__?.core?.invoke
  if (invoke && (await shouldShowStartupWindow(host))) {
    // Recheck the native startup policy at the show boundary, even if the
    // preliminary query failed or a delayed renderer finishes initializing.
    await invoke('show_startup_window')
  }
}
