// Browser implementation of the `window.hermesDesktop` bridge.
//
// The web build runs the SAME renderer source as Electron; every native
// capability the renderer expects arrives through this shim instead of the
// preload script. REST goes same-origin through `api()` (the single REST choke
// point — `src/api/client.ts` and the direct-call domain files all land here),
// the WebSocket URL is minted per dial (cookie → ws-ticket when the dashboard
// gate is on, injected session token on loopback), and everything that needs a
// machine (windows, overlays, local fs dialogs, terminals, updates) rejects
// with `WebBridgeCapabilityError` instead of silently returning undefined.
import { buildHermesWebSocketUrl, type GatewayWsUrlResult, type WebSocketAuthParam } from '@hermes/shared'

import type { HermesApiRequest, HermesConnection } from '@/global'

export class WebBridgeCapabilityError extends Error {
  readonly capability: string

  constructor(capability: string) {
    super(`This capability is not available in the browser: ${capability}`)
    this.name = 'WebBridgeCapabilityError'
    this.capability = capability
  }
}

export class WebApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'WebApiError'
    this.status = status
  }
}

/** 401/403 from the backend: the session (cookie or injected token) is gone. */
export class WebApiAuthError extends WebApiError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'WebApiAuthError'
  }
}

declare global {
  interface Window {
    // Injected into /app's index.html by the dashboard server (same
    // convention as the dashboard SPA — web_server_dashboard.py).
    __HERMES_SESSION_TOKEN__?: string
    __HERMES_AUTH_REQUIRED__?: boolean
  }
}

const SESSION_HEADER = 'X-Hermes-Session-Token'

const warned = new Set<string>()

function warnOnce(capability: string): void {
  if (warned.has(capability)) {return}
  warned.add(capability)
   
  console.warn('[web-bridge] unavailable:', capability)
}

/**
 * Structured degradation for a required bridge member the browser cannot
 * offer. Rejects with `WebBridgeCapabilityError` on first use (and warns once
 * per capability) so misrouted calls are visible in the console during
 * acceptance instead of failing as silent `undefined`.
 */
function unavailable(capability: string): (...args: unknown[]) => Promise<never> {
  return (...args: unknown[]) => {
    warnOnce(capability)

    return Promise.reject(new WebBridgeCapabilityError(capability))
  }
}

// A subscription with no web-side event source. Subscribing succeeds and the
// unsubscribe is a no-op; the callback simply never fires.
const neverFires = () => () => {}

function authHeaders(hasJsonBody: boolean): Headers {
  const headers = new Headers()

  if (hasJsonBody) {headers.set('content-type', 'application/json')}
  const token = window.__HERMES_SESSION_TOKEN__

  if (token) {headers.set(SESSION_HEADER, token)}

  return headers
}

function withProfileParam(path: string, profile?: string | null): string {
  if (!profile) {return path}
  const sep = path.includes('?') ? '&' : '?'

  return `${path}${sep}profile=${encodeURIComponent(profile)}`
}

