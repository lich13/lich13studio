const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: '.sh',
  c: '.c',
  clojure: '.clj',
  cmake: '.cmake',
  cpp: '.cpp',
  'c++': '.cpp',
  cs: '.cs',
  csharp: '.cs',
  'c#': '.cs',
  css: '.css',
  dart: '.dart',
  diff: '.diff',
  dockerfile: '.dockerfile',
  dot: '.dot',
  elixir: '.ex',
  erlang: '.erl',
  go: '.go',
  golang: '.go',
  graphql: '.graphql',
  graphviz: '.dot',
  groovy: '.groovy',
  haskell: '.hs',
  html: '.html',
  ini: '.ini',
  java: '.java',
  javascript: '.js',
  js: '.js',
  json: '.json',
  jsonc: '.jsonc',
  jsx: '.jsx',
  kotlin: '.kt',
  latex: '.tex',
  less: '.less',
  lua: '.lua',
  makefile: '.mk',
  markdown: '.md',
  md: '.md',
  mermaid: '.mmd',
  objc: '.m',
  'objective-c': '.m',
  ocaml: '.ml',
  perl: '.pl',
  php: '.php',
  plaintext: '.txt',
  powershell: '.ps1',
  protobuf: '.proto',
  py: '.py',
  python: '.py',
  r: '.r',
  rb: '.rb',
  ruby: '.rb',
  rs: '.rs',
  rust: '.rs',
  scala: '.scala',
  scss: '.scss',
  sh: '.sh',
  shell: '.sh',
  sql: '.sql',
  svg: '.svg',
  swift: '.swift',
  tex: '.tex',
  text: '.txt',
  toml: '.toml',
  ts: '.ts',
  tsx: '.tsx',
  txt: '.txt',
  typescript: '.ts',
  vab: '.vb',
  vb: '.vb',
  vue: '.vue',
  xml: '.xml',
  yaml: '.yaml',
  yml: '.yml',
  zsh: '.sh'
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  m: 'objc',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  pl: 'perl',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  tex: 'latex',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash'
}

const CUSTOM_NORMALIZED_EXTENSIONS: Record<string, string> = {
  svg: 'xml',
  vab: 'vb',
  graphviz: 'dot'
}

export function getExtensionByLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return '.txt'
  if (LANGUAGE_EXTENSIONS[normalized]) {
    return LANGUAGE_EXTENSIONS[normalized]
  }
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

export function getLanguageByFilePath(filePath: string): string {
  if (!filePath) return 'text'
  const ext = filePath.split('.').pop()?.trim().toLowerCase()
  if (!ext || ext === filePath.toLowerCase()) return 'text'
  return EXTENSION_LANGUAGES[ext] || ext
}

export async function getNormalizedExtension(language: string): Promise<string> {
  const lowerLanguage = language.trim().toLowerCase()
  if (CUSTOM_NORMALIZED_EXTENSIONS[lowerLanguage]) {
    return CUSTOM_NORMALIZED_EXTENSIONS[lowerLanguage]
  }
  const mapped = LANGUAGE_EXTENSIONS[lowerLanguage]
  if (mapped) {
    return mapped.slice(1)
  }
  return lowerLanguage.startsWith('.') && lowerLanguage.length > 1 ? lowerLanguage.slice(1) : lowerLanguage
}
