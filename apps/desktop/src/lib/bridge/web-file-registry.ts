// Files picked or dropped inside the browser tab have no real filesystem
// path, but the renderer's whole attach pipeline (chips, previews, submit)
// is path-keyed. This registry bridges the two worlds: every browser File or
// raw blob gets a stable virtual path (`/__webfs__/<id>/<name>`), and bridge
// reads resolve those paths back to bytes as data URLs.
//
// Pure module — no imports, no side effects at load — so Electron bundles it
// harmlessly (the maps simply stay empty) alongside its real fs bridge.

export const WEB_FS_ROOT = '/__webfs__'

const blobsByPath = new Map<string, Blob>()
const pathByFile = new WeakMap<File, string>()

let nextEntryId = 0

function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/[/\\]+/g, '_')
    // eslint-disable-next-line no-control-regex -- stripping control bytes mirrors the backend's _sanitize_attachment_name
    .replace(/[\x00-\x1f]+/g, '_')
    .trim()
    .replace(/^\.+/, '')

  return cleaned || 'attachment'
}

export function isWebVirtualPath(path: null | string | undefined): boolean {
  return typeof path === 'string' && path.startsWith(`${WEB_FS_ROOT}/`)
}

export function registerWebBlob(blob: Blob, name?: string): string {
  const entryId = ++nextEntryId
  const finalName = sanitizeEntryName(name || (blob instanceof File ? blob.name : '') || 'attachment')
  const path = `${WEB_FS_ROOT}/${entryId}/${finalName}`

  blobsByPath.set(path, blob)

  return path
}

/** Memoized per File object, so re-reading the same drop yields one path. */
export function registerWebFile(file: File): string {
  const existing = pathByFile.get(file)

  if (existing && blobsByPath.has(existing)) {
    return existing
  }

  const path = registerWebBlob(file, file.name)
  pathByFile.set(file, path)

  return path
}

/**
 * Read a registered virtual path as a data URL. Returns null for non-virtual
 * paths (callers fall through to their real-fs path) and for virtual paths
 * whose entry is gone (registry reset between picks).
 */
export function readWebFileDataUrl(path: string): Promise<null | string> {
  if (!isWebVirtualPath(path)) {
    return Promise.resolve(null)
  }

  const blob = blobsByPath.get(path)

  if (!blob) {
    return Promise.resolve(null)
  }

  return new Promise(resolve => {
    const reader = new FileReader()

    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** Test seam: drop every entry so ids never collide across cases. */
export function resetWebFileRegistry(): void {
  blobsByPath.clear()
  nextEntryId = 0
}
