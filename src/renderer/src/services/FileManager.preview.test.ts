import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  const filesMap = new Map<string, any>()
  const blocksList: any[] = []
  const dbObj: any = {
    files: {
      get: vi.fn(async (id: string) => filesMap.get(id)),
      bulkGet: vi.fn(async (ids: string[]) => ids.map((id) => filesMap.get(id))),
      update: vi.fn(async (id: string, changes: Record<string, any>) => {
        const cur = filesMap.get(id)
        if (cur) Object.assign(cur, changes)
        return 1
      }),
      delete: vi.fn(async (id: string) => {
        filesMap.delete(id)
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        ids.forEach((id) => filesMap.delete(id))
      })
    },
    message_blocks: {
      where: vi.fn(() => ({
        anyOf: (targetIds: string[]) => ({
          toArray: async () => blocksList.filter((blk) => targetIds.includes(blk.file?.id))
        })
      }))
    },
    transaction: vi.fn(async (_mode: string, _t1: unknown, _t2: unknown, scope: () => Promise<unknown>) => scope())
  }
  return { filesMap, blocksList, dbObj }
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@renderer/databases', () => ({ default: dbMocks.dbObj }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/store', () => ({ default: { getState: () => ({ runtime: { filesPath: '/app/Data/Files' } }) } }))
vi.mock('@renderer/utils', () => ({ getFileDirectory: (path: string) => path }))
import type { FileMetadata } from '@renderer/types'

import FileManager from './FileManager'

describe('attachment previews', () => {
  beforeEach(() => {
    dbMocks.filesMap.clear()
    dbMocks.blocksList.length = 0
    vi.stubGlobal('window', {
      api: {
        file: {
          base64Image: vi.fn().mockResolvedValue({ data: 'data:image/png;base64,AA==' }),
          delete: vi.fn().mockResolvedValue(true)
        }
      }
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
  it('also resolves browser memory attachments', async () => {
    expect(
      await FileManager.resolvePreviewUrl({
        id: 'memory-image',
        ext: '.png',
        path: 'memory://memory-image/photo.png'
      } as FileMetadata)
    ).toBe('data:image/png;base64,AA==')
  })
  it('self-heals under-counted db.files.count in FileManager.deleteFile when surviving blocks still reference the file', async () => {
    dbMocks.filesMap.set('f-shared', { id: 'f-shared', ext: '.pdf', count: 1 })
    dbMocks.blocksList.push(
      { id: 'blk-1', type: 'file', file: { id: 'f-shared' } },
      { id: 'blk-2', type: 'file', file: { id: 'f-shared' } }
    )

    await FileManager.deleteFile('f-shared', false)
    expect(dbMocks.filesMap.get('f-shared')?.count).toBe(2)
    expect(window.api.file.delete).not.toHaveBeenCalled()

    dbMocks.blocksList.length = 0
    dbMocks.filesMap.get('f-shared')!.count = 1
    await FileManager.deleteFile('f-shared', false)
    expect(dbMocks.filesMap.has('f-shared')).toBe(false)
    expect(window.api.file.delete).toHaveBeenCalledWith('f-shared.pdf')
  })
})
