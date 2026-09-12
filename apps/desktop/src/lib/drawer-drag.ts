/**
 * Drawer drag-follow math and the atom that carries a live gesture to the
 * narrow-overlay renderer (see narrow-overlays.tsx). Pure arithmetic only —
 * the hook (use-edge-swipe-drawer.ts) owns the event plumbing.
 */

import { atom } from 'nanostores'

/** Release commits the gesture when the drawer travelled at least this
 *  fraction of its width. */
export const DRAWER_COMMIT_FRACTION = 0.5

/** ...or reached this velocity (px/ms) — a flick commits early. */
export const DRAWER_COMMIT_VELOCITY_PX_PER_MS = 0.5

/** ms the settle transition runs before the final state applies. */
export const DRAWER_SETTLE_MS = 160

export interface DrawerDragProgressInput {
  /** Horizontal travel of the gesture in px (magnitude). */
  dx: number
  /** The drawer's rendered width in px. */
  width: number
}

/** Gesture progress 0..1 (clamped): how far the drawer has travelled. */
export function drawerDragProgress({ dx, width }: DrawerDragProgressInput): number {
  if (width <= 0) {
    return 0
  }

  return Math.min(1, Math.max(0, Math.abs(dx) / width))
}

export interface DrawerReleaseDecisionInput {
  dx: number
  /** Gesture duration in ms (for the velocity rung). */
  dt: number
  width: number
}

export type DrawerReleaseDecision = 'commit' | 'cancel'

/** Commit on ≥50% travel OR a flick past the velocity threshold; anything
 *  else springs back. */
export function drawerReleaseDecision({ dx, dt, width }: DrawerReleaseDecisionInput): DrawerReleaseDecision {
  const progress = drawerDragProgress({ dx, width })

  if (progress >= DRAWER_COMMIT_FRACTION) {
    return 'commit'
  }

  const velocity = dt > 0 ? Math.abs(dx) / dt : 0

  return velocity >= DRAWER_COMMIT_VELOCITY_PX_PER_MS ? 'commit' : 'cancel'
}

export interface DrawerDragState {
  side: 'left' | 'right'
  /** Visible fraction 0..1 — follows the finger during `drag`, animates to
   *  `target` during `settle`. */
  fraction: number
  phase: 'drag' | 'settle'
  /** Where `settle` lands: 1 = drawer ends open, 0 = ends closed. */
  target: 0 | 1
}

/** Live drag-follow channel: null when no gesture is addressing a drawer. */
export const $drawerDrag = atom<DrawerDragState | null>(null)
