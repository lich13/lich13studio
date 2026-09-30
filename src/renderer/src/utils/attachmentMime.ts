/** Android document providers may label images application/octet-stream. */
export function attachmentMime(name: string, declared: string, bytes?: Uint8Array): string {
  const starts = (signature: number[]) => signature.every((value, index) => bytes?.[index] === value)
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (starts([255, 216, 255])) return 'image/jpeg'
  if (starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97])) return 'image/gif'
  if (starts([82, 73, 70, 70]) && bytes?.[8] === 87 && bytes?.[9] === 69 && bytes?.[10] === 66 && bytes?.[11] === 80)
    return 'image/webp'
  const mime = declared.split(';')[0].trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream') return mime
  const extension = name.split('.').pop()?.toLowerCase() || ''
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        pdf: 'application/pdf',
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json'
      } as Record<string, string>
    )[extension] || 'application/octet-stream'
  )
}

export function managedAttachmentId(path: string, extension: string): string {
  if (path.startsWith('memory://')) return path.slice('memory://'.length).split('/')[0]
  const name = path.replace(/\\/g, '/').split('/').pop() || ''
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name
}
