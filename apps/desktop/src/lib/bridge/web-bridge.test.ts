import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWebBridge, WebApiAuthError, WebApiError, WebBridgeCapabilityError } from './web-bridge'

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

  it('multipart upload requests reject with a capability error (out of P0 scope)', async () => {
    const bridge = createWebBridge()
    await expect(
      bridge.api({ path: '/api/upload', upload: { filename: 'a.png', bytes: new ArrayBuffer(1) } })
    ).rejects.toBeInstanceOf(WebBridgeCapabilityError)
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
