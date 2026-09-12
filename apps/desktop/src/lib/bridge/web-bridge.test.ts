import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWebBridge, WebApiAuthError, WebApiError, WebBridgeCapabilityError } from './web-bridge'
import { isWebVirtualPath, registerWebFile, resetWebFileRegistry, WEB_FS_ROOT } from './web-file-registry'

import { getBridge } from './index'

type FetchMock = ReturnType<typeof vi.fn>

function mockFetch(status = 200, body: unknown = {}): FetchMock {
  const fn = vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' }
        })
  )

  vi.stubGlobal('fetch', fn)

  return fn
}

const authedFetchCall = (fn: FetchMock) => fn.mock.calls[0] as unknown as [string, RequestInit]

beforeEach(() => {
  window.__HERMES_SESSION_TOKEN__ = undefined
  window.__HERMES_AUTH_REQUIRED__ = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web-bridge api()', () => {
  it('GET requests send no body and no content-type', async () => {
    const fn = mockFetch(200, { ok: true })
    const bridge = createWebBridge()
    const result = await bridge.api<{ ok: boolean }>({ path: '/api/profiles/sessions/sidebar' })
    const [url, init] = authedFetchCall(fn)
    expect(url).toBe('/api/profiles/sessions/sidebar')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('content-type')).toBeNull()
    expect(init.credentials).toBe('same-origin')
    expect(result).toEqual({ ok: true })
  })

  it('a GET with a body field still sends no body (GET/no-body semantics)', async () => {
    const fn = mockFetch(200, {})
    const bridge = createWebBridge()
    await bridge.api({ path: '/api/x', method: 'GET', body: { ignored: true } })
    const [, init] = authedFetchCall(fn)
    expect(init.body).toBeUndefined()
  })

  it('non-GET requests JSON-serialize the body and set content-type', async () => {
    const fn = mockFetch(200, { renamed: true })
    const bridge = createWebBridge()
    await bridge.api<{ renamed: boolean }>({
      path: '/api/sessions/abc',
      method: 'PATCH',
      body: { title: 'new' }
    })
    const [url, init] = authedFetchCall(fn)
    expect(url).toBe('/api/sessions/abc')
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ title: 'new' }))
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it('attaches the injected session token header in token mode', async () => {
    const fn = mockFetch(200, {})
    window.__HERMES_SESSION_TOKEN__ = 'tok-1'
    const bridge = createWebBridge()
    await bridge.api({ path: '/api/config' })
    const [, init] = authedFetchCall(fn)
    expect(new Headers(init.headers).get('X-Hermes-Session-Token')).toBe('tok-1')
  })

  it('appends the profile as a query param (merging with existing query)', async () => {
    const fn = mockFetch(200, {})
    const bridge = createWebBridge()
    await bridge.api({ path: '/api/fs/read-data-url?path=%2Fa', profile: 'pro' })
    const [url] = authedFetchCall(fn)
    expect(url).toBe('/api/fs/read-data-url?path=%2Fa&profile=pro')
  })

  it('401/403 reject with WebApiAuthError (re-login path)', async () => {
    mockFetch(401, { error: 'unauthenticated' })
    const bridge = createWebBridge()
    await expect(bridge.api({ path: '/api/config' })).rejects.toBeInstanceOf(WebApiAuthError)
  })

  it('other non-2xx statuses reject with WebApiError carrying the status', async () => {
    mockFetch(500, 'boom')
    const bridge = createWebBridge()
    const error = await bridge.api({ path: '/api/config' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebApiError)
    expect((error as WebApiError).status).toBe(500)
  })

  it('multipart uploads POST FormData with the browser-set boundary (no content-type header)', async () => {
    const fn = mockFetch(200, { saved: true })
    const bridge = createWebBridge()
    const bytes = new TextEncoder().encode('file-bytes')

    const result = await bridge.api<{ saved: boolean }>({
      path: '/api/plugins/kanban/upload',
      upload: { filename: 'board.png', contentType: 'image/png', bytes: bytes.buffer as ArrayBuffer }
    })

    const [url, init] = authedFetchCall(fn)
    expect(url).toBe('/api/plugins/kanban/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const entries = [...(init.body as FormData).entries()]
    const [fieldName, formValue] = entries.find(([name]) => name === 'file') ?? []
    expect(fieldName).toBe('file')
    expect((formValue as File).name).toBe('board.png')
    expect((formValue as File).type).toBe('image/png')
    expect(new Headers(init.headers).get('content-type')).toBeNull()
    expect(init.credentials).toBe('same-origin')
    expect(result).toEqual({ saved: true })
  })

  it('an explicit GET with an upload is a caller bug, not a silent body drop', async () => {
    const bridge = createWebBridge()

    const error = await bridge
      .api({ path: '/api/x', method: 'GET', upload: { filename: 'a.png', bytes: new ArrayBuffer(1) } })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(WebApiError)
    expect((error as WebApiError).status).toBe(400)
  })
})

