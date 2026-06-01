import type { FileMetadata } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSupportedFile: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      verbose: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils', () => ({
  getFileExtension: (filePath: string) => {
    const extension = filePath.split('.').pop()?.toLowerCase()
    return extension && extension !== filePath ? `.${extension}` : '.'
  },
  isSupportedFile: mocks.isSupportedFile
}))

type PasteEvent = ClipboardEvent & {
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
}

const createMetadata = (overrides: Partial<FileMetadata> = {}): FileMetadata =>
  ({
    id: 'file-id',
    origin_name: 'pasted.png',
    name: 'pasted.png',
    path: '/tmp/pasted.png',
    created_at: '2026-05-30T00:00:00.000Z',
    size: 8,
    ext: 'png',
    type: 'image',
    count: 1,
    ...overrides
  }) as FileMetadata

const createSetFiles = () => {
  let files: FileMetadata[] = []
  const setFiles = vi.fn((updater: (prevFiles: FileMetadata[]) => FileMetadata[]) => {
    files = updater(files)
  })

  return {
    setFiles,
    getFiles: () => files
  }
}

const createPasteEvent = ({
  text = '',
  files = [],
  items = []
}: {
  text?: string
  files?: File[]
  items?: DataTransferItem[]
}): PasteEvent =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clipboardData: {
      getData: vi.fn((type: string) => (type === 'text' ? text : '')),
      files,
      items
    }
  }) as unknown as PasteEvent

