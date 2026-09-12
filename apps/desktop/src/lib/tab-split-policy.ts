/**
 * Touch/viewport policy for SPLIT-shaped drag drops (pane tabs docked on a
 * zone edge, session rows/tiles dropped on an edge band).
 *
 * A split on a phone-width viewport produces unreadable slivers (a 390px
 * screen split in half is two ~195px columns; the default tree's right rail
 * is already ~86-105px) whose edge drop targets physically overlap the
 * narrow drawer hover strips, so the gesture is REJECTED there instead of
 * committing — desktop (fine pointer, wide viewport) behavior is unchanged.
 *
 * The boundary intentionally matches the sidebar-collapse breakpoint
 * (SIDEBAR_DOCK_MIN_WIDTH_PX = 640): splits are only allowed on viewports
 * where side rails can still dock, so a split can never outlive the narrow
 * mode that would make it unreadable.
 */

/** Minimum viewport width at which a split drop may commit. */
export const TAB_SPLIT_MIN_WIDTH_PX = 640

export interface TabSplitPolicyInput {
  /** Whether the primary pointer is coarse (touch). */
  coarse: boolean
  width: number
}

/** Pure policy: may a split-shaped drop commit in this context? */
export function shouldAllowTabSplit({ coarse, width }: TabSplitPolicyInput): boolean {
  return !coarse && width > TAB_SPLIT_MIN_WIDTH_PX
}

/** Runtime resolver for drag-commit gates (browser-only; false elsewhere). */
export function tabSplitAllowedNow(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return shouldAllowTabSplit({
    coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    width: window.innerWidth
  })
}
