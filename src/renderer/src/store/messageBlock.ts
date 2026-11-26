import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type EntityState,
  type PayloadAction
} from '@reduxjs/toolkit'
import type { TodoWriteToolInput } from '@renderer/pages/home/Messages/Tools/MessageAgentTools/types'
import type {
  AISDKWebSearchResult,
  AnthropicWebSearchResultBlock,
  BaseTool,
  Citation,
  GroundingMetadata,
  NormalToolResponse,
  OpenAIResponseUrlCitation,
  OpenAIUrlCitationAnnotation,
  WebSearchProviderResponse
} from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { CitationMessageBlock, MessageBlock, ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

import type { RootState } from './index'

// Create a simplified type for the entity adapter to avoid circular type issues
type MessageBlockEntity = MessageBlock

// 1. 创建实体适配器 (Entity Adapter)
// 我们使用块的 `id` 作为唯一标识符。
const messageBlocksAdapter = createEntityAdapter<MessageBlockEntity>()

export interface MessageBlocksState extends EntityState<MessageBlockEntity, string> {
  loadingState: 'idle' | 'loading' | 'succeeded' | 'failed'
  error: string | null
}

const initialState: MessageBlocksState = messageBlocksAdapter.getInitialState({
  loadingState: 'idle' as const,
  error: null
})

const _messageBlocksSlice = createSlice({
  name: 'messageBlocks',
  initialState,
  reducers: {
    upsertOneBlock(state, action: PayloadAction<MessageBlock>) {
      messageBlocksAdapter.upsertOne(state as MessageBlocksState, action.payload)
    },
    upsertManyBlocks(state, action: PayloadAction<MessageBlock[]>) {
      messageBlocksAdapter.upsertMany(state as MessageBlocksState, action.payload)
    },
    removeOneBlock(state, action: PayloadAction<string>) {
      messageBlocksAdapter.removeOne(state as MessageBlocksState, action.payload)
    },
    removeManyBlocks(state, action: PayloadAction<string[]>) {
      messageBlocksAdapter.removeMany(state as MessageBlocksState, action.payload)
    },
    removeAllBlocks(state) {
      messageBlocksAdapter.removeAll(state as MessageBlocksState)
    },
    setMessageBlocksLoading: (state, action: PayloadAction<'idle' | 'loading'>) => {
      state.loadingState = action.payload
      state.error = null
    },
    setMessageBlocksError: (state, action: PayloadAction<string>) => {
      state.loadingState = 'failed'
      state.error = action.payload
    },
    updateOneBlock(state, action: PayloadAction<{ id: string; changes: Partial<MessageBlock> }>) {
      messageBlocksAdapter.updateOne(state as MessageBlocksState, action.payload)
    }
  }
})

// 4. 导出 Actions 和 Reducer
export const {
  upsertOneBlock,
  upsertManyBlocks,
  removeOneBlock,
  removeManyBlocks,
  removeAllBlocks,
  setMessageBlocksLoading,
  setMessageBlocksError,
  updateOneBlock
} = _messageBlocksSlice.actions

export const messageBlocksSelectors = messageBlocksAdapter.getSelectors<RootState>(
  (state) => state.messageBlocks // Ensure this matches the key in the root reducer
)

// --- Selector Integration --- START

// Selector to get the raw block entity by ID
const selectBlockEntityById = (state: RootState, blockId: string | undefined): MessageBlock | undefined => {
  const entity = blockId ? messageBlocksSelectors.selectById(state, blockId) : undefined
  if (!entity) return undefined

  // Convert back to full MessageBlock type
  return entity
}

// --- Centralized Citation Formatting Logic ---
export const formatCitationsFromBlock = (block: CitationMessageBlock | undefined): Citation[] => {
  if (!block) return []

  let formattedCitations: Citation[] = []
  // 1. Handle Web Search Responses
  if (block.response) {
    switch (block.response.source) {
      case WEB_SEARCH_SOURCE.GEMINI: {
        const groundingMetadata = block.response.results as GroundingMetadata
        formattedCitations =
          groundingMetadata?.groundingChunks?.map((chunk, index) => ({
            number: index + 1,
            url: chunk?.web?.uri || '',
            title: chunk?.web?.title,
            showFavicon: true,
            metadata: groundingMetadata.groundingSupports,
            type: 'websearch'
          })) || []
        break
      }
      case WEB_SEARCH_SOURCE.OPENAI_RESPONSE:
        formattedCitations =
          (block.response.results as OpenAIResponseUrlCitation[])?.map((result, index) => {
            let hostname: string | undefined
            try {
              hostname = result.title ? undefined : new URL(result.url).hostname
            } catch {
              hostname = result.url
            }
            return {
              number: index + 1,
              url: result.url,
              title: result.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WEB_SEARCH_SOURCE.OPENAI:
        formattedCitations =
          (block.response.results as OpenAIUrlCitationAnnotation[])?.map((url, index) => {
            const urlCitation = url.url_citation
            let hostname: string | undefined
            try {
              hostname = urlCitation.title ? undefined : new URL(urlCitation.url).hostname
            } catch {
              hostname = urlCitation.url
            }
            return {
              number: index + 1,
              url: urlCitation.url,
              title: urlCitation.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WEB_SEARCH_SOURCE.ANTHROPIC:
        formattedCitations =
          (block.response.results as Array<AnthropicWebSearchResultBlock>)?.map((result, index) => {
            const { url } = result
            let hostname: string | undefined
            try {
              hostname = new URL(url).hostname
            } catch {
              hostname = url
            }
            return {
              number: index + 1,
              url: url,
              title: result.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WEB_SEARCH_SOURCE.PERPLEXITY: {
        formattedCitations =
          (block.response.results as any[])?.map((result, index) => ({
            number: index + 1,
            url: result.url || result, // 兼容旧数据
            title: result.title || new URL(result).hostname, // 兼容旧数据
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      }
      case WEB_SEARCH_SOURCE.GROK:
        formattedCitations =
          (block.response.results as AISDKWebSearchResult[])?.map((result, index) => {
            const url = result.url
            try {
              const hostname = new URL(result.url).hostname
              // xAI source events use citation number as title, fall back to hostname
              const title = result.title && /^\d+$/.test(result.title) ? hostname : result.title || hostname
              return {
                number: index + 1,
                url,
                title,
                showFavicon: true,
                type: 'websearch'
              }
            } catch {
              return {
                number: index + 1,
                url,
                hostname: url,
                showFavicon: true,
                type: 'websearch'
              }
            }
          }) || []
        break
      case WEB_SEARCH_SOURCE.OPENROUTER:
        formattedCitations =
          (block.response.results as AISDKWebSearchResult[])?.map((result, index) => {
            const url = result.url
            try {
              const hostname = new URL(result.url).hostname
              const content = result.providerMetadata && result.providerMetadata['openrouter']?.content
              return {
                number: index + 1,
                url,
                title: result.title || hostname,
                content: content as string,
                showFavicon: true,
                type: 'websearch'
              }
            } catch {
              return {
                number: index + 1,
                url,
                hostname: url,
                showFavicon: true,
                type: 'websearch'
              }
            }
          }) || []
        break
      case WEB_SEARCH_SOURCE.ZHIPU:
      case WEB_SEARCH_SOURCE.HUNYUAN:
        formattedCitations =
          (block.response.results as any[])?.map((result, index) => ({
            number: index + 1,
            url: result.link || result.url,
            title: result.title,
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      case WEB_SEARCH_SOURCE.WEBSEARCH:
        formattedCitations =
          (block.response.results as WebSearchProviderResponse)?.results?.map((result, index) => ({
            number: index + 1,
            url: result.url,
            title: result.title,
            content: result.content,
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      case WEB_SEARCH_SOURCE.AISDK:
        formattedCitations =
          (block.response?.results as AISDKWebSearchResult[])?.map((result, index) => ({
            number: index + 1,
            url: result.url,
            title: result.title || new URL(result.url).hostname,
            showFavicon: true,
            type: 'websearch',
            providerMetadata: result?.providerMetadata
          })) || []
        break
    }
  }
  // 3. Handle Knowledge Base References
  if (block.knowledge && Array.isArray(block.knowledge) && block.knowledge.length > 0) {
    formattedCitations.push(
      ...block.knowledge.map((result, index) => {
        const filePattern = /\[(.*?)]\(http:\/\/file\/(.*?)\)/
        const fileMatch = result.sourceUrl.match(filePattern)

        let url = result.sourceUrl
        let title = result.sourceUrl
        const showFavicon = true

        // 如果匹配文件链接格式 [filename](http://file/xxx)
        if (fileMatch) {
          title = fileMatch[1]
          url = `http://file/${fileMatch[2]}`
        }

        return {
          number: index + 1,
          url: url,
          title: title,
          content: result.content,
          showFavicon: showFavicon,
          type: 'knowledge'
        }
      })
    )
  }

  if (block.memories && Array.isArray(block.memories) && block.memories.length > 0) {
    // 5. Handle Memory References
    formattedCitations.push(
      ...block.memories.map((memory, index) => ({
        number: index + 1,
        url: '',
        title: `Memory ${memory.hash?.slice(0, 8)}`,
        content: memory.memory,
        showFavicon: false,
        type: 'memory'
      }))
    )
  }

  // 4. Deduplicate non-knowledge citations by URL and Renumber Sequentially
  const urlSet = new Set<string>()
  return formattedCitations
    .filter((citation) => {
      if (citation.type === 'knowledge' || citation.type === 'memory') return true
      if (!citation.url || urlSet.has(citation.url)) return false
      urlSet.add(citation.url)
      return true
    })
    .map((citation, index) => ({
      ...citation,
      number: index + 1
    }))
}
// --- End of Centralized Logic ---

// Memoized selector that takes a block ID and returns formatted citations
export const selectFormattedCitationsByBlockId = createSelector([selectBlockEntityById], (blockEntity): Citation[] => {
  if (blockEntity?.type === MessageBlockType.CITATION) {
    return formatCitationsFromBlock(blockEntity)
  }
  return []
})

// --- Active TodoWrite Block Selector ---
export interface TodoWriteNormalToolResponse extends Omit<NormalToolResponse, 'tool' | 'arguments'> {
  tool: BaseTool & { name: 'TodoWrite' }
  arguments: TodoWriteToolInput
}

export interface TodoWriteToolMessageBlock extends Omit<ToolMessageBlock, 'metadata'> {
  metadata: NonNullable<ToolMessageBlock['metadata']> & {
    rawMcpToolResponse: TodoWriteNormalToolResponse
  }
}

export const isTodoWriteBlock = (block: MessageBlock | undefined): block is TodoWriteToolMessageBlock => {
  if (!block || block.type !== MessageBlockType.TOOL) return false
  const toolResponse = block.metadata?.rawMcpToolResponse
  if (toolResponse?.tool?.name !== 'TodoWrite') return false
  const args = toolResponse.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  return Array.isArray(args.todos)
}

type MessageBlocksSlicePublic = {
  reducer: typeof _messageBlocksSlice.reducer
  actions: typeof _messageBlocksSlice.actions
}

export const messageBlocksSlice: MessageBlocksSlicePublic = {
  reducer: _messageBlocksSlice.reducer,
  actions: _messageBlocksSlice.actions
}

export default _messageBlocksSlice.reducer