describe('PasteService.handlePaste', () => {
  beforeEach(() => {
    mocks.isSupportedFile.mockReset()
    mocks.isSupportedFile.mockResolvedValue(true)

    const api = {
      file: {
        createTempFile: vi.fn(async (fileName: string) => `/tmp/${fileName}`),
        write: vi.fn(async () => undefined),
        get: vi.fn(async (filePath: string) =>
          createMetadata({
            path: filePath,
            origin_name: filePath.split('/').pop() ?? 'file.txt',
            name: filePath.split('/').pop() ?? 'file.txt',
            ext: filePath.endsWith('.txt') ? 'txt' : 'png',
            type: filePath.endsWith('.txt') ? 'text' : 'image'
          })
        ),
        getPathForFile: vi.fn(() => ''),
        savePastedImage: vi.fn(async () => createMetadata())
      }
    }

    ;(globalThis as typeof globalThis & { window: unknown }).window = {
      api,
      toast: {
        error: vi.fn(),
        info: vi.fn()
      }
    }
  })

  it('attaches an unnamed image/png clipboard item', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], '', { type: 'image/png' })
    const event = createPasteEvent({
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => imageFile
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.savePastedImage).toHaveBeenCalledWith(expect.any(Uint8Array), '.png')
    expect(getFiles()).toEqual([expect.objectContaining({ ext: 'png', type: 'image' })])
  })

  it('rejects a pasted image item when image extensions are unsupported', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const imageFile = new File([new Uint8Array([1, 2, 3])], '', { type: 'image/png' })
    const event = createPasteEvent({
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => imageFile
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(
      event,
      ['.txt'],
      setFiles,
      undefined,
      false,
      5000,
      '',
      undefined,
      (key) => key
    )

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.savePastedImage).not.toHaveBeenCalled()
    expect(window.toast.info).toHaveBeenCalledWith('chat.input.file_not_supported')
    expect(getFiles()).toEqual([])
  })

  it('attaches a clipboard image even when text metadata is also present', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], '', { type: 'image/png' })
    const event = createPasteEvent({
      text: 'Screenshot',
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => imageFile
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.savePastedImage).toHaveBeenCalledWith(expect.any(Uint8Array), '.png')
    expect(getFiles()).toEqual([expect.objectContaining({ ext: 'png', type: 'image' })])
  })

  it('does not attach the same clipboard image twice when files and items both expose it', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const fileBytes = new Uint8Array([137, 80, 78, 71])
    const imageFileFromFiles = new File([fileBytes], 'clipboard.png', {
      lastModified: 1,
      type: 'image/png'
    })
    const imageFileFromItems = new File([fileBytes], 'clipboard.png', {
      lastModified: 1,
      type: 'image/png'
    })
    const event = createPasteEvent({
      files: [imageFileFromFiles],
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => imageFileFromItems
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(handled).toBe(true)
    expect(window.api.file.savePastedImage).toHaveBeenCalledTimes(1)
    expect(getFiles()).toHaveLength(1)
  })

  it('does not attach the same clipboard image twice when files and items differ by lastModified', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const fileBytes = new Uint8Array([137, 80, 78, 71])
    const imageFileFromFiles = new File([fileBytes], 'image.png', {
      lastModified: 1,
      type: 'image/png'
    })
    const imageFileFromItems = new File([fileBytes], 'image.png', {
      lastModified: 2,
      type: 'image/png'
    })
    const event = createPasteEvent({
      files: [imageFileFromFiles],
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => imageFileFromItems
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(handled).toBe(true)
    expect(window.api.file.savePastedImage).toHaveBeenCalledTimes(1)
    expect(getFiles()).toHaveLength(1)
  })

  it('does not handle the same native image paste event twice', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
    const event = createPasteEvent({ files: [imageFile] })

    const firstHandled = await PasteService.handlePaste(event, ['.png'], setFiles)
    const secondHandled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(firstHandled).toBe(true)
    expect(secondHandled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(window.api.file.savePastedImage).toHaveBeenCalledTimes(1)
    expect(getFiles()).toHaveLength(1)
  })

  it('attaches a file path exposed only through clipboard items', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const documentFile = new File([new Uint8Array([37, 80, 68, 70])], 'doc.pdf', {
      type: 'application/pdf'
    })
    vi.mocked(window.api.file.getPathForFile).mockReturnValue('/tmp/doc.pdf')
    const event = createPasteEvent({
      items: [
        {
          kind: 'file',
          type: 'application/pdf',
          getAsFile: () => documentFile
        } as DataTransferItem
      ]
    })

    const handled = await PasteService.handlePaste(event, ['.pdf'], setFiles)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.get).toHaveBeenCalledWith('/tmp/doc.pdf')
    expect(window.api.file.savePastedImage).not.toHaveBeenCalled()
    expect(getFiles()).toEqual([expect.objectContaining({ path: '/tmp/doc.pdf' })])
  })

  it('rejects a path-backed file when its extension is not supported', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const textFile = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    vi.mocked(window.api.file.getPathForFile).mockReturnValue('/tmp/notes.txt')
    const event = createPasteEvent({
      files: [textFile]
    })

    const handled = await PasteService.handlePaste(
      event,
      ['.png'],
      setFiles,
      undefined,
      false,
      5000,
      '',
      undefined,
      (key) => key
    )

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.get).not.toHaveBeenCalled()
    expect(window.toast.info).toHaveBeenCalledWith('chat.input.file_not_supported')
    expect(getFiles()).toEqual([])
  })

  it('saves an unnamed clipboard image even when the runtime exposes a memory path', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], '', { type: 'image/png' })
    vi.mocked(window.api.file.getPathForFile).mockReturnValue('memory://pending/file-id/')
    const event = createPasteEvent({ files: [imageFile] })

    const handled = await PasteService.handlePaste(event, ['.png'], setFiles)

    expect(handled).toBe(true)
    expect(window.api.file.savePastedImage).toHaveBeenCalledWith(expect.any(Uint8Array), '.png')
    expect(window.api.file.get).not.toHaveBeenCalled()
    expect(getFiles()).toEqual([expect.objectContaining({ ext: 'png', type: 'image' })])
  })

  it('converts long pasted text to a text attachment', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const event = createPasteEvent({ text: 'long pasted text' })

    const handled = await PasteService.handlePaste(event, ['.txt'], setFiles, undefined, true, 5)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.file.createTempFile).toHaveBeenCalledWith('pasted_text.txt')
    expect(window.api.file.write).toHaveBeenCalledWith('/tmp/pasted_text.txt', 'long pasted text')
    expect(getFiles()).toEqual([expect.objectContaining({ ext: 'txt', type: 'text' })])
  })

  it('lets short pasted text use the default textarea paste behavior', async () => {
    const { default: PasteService } = await import('./PasteService')
    const { setFiles, getFiles } = createSetFiles()
    const event = createPasteEvent({ text: 'short text' })

    const handled = await PasteService.handlePaste(event, ['.txt'], setFiles, undefined, true, 5000)

    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(getFiles()).toEqual([])
  })
})
