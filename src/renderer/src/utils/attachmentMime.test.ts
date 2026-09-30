import { describe, expect, it } from 'vitest'

import { attachmentMime, managedAttachmentId } from './attachmentMime'

describe('system-picked attachment MIME', () => {
  it('recognizes PNG bytes even when the document provider supplies a generic type', () => {
    expect(
      attachmentMime('image', 'application/octet-stream', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ).toBe('image/png')
  })
  it.each([
    ['photo.JPG', 'image/jpeg'],
    ['image.webp', 'image/webp'],
    ['notes.md', 'text/markdown'],
    ['data.json', 'application/json'],
    ['data.bin', 'application/octet-stream']
  ])('restores the type of %s after a restart', (name, mime) => {
    expect(attachmentMime(name, '')).toBe(mime)
  })
  it('preserves a meaningful document type and ignores incomplete image signatures', () => {
    expect(attachmentMime('document', 'application/pdf')).toBe('application/pdf')
    expect(attachmentMime('document', '', Uint8Array.from([137, 80]))).toBe('application/octet-stream')
  })
  it('preserves the persisted filename ID when selected files are registered again', () => {
    expect(managedAttachmentId('/data/user/0/com.lich13.studio/files/Data/Files/file-123-abc.png', '.png')).toBe(
      'file-123-abc'
    )
    expect(managedAttachmentId('C:\\Data\\Files\\file-123-abc.png', '.png')).toBe('file-123-abc')
    expect(managedAttachmentId('memory://file-123-abc/Original image.png', '.png')).toBe('file-123-abc')
  })
})
