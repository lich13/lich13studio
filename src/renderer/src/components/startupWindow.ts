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
