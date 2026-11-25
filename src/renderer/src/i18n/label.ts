import { loggerService } from '@logger'

import i18n from './index'

const t = i18n.t

const logger = loggerService.withContext('i18n:label')

const getLabel = (keyMap: Record<string, string>, key: string, fallback?: string) => {
  const result = keyMap[key]
  if (result) {
    return t(result)
  } else {
    logger.error(`Missing key ${key}`)
    return fallback ?? key
  }
}

const providerKeyMap = {
  '302ai': 'provider.302ai',
  aihubmix: 'provider.aihubmix',
  alayanew: 'provider.alayanew',
  anthropic: 'provider.anthropic',
  'aws-bedrock': 'provider.aws-bedrock',
  'azure-openai': 'provider.azure-openai',
  baichuan: 'provider.baichuan',
  'baidu-cloud': 'provider.baidu-cloud',
  burncloud: 'provider.burncloud',
  cephalon: 'provider.cephalon',
  cherryin: 'provider.cherryin',
  copilot: 'provider.copilot',
  dashscope: 'provider.dashscope',
  deepseek: 'provider.deepseek',
  dmxapi: 'provider.dmxapi',
  doubao: 'provider.doubao',
  fireworks: 'provider.fireworks',
  gemini: 'provider.gemini',
  'gitee-ai': 'provider.gitee-ai',
  github: 'provider.github',
  gpustack: 'provider.gpustack',
  grok: 'provider.grok',
  groq: 'provider.groq',
  hunyuan: 'provider.hunyuan',
  hyperbolic: 'provider.hyperbolic',
  infini: 'provider.infini',
  jina: 'provider.jina',
  lanyun: 'provider.lanyun',
  lmstudio: 'provider.lmstudio',
  minimax: 'provider.minimax',
  mistral: 'provider.mistral',
  modelscope: 'provider.modelscope',
  moonshot: 'provider.moonshot',
  'new-api': 'provider.new-api',
  nvidia: 'provider.nvidia',
  o3: 'provider.o3',
  ocoolai: 'provider.ocoolai',
  ovms: 'provider.ovms',
  ollama: 'provider.ollama',
  openai: 'provider.openai',
  openrouter: 'provider.openrouter',
  perplexity: 'provider.perplexity',
  ph8: 'provider.ph8',
  ppio: 'provider.ppio',
  qiniu: 'provider.qiniu',
  qwenlm: 'provider.qwenlm',
  silicon: 'provider.silicon',
  stepfun: 'provider.stepfun',
  'tencent-cloud-ti': 'provider.tencent-cloud-ti',
  together: 'provider.together',
  tokenflux: 'provider.tokenflux',
  vertexai: 'provider.vertexai',
  voyageai: 'provider.voyageai',
  xirang: 'provider.xirang',
  yi: 'provider.yi',
  zhinao: 'provider.zhinao',
  zhipu: 'provider.zhipu',
  poe: 'provider.poe',
  aionly: 'provider.aionly',
  longcat: 'provider.longcat',
  huggingface: 'provider.huggingface',
  sophnet: 'provider.sophnet',
  gateway: 'provider.ai-gateway',
  cerebras: 'provider.cerebras',
  mimo: 'provider.mimo',
  'minimax-global': 'provider.minimax-global',
  zai: 'provider.zai'
} as const

export const getProviderLabel = (id: string): string => {
  return getLabel(providerKeyMap, id)
}

const backupProgressKeyMap = {
  completed: 'backup.progress.completed',
  compressing: 'backup.progress.compressing',
  copying_database: 'backup.progress.copying_database',
  copying_files: 'backup.progress.copying_files',
  preparing: 'backup.progress.preparing',
  preparing_compression: 'backup.progress.preparing_compression',
  title: 'backup.progress.title',
  writing_data: 'backup.progress.writing_data'
} as const

export const getBackupProgressLabel = (key: string): string => {
  return getLabel(backupProgressKeyMap, key)
}

const restoreProgressKeyMap = {
  completed: 'restore.progress.completed',
  copying_files: 'restore.progress.copying_files',
  extracted: 'restore.progress.extracted',
  extracting: 'restore.progress.extracting',
  preparing: 'restore.progress.preparing',
  reading_data: 'restore.progress.reading_data',
  restoring_data: 'restore.progress.restoring_data',
  restoring_database: 'restore.progress.restoring_database',
  title: 'restore.progress.title',
  validating: 'restore.progress.validating'
} as const

export const getRestoreProgressLabel = (key: string): string => {
  return getLabel(restoreProgressKeyMap, key)
}

const sidebarIconKeyMap = {
  assistants: 'assistants.title',
  agents: 'agent.sidebar_title',
  store: 'assistants.presets.title',
  translate: 'translate.title',
  knowledge: 'knowledge.title',
  files: 'files.title',
  code_tools: 'code.title'
} as const

export const getSidebarIconLabel = (key: string): string => {
  return getLabel(sidebarIconKeyMap, key)
}

const httpMessageKeyMap = {
  '400': 'error.http.400',
  '401': 'error.http.401',
  '403': 'error.http.403',
  '404': 'error.http.404',
  '429': 'error.http.429',
  '500': 'error.http.500',
  '502': 'error.http.502',
  '503': 'error.http.503',
  '504': 'error.http.504'
} as const

export const getHttpMessageLabel = (key: string): string => {
  return getLabel(httpMessageKeyMap, key)
}
