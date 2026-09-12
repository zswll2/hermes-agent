/**
 * Narrow-viewport exit for drag-created splits (`SplitNode.origin === 'user'`).
 *
 * On a phone-width viewport a persisted split renders as unreadable sliver
 * columns, so entering narrow mode folds each user split whose smaller
 * column would fall below {@link NARROW_MIN_COLUMN_PX}: the larger-weight
 * column is kept and every pane in the dropped column exits through its
 * EXISTING close path (`closeTreePane` — tool panels collapse to their rail
 * via their store closer, tiles are dismissed, hide-only tabs hide), which
 * keeps the owning stores truthful. Splits without the marker (default
 * tree, presets, adoption/dock healing, trees persisted before the marker
 * existed) are deliberately untouched — the layout reset entry is their
 * way back. Column-orientation (stacked) splits keep full width and are
 * left alone too.
 */

import { allPaneIds, type LayoutNode } from './model'
import { closeTreePane, $layoutTree, $narrowViewport } from './store'

/** Below this column width a narrow-viewport split reads as a sliver. */
export const NARROW_MIN_COLUMN_PX = 280

/** The uncloseable main pane — never chosen for exit. */
const KEEP_PANE = 'workspace'

function smallerSideIndex(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0)

  if (total <= 0 || weights.length !== 2) {
    return -1
  }

  // Ties drop the LATER child, so a [main | other] pair keeps main.
  return weights[1] / total <= weights[0] / total ? 1 : 0
}

/**
 * Collect the pane ids that should EXIT when folding user splits for a
 * `viewportWidth`-wide narrow viewport. Pure — unit-testable against hand
 * built trees. Recurses into the KEPT side (a readable column may itself
 * hold a nested user split that is no longer readable at this width) and
 * into every child of non-folding splits.
 */
export function collectNarrowUserSplitExits(
  node: LayoutNode | null,
  viewportWidth: number,
  minWidth: number = NARROW_MIN_COLUMN_PX
): string[] {
  if (!node || node.type !== 'split') {
    return []
  }

  if (node.origin === 'user' && node.orientation === 'row') {
    const drop = smallerSideIndex(node.weights)

    if (drop >= 0) {
      const total = node.weights.reduce((sum, w) => sum + w, 0)
      const dropPx = (node.weights[drop] / total) * viewportWidth

      if (dropPx < minWidth) {
        const dropChild = node.children[drop]
        const dropPanes = allPaneIds(dropChild)

        if (dropPanes.includes(KEEP_PANE)) {
          return node.children.flatMap(child => collectNarrowUserSplitExits(child, viewportWidth, minWidth))
        }

        const kept = collectNarrowUserSplitExits(node.children[1 - drop], viewportWidth, minWidth)

        return [...dropPanes, ...kept]
      }
    }
  }

  return node.children.flatMap(child => collectNarrowUserSplitExits(child, viewportWidth, minWidth))
}

/** Fold user splits once for the current narrow viewport (idempotent —
 *  after the first fold the tree holds no qualifying splits). */
export function foldUserSplitsForNarrowViewport(): void {
  const tree = $layoutTree.get()

  if (!tree || typeof window === 'undefined') {
    return
  }

  for (const paneId of collectNarrowUserSplitExits(tree, window.innerWidth)) {
    closeTreePane(paneId)
  }
}

/** Mount-once watcher: folds on every transition INTO narrow (nanostores
 *  fires the handler with the current value on subscribe, so a phone-width
 *  boot folds persisted splits immediately). */
export function watchNarrowUserSplitFolding(): () => void {
  return $narrowViewport.subscribe(narrow => {
    if (narrow) {
      foldUserSplitsForNarrowViewport()
    }
  })
}
