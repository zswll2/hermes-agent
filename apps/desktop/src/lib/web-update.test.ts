/** Behavior contract for the web PWA update check (src/lib/web-update.ts):
 * one auto-reload per remote stamp, guard written BEFORE the reload, a manual
 * pill once the guard has fired, and silence when the remote matches the
 * embedded stamp or the probe fails. The embedded stamp comes from the
 * ui-project define in vitest.config.ts ('vitest-embedded-stamp'). */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { installWebUpdateCheck, WEB_STAMP_STORAGE_KEY } from './web-update'

const EMBEDDED = 'vitest-embedded-stamp'

const okStamp = (buildId: string) => () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ buildId }) } as Response)

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

let fetchMock: Mock
let reloadSpy: Mock
let setItemSpy: ReturnType<typeof vi.spyOn>

const pill = () => document.querySelector('[data-web-update-pill]')

beforeEach(() => {
  sessionStorage.clear()
  pill()?.remove()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  reloadSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { reload: reloadSpy },
    configurable: true,
    writable: true,
  })
  // jsdom hands out a fresh Storage proxy per window.sessionStorage access,
  // so the spy must live on the shared prototype to see the product call.
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  pill()?.remove()
  sessionStorage.clear()
})

describe('web-update checkOnce contract (via installWebUpdateCheck)', () => {
  it('first mismatch reloads exactly once and writes the guard BEFORE reloading', async () => {
    fetchMock.mockImplementation(okStamp('remote-new'))
    installWebUpdateCheck()
    await flush()

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(WEB_STAMP_STORAGE_KEY)).toBe('remote-new')
    // Order proof: the guard must already be in place when reload fires, or a
    // stale page reloading would loop forever.
    expect(setItemSpy.mock.invocationCallOrder[0]).toBeLessThan(
      reloadSpy.mock.invocationCallOrder[0]
    )

    // Resumes (visibilitychange→visible) must not reload a second time for
    // the same remote stamp — jsdom's visibilityState is 'visible' by default.
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
    }

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(pill()).not.toBeNull()
  })

  it('guard already hit → pill only, no reload', async () => {
    sessionStorage.setItem(WEB_STAMP_STORAGE_KEY, 'remote-new')
    fetchMock.mockImplementation(okStamp('remote-new'))
    installWebUpdateCheck()
    await flush()

    expect(reloadSpy).not.toHaveBeenCalled()
    expect(pill()).not.toBeNull()
  })

  it('remote equals embedded → no action', async () => {
    fetchMock.mockImplementation(okStamp(EMBEDDED))
    installWebUpdateCheck()
    await flush()

    expect(reloadSpy).not.toHaveBeenCalled()
    expect(pill()).toBeNull()
    expect(sessionStorage.getItem(WEB_STAMP_STORAGE_KEY)).toBeNull()
  })

  it('fetch rejects → no action', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    installWebUpdateCheck()
    await flush()

    expect(reloadSpy).not.toHaveBeenCalled()
    expect(pill()).toBeNull()
    expect(sessionStorage.getItem(WEB_STAMP_STORAGE_KEY)).toBeNull()
  })
})
