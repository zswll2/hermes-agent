import { describe, expect, it } from 'vitest'

import {
  DRAWER_COMMIT_FRACTION,
  DRAWER_COMMIT_VELOCITY_PX_PER_MS,
  drawerDragProgress,
  drawerReleaseDecision
} from './drawer-drag'

describe('drawerDragProgress', () => {
  it('scales travel by drawer width and clamps to 0..1', () => {
    expect(drawerDragProgress({ dx: 100, width: 200 })).toBe(0.5)
    expect(drawerDragProgress({ dx: 300, width: 200 })).toBe(1)
    expect(drawerDragProgress({ dx: -100, width: 200 })).toBe(0.5)
    expect(drawerDragProgress({ dx: 0, width: 200 })).toBe(0)
  })

  it('is safe on degenerate widths', () => {
    expect(drawerDragProgress({ dx: 100, width: 0 })).toBe(0)
  })
})

describe('drawerReleaseDecision', () => {
  it('commits at and beyond the 50% travel threshold', () => {
    expect(drawerReleaseDecision({ dx: 200 * DRAWER_COMMIT_FRACTION, dt: 400, width: 200 })).toBe('commit')
    expect(drawerReleaseDecision({ dx: 200 * (DRAWER_COMMIT_FRACTION - 0.01), dt: 400, width: 200 })).toBe('cancel')
  })

  it('commits a fast flick below the distance threshold', () => {
    // 60px in 60ms = 1 px/ms ≥ 0.5, distance only 30%.
    expect(drawerReleaseDecision({ dx: 60, dt: 60, width: 200 })).toBe('commit')
  })

  it('cancels a slow short drag', () => {
    // 40px in 800ms = 0.05 px/ms, distance 20%.
    expect(drawerReleaseDecision({ dx: 40, dt: 800, width: 200 })).toBe('cancel')
  })

  it('velocity rung uses magnitude — direction-agnostic', () => {
    expect(drawerReleaseDecision({ dx: -60, dt: 60, width: 200 })).toBe('commit')
  })

  it('zero-duration gestures fall back to distance only', () => {
    expect(drawerReleaseDecision({ dx: 100, dt: 0, width: 200 })).toBe('commit')
    expect(drawerReleaseDecision({ dx: 10, dt: 0, width: 200 })).toBe('cancel')
  })

  it('matches the documented velocity constant', () => {
    expect(DRAWER_COMMIT_VELOCITY_PX_PER_MS).toBe(0.5)
  })
})
