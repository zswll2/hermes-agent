import { downloadFilename } from './download-filename'

/**
 * Save a file URL through the browser's own download path: fetch → blob →
 * transient `<a download>` click.
 *
 * This is the web build's equivalent of the Electron save dialog and the ONLY
 * save mechanism available in a browser, so both the bridge's image-save
 * channel and the composer's non-IPC fallback route through this one
 * implementation instead of drifting apart.
 */
export async function startBrowserDownload(url: string): Promise<string> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Could not fetch file: ${response.status}`)
  }

  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = downloadFilename(url, blob.type)
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)

  return link.download
}