async function webApi<T>(request: HermesApiRequest): Promise<T> {
  if (request.upload) {
    warnOnce('api.upload')

    return Promise.reject(new WebBridgeCapabilityError('api.upload'))
  }

  const method = (request.method ?? 'GET').toUpperCase()
  const hasBody = request.body !== undefined && method !== 'GET' && method !== 'HEAD'

  const res = await fetch(withProfileParam(request.path, request.profile), {
    method,
    headers: authHeaders(hasBody),
    body: hasBody ? JSON.stringify(request.body) : undefined,
    credentials: 'same-origin',
    signal: request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined
  })

  if (res.status === 401 || res.status === 403) {
    throw new WebApiAuthError(res.status, `${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }

  if (!res.ok) {
    throw new WebApiError(res.status, `${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }

  const text = await res.text()

  return (text ? (JSON.parse(text) as T) : (undefined as T)) ?? (null as T)
}

/** Auth pair for a WS dial: ticket (gated) or injected token (loopback). */
async function buildWsAuthParam(): Promise<WebSocketAuthParam> {
  if (window.__HERMES_AUTH_REQUIRED__) {
    const res = await fetch('/api/auth/ws-ticket', { method: 'POST', credentials: 'same-origin' })

    if (!res.ok) {
      // Session cookie expired — the existing GatewayReauthRequiredError UX
      // picks this up through `needsOauthLogin`.
      throw new WebApiAuthError(res.status, `/api/auth/ws-ticket: HTTP ${res.status}`)
    }

    const data = (await res.json()) as { ticket: string }

    return ['ticket', data.ticket]
  }

  return ['token', window.__HERMES_SESSION_TOKEN__ ?? '']
}

async function webGetGatewayWsUrl(_profile?: null | string): Promise<GatewayWsUrlResult> {
  try {
    const authParam = await buildWsAuthParam()

    return { ok: true, wsUrl: buildHermesWebSocketUrl({ path: '/api/ws', authParam }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof WebApiAuthError) {return { ok: false, needsOauthLogin: true, error: message }}

    return { ok: false, error: message }
  }
}

// The browser is always "remote": one same-origin backend, no process pool.
// mode='remote' makes the existing remote paths (desktop-fs REST, desktop-git
// REST) engage without touching those modules.
async function webGetConnection(_profile?: null | string): Promise<HermesConnection> {
  const gated = window.__HERMES_AUTH_REQUIRED__ === true
  const token = window.__HERMES_SESSION_TOKEN__ ?? ''

  return {
    baseUrl: window.location.origin,
    isFullscreen: false,
    nativeOverlayWidth: 0,
    token,
    logs: [],
    windowButtonPosition: null,
    mode: 'remote',
    remoteKind: 'url',
    authMode: gated ? 'oauth' : 'token',
    source: 'settings',
    // oauth-mode dials always mint a fresh ticket; the cached wsUrl only
    // matters as the token-mode fallback, so leave it empty when gated.
    wsUrl: gated ? '' : buildHermesWebSocketUrl({ path: '/api/ws', authParam: ['token', token] })
  }
}

// Fallback for direct `readFileDataUrl` call sites; the remote branch of
// desktop-fs.ts (media rendering) goes through `api()` instead.
async function webReadFileDataUrl(path: string): Promise<string> {
  const res = await fetch(withProfileParam(`/api/fs/read-data-url?path=${encodeURIComponent(path)}`), {
    headers: authHeaders(false),
    credentials: 'same-origin'
  })

  if (!res.ok) {throw new WebApiError(res.status, `read-data-url: HTTP ${res.status}`)}
  const data = (await res.json()) as string | { dataUrl?: string }

  return typeof data === 'string' ? data : (data.dataUrl ?? '')
}

async function webReadClipboard(): Promise<string> {
  if (!navigator.clipboard) {
    warnOnce('readClipboard')

    return Promise.reject(new WebBridgeCapabilityError('readClipboard'))
  }

  return navigator.clipboard.readText()
}

async function webWriteClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) {
    warnOnce('writeClipboard')

    return Promise.reject(new WebBridgeCapabilityError('writeClipboard'))
  }

  await navigator.clipboard.writeText(text)

  return true
}

async function webOpenExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    warnOnce('openExternal')

    return Promise.reject(new WebBridgeCapabilityError(`openExternal(${url})`))
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

async function webNotify(payload: {
  body?: string
  silent?: boolean
  title?: string
}): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {return false}
  new Notification(payload.title || 'Hermes', { body: payload.body, silent: payload.silent })

  return true
}

