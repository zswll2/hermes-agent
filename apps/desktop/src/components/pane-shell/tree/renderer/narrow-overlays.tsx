/**
 * Narrow-viewport edge overlays — the tree's take on the app's hover-reveal
 * collapse. Collapsible panes leave the grid below the sidebar-collapse
 * breakpoint; an edge strip (hover) or PANE_TOGGLE_REVEAL_EVENT (⌘B / ⌘G /
 * titlebar toggles route here on narrow) slides the pane OVER the layout
 * instead of squeezing it. Event reveals pin; hover reveals follow the mouse.
 *
 * Touch: hover strips never register (there is no hover), ANY reveal gets a
 * backdrop, and the drawer carries a ≥44px close button — plus drag-follow
 * ($drawerDrag, fed by use-edge-swipe-drawer) renders the drawer tracking
 * the finger and settles with a transition, mounting the pane at gesture
 * start so the pull-out is live from pixel one.
 */

import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import type { Contribution } from '@/contrib/types'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import { DRAWER_SETTLE_MS, $drawerDrag } from '@/lib/drawer-drag'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { setFileBrowserOpen, setSidebarOpen } from '@/store/layout'
import { cn } from '@/lib/utils'

import { PANE_TOGGLE_REVEAL_EVENT } from '../..'
import { allPaneIds, findGroupOfPane } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport } from '../store'

import { paneChrome } from './track-model'

type DrawerSide = 'left' | 'right'

const sideOf = (c: Contribution): DrawerSide => (paneChrome(c).placement === 'left' ? 'left' : 'right')

/** Inline visual state for a followed/settling drawer; null = default. */
interface DragVisual {
  fraction: number
  phase: 'drag' | 'settle'
}

function drawerTransform(side: DrawerSide, fraction: number): string {
  const offset = side === 'left' ? fraction - 1 : 1 - fraction

  return `translateX(${offset * 100}%)`
}

