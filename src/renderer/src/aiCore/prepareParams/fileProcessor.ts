/**
 * 文件处理模块
 * 处理文件内容提取、文件格式转换、文件上传等逻辑
 */

import { loggerService } from '@logger'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { FileMessageBlock } from '@renderer/types/newMessage'
import type { FilePart, TextPart } from 'ai'
import i18n from 'i18next'

import { getAiSdkProviderId } from '../provider/providerConfig'
import { getFileSizeLimit, supportsImageInput } from './modelCapabilities'

const logger = loggerService.withContext('fileProcessor')

/**
 * 将文件块转换为文本部分
 */
export async function convertFileBlockToTextPart(fileBlock: FileMessageBlock): Promise<TextPart | null> {
  const file = fileBlock.file

  // 处理文本文件
  if (file.type === FILE_TYPE.TEXT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext)
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn('Failed to read text file:', error as Error)
    }
  }

  // 处理文档文件（PDF、Word、Excel等）- 提取为文本内容
  if (file.type === FILE_TYPE.DOCUMENT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext, true) // true表示强制文本提取
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn(`Failed to extract text from document ${file.origin_name}:`, error as Error)
      window.toast.error(i18n.t('message.error.file.text_extraction_failed', { name: file.origin_name }))
    }
  }

  return null
}

/**
 * 将文件块转换为FilePart（用于原生文件支持）
 */
export async function convertFileBlockToFilePart(fileBlock: FileMessageBlock, model: Model): Promise<FilePart | null> {
  const file = fileBlock.file
  const fileSizeLimit = getFileSizeLimit(model, file.type)

  try {
    // 处理PDF文档（始终生成 FilePart，由下游插件处理兼容性）
    if (file.type === FILE_TYPE.DOCUMENT && file.ext === '.pdf') {
      if (file.size > fileSizeLimit) {
        logger.warn(`PDF file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
        window.toast.warning(
          i18n.t('message.warning.file.pdf_exceeds_limit', {
            name: file.origin_name,
            limit: `${Math.round(fileSizeLimit / 1024 / 1024)}MB`
          })
        )
        return null
      }

      const base64Data = await window.api.file.base64File(file.id + file.ext)

      return {
        type: 'file',
        data: base64Data.data,
        mediaType: base64Data.mime,
        filename: file.origin_name
      }
    }

    // 处理图片文件
    if (file.type === FILE_TYPE.IMAGE && supportsImageInput(model)) {
      // 检查文件大小
      if (file.size > fileSizeLimit) {
        logger.warn(`Image file ${file.origin_name} exceeds size limit (${file.size} > ${fileSizeLimit})`)
        return null
      }

      const base64Data = await window.api.file.base64Image(file.id + file.ext)

      // 处理MIME类型，特别是jpg->jpeg的转换（Anthropic要求）
      let mediaType = base64Data.mime
      const provider = getProviderByModel(model)
      const aiSdkId = getAiSdkProviderId(provider)

      if (aiSdkId === 'anthropic' && mediaType === 'image/jpg') {
        mediaType = 'image/jpeg'
      }

      return {
        type: 'file',
        data: base64Data.base64,
        mediaType: mediaType,
        filename: file.origin_name
      }
    }

    // 处理其他文档类型（Word、Excel等）
    if (file.type === FILE_TYPE.DOCUMENT && file.ext !== '.pdf') {
      // 目前大多数提供商不支持Word等格式的原生处理
      // 返回null会触发上层调用convertFileBlockToTextPart进行文本提取
      // 这与Legacy架构中的处理方式一致
      logger.debug(`Document file ${file.origin_name} with extension ${file.ext} will use text extraction fallback`)
      return null
    }
  } catch (error) {
    logger.warn(`Failed to process file ${file.origin_name}:`, error as Error)
  }

  return null
}
