/** Filename derivation for browser-anchor downloads (fetch → blob →
 * `<a download>`): the anchor needs a name, and generated-file URLs (fal.media
 * content hashes, gateway temp paths) often end extensionless — without an
 * extension the OS save dialog shows "All Files" and the saved file won't open
 * by double-click. */

/** Image MIME → extension, for `downloadFilename` (the image hook's contract:
 * unknown or binary types fall back to `.png`). */
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp'
}

/** Non-image MIME → extension, for `attachmentFilename` (unknown types get NO
 * invented extension — a bare name beats a wrong one). */
const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/gzip': '.gz',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/plain': '.txt'
}

const KNOWN_IMAGE_EXTENSION_RE = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i

/** Any plausible filename extension — unlike the image-specific regex, an
 * attachment may carry any extension the OS can already open. */
const ANY_EXTENSION_RE = /\.[A-Za-z0-9]{1,8}$/

const normalizedMime = (mimeType?: string): string =>
  String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()

export function imageFilename(src?: string): string {
  if (!src) {
    return 'image'
  }

  try {
    return new URL(src, window.location.href).pathname.split('/').filter(Boolean).pop() || 'image'
  } catch {
    return src.split(/[\\/]/).filter(Boolean).pop() || 'image'
  }
}

export function downloadFilename(src: string, mimeType?: string): string {
  const base = imageFilename(src)

  if (KNOWN_IMAGE_EXTENSION_RE.test(base)) {
    return base
  }

  const type = normalizedMime(mimeType)

  return `${base}${IMAGE_MIME_EXTENSIONS[type] || '.png'}`
}

/** `filename` (quoted or bare) or RFC 5987 `filename*=UTF-8''…` from a
 * Content-Disposition header — the gateway's file routes always set it to the
 * real on-disk name, which beats any client-side guess. */
export function dispositionFilename(header: null | string | undefined): null | string {
  if (!header) {
    return null
  }

  const extended = /filename\*=(?:utf-8)?''([^;]+)/i.exec(header)

  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header)

  return plain?.[1]?.trim() || null
}

/** Name for a gateway file download: the response's Content-Disposition when
 * the server sent one, else the path basename, else the basename plus a
 * MIME-derived extension (image-aware so an extensionless image still gets
 * its `.png`/`.jpg`). Never invents an extension for a name that has none and
 * an unknown MIME — a bare name is better than a wrong one. */
export function attachmentFilename(path: string, mimeType?: string, disposition?: null | string): string {
  const header = dispositionFilename(disposition)

  if (header) {
    return header
  }

  const base = path.split(/[\\/]/).filter(Boolean).pop() || 'download'

  if (ANY_EXTENSION_RE.test(base)) {
    return base
  }

  const type = normalizedMime(mimeType)

  if (!type || type === 'application/octet-stream') {
    return base
  }

  if (type.startsWith('image/')) {
    return downloadFilename(base, type)
  }

  return `${base}${ATTACHMENT_MIME_EXTENSIONS[type] ?? ''}`
}
