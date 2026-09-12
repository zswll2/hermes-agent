import { useEffect } from 'react'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { matchesQuery } from '@/hooks/use-media-query'
import { classifyEdgeSwipe } from '@/lib/edge-swipe'
import { setSidebarOpen } from '@/store/layout'

interface TrackedTouch {
  identifier: number
  startX: number
  startY: number
}

// The narrow drawer's reveal state is LOCAL to the overlay component (it
// never lives in the layout store), so its rendered node is the only honest
// visibility signal — the pane's `open` flag defaults to true and stays true
// while the drawer is hidden, which would make every "open" swipe a no-op.
function narrowDrawerVisible(): boolean {
  return Boolean(document.querySelector("[data-narrow-drawer='left']"))
}

/**
 * Edge-swipe drawer gesture for narrow viewports.
 *
 * Registration is pinned to pure observation: touchstart/touchend listeners
 * are `passive: true` and NOTHING ever calls `preventDefault()` — a passive
 * listener cannot cancel scrolling anyway, and cancelling would fight the
 * transcript's own scroll. The gesture is classified once, on touchend, by the
 * pure `classifyEdgeSwipe` contract; only then does it touch drawer state,
 * through the same setSidebarOpen the titlebar button uses.
 *
 * Desktop is untouched twice over: the handler returns early unless the
 * sidebar-collapse media query matches, and touch events never fire for a
 * mouse. A second finger landing mid-gesture invalidates it (pinch-zoom must
 * not toggle the drawer).
 */
export function useEdgeSwipeDrawer(): void {
  useEffect(() => {
    let tracked: TrackedTouch | null = null

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        tracked = null

        return
      }

      const touch = event.touches[0]

      if (!touch) {
        return
      }

      tracked = { identifier: touch.identifier, startX: touch.clientX, startY: touch.clientY }
    }

    const onTouchEnd = (event: TouchEvent) => {
      const start = tracked

      tracked = null

      if (!start || !matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
        return
      }

      const touch = [...event.changedTouches].find(candidate => candidate.identifier === start.identifier)

      if (!touch) {
        return
      }

      const gesture = classifyEdgeSwipe({
        dx: touch.clientX - start.startX,
        dy: touch.clientY - start.startY,
        startX: start.startX,
        open: narrowDrawerVisible()
      })

      if (gesture) {
        setSidebarOpen(gesture === 'open')
      }
    }

    const onTouchCancel = () => {
      tracked = null
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [])
}
