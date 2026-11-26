import { isVisionModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { FileType, Model } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'

import { getAiSdkProviderId } from '../provider/providerConfig'

export function supportsImageInput(model: Model): boolean {
  return isVisionModel(model)
}

export function getFileSizeLimit(model: Model, fileType: FileType): number {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  if (aiSdkId === 'anthropic' && fileType === FILE_TYPE.DOCUMENT) {
    return 32 * 1024 * 1024
  }

  return Infinity
}
