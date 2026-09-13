import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { registry } from '@/contrib/registry'
import { stubResizeObserver } from '@/test/jsdom'

import { allPaneIds, group, split } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, declareDefaultTree } from '../store'

import { NarrowOverlays } from './narrow-overlays'

// Ground truth for "the Bots tab is still visible when the sessions sidebar
// collapses on a narrow window". A collapsible pane DOCKED into the sessions
// zone (SESSIONS | BOTS) must leave the grid with the zone, and the narrow
// edge overlay must mirror the zone's tab strip so the docked pane stays
// reachable — not just the zone's first pane.

beforeAll(() => {
  stubResizeObserver()
})

const disposers: (() => void)[] = []

const registerPane = (id: string, title: string, data: Record<string, unknown>, body: string) => {
  disposers.push(
    registry.register({
      area: 'panes',
      data,
      id,
      render: () => <div data-testid={`${id}-body`}>{body}</div>,
      title
    })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  $hiddenTreePanes.set(new Set())

  registerPane('sessions', 'sessions', { collapsible: true, placement: 'left', width: '237px' }, 'session rows')
  registerPane('bots', 'Bots', { collapsible: true, placement: 'left', width: '260px' }, 'bot roster')
  registerPane('workspace', 'workspace', { placement: 'main', uncloseable: true }, 'chat')

  declareDefaultTree(split('row', [group(['sessions', 'bots']), group(['workspace'])]))
  $narrowViewport.set(true)
})

afterEach(() => {
  cleanup()
  $narrowViewport.set(false)
  $layoutTree.set(null)
  disposers.splice(0).forEach(dispose => dispose())
})

const revealPane = (id: string) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id, mode: 'open' } }))
  })
}

const overlayTab = (paneId: string) => document.querySelector<HTMLElement>(`[data-narrow-overlay-tab="${paneId}"]`)

describe('narrow overlay of a stacked zone', () => {
  it('mirrors the zone tab strip so every stacked collapsible stays reachable', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    // Both zone-mates surface as tabs; the revealed pane's body is on screen.
    expect(overlayTab('sessions')).toBeTruthy()
    expect(overlayTab('bots')).toBeTruthy()
    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(queryByTestId('bots-body')).toBeNull()

    // Clicking the BOTS tab swaps the overlay to the docked pane.
    fireEvent.pointerDown(overlayTab('bots')!, { button: 0 })
    expect(getByTestId('bots-body')).toBeTruthy()
    expect(queryByTestId('sessions-body')).toBeNull()
  })

  it('keeps the stripless form for a zone with a single collapsible', () => {
    // Direct set: declareDefaultTree only ADOPTS into an existing tree — it
    // would keep the beforeEach zone (with bots) instead of replacing it.
    $layoutTree.set(split('row', [group(['sessions']), group(['workspace'])]))

    const { getByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(overlayTab('sessions')).toBeNull()
  })

  // A row selection folds the drawer without knowing which zone tab fronts it
  // (closeNarrowSidebarDrawer always names the sessions pane) — close is
  // side-scoped, not tab-scoped.
  it('a close naming one left pane dismisses the drawer whichever zone tab is active', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('bots')
    expect(getByTestId('bots-body')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'sessions', mode: 'close' } }))
    })

    expect(queryByTestId('bots-body')).toBeNull()
  })

  it('a close naming a left pane leaves a right-side reveal alone', () => {
    registerPane('files', 'files', { collapsible: true, placement: 'right', width: '200px' }, 'file rail')
    $layoutTree.set(split('row', [group(['sessions', 'bots']), group(['workspace']), group(['files'])]))

    const { getByTestId } = render(<NarrowOverlays />)

    revealPane('files')
    expect(getByTestId('files-body')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'sessions', mode: 'close' } }))
    })

    expect(getByTestId('files-body')).toBeTruthy()
  })

  // r7 N3 regression: the titlebar's show-right-sidebar press routes here with
  // the pane-state ALIAS while the files pane sits outside `collapsibles` —
  // hidden (the right rail boots closed, so its binding hid the pane at every
  // phone's first paint) or dismissed out of the tree. The press must HEAL the
  // pane and open the drawer anyway, not silently no-op (which is what r6's
  // "zero-code" M3 verdict missed).
  describe('a toggle naming a pane outside collapsibles', () => {
    const coarseMedia = () => {
      const mql = { addEventListener: vi.fn(), matches: true, removeEventListener: vi.fn() }

      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const registerFiles = () =>
      registerPane(
        'files',
        'files',
        { collapsible: true, placement: 'right', revealAliases: ['file-browser'], width: '200px' },
        'file rail'
      )

    it('heals a chrome-hidden pane and still opens the drawer with backdrop and close button', () => {
      coarseMedia()
      registerFiles()
      $layoutTree.set(split('row', [group(['sessions', 'bots']), group(['workspace']), group(['files'])]))
      $hiddenTreePanes.set(new Set(['files']))

      const { getByTestId } = render(<NarrowOverlays />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'file-browser', mode: 'toggle' } })
        )
      })

      expect(getByTestId('files-body')).toBeTruthy()
      expect(document.querySelector('[data-narrow-drawer="right"]')).toBeTruthy()
      expect(document.querySelector('[data-narrow-drawer-close]')).toBeTruthy()
      expect(document.querySelector('[data-narrow-backdrop]')).toBeTruthy()
      expect($hiddenTreePanes.get().has('files')).toBe(false)
    })

    it('re-adopts a dismissed pane that left the tree and still opens the drawer', () => {
      coarseMedia()
      registerFiles()
      // Dismissed: files is gone from the tree entirely.
      $layoutTree.set(split('row', [group(['sessions', 'bots']), group(['workspace'])]))

      const { getByTestId } = render(<NarrowOverlays />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'file-browser', mode: 'open' } })
        )
      })

      expect(getByTestId('files-body')).toBeTruthy()
      expect($layoutTree.get() ? allPaneIds($layoutTree.get()!).includes('files') : false).toBe(true)
    })

    it('still ignores an id no registered collapsible pane answers to', () => {
      coarseMedia()

      const { queryByTestId } = render(<NarrowOverlays />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'no-such-pane', mode: 'toggle' } })
        )
      })

      expect(queryByTestId('sessions-body')).toBeNull()
    })
  })
})
