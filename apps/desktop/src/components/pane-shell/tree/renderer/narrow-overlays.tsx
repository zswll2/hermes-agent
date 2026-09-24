/**
 * Narrow-viewport edge overlays — the tree's take on the app's hover-reveal
 * collapse. Collapsible panes leave the grid below the sidebar-collapse
 * breakpoint; an edge strip (hover) or PANE_TOGGLE_REVEAL_EVENT (⌘B / ⌘G /
 * titlebar toggles route here on narrow) slides the pane OVER the layout
 * instead of squeezing it. Event reveals pin; hover reveals follow the mouse.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { $chatOnboardingSolo } from '@/components/onboarding-chat/assembly'
import { Codicon } from '@/components/ui/codicon'
import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import type { Contribution } from '@/contrib/types'
import { translateNow } from '@/i18n'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { cn } from '@/lib/utils'

import { PANE_TOGGLE_REVEAL_EVENT } from '../..'
import { allPaneIds, findGroupOfPane } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, revealTreePane } from '../store'

import { paneChrome } from './track-model'

export function NarrowOverlays() {
  const narrow = useStore($narrowViewport)
  const solo = useStore($chatOnboardingSolo)
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const hiddenPanes = useStore($hiddenTreePanes)
  const [reveal, setReveal] = useState<{ id: string; pinned: boolean } | null>(null)

  // Own an Escape layer only while something is revealed, so Escape closes the
  // overlay only when it's the top layer (never under a dialog / edit mode).
  const revealActive = reveal !== null
  useEffect(() => (revealActive ? pushEscapeLayer(ESCAPE_PRIORITY.narrowOverlay) : undefined), [revealActive])

  const inTree = useMemo(() => new Set(tree ? allPaneIds(tree) : []), [tree])

  const collapsibles = useMemo(
    // Solo adopts sidebar panes without their surrounding sidebar chrome.
    // Suppress every reveal path while those panes are intentionally hidden.
    () => (solo ? [] : panes.filter(p => paneChrome(p).collapsible && inTree.has(p.id) && !hiddenPanes.has(p.id))),
    [solo, panes, inTree, hiddenPanes]
  )

  const collapsiblesRef = useRef(collapsibles)
  collapsiblesRef.current = collapsibles

  // The toggle handler resolves ids through refs: a heal has to see panes that
  // are hidden or dismissed (i.e. filtered out of `collapsibles`), and neither
  // list may be stale inside the effect, which only re-subscribes on
  // narrow/solo changes.
  const panesRef = useRef(panes)
  panesRef.current = panes

  // ⌘B / ⌘G's narrow branch dispatches the app's toggle-reveal event with the
  // REAL pane id — accept those via each contribution's revealAliases.
  useEffect(() => {
    if (!narrow || solo) {
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

      // `open`/`close` are explicit intents (programmatic reveal, titlebar show);
      // `toggle` (default) is the ⌘B/⌘G flip. `close` is side-scoped, not
      // tab-scoped: the sessions zone's drawer may be showing ANY of its
      // stacked panes (SESSIONS | BOTS strip), and closing "the left sidebar"
      // must dismiss that drawer whichever tab is active — a row selection
      // fires it without knowing which pane fronts the strip.
      const mode = detail?.mode ?? 'toggle'

      // Nothing revealable answers to this id. On a phone that is the NORMAL
      // case for the right rail: `$fileBrowserOpen` boots closed, so the
      // visibility binding hides the files pane and it leaves `collapsibles` —
      // and the press silently no-oped (a bare `return`). When a REGISTERED
      // collapsible pane does answer to the id, heal it first: revealTreePane
      // un-dismisses, re-adopts into the tree, un-hides and un-collapses its
      // column, then we open the drawer anyway. Unknown ids (⌘B on a layout
      // without that pane) still no-op.
      if (!match) {
        const healable = panesRef.current.find(
          p => paneChrome(p).collapsible && (p.id === id || paneChrome(p).revealAliases?.includes(id))
        )

        if (!healable) {
          return
        }

        revealTreePane(healable.id)

        if (mode !== 'close') {
          setReveal({ id: healable.id, pinned: true })
        }

        return
      }

      setReveal(current => {
        if (mode === 'open') {
          return { id: match.id, pinned: true }
        }

        if (mode === 'close') {
          if (!current) {
            return current
          }

          if (current.id === match.id) {
            return null
          }

          const currentPane = collapsiblesRef.current.find(p => p.id === current.id)

          return currentPane && sideOf(currentPane) === sideOf(match) ? null : current
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
  }, [narrow, solo])

  if (!narrow || solo || collapsibles.length === 0) {
    return null
  }

  const sideOf = (c: Contribution) => (paneChrome(c).placement === 'left' ? 'left' : 'right')
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

  return (
    <>
      {/* Hover-intent strips on each edge that has a collapsed pane. */}
      {sides.map(side => (
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

      {/* Backdrop for PINNED reveals only (titlebar toggle / ⌘B / touch):
          hover reveals keep their weightless come-and-go, while a drawer the
          user opened on purpose gets an obvious tap-anywhere-to-close target —
          the only dismissal that works without a mouse. */}
      {reveal?.pinned && revealed && (
        <div
          aria-hidden
          className="absolute inset-0 z-30 bg-black/30"
          data-narrow-backdrop=""
          onPointerDown={() => setReveal(null)}
        />
      )}

      {revealed && (
        <div
          className={cn(
            'absolute inset-y-0 z-40 flex flex-col overflow-hidden bg-(--ui-sidebar-surface-background) shadow-2xl',
            sideOf(revealed) === 'left'
              ? 'left-0 border-r border-(--ui-stroke-secondary)'
              : 'right-0 border-l border-(--ui-stroke-secondary)'
          )}
          // Floats OVER the layout, so under glass its surface must mask the
          // panes beneath it — a see-through overlay reads as text bleeding
          // through text. Contract: `[data-glass-opaque]` in styles.css.
          data-glass-opaque=""
          data-narrow-drawer={sideOf(revealed)}
          onMouseLeave={() => setReveal(current => (current?.pinned ? current : null))}
          // Match the pane's docked width (sessions ~237px, files its rail
          // width) instead of a fat fixed 20rem — capped for tiny screens.
          style={{ width: `min(${(revealed.data as { width?: string } | undefined)?.width ?? '18rem'}, 85vw)` }}
        >
          {/* Drawer chrome: the zone's tab strip (SESSIONS | BOTS when the zone
              stacks panes) plus the close affordance, in ONE row that the
              drawer's `padding-top: var(--titlebar-clearance)` keeps below the
              fixed toolbar. Before that padding existed this row started at the
              notch and the toolbar's icon boxes sat on top of the tabs, so a tap
              on SESSIONS hit the sidebar toggle (see styles.css). */}
          <div className="flex min-w-0 shrink-0 items-stretch" data-narrow-drawer-chrome="">
            {zonePanes.length > 1 && (
              <PaneTabStrip className="min-w-0 flex-1">
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
                  >
                    <PaneTabLabel>{pane.title ?? pane.id}</PaneTabLabel>
                  </PaneTab>
                ))}
              </PaneTabStrip>
            )}
            <button
              aria-label={translateNow('common.close')}
              className="ml-auto grid w-11 shrink-0 cursor-pointer place-items-center bg-transparent text-(--ui-text-tertiary) outline-none hover:text-foreground"
              data-narrow-drawer-close=""
              onClick={() => setReveal(null)}
              type="button"
            >
              <Codicon name="close" size="0.6875rem" />
            </button>
          </div>
          <ContribBoundary id={revealed.id}>
            {revealed.render && <ContribRender render={revealed.render} />}
          </ContribBoundary>
        </div>
      )}
    </>
  )
}
