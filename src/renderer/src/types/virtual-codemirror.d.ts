declare module 'virtual:cm-themes' {
  export function loadCmTheme(themeName: string): Promise<any>
}

declare module 'virtual:cm-langs' {
  export function loadLanguageAsync(ext: string): Promise<any>
}
