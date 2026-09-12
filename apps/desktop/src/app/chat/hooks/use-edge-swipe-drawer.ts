import { useEffect } from 'react'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { matchesQuery } from '@/hooks/use-media-query'
import { classifyEdgeSwipe, EDGE_SWIPE_START_MAX_X_PX } from '@/lib/edge-swipe'
import { drawerDragProgress, $drawerDrag } from '@/lib/drawer-drag'
import { setFileBrowserOpen, setSidebarOpen } from '@/store/layout'

interface TrackedTouch {
  identifier: number
  startX: number
  startY: number
  startedAt: number
}

interface VisibleDrawer {
  side: 'left' | 'right'
  paneId: string | null
  width: number
}

// The narrow drawer's reveal state is LOCAL to the overlay component (it
// never lives in the layout store), so its rendered node is the only honest
// visibility signal — the pane's `open` flag defaults to true and stays true
// while the drawer is hidden, which would make every "open" swipe a no-op.
// data-narrow-drawer-pane (the close routing channel) is read on release.
function visibleDrawer(): VisibleDrawer | null {
  const el =
    document.querySelector<HTMLElement>("[data-narrow-drawer='left']") ??
    document.querySelector<HTMLElement>("[data-narrow-drawer='right']")

  if (!el) {
    return null
  }

  return {
    side: el.dataset.narrowDrawer === 'right' ? 'right' : 'left',
    paneId: el.dataset.narrowDrawerPane ?? null,
    width: el.offsetWidth
  }
}

/** Fallback drawer width for opening gestures (drawer not mounted yet) —
 *  mirrors the overlay's `min(18rem, 85vw)` default. */
const drawerWidthProxy = () => Math.min(288, window.innerWidth * 0.85)

/** Horizontal travel needed before a gesture locks to the drag axis. */
const AXIS_LOCK_DX_PX = 8

/**
 * Edge-swipe drawer gesture for narrow viewports, both edges.
 *
 * Registration is pinned to pure observation: every listener is
 * `passive: true` and NOTHING ever calls `preventDefault()` — a passive
 * listener cannot cancel scrolling anyway, and cancelling would fight the
 * transcript's own scroll. Classification runs once, on touchend, through
 * the pure `classifyEdgeSwipe` contract (side-aware); only then does it
 * touch drawer state, through the same setters the titlebar buttons use.
 *
 * Drag-follow: once a gesture axis-locks horizontal AND addresses a drawer
 * (starts in a closed side's edge band, or rides an open drawer outward),
 * every touchmove publishes progress to `$drawerDrag` — the narrow overlay
 * renders the drawer following the finger, mounting it at gesture start.
 * Release settles through the same atom (the overlay animates and applies
 * the final state); pure classification only runs for gestures that never
 * followed (sub-lock drift released where it started).
 *
 * Desktop is untouched twice over: the handler returns early unless the
 * sidebar-collapse media query matches, and touch events never fire for a
 * mouse. A second finger landing mid-gesture invalidates it (pinch-zoom
 * must not toggle the drawer).
 */
