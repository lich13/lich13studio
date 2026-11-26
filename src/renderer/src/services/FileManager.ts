import { loggerService } from '@logger'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import type { FileMetadata } from '@renderer/types'
import type { OpenDialogOptions } from '@renderer/types/fileDialog'
import { getFileDirectory } from '@renderer/utils'
import dayjs from 'dayjs'

const logger = loggerService.withContext('FileManager')

function summarizeFileForLog(file: Partial<FileMetadata> | null | undefined) {
  if (!file) return null
  return {
    type: file.type,
    size: file.size,
    ext: file.ext
  }
}

class FileManager {
  private static uploadingFileIds = new Set<string>()

  static async selectFiles(options?: OpenDialogOptions): Promise<FileMetadata[] | null> {
    return await window.api.file.select(options)
  }

  static async addFile(file: FileMetadata): Promise<FileMetadata> {
    const fileRecord = await db.files.get(file.id)

    if (fileRecord) {
      await db.files.update(fileRecord.id, { ...fileRecord, count: fileRecord.count + 1 })
      return fileRecord
    }

    await db.files.add(file)

    return file
  }

  static async addFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.addFile(file)))
  }

  static async readBase64File(file: FileMetadata): Promise<string> {
    const fileData = await window.api.file.base64File(file.id + file.ext)
    return fileData.data
  }

  static async uploadFile(file: FileMetadata): Promise<FileMetadata> {
    let uploadedId = ''
    if (file?.id) {
      this.uploadingFileIds.add(file.id)
    }
    try {
      logger.info('Uploading file:', summarizeFileForLog(file))

      const uploadFile = await window.api.file.upload(file)
      logger.info('Uploaded file:', summarizeFileForLog(uploadFile))
      if (uploadFile?.id) {
        uploadedId = uploadFile.id
        this.uploadingFileIds.add(uploadedId)
      }
      const fileRecord = await db.files.get(uploadFile.id)

      if (fileRecord) {
        await db.files.update(fileRecord.id, { ...fileRecord, count: fileRecord.count + 1 })
        return fileRecord
      }

      await db.files.add(uploadFile)

      return uploadFile
    } finally {
      if (file?.id) {
        this.uploadingFileIds.delete(file.id)
      }
      if (uploadedId) {
        this.uploadingFileIds.delete(uploadedId)
      }
    }
  }

  static async uploadFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.uploadFile(file)))
  }

  static async cleanupUncommittedDraftFiles(files: FileMetadata[]): Promise<void> {
    if (!files || files.length === 0) return
    await Promise.allSettled(
      files.map(async (file) => {
        if (!file?.id || !file.ext || this.uploadingFileIds.has(file.id)) return
        const committed = await db.files.get(file.id)
        if (!committed && !this.uploadingFileIds.has(file.id)) {
          await window.api?.file?.delete?.(file.id + file.ext)
        }
      })
    )
  }

  static async getFile(id: string): Promise<FileMetadata | undefined> {
    const file = await db.files.get(id)

    if (file) {
      const filesPath = store.getState().runtime.filesPath
      file.path = filesPath + '/' + file.id + file.ext
    }

    return file
  }

  static getFilePath(file: FileMetadata) {
    const filesPath = store.getState().runtime.filesPath
    return filesPath + '/' + file.id + file.ext
  }

  static async deleteFile(id: string, force: boolean = false): Promise<void> {
    const file = await this.getFile(id)

    logger.info('Deleting file:', summarizeFileForLog(file))

    if (!file) {
      return
    }

    if (!force) {
      const { applyFileCountDeltasInTx, purgeDetachedAttachments } = await import('./db/DexieMessageDataSource')
      let attachmentsToDelete: string[] = []
      await db.transaction('rw', db.message_blocks, db.files, async () => {
        attachmentsToDelete = await applyFileCountDeltasInTx(
          db.files,
          new Map([[id, { delta: -1, deleteIfZero: true }]]),
          { messageBlocksTable: db.message_blocks }
        )
      })
      await purgeDetachedAttachments(attachmentsToDelete)
      return
    }

    await db.files.delete(id)

    try {
      await window.api.file.delete(id + file.ext)
    } catch (error) {
      logger.error('Failed to delete file:', error as Error)
    }
  }

  static async deleteFiles(files: FileMetadata[]): Promise<void> {
    if (!files || files.length === 0) return

    const results = await Promise.allSettled(files.map((file) => this.deleteFile(file.id)))

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      logger.warn(`File deletions completed with ${failed.length} files failed to delete:`, failed)
    }
  }

  static async allFiles(): Promise<FileMetadata[]> {
    return db.files.toArray()
  }

  static isDangerFile(file: FileMetadata) {
    return ['.sh', '.bat', '.cmd', '.ps1', '.vbs', 'reg'].includes(file.ext)
  }

  static getSafePath(file: FileMetadata) {
    // use the path from the file metadata instead
    // this function is used to get path for files which are not in the filestorage
    return this.isDangerFile(file) ? getFileDirectory(file.path) : file.path
  }

  static isMemoryFile(file: Pick<FileMetadata, 'path'>) {
    return file.path.startsWith('memory://')
  }

  static async resolvePreviewUrl(file: FileMetadata): Promise<string> {
    const imageData = await window.api.file.base64Image(file.id + file.ext)
    return imageData.data
  }

  static getFileUrl(file: FileMetadata) {
    const filesPath = store.getState().runtime.filesPath
    return 'file://' + filesPath + '/' + file.name
  }

  static async updateFile(file: FileMetadata) {
    if (!file.origin_name.includes(file.ext)) {
      file.origin_name = file.origin_name + file.ext
    }

    await db.files.update(file.id, file)
  }

  static formatFileName(file: FileMetadata) {
    if (!file || !file.origin_name) {
      return ''
    }

    const date = dayjs(file.created_at).format('YYYY-MM-DD')

    if (file.origin_name.includes('pasted_text')) {
      return date + ' ' + i18n.t('message.attachments.pasted_text') + file.ext
    }

    if (file.origin_name.startsWith('temp_file') && file.origin_name.includes('image')) {
      return date + ' ' + i18n.t('message.attachments.pasted_image') + file.ext
    }

    return file.origin_name
  }
}

export default FileManager
