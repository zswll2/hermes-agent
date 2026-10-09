import { describe, expect, it } from 'vitest'

import { attachmentFilename, dispositionFilename, downloadFilename, imageFilename } from './download-filename'

describe('imageFilename', () => {
  it('takes the last path segment of a URL', () => {
    expect(imageFilename('https://v3.fal.media/files/kangaroo/pic.png')).toBe('pic.png')
  })

  it('falls back to "image" when there is no usable segment', () => {
    expect(imageFilename('https://example.com/')).toBe('image')
    expect(imageFilename(undefined)).toBe('image')
  })
})

describe('downloadFilename', () => {
  it('keeps a name that already has a known image extension', () => {
    expect(downloadFilename('https://example.com/a/photo.jpg', 'image/jpeg')).toBe('photo.jpg')
    expect(downloadFilename('https://example.com/a/photo.webp', '')).toBe('photo.webp')
  })

  it('appends a MIME-derived extension to extensionless content hashes', () => {
    expect(downloadFilename('https://v3.fal.media/files/x/MKZV6h-RrKLVCOKp9bGfE_YuJPemAQ', 'image/jpeg')).toBe(
      'MKZV6h-RrKLVCOKp9bGfE_YuJPemAQ.jpg'
    )
    expect(downloadFilename('https://cdn.example.com/abc123', 'image/webp')).toBe('abc123.webp')
  })

  it('handles MIME parameters and unknown types', () => {
    expect(downloadFilename('https://cdn.example.com/abc123', 'image/png; charset=binary')).toBe('abc123.png')
    expect(downloadFilename('https://cdn.example.com/abc123', 'application/octet-stream')).toBe('abc123.png')
    expect(downloadFilename('https://cdn.example.com/abc123', undefined)).toBe('abc123.png')
  })

  it('does not treat a dotted hash suffix as an extension', () => {
    // A name like "photo.v2" has an extname but not a known image one — the
    // MIME extension still gets appended so the OS can open the file.
    expect(downloadFilename('https://cdn.example.com/photo.v2', 'image/png')).toBe('photo.v2.png')
  })
})

describe('dispositionFilename', () => {
  it('parses a quoted plain filename', () => {
    expect(dispositionFilename('attachment; filename="report.pdf"')).toBe('report.pdf')
  })

  it('parses a bare filename and an RFC 5987 UTF-8 filename', () => {
    expect(dispositionFilename('attachment; filename=notes.txt')).toBe('notes.txt')
    expect(dispositionFilename("attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf")).toBe('报告.pdf')
  })

  it('prefers the UTF-8 form and tolerates malformed encoding', () => {
    expect(dispositionFilename("attachment; filename=\"a.txt\"; filename*=UTF-8''b.txt")).toBe('b.txt')
    expect(dispositionFilename("attachment; filename*=UTF-8''%E0%A4%A; filename=\"ok.txt\"")).toBe('ok.txt')
  })

  it('returns null for absent or nameless headers', () => {
    expect(dispositionFilename(null)).toBeNull()
    expect(dispositionFilename('inline')).toBeNull()
  })
})

describe('attachmentFilename', () => {
  it('prefers the Content-Disposition name — the gateway knows the real one', () => {
    expect(attachmentFilename('/tmp/x/whatever', 'application/pdf', 'attachment; filename="final report.pdf"')).toBe(
      'final report.pdf'
    )
  })

  it('keeps a basename that already carries an extension', () => {
    expect(attachmentFilename('/tmp/hermes/report.pdf', 'application/pdf')).toBe('report.pdf')
    expect(attachmentFilename('/tmp/hermes/a b.zip', 'application/zip')).toBe('a b.zip')
  })

  it('appends a MIME-derived extension to an extensionless path', () => {
    expect(attachmentFilename('/tmp/hermes/data', 'text/csv')).toBe('data.csv')
    expect(attachmentFilename('/tmp/hermes/hash', 'application/pdf')).toBe('hash.pdf')
  })

  it('routes extensionless images through the image-aware derivation', () => {
    expect(attachmentFilename('/tmp/hermes/pic', 'image/webp')).toBe('pic.webp')
  })

  it('never invents an extension for unknown or binary MIME types', () => {
    expect(attachmentFilename('/tmp/hermes/blob', 'application/octet-stream')).toBe('blob')
    expect(attachmentFilename('/tmp/hermes/blob', undefined)).toBe('blob')
    expect(attachmentFilename('/tmp/hermes/blob', 'application/x-custom; v=2')).toBe('blob')
  })
})