export function useEdgeSwipeDrawer(): void {
  useEffect(() => {
    let tracked: TrackedTouch | null = null
    let axisLocked = false
    // Resolved on the FIRST qualifying move and frozen for the gesture: the
    // drag-follow ghost mounts a drawer mid-gesture, so re-reading the DOM
    // would mistake the ghost for an open drawer and drop the follow.
    let follow: { side: 'left' | 'right'; wasOpen: boolean; paneId: string | null; width: number } | null = null

    const touchById = (list: TouchList, identifier: number) =>
      [...list].find(candidate => candidate.identifier === identifier)

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        tracked = null
        axisLocked = false
        follow = null
        $drawerDrag.set(null)

        return
      }

      const touch = event.touches[0]

      if (!touch) {
        return
      }

      tracked = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: event.timeStamp
      }
      axisLocked = false
      follow = null
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = tracked

      if (!start) {
        return
      }

      const touch = touchById(event.touches, start.identifier)

      if (!touch) {
        return
      }

      const dx = touch.clientX - start.startX

      if (!follow) {
        if (!axisLocked) {
          if (Math.abs(dx) < AXIS_LOCK_DX_PX) {
            return
          }

          axisLocked = Math.abs(dx) > Math.abs(touch.clientY - start.startY)

          if (!axisLocked) {
            tracked = null

            return
          }
        }

        const open = visibleDrawer()
        const side = open?.side ?? (start.startX <= EDGE_SWIPE_START_MAX_X_PX ? 'left' : 'right')
        const towardCenter = side === 'left' ? dx > 0 : dx < 0

        if (open) {
          // Riding an open drawer: only the outward direction follows.
          if (towardCenter) {
            return
          }
        } else if (!towardCenter) {
          return
        }

        follow = { paneId: open?.paneId ?? null, side, wasOpen: Boolean(open), width: open?.width || drawerWidthProxy() }
      }

      const width = follow.width
      const progress = drawerDragProgress({ dx, width })

      $drawerDrag.set({ fraction: follow.wasOpen ? 1 - progress : progress, phase: 'drag', side: follow.side, target: 0 })
    }

    const onTouchEnd = (event: TouchEvent) => {
      const start = tracked
      const followed = follow !== null

      tracked = null
      axisLocked = false

      if (!start) {
        follow = null
        $drawerDrag.set(null)

        return
      }

      const touch = touchById(event.changedTouches, start.identifier)

      if (!touch) {
        return
      }

      const dx = touch.clientX - start.startX
      const dy = touch.clientY - start.startY

      if (!followed) {
        follow = null
        $drawerDrag.set(null)

        if (!matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
          return
        }

        const open = visibleDrawer()
        const gesture = classifyEdgeSwipe({
          dx,
          dy,
          startX: start.startX,
          open: Boolean(open),
          side: open?.side ?? 'left',
          width: window.innerWidth
        })

        if (gesture) {
          applyGesture(gesture === 'open', open)
        }

        return
      }

      // Followed gesture: settle through the atom — the overlay animates to
      // the target and applies the final state when the transition ends.
      const state = follow
      follow = null

      if (state) {
        const dt = event.timeStamp - start.startedAt
        const commits =
          Math.abs(dy) <= 40 &&
          (drawerDragProgress({ dx, width: state.width }) >= 0.5 || (dt > 0 && Math.abs(dx) / dt >= 0.5))
        const fraction = drawerDragProgress({ dx, width: state.width })

        $drawerDrag.set({
          fraction: state.wasOpen ? 1 - fraction : fraction,
          phase: 'settle',
          side: state.side,
          target: state.wasOpen ? (commits ? 0 : 1) : commits ? 1 : 0
        })
      }
    }

    const onTouchCancel = () => {
      tracked = null
      axisLocked = false
      follow = null
      $drawerDrag.set(null)
    }

    // Capture phase: the drag-follow ghost mounts the pane content UNDER the
    // finger mid-gesture, and that content (the sessions list's sortable
    // rows) may stop touch events in the bubble phase — capture keeps the
    // gesture's own listeners first in line while staying passive.
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true })
      document.removeEventListener('touchmove', onTouchMove, { capture: true })
      document.removeEventListener('touchend', onTouchEnd, { capture: true })
      document.removeEventListener('touchcancel', onTouchCancel, { capture: true })
    }
  }, [])
}

function applyGesture(open: boolean, drawer: VisibleDrawer | null): void {
  const side = drawer?.side ?? 'left'

  if (open) {
    if (side === 'left') {
      setSidebarOpen(true)
    } else {
      setFileBrowserOpen(true)
    }

    return
  }

  if (side === 'left') {
    // Keeps $sidebarOpen truthful for the resize back to wide.
    setSidebarOpen(false)

    return
  }

  if (drawer?.paneId) {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: drawer.paneId, mode: 'close' } }))

    return
  }

  setFileBrowserOpen(false)
}