export function NarrowOverlays() {
  const narrow = useStore($narrowViewport)
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const hiddenPanes = useStore($hiddenTreePanes)
  const coarse = useMediaQuery('(pointer: coarse)')
  const { t } = useI18n()
  const [reveal, setReveal] = useState<{ id: string; pinned: boolean } | null>(null)
  const drag = useStore($drawerDrag)

  // Own an Escape layer only while something is revealed, so Escape closes the
  // overlay only when it's the top layer (never under a dialog / edit mode).
  const revealActive = reveal !== null
  useEffect(() => (revealActive ? pushEscapeLayer(ESCAPE_PRIORITY.narrowOverlay) : undefined), [revealActive])

  const inTree = useMemo(() => new Set(tree ? allPaneIds(tree) : []), [tree])

  const collapsibles = useMemo(
    () => panes.filter(p => paneChrome(p).collapsible && inTree.has(p.id) && !hiddenPanes.has(p.id)),
    [panes, inTree, hiddenPanes]
  )

  const collapsiblesRef = useRef(collapsibles)
  collapsiblesRef.current = collapsibles

  // ⌘B / ⌘G's narrow branch dispatches the app's toggle-reveal event with the
  // REAL pane id — accept those via each contribution's revealAliases.
  useEffect(() => {
    if (!narrow) {
      setReveal(null)

      return
    }

    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; mode?: 'close' | 'open' | 'toggle' }>).detail
      const id = detail?.id

      if (!id) {
        return
      }

      const match = collapsiblesRef.current.find(p => p.id === id || paneChrome(p).revealAliases?.includes(id))

      if (!match) {
        return
      }

      // `open`/`close` are explicit intents (programmatic reveal, titlebar show);
      // `toggle` (default) is the ⌘B/⌘G flip.
      const mode = detail?.mode ?? 'toggle'
      setReveal(current => {
        if (mode === 'open') {
          return { id: match.id, pinned: true }
        }

        if (mode === 'close') {
          return current?.id === match.id ? null : current
        }

        return current?.id === match.id && current.pinned ? null : { id: match.id, pinned: true }
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
        return
      }

      event.preventDefault()
      setReveal(null)
    }

    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [narrow])

  // A settling drag lands here: after the transition window, apply the real
  // end state (open the owning pane's drawer, or drop the reveal) and clear
  // the atom. The open-drawer case needs NO remount — its reveal stays put
  // and only the inline transform goes away.
  const settleSide = drag?.phase === 'settle' ? drag.side : null
  useEffect(() => {
    if (settleSide === null) {
      return
    }

    const timer = window.setTimeout(() => {
      const state = $drawerDrag.get()

      $drawerDrag.set(null)

      if (state?.target === 1) {
        if (settleSide === 'left') {
          setSidebarOpen(true)
        } else {
          setFileBrowserOpen(true)
        }
      } else if (state?.target === 0) {
        setReveal(current => (current && sideOfSafe(current.id, collapsiblesRef.current) === settleSide ? null : current))
      }
    }, DRAWER_SETTLE_MS)

    return () => window.clearTimeout(timer)
  }, [settleSide, drag?.target, drag?.fraction])

  if (!narrow || collapsibles.length === 0) {
    return null
  }

  const revealed = reveal ? collapsibles.find(p => p.id === reveal.id) : undefined
  const sides = [...new Set(collapsibles.map(sideOf))]

  // The revealed pane's ZONE-mates that also left the grid (the sessions zone
  // stacks SESSIONS | BOTS): the overlay mirrors the zone's tab strip so a
  // pane docked into a collapsed zone stays reachable on narrow viewports —
  // without this, only the zone's first pane ever surfaces again.
  const zonePanes = (() => {
    if (!revealed || !tree) {
      return [revealed].filter((p): p is Contribution => Boolean(p))
    }

    const zone = findGroupOfPane(tree, revealed.id)
    const mates = zone ? zone.panes.map(id => collapsibles.find(p => p.id === id)) : []
    const shown = mates.filter((p): p is Contribution => Boolean(p))

    return shown.length > 0 ? shown : [revealed]
  })()

  // Drag-follow visual: an open drawer of the dragged side tracks the finger
  // directly; a closed side gets a GHOST drawer (the pane mounts at gesture
  // start — the pull-out is live from pixel one).
  const revealedSide = revealed ? sideOf(revealed) : null
  const followingReveal = drag && revealedSide === drag.side ? drag : null
  const ghostPane =
    drag && !followingReveal ? collapsibles.find(p => sideOf(p) === drag.side) : undefined
  const ghostSide = ghostPane ? sideOf(ghostPane) : null

  const dragVisualOf = (side: DrawerSide): DragVisual | null => {
    const state = followingReveal && revealedSide === side ? followingReveal : drag && ghostSide === side ? drag : null

    return state ? { fraction: state.phase === 'settle' ? state.target : state.fraction, phase: state.phase } : null
  }

  const drawerStyle = (side: DrawerSide, visual: DragVisual | null) =>
    visual
      ? {
          animation: 'none',
          transform: drawerTransform(side, visual.fraction),
          transition: visual.phase === 'settle' ? `transform ${DRAWER_SETTLE_MS}ms ease-out` : 'none'
        }
      : undefined

  const backdropOpacity = followingReveal
    ? followingReveal.phase === 'settle'
      ? followingReveal.target
      : followingReveal.fraction
    : ghostPane && drag
      ? drag.phase === 'settle'
        ? drag.target * 0.3
        : drag.fraction * 0.3
      : undefined

  const renderDrawerBody = (pane: Contribution, side: DrawerSide, visual: DragVisual | null, zoneStrip: ReactNode) => (
    <div
      className={cn(
        'absolute inset-y-0 z-40 flex flex-col overflow-hidden bg-(--ui-sidebar-surface-background) shadow-2xl',
        side === 'left' ? 'left-0 border-r border-(--ui-stroke-secondary)' : 'right-0 border-l border-(--ui-stroke-secondary)'
      )}
      // Floats OVER the layout, so under glass its surface must mask the
      // panes beneath it — a see-through overlay reads as text bleeding
      // through text. Contract: `[data-glass-opaque]` in styles.css.
      data-glass-opaque=""
      data-narrow-drawer={side}
      data-narrow-drawer-pane={pane.id}
      onMouseLeave={() => setReveal(current => (current?.pinned ? current : null))}
      style={{
        ...drawerStyle(side, visual),
        // Match the pane's docked width (sessions ~237px, files its rail
        // width) instead of a fat fixed 20rem — capped for tiny screens.
        width: `min(${(pane.data as { width?: string } | undefined)?.width ?? '18rem'}, 85vw)`
      }}
    >
      {zoneStrip}
      {coarse && (
        <button
          aria-label={t.common.close}
          className={cn(
            'absolute z-10 grid size-11 place-items-center rounded-md text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
            side === 'left' ? 'right-1 top-1' : 'left-1 top-1'
          )}
          data-narrow-drawer-close=""
          onClick={() => setReveal(current => (current?.id === pane.id ? null : current))}
          type="button"
        >
          <Codicon name="close" size="1rem" />
        </button>
      )}
      <ContribBoundary id={pane.id}>{pane.render && <ContribRender render={pane.render} />}</ContribBoundary>
    </div>
  )

  const zoneStrip =
    zonePanes.length > 1 && revealed ? (
      <PaneTabStrip
        // Marks the drawer's strip for the coarse-pointer clearance rule in
        // styles.css. Deliberately NOT data-zone-tabstrip — that attribute is
        // the drag-drop stacking hit-test key (drag-session.ts) and the
        // drawer strip must stay out of drag hit-testing.
        data-narrow-drawer-strip=""
      >
        {zonePanes.map(pane => (
          <PaneTab
            active={pane.id === revealed.id}
            aria-selected={pane.id === revealed.id}
            data-narrow-overlay-tab={pane.id}
            key={pane.id}
            onPointerDown={event => {
              if (event.button === 0) {
                event.preventDefault()
                setReveal(current => ({ id: pane.id, pinned: current?.pinned ?? false }))
              }
            }}
            role="tab"
          >
            <PaneTabLabel>{pane.title ?? pane.id}</PaneTabLabel>
          </PaneTab>
        ))}
      </PaneTabStrip>
    ) : null

  return (
    <>
      {/* Hover-intent strips on each edge that has a collapsed pane — fine
          pointers only; touch has no hover and the strip only steals taps. */}
      {!coarse &&
        sides.map(side => (
          <div
            className={cn('absolute inset-y-0 z-30 w-1.5', side === 'left' ? 'left-0' : 'right-0')}
            key={side}
            onMouseEnter={() => {
              const first = collapsibles.find(p => sideOf(p) === side)

              if (first) {
                setReveal(current => (current?.pinned ? current : { id: first.id, pinned: false }))
              }
            }}
          />
        ))}

      {/* Backdrop: PINNED reveals and ANY touch reveal (an open drawer the
          user cannot hover away needs a tap-anywhere target), plus the
          drag-follow veil whose opacity tracks the finger. */}
      {revealed && (reveal?.pinned || coarse) && (
        <div
          aria-hidden
          className="absolute inset-0 z-30 bg-black/30"
          onPointerDown={() => setReveal(null)}
          style={backdropOpacity !== undefined ? { opacity: backdropOpacity } : undefined}
        />
      )}
      {ghostPane && drag && (
        <div aria-hidden className="absolute inset-0 z-30 bg-black/30" style={{ opacity: drag.fraction * 0.3 }} />
      )}

      {revealed && renderDrawerBody(revealed, sideOf(revealed), dragVisualOf(sideOf(revealed)), zoneStrip)}
      {ghostPane && ghostSide && renderDrawerBody(ghostPane, ghostSide, dragVisualOf(ghostSide), null)}
    </>
  )
}

function sideOfSafe(paneId: string, collapsibles: readonly Contribution[]): DrawerSide {
  const found = collapsibles.find(p => p.id === paneId)

  return found ? sideOf(found) : 'left'
}
