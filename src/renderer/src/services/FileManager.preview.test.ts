import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: true }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn() }) } }))
vi.mock('@renderer/databases', () => ({ default: {} }))
vi.mock('@renderer/i18n', () => ({ default: {} }))
vi.mock('@renderer/store', () => ({ default: {} }))
vi.mock('@renderer/utils', () => ({ getFileDirectory: (path: string) => path }))
import type { FileMetadata } from '@renderer/types'

import FileManager from './FileManager'

describe('attachment previews', () => {
  beforeEach(() => {
    native.enabled = true
    vi.stubGlobal('window', {
      api: { file: { base64Image: vi.fn().mockResolvedValue({ data: 'data:image/png;base64,AA==' }) } }
    })
  })
  it('reads persisted private attachments through the native bridge after restarting', async () => {
    const file = {
      id: 'saved-image',
      ext: '.png',
      path: '/data/user/0/com.lich13.studio/files/Data/Files/saved-image.png'
    } as FileMetadata
    expect(await FileManager.resolvePreviewUrl(file)).toBe('data:image/png;base64,AA==')
    expect(window.api.file.base64Image).toHaveBeenCalledWith('saved-image.png')
  })
  it('keeps the Electron filesystem preview path', async () => {
    native.enabled = false
    expect(await FileManager.resolvePreviewUrl({ path: '/tmp/photo.png', ext: '.png' } as FileMetadata)).toBe(
      'file:///tmp/photo.png'
    )
    expect(window.api.file.base64Image).not.toHaveBeenCalled()
  })
  it('also resolves browser memory attachments', async () => {
    native.enabled = false
    expect(
      await FileManager.resolvePreviewUrl({
        id: 'memory-image',
        ext: '.png',
        path: 'memory://memory-image/photo.png'
      } as FileMetadata)
    ).toBe('data:image/png;base64,AA==')
  })
})
