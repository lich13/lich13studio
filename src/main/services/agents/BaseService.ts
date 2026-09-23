import { loggerService } from '@logger'
import type { ModelValidationError } from '@main/apiServer/utils'
import { validateModelId } from '@main/apiServer/utils'
import { getDataPath } from '@main/utils'
import type { AgentType, SlashCommand, SystemProviderId, Tool } from '@types'
import { objectKeys } from '@types'
import fs from 'fs'
import path from 'path'

import { DatabaseManager } from './database/DatabaseManager'
import type { AgentModelField } from './errors'
import { AgentModelValidationError } from './errors'
import { builtinSlashCommands } from './services/claudecode/commands'
import { builtinTools } from './services/claudecode/tools'

const logger = loggerService.withContext('BaseService')
/**
 * Base service class providing shared utilities for all agent-related services.
 *
 * Features:
 * - Database access through DatabaseManager singleton
 * - JSON field serialization/deserialization
 * - Path validation and creation
 * - Model validation
 * - Built-in tools and slash commands listing
 */
export abstract class BaseService {
  protected jsonFields: string[] = ['tools', 'configuration', 'accessible_paths', 'allowed_tools', 'slash_commands']

  public async listTools(agentType: AgentType): Promise<{ tools: Tool[] }> {
    return { tools: agentType === 'claude-code' ? [...builtinTools] : [] }
  }

  protected normalizeAllowedTools(allowedTools: string[] | undefined, tools: Tool[]): string[] | undefined {
    return allowedTools?.filter((id) => !id.startsWith('mcp_') && tools.some((tool) => tool.id === id))
  }

  public async listSlashCommands(agentType: AgentType): Promise<SlashCommand[]> {
    if (agentType === 'claude-code') {
      return builtinSlashCommands
    }
    return []
  }

  /**
   * Get database instance
   * Automatically waits for initialization to complete
   */
  public async getDatabase() {
    const dbManager = await DatabaseManager.getInstance()
    return dbManager.getDatabase()
  }

  protected serializeJsonFields(data: any): any {
    const serialized = { ...data }
    delete serialized.mcps

    for (const field of this.jsonFields) {
      if (serialized[field] !== undefined) {
        serialized[field] =
          Array.isArray(serialized[field]) || typeof serialized[field] === 'object'
            ? JSON.stringify(serialized[field])
            : serialized[field]
      }
    }

    return serialized
  }

  protected deserializeJsonFields(data: any): any {
    if (!data) return data

    const deserialized = { ...data }
    delete deserialized.mcps

    for (const field of this.jsonFields) {
      if (deserialized[field] && typeof deserialized[field] === 'string') {
        try {
          deserialized[field] = JSON.parse(deserialized[field])
        } catch (error) {
          logger.warn(`Failed to parse JSON field ${field}:`, error as Error)
        }
      }
    }

    // Normalize legacy agent type values to the unified type
    if (deserialized.type === 'cherry-claw') {
      deserialized.type = 'claude-code'
    }
    if (deserialized.agent_type === 'cherry-claw') {
      deserialized.agent_type = 'claude-code'
    }

    // convert null from db to undefined to satisfy type definition
    for (const key of objectKeys(data)) {
      if (deserialized[key] === null) {
        deserialized[key] = undefined
      }
    }

    return deserialized
  }

  /**
   * Validate, normalize, and ensure filesystem access for a set of absolute paths.
   *
   * - Requires every entry to be an absolute path and throws if not.
   * - Normalizes each path and deduplicates while preserving order.
   * - Creates missing directories (or parent directories for file-like paths).
   */
  protected ensurePathsExist(paths?: string[]): string[] {
    if (!paths?.length) {
      return []
    }

    const sanitizedPaths: string[] = []
    const seenPaths = new Set<string>()

    for (const rawPath of paths) {
      if (!rawPath) {
        continue
      }

      if (!path.isAbsolute(rawPath)) {
        throw new Error(`Accessible path must be absolute: ${rawPath}`)
      }

      // Normalize to provide consistent values to downstream consumers.
      const resolvedPath = path.normalize(rawPath)

      let stats: fs.Stats | null = null
      try {
        // Attempt to stat the path to understand whether it already exists and if it is a file.
        if (fs.existsSync(resolvedPath)) {
          stats = fs.statSync(resolvedPath)
        }
      } catch (error) {
        logger.warn('Failed to inspect accessible path', {
          path: rawPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      const looksLikeFile =
        (stats && stats.isFile()) || (!stats && path.extname(resolvedPath) !== '' && !resolvedPath.endsWith(path.sep))

      // For file-like targets create the parent directory; otherwise ensure the directory itself.
      const directoryToEnsure = looksLikeFile ? path.dirname(resolvedPath) : resolvedPath

      if (!fs.existsSync(directoryToEnsure)) {
        try {
          fs.mkdirSync(directoryToEnsure, { recursive: true })
        } catch (error) {
          logger.error('Failed to create accessible path directory', {
            path: directoryToEnsure,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }

      // Preserve the first occurrence only to avoid duplicates while keeping caller order stable.
      if (!seenPaths.has(resolvedPath)) {
        seenPaths.add(resolvedPath)
        sanitizedPaths.push(resolvedPath)
      }
    }

    return sanitizedPaths
  }

  /**
   * Resolve accessible paths, assigning a default workspace under `{dataPath}/Agents/{id}`
   * when the provided paths are empty or undefined, then ensure all directories exist.
   */
  protected resolveAccessiblePaths(paths: string[] | undefined, id: string): string[] {
    if (!paths || paths.length === 0) {
      const shortId = id.substring(id.length - 9)
      paths = [path.join(getDataPath(), 'Agents', shortId)]
    }
    return this.ensurePathsExist(paths)
  }

  /**
   * Validate agent model configuration.
   *
   * **Side effect**: For local providers that don't require a real API key
   * (e.g. ollama, lmstudio), this method sets `provider.apiKey` to the
   * provider ID as a placeholder so downstream SDK calls don't reject the
   * request. Callers should be aware that the provider object may be mutated.
   */
  protected async validateAgentModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>
  ): Promise<void> {
    const entries = Object.entries(models) as [AgentModelField, string | undefined][]
    if (entries.length === 0) {
      return
    }

    // Local providers that don't require a real API key (use placeholder).
    // Note: lmstudio doesn't support Anthropic API format, only ollama does.
    const localProvidersWithoutApiKey: readonly string[] = ['ollama', 'lmstudio'] satisfies SystemProviderId[]

    for (const [field, rawValue] of entries) {
      if (rawValue === undefined || rawValue === null) {
        continue
      }

      const modelValue = rawValue
      const validation = await validateModelId(modelValue)

      if (!validation.valid || !validation.provider) {
        const detail: ModelValidationError = validation.error ?? {
          type: 'invalid_format',
          message: 'Unknown model validation error',
          code: 'validation_error'
        }

        throw new AgentModelValidationError({ agentType, field, model: modelValue }, detail)
      }

      const requiresApiKey = !localProvidersWithoutApiKey.includes(validation.provider.id)

      if (!validation.provider.apiKey) {
        if (requiresApiKey) {
          throw new AgentModelValidationError(
            { agentType, field, model: modelValue },
            {
              type: 'invalid_format',
              message: `Provider '${validation.provider.id}' is missing an API key`,
              code: 'provider_api_key_missing'
            }
          )
        } else {
          // Use provider id as placeholder API key for providers that don't require one
          validation.provider.apiKey = validation.provider.id
        }
      }
    }
  }
}