export function createWebBridge(): Window['hermesDesktop'] {
  return {
    // ── Real implementations (P0 data plane) ──
    api: webApi,
    getConnection: webGetConnection,
    getGatewayWsUrl: webGetGatewayWsUrl,
    revalidateConnection: async () => ({ ok: true, rebuilt: false }),
    touchBackend: async () => ({ ok: true }),
    readFileDataUrl: webReadFileDataUrl,
    readClipboard: webReadClipboard,
    writeClipboard: webWriteClipboard,
    openExternal: webOpenExternal,
    notify: webNotify,
    // No peer windows exist in a browser tab — every ambient cue is ours.
    claimAmbientCue: async () => true,

    // ── Honest static capability values ──
    glassSupported: false,
    translucencySupported: false,
    localModelsEnabled: false,

    // ── Subscriptions with no web event source: subscribe, never fire ──
    onBrowserPopoutClosed: neverFires,
    onPreviewFileChanged: neverFires,
    onBackendExit: neverFires,
    onBootProgress: neverFires,
    onBootstrapEvent: neverFires,
    onFoundInPage: neverFires,
    onOpenFindBarRequested: neverFires,

    // ── Window/overlay surfaces: fire-and-forget pushes are no-ops, ──
    // ── everything returning a Promise degrades structurally.     ──
    petOverlay: {
      open: unavailable('petOverlay.open'),
      close: unavailable('petOverlay.close'),
      setBounds: () => {},
      setIgnoreMouse: () => {},
      setFocusable: () => {},
      pushState: () => {},
      control: () => {},
      onState: neverFires,
      onControl: neverFires
    },
    quickEntry: {
      getSettings: unavailable('quickEntry.getSettings'),
      setSettings: unavailable('quickEntry.setSettings'),
      submit: () => {},
      dismiss: () => {},
      pushState: () => {},
      onState: neverFires,
      onSubmit: neverFires,
      onShown: neverFires
    },

    // ── Structured degradation for every remaining member ──
    getProfileRoutes: unavailable('getProfileRoutes'),
    getPoolLimits: unavailable('getPoolLimits'),
    setPoolLimits: unavailable('setPoolLimits'),
    openSessionWindow: unavailable('openSessionWindow'),
    openSessionInTerminal: unavailable('openSessionInTerminal'),
    openWindow: unavailable('openWindow'),
    openBrowserWindow: unavailable('openBrowserWindow'),
    getBootProgress: unavailable('getBootProgress'),
    getConnectionConfig: unavailable('getConnectionConfig'),
    saveConnectionConfig: unavailable('saveConnectionConfig'),
    applyConnectionConfig: unavailable('applyConnectionConfig'),
    testConnectionConfig: unavailable('testConnectionConfig'),
    getSecretStorageEncryption: unavailable('getSecretStorageEncryption'),
    setSecretStorageEncryption: unavailable('setSecretStorageEncryption'),
    connections: {
      list: unavailable('connections.list'),
      save: unavailable('connections.save'),
      remove: unavailable('connections.remove'),
      setPrimary: unavailable('connections.setPrimary'),
      test: unavailable('connections.test')
    },
    sshConfigHosts: unavailable('sshConfigHosts'),
    sshResolveHost: unavailable('sshResolveHost'),
    probeConnectionConfig: unavailable('probeConnectionConfig'),
    oauthLoginConnectionConfig: unavailable('oauthLoginConnectionConfig'),
    oauthLogoutConnectionConfig: unavailable('oauthLogoutConnectionConfig'),
    cloud: {
      status: unavailable('cloud.status'),
      login: unavailable('cloud.login'),
      logout: unavailable('cloud.logout'),
      discover: unavailable('cloud.discover'),
      agentSignIn: unavailable('cloud.agentSignIn')
    },
    profile: {
      get: unavailable('profile.get'),
      remember: unavailable('profile.remember'),
      set: unavailable('profile.set')
    },
    requestMicrophoneAccess: unavailable('requestMicrophoneAccess'),
    readFileText: unavailable('readFileText'),
    selectPaths: unavailable('selectPaths'),
    saveImageFromUrl: unavailable('saveImageFromUrl'),
    saveImageBuffer: unavailable('saveImageBuffer'),
    saveClipboardImage: unavailable('saveClipboardImage'),
    // Sync member: File objects picked in a browser carry no real path.
    getPathForFile: () => '',
    normalizePreviewTarget: unavailable('normalizePreviewTarget'),
    watchPreviewFile: unavailable('watchPreviewFile'),
    stopPreviewFileWatch: unavailable('stopPreviewFileWatch'),
    fetchLinkTitle: unavailable('fetchLinkTitle'),
    sanitizeWorkspaceCwd: unavailable('sanitizeWorkspaceCwd'),
    settings: {
      getDefaultProjectDir: unavailable('settings.getDefaultProjectDir'),
      pickDefaultProjectDir: unavailable('settings.pickDefaultProjectDir'),
      setDefaultProjectDir: unavailable('settings.setDefaultProjectDir')
    },
    revealLogs: unavailable('revealLogs'),
    getRecentLogs: unavailable('getRecentLogs'),
    readDir: unavailable('readDir'),
    terminal: {
      attach: unavailable('terminal.attach'),
      cwd: unavailable('terminal.cwd'),
      dispose: unavailable('terminal.dispose'),
      onData: neverFires,
      onExit: neverFires,
      resize: unavailable('terminal.resize'),
      start: unavailable('terminal.start'),
      write: unavailable('terminal.write')
    },
    getBootstrapState: unavailable('getBootstrapState'),
    continueBootstrapLocal: unavailable('continueBootstrapLocal'),
    resetBootstrap: unavailable('resetBootstrap'),
    repairBootstrap: unavailable('repairBootstrap'),
    cancelBootstrap: unavailable('cancelBootstrap'),
    getVersion: unavailable('getVersion'),
    updates: {
      check: unavailable('updates.check'),
      apply: unavailable('updates.apply'),
      getBranch: unavailable('updates.getBranch'),
      setBranch: unavailable('updates.setBranch'),
      onProgress: neverFires
    },
    uninstall: {
      summary: unavailable('uninstall.summary'),
      run: unavailable('uninstall.run')
    },
    themes: {
      fetchMarketplace: unavailable('themes.fetchMarketplace'),
      searchMarketplace: unavailable('themes.searchMarketplace')
    },
    findInPage: unavailable('findInPage'),
    stopFindInPage: unavailable('stopFindInPage')
  }
}
