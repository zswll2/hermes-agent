// Edge-swipe classification for the narrow-viewport drawer gesture.
//
// Pure arithmetic on the gesture's start point and total delta — no DOM, no
// state — so the threshold contract is unit-testable in isolation. The hook
// (app/chat/hooks/use-edge-swipe-drawer.ts) owns only the event plumbing.

/** A gesture starting further from the left edge than this is not an
 *  edge-swipe (iOS reserves roughly this band for the system gesture). */
export const EDGE_SWIPE_START_MAX_X_PX = 24

/** Minimum horizontal travel before a gesture counts as a swipe. */
export const EDGE_SWIPE_MIN_DX_PX = 60

/** Vertical drift above which a gesture is a scroll, not a swipe. */
export const EDGE_SWIPE_MAX_ABS_DY_PX = 40

export interface EdgeSwipeInput {
  /** Horizontal travel: endX - startX, positive → rightward. */
  dx: number
  /** Vertical drift: endY - startY. */
  dy: number
  /** Gesture start X in viewport coordinates. */
  startX: number
  /** Whether the drawer the gesture controls is currently open. */
  open: boolean
}

export type EdgeSwipeResult = 'close' | 'open' | null

/**
 * Classify one completed touch gesture against the drawer thresholds.
 *
 * - Drawer closed: only a rightward swipe STARTING within the edge band opens
 *   it, so mid-screen horizontal drags (slider UIs, text selection) never
 *   summon the drawer.
 * - Drawer open: a leftward swipe from anywhere closes it — the drawer itself
 *   covers the screen edge, so every close gesture necessarily starts on it.
 * - Anything else — too short, too diagonal, or a repeat of the current state
 *   — is `null` and must not touch drawer state.
 */
export function classifyEdgeSwipe({ dx, dy, startX, open }: EdgeSwipeInput): EdgeSwipeResult {
  if (Math.abs(dy) > EDGE_SWIPE_MAX_ABS_DY_PX) {
    return null
  }

  if (open) {
    return dx <= -EDGE_SWIPE_MIN_DX_PX ? 'close' : null
  }

  if (startX > EDGE_SWIPE_START_MAX_X_PX) {
    return null
  }

  return dx >= EDGE_SWIPE_MIN_DX_PX ? 'open' : null
}
