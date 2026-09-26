import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import type { ReasoningMode } from '@shared/reasoning'

import { generateChallenges } from './challenge'
import bank from './data/unified_bank.json'
import { analyzeGlobalOutputs } from './fingerprintCore'

export type ModelTestTransport = 'direct' | 'iq-proxy'

export interface ModelTestChallenge {
  id: string
  expected_count: number
  prompt: string
}

export interface ModelTestOutput {
  id: string
  expected_count: number
  text: string
}

export interface ModelTestProgress {
  index: number
  total: number
  challenge: ModelTestChallenge
  text: string
}

export interface ModelTraceReport {
  prediction: string
  prediction_name: string
  probability: number
  used_outputs: number
  results: Array<Record<string, unknown>>
  diagnostics: Array<Record<string, unknown>>
  family_prediction: string
  family_prediction_name: string
  family_probability: number
  family_probabilities: Array<Record<string, unknown>>
  method: string
  calibration: Record<string, unknown>
}

export interface ModelTestRunResult {
  challenges: ModelTestChallenge[]
  outputs: ModelTestOutput[]
  report: ModelTraceReport
}

export interface ModelTestRunnerOptions {
  model: Model
  transport?: ModelTestTransport
  challenges?: ModelTestChallenge[]
  signal?: AbortSignal
  onProgress?: (progress: ModelTestProgress) => void
}

export interface ModelTestRunnerConfig {
  model: Model
  transport?: ModelTestTransport
  onProgress?: (progress: ModelTestProgress) => void
}

export const MODELTRACE_PROXY_URL = 'https://llm-iq-proxy.hanmo5888.workers.dev/v1'
export const MODELTRACE_BANK_VERSION = String((bank as { built_at?: string }).built_at || 'bundled')

export const createModelTraceChallenges = (): ModelTestChallenge[] => generateChallenges(3) as ModelTestChallenge[]

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Model test aborted', 'AbortError')
  }
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '模型测试请求失败'
}

const runDirectChallenge = async (
  model: Model,
  challenge: ModelTestChallenge,
  signal: AbortSignal | undefined,
  onText: (text: string) => void
): Promise<string> => {
  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.settings = {
    ...assistant.settings,
    reasoning_effort: undefined,
    reasoning_effort_cache: undefined,
    qwenThinkMode: undefined,
    streamOutput: true,
    enableMaxToolCalls: false,
    toolUseMode: 'prompt'
  }
  assistant.enableUrlContext = false
  assistant.enableGenerateImage = false

  let text = ''
  let streamError: unknown
  await fetchChatCompletion({
    prompt: challenge.prompt,
    assistant,
    allowedTools: [],
    requestOptions: { signal, reasoningMode: 'disabled' as ReasoningMode },
    onChunkReceived: (chunk: Chunk) => {
      if (chunk.type === ChunkType.TEXT_DELTA) {
        text += chunk.text
        onText(text)
      } else if (chunk.type === ChunkType.ERROR) {
        streamError = chunk.error
      }
    }
  })

  throwIfAborted(signal)
  if (streamError) throw new Error(errorMessage(streamError))
  if (!text.trim()) throw new Error('模型没有返回可分析的文本')
  return text
}

const runProxyChallenge = async (
  model: Model,
  challenge: ModelTestChallenge,
  signal: AbortSignal | undefined,
  onText: (text: string) => void
): Promise<string> => {
  const provider = getProviderByModel(model)
  if (!provider.apiKey) throw new Error('代理测试需要当前服务商的 API Key')

  const response = await fetch(`${MODELTRACE_PROXY_URL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content: challenge.prompt }],
      stream: true
    })
  })

  if (!response.ok) {
    throw new Error(`ModelTrace proxy returned HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('模型测试代理没有返回流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let done = false

  const consumeEvent = (rawEvent: string) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('')
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') done = true
      return
    }

    let payload: any
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    const delta = payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content
    if (typeof delta === 'string' && delta) {
      text += delta
      onText(text)
    }
    if (payload?.error) throw new Error(String(payload.error.message || '模型测试代理返回错误'))
  }

  try {
    while (!done) {
      throwIfAborted(signal)
      const { value, done: readerDone } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !readerDone }).replace(/\r\n/g, '\n')
      let separatorIndex = buffer.indexOf('\n\n')
      while (separatorIndex !== -1) {
        const event = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        consumeEvent(event)
        separatorIndex = buffer.indexOf('\n\n')
      }
      if (readerDone) break
    }
    if (buffer.trim()) consumeEvent(buffer.trim())
  } finally {
    reader.releaseLock()
  }

  throwIfAborted(signal)
  if (!text.trim()) throw new Error('模型测试代理没有返回可分析的文本')
  return text
}

export const analyzeModelTraceOutputs = (outputs: ModelTestOutput[]): ModelTraceReport =>
  analyzeGlobalOutputs(outputs, bank) as ModelTraceReport

export const runModelTraceTest = async ({
  model,
  transport = 'direct',
  challenges: requestedChallenges,
  signal,
  onProgress
}: ModelTestRunnerOptions): Promise<ModelTestRunResult> => {
  const challenges = requestedChallenges?.length ? requestedChallenges : createModelTraceChallenges()
  const outputs: ModelTestOutput[] = []

  for (let index = 0; index < challenges.length; index += 1) {
    const challenge = challenges[index]
    throwIfAborted(signal)
    let latestText = ''
    const onText = (text: string) => {
      latestText = text
      onProgress?.({ index, total: challenges.length, challenge, text })
    }
    const text =
      transport === 'iq-proxy'
        ? await runProxyChallenge(model, challenge, signal, onText)
        : await runDirectChallenge(model, challenge, signal, onText)
    outputs.push({ id: challenge.id, expected_count: challenge.expected_count, text })
    onProgress?.({ index, total: challenges.length, challenge, text: latestText || text })
  }

  return {
    challenges,
    outputs,
    report: analyzeModelTraceOutputs(outputs)
  }
}

/**
 * Stateful facade used by the settings page and integrations that need a
 * cancellable test session. The runner owns only the in-memory AbortController;
 * challenges, outputs, and reports are returned to the caller and never stored.
 */
export class ModelTestRunner {
  private controller?: AbortController

  constructor(private readonly config: ModelTestRunnerConfig) {}

  run(): Promise<ModelTestRunResult> {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    return runModelTraceTest({
      ...this.config,
      signal: controller.signal
    }).finally(() => {
      if (this.controller === controller) this.controller = undefined
    })
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = undefined
  }

  analyze(outputs: ModelTestOutput[]): ModelTraceReport {
    return analyzeModelTraceOutputs(outputs)
  }
}
