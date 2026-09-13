// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $paneHeightOverride, clearAllPaneSizeOverrides } from '@/store/panes'

// The hub's narrow/desktop split is driven by the viewport query; swap the
// answer per test instead of resizing jsdom.
const narrow = vi.hoisted(() => ({ matches: false }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => narrow.matches }))

async function renderPicker() {
  const { EmbeddedHubPicker } = await import('./embedded-hub-picker')
  return render(<EmbeddedHubPicker installedNames={new Set()} />)
}

const iframe = () => document.querySelector('iframe[title="Skills Hub"]')
const headerRow = () => screen.getByText('Skills Hub').closest('div')

describe('EmbeddedHubPicker narrow collapse (session-local) vs desktop default', () => {
  beforeEach(() => {
    narrow.matches = false
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    // Reset the in-memory pane store too — the desktop toggle test writes 0.
    clearAllPaneSizeOverrides()
    window.localStorage.clear()
  })

  it('narrow sessions start collapsed; header taps toggle without touching the persisted pane store', async () => {
    narrow.matches = true
    const { container } = await renderPicker()

    // Collapsed by default: header visible, no iframe viewport.
    expect(screen.getByText('Skills Hub')).toBeTruthy()
    expect(iframe()).toBeNull()
    expect(container.querySelector('.group\\/hubsash')).toBeNull()

    // Tap the header row (≥44px target on touch) → the hub expands.
    fireEvent.click(headerRow()!)
    expect(iframe()).not.toBeNull()

    // Tap again → collapses back; both flips stay out of the persisted store.
    fireEvent.click(headerRow()!)
    expect(iframe()).toBeNull()
    expect($paneHeightOverride('capabilities-hub').get()).toBeUndefined()
  })

  it('desktop sessions keep the expanded default and the toggle writes the persisted override', async () => {
    const { container } = await renderPicker()

    // Desktop default is unchanged: expanded, with the drag sash present.
    expect(iframe()).not.toBeNull()
    expect(container.querySelector('.group\\/hubsash')).not.toBeNull()

    // The hide toggle writes the persisted collapse override (0), like the
    // sash — the pre-existing desktop contract.
    fireEvent.click(screen.getByText('Hide the hub browser'))
    await waitFor(() => expect($paneHeightOverride('capabilities-hub').get()).toBe(0))
    expect(iframe()).toBeNull()
  })
})
