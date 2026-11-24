import { FILE_TYPE, type Model } from '@renderer/types'
import { type FileMessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProviderByModel: vi.fn(),
  getAiSdkProviderId: vi.fn(),
  getFileSizeLimit: vi.fn(),
  supportsImageInput: vi.fn(),
  supportsLargeFileUpload: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: mocks.getProviderByModel
}))

vi.mock('../provider/factory', () => ({
  getAiSdkProviderId: mocks.getAiSdkProviderId
}))

vi.mock('./modelCapabilities', () => ({
  getFileSizeLimit: mocks.getFileSizeLimit,
  supportsImageInput: mocks.supportsImageInput,
  supportsLargeFileUpload: mocks.supportsLargeFileUpload
}))

import { convertFileBlockToFilePart } from './fileProcessor'

const fixtureModel: Model = {
  id: 'claude-sonnet-4-5',
  provider: 'anthropic',
  name: 'Claude Sonnet 4.5',
  group: 'Claude'
}

function makePdfBlock(size = 2048): FileMessageBlock {
  return {
    id: 'block-pdf-1',
    messageId: 'msg-1',
    type: MessageBlockType.FILE,
    status: MessageBlockStatus.SUCCESS,
    createdAt: '2026-01-01T00:00:00.000Z',
    file: {
      id: 'file-pdf-1',
      name: 'report',
      origin_name: 'report.pdf',
      path: '/tmp/Data/Files/file-pdf-1.pdf',
      size,
      ext: '.pdf',
      type: FILE_TYPE.DOCUMENT,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }
  }
}

describe('convertFileBlockToFilePart', () => {
  const base64File = vi.fn()
  const base64Image = vi.fn()
  const warning = vi.fn()

  beforeEach(() => {
    base64File.mockReset()
    base64Image.mockReset()
    warning.mockReset()
    mocks.getFileSizeLimit.mockReset().mockReturnValue(32 * 1024 * 1024)
    mocks.supportsImageInput.mockReset().mockReturnValue(true)
    mocks.supportsLargeFileUpload.mockReset().mockReturnValue(false)
    mocks.getProviderByModel.mockReset().mockReturnValue({ id: 'anthropic', type: 'anthropic' })
    mocks.getAiSdkProviderId.mockReset().mockReturnValue('anthropic')

    vi.stubGlobal('window', {
      api: {
        file: {
          base64File,
          base64Image
        }
      },
      toast: { warning }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a multimodal FilePart from structured base64File output for PDF attachments', async () => {
    const encodedPdf = btoa('%PDF-1.4 fixture body')
    base64File.mockResolvedValueOnce({
      mime: 'application/pdf',
      base64: encodedPdf,
      data: encodedPdf
    })

    const part = await convertFileBlockToFilePart(makePdfBlock(), fixtureModel)

    expect(base64File).toHaveBeenCalledWith('file-pdf-1.pdf')
    expect(part).toEqual({
      type: 'file',
      data: encodedPdf,
      mediaType: 'application/pdf',
      filename: 'report.pdf'
    })
  })

  it('falls back to null and warns when a PDF exceeds the model size limit without File API support', async () => {
    mocks.getFileSizeLimit.mockReturnValue(1024)

    const part = await convertFileBlockToFilePart(makePdfBlock(4096), fixtureModel)

    expect(part).toBeNull()
    expect(base64File).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledOnce()
  })

  it('normalizes image/jpg to image/jpeg for Anthropic multimodal image blocks', async () => {
    const encodedJpg = btoa('jpg-bytes')
    base64Image.mockResolvedValueOnce({
      mime: 'image/jpg',
      base64: encodedJpg,
      data: `data:image/jpg;base64,${encodedJpg}`
    })

    const imageBlock: FileMessageBlock = {
      ...makePdfBlock(512),
      id: 'block-img-1',
      file: {
        id: 'img-1',
        name: 'photo',
        origin_name: 'photo.jpg',
        path: '/tmp/Data/Files/img-1.jpg',
        size: 512,
        ext: '.jpg',
        type: FILE_TYPE.IMAGE,
        created_at: '2026-01-01T00:00:00.000Z',
        count: 1
      }
    }

    const part = await convertFileBlockToFilePart(imageBlock, fixtureModel)

    expect(base64Image).toHaveBeenCalledWith('img-1.jpg')
    expect(part).toEqual({
      type: 'file',
      data: encodedJpg,
      mediaType: 'image/jpeg',
      filename: 'photo.jpg'
    })
  })
})