describe('web-bridge browser file registry', () => {
  beforeEach(() => {
    resetWebFileRegistry()
  })

  it('getPathForFile mints a memoized virtual path for a browser File', () => {
    const bridge = createWebBridge()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const first = bridge.getPathForFile(file)
    expect(isWebVirtualPath(first)).toBe(true)
    expect(first).toContain('note.txt')
    expect(bridge.getPathForFile(file)).toBe(first)
    expect(bridge.getPathForFile(new File(['x'], 'other.txt'))).not.toBe(first)
  })

  it('readFileDataUrl serves registered files as data URLs without any fetch', async () => {
    const fn = mockFetch(200, {})
    const bridge = createWebBridge()
    const path = registerWebFile(new File(['hi'], 'a.txt', { type: 'text/plain' }))
    const dataUrl = await bridge.readFileDataUrl(path)
    expect(dataUrl.startsWith('data:text/plain;base64,')).toBe(true)
    expect(atob(dataUrl.split(',')[1] || '')).toBe('hi')
    expect(fn).not.toHaveBeenCalled()
  })

  it('readFileDataUrl falls through to the REST endpoint for non-virtual paths', async () => {
    const fn = mockFetch(200, { dataUrl: 'data:image/png;base64,QQ==' })
    const bridge = createWebBridge()
    const dataUrl = await bridge.readFileDataUrl('/srv/real/shot.png')
    expect(dataUrl).toBe('data:image/png;base64,QQ==')
    const [url] = authedFetchCall(fn)
    expect(url).toBe(`/api/fs/read-data-url?path=${encodeURIComponent('/srv/real/shot.png')}`)
  })

  it('saveImageBuffer registers bytes under a readable virtual path', async () => {
    const bridge = createWebBridge()
    const bytes = new TextEncoder().encode('pngbytes')
    const path = await bridge.saveImageBuffer(bytes, '.png', 'dropped.png')
    expect(isWebVirtualPath(path)).toBe(true)
    const dataUrl = await bridge.readFileDataUrl(path)
    expect(dataUrl.startsWith('data:')).toBe(true)
    expect(atob(dataUrl.split(',')[1] || '')).toBe('pngbytes')
  })

  it('saveImageBuffer defaults the name from the extension when unnamed', async () => {
    const bridge = createWebBridge()
    const path = await bridge.saveImageBuffer(new Uint8Array([1]), 'png')
    expect(path.endsWith('/attachment.png')).toBe(true)
  })

  it('selectPaths rejects directory picks honestly (no browser directory picker)', async () => {
    const bridge = createWebBridge()
    const error = await bridge.selectPaths({ directories: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebBridgeCapabilityError)
    expect((error as WebBridgeCapabilityError).capability).toBe('selectPaths.directories')
  })

  it('virtual paths live under the reserved root and never collide with real ones', () => {
    expect(isWebVirtualPath(`${WEB_FS_ROOT}/1/a.txt`)).toBe(true)
    expect(isWebVirtualPath('/home/user/a.txt')).toBe(false)
    expect(isWebVirtualPath('')).toBe(false)
    expect(isWebVirtualPath(undefined)).toBe(false)
  })
})

describe('web-bridge getGatewayWsUrl()', () => {
  it('token mode builds the URL from the injected token without any network call', async () => {
    const fn = mockFetch(200, {})
    window.__HERMES_SESSION_TOKEN__ = 'tok-9'
    const bridge = createWebBridge()
    const result = await bridge.getGatewayWsUrl()
    expect(result).toEqual({
      ok: true,
      wsUrl: `ws://${window.location.host}/api/ws?token=tok-9`
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('gated mode mints a single-use ticket and dials with it', async () => {
    const fn = mockFetch(200, { ticket: 'tk-1', ttl_seconds: 30 })
    window.__HERMES_AUTH_REQUIRED__ = true
    const bridge = createWebBridge()
    const result = await bridge.getGatewayWsUrl()
    const [url, init] = authedFetchCall(fn)
    expect(url).toBe('/api/auth/ws-ticket')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(result).toEqual({ ok: true, wsUrl: `ws://${window.location.host}/api/ws?ticket=tk-1` })
  })

  it('an expired cookie (401 on mint) maps to needsOauthLogin for the re-login UX', async () => {
    mockFetch(401, {})
    window.__HERMES_AUTH_REQUIRED__ = true
    const bridge = createWebBridge()
    const result = await bridge.getGatewayWsUrl()
    expect(result).toEqual({ ok: false, needsOauthLogin: true, error: expect.any(String) })
  })
})

describe('web-bridge getConnection()', () => {
  it('synthesizes a remote-url connection in token mode', async () => {
    window.__HERMES_SESSION_TOKEN__ = 'tok-2'
    const bridge = createWebBridge()
    const conn = await bridge.getConnection()
    expect(conn.mode).toBe('remote')
    expect(conn.remoteKind).toBe('url')
    expect(conn.authMode).toBe('token')
    expect(conn.baseUrl).toBe(window.location.origin)
    expect(conn.wsUrl).toContain('token=tok-2')
    expect(conn.isFullscreen).toBe(false)
    expect(conn.windowButtonPosition).toBeNull()
  })

  it('gated mode reports oauth and leaves the cached wsUrl empty (always mint)', async () => {
    window.__HERMES_AUTH_REQUIRED__ = true
    const bridge = createWebBridge()
    const conn = await bridge.getConnection()
    expect(conn.authMode).toBe('oauth')
    expect(conn.wsUrl).toBe('')
  })
})

describe('web-bridge degraded members', () => {
  it('reject with WebBridgeCapabilityError and carry the capability name', async () => {
    const bridge = createWebBridge()
    const error = await bridge.getVersion().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebBridgeCapabilityError)
    expect((error as WebBridgeCapabilityError).capability).toBe('getVersion')
  })

  it('nested object members degrade too', async () => {
    const bridge = createWebBridge()
    await expect(bridge.updates.check()).rejects.toBeInstanceOf(WebBridgeCapabilityError)
    await expect(bridge.connections.list()).rejects.toBeInstanceOf(WebBridgeCapabilityError)
  })

  it('subscriptions return an unsubscribe without ever firing', () => {
    const bridge = createWebBridge()

    const off = bridge.onBootProgress(() => {
      throw new Error('must not fire')
    })

    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })

  it('clipboard without the async API (insecure context) degrades honestly', async () => {
    const bridge = createWebBridge()
    await expect(bridge.readClipboard()).rejects.toBeInstanceOf(WebBridgeCapabilityError)
  })

  it('openExternal refuses non-http(s) schemes', async () => {
    const bridge = createWebBridge()
    await expect(bridge.openExternal('file:///etc/passwd')).rejects.toBeInstanceOf(WebBridgeCapabilityError)
  })
})

describe('bridge install contract', () => {
  it('getBridge() returns the same object installed on window', async () => {
    window.hermesDesktop = createWebBridge()
    expect(getBridge()).toBe(window.hermesDesktop)
    await expect(window.hermesDesktop.api({ path: '/x' })).rejects.toBeInstanceOf(Error)
  })
})
