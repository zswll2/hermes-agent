/**
 * PWA update visibility (web build only): the bundle carries its build stamp
 * (`__HERMES_BUILD_STAMP__`, written by scripts/write-build-stamp.mjs into
 * public/build-stamp.json and the vite `define`); the page re-fetches that
 * SAME file on load and on every visibilitychange→visible and compares.
 *
 * Why page-side polling: a home-screen web app is a long-lived WKWebView
 * that iOS RESUMES without a new navigation, so HTML cache headers never get
 * a chance — only code running inside the page can notice a redeploy.
 *
 * On mismatch it AUTO-RELOADS ONCE per remote stamp (sessionStorage guard —
 * a stale CDN edge serving the old bundle after reload must not loop), and
 * falls back to a manual "new version, tap to refresh" pill when a reload
 * already happened for this stamp.
 */

export const WEB_STAMP_STORAGE_KEY = 'hermes.web.reloadedStamp'

function stampUrl(): string {
  return `${import.meta.env.BASE_URL}build-stamp.json?t=${Date.now()}`
}

function remoteBuildId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const id = (payload as { buildId?: unknown }).buildId

  return typeof id === 'string' && id.length > 0 ? id : null
}

function alreadyReloaded(remote: string): boolean {
  try {
    return sessionStorage.getItem(WEB_STAMP_STORAGE_KEY) === remote
  } catch {
    return false
  }
}

function markReloaded(remote: string): void {
  try {
    sessionStorage.setItem(WEB_STAMP_STORAGE_KEY, remote)
  } catch {
    // Private-mode quota refusal just loses loop protection; the banner
    // fallback still gives the user a manual way out.
  }
}

function showUpdatePill(): void {
  if (document.querySelector('[data-web-update-pill]')) {
    return
  }

  const pill = document.createElement('button')
  pill.dataset.webUpdatePill = ''
  pill.setAttribute('aria-live', 'polite')
  pill.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%)',
    'top:calc(env(safe-area-inset-top,0px) + 44px)',
    'z-index:2147483647',
    'padding:0.5rem 1rem',
    'border-radius:9999px',
    'border:1px solid rgba(255,255,255,0.2)',
    'background:rgba(20,20,24,0.92)',
    'color:#fff',
    'font:600 12px/1.2 system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.35)'
  ].join(';')
  pill.type = 'button'
  pill.addEventListener('click', () => location.reload())

  const text = window.__HERMES_WEB_UPDATE_COPY__
  pill.textContent = typeof text === 'string' ? text : 'A new version is available — tap to refresh'
  document.body.appendChild(pill)
}

async function checkOnce(embedded: string): Promise<void> {
  let remote: string | null = null

  try {
    const response = await fetch(stampUrl(), { cache: 'no-store' })

    if (response.ok) {
      remote = remoteBuildId(await response.json())
    }
  } catch {
    return
  }

  if (!remote || remote === embedded) {
    return
  }

  if (alreadyReloaded(remote)) {
    showUpdatePill()

    return
  }

  markReloaded(remote)
  location.reload()
}

/** Web build only (`__HERMES_WEB__`); a no-op everywhere else. i18n copy is
 *  injected via {@link setWebUpdateCopy} by the React layer. */
export function installWebUpdateCheck(): void {
  if (!__HERMES_WEB__ || typeof window === 'undefined' || !__HERMES_BUILD_STAMP__) {
    return
  }

  const embedded = __HERMES_BUILD_STAMP__

  void checkOnce(embedded)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkOnce(embedded)
    }
  })
}

declare global {
  interface Window {
    __HERMES_WEB_UPDATE_COPY__?: string
  }
}

/** The pill is rendered outside React (document.body, before providers); the
 *  translated copy arrives through this setter once i18n is up. */
export function setWebUpdateCopy(copy: string): void {
  window.__HERMES_WEB_UPDATE_COPY__ = copy

  const pill = document.querySelector<HTMLElement>('[data-web-update-pill]')

  if (pill) {
    pill.textContent = copy
  }
}
