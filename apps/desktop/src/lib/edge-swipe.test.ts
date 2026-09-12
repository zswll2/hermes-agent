import { describe, expect, it } from 'vitest'

import {
  classifyEdgeSwipe,
  EDGE_SWIPE_MAX_ABS_DY_PX,
  EDGE_SWIPE_MIN_DX_PX,
  EDGE_SWIPE_START_MAX_X_PX
} from './edge-swipe'

describe('classifyEdgeSwipe', () => {
  describe('opening (drawer closed)', () => {
    it('opens on a rightward swipe from the left edge', () => {
      expect(classifyEdgeSwipe({ dx: 200, dy: 5, startX: 2, open: false })).toBe('open')
    })

    it('opens at exactly the minimum travel', () => {
      expect(classifyEdgeSwipe({ dx: EDGE_SWIPE_MIN_DX_PX, dy: 0, startX: 0, open: false })).toBe('open')
    })

    it('rejects one pixel short of the minimum travel', () => {
      expect(classifyEdgeSwipe({ dx: EDGE_SWIPE_MIN_DX_PX - 1, dy: 0, startX: 0, open: false })).toBeNull()
    })

    it('accepts a start at the edge-band boundary', () => {
      expect(classifyEdgeSwipe({ dx: 100, dy: 0, startX: EDGE_SWIPE_START_MAX_X_PX, open: false })).toBe('open')
    })

    it('rejects a start one pixel past the edge band', () => {
      expect(classifyEdgeSwipe({ dx: 100, dy: 0, startX: EDGE_SWIPE_START_MAX_X_PX + 1, open: false })).toBeNull()
    })

    it('rejects a leftward swipe from the edge', () => {
      expect(classifyEdgeSwipe({ dx: -100, dy: 0, startX: 2, open: false })).toBeNull()
    })
  })

  describe('closing (drawer open)', () => {
    it('closes on a leftward swipe starting anywhere on the drawer', () => {
      expect(classifyEdgeSwipe({ dx: -200, dy: -3, startX: 300, open: true })).toBe('close')
    })

    it('closes at exactly the minimum travel', () => {
      expect(classifyEdgeSwipe({ dx: -EDGE_SWIPE_MIN_DX_PX, dy: 0, startX: 300, open: true })).toBe('close')
    })

    it('rejects one pixel short of the minimum travel', () => {
      expect(classifyEdgeSwipe({ dx: -(EDGE_SWIPE_MIN_DX_PX - 1), dy: 0, startX: 300, open: true })).toBeNull()
    })

    it('ignores a further rightward swipe while open', () => {
      expect(classifyEdgeSwipe({ dx: 120, dy: 0, startX: 2, open: true })).toBeNull()
    })
  })

  describe('vertical drift gate', () => {
    it('allows drift at the boundary', () => {
      expect(classifyEdgeSwipe({ dx: 120, dy: EDGE_SWIPE_MAX_ABS_DY_PX, startX: 2, open: false })).toBe('open')
      expect(classifyEdgeSwipe({ dx: 120, dy: -EDGE_SWIPE_MAX_ABS_DY_PX, startX: 2, open: false })).toBe('open')
    })

    it('rejects one pixel past the drift boundary (a scroll)', () => {
      expect(classifyEdgeSwipe({ dx: 120, dy: EDGE_SWIPE_MAX_ABS_DY_PX + 1, startX: 2, open: false })).toBeNull()
      expect(classifyEdgeSwipe({ dx: -120, dy: -(EDGE_SWIPE_MAX_ABS_DY_PX + 1), startX: 300, open: true })).toBeNull()
    })
  })

  it('keeps thresholds on the contract the hook depends on', () => {
    expect(EDGE_SWIPE_START_MAX_X_PX).toBe(24)
    expect(EDGE_SWIPE_MIN_DX_PX).toBe(60)
    expect(EDGE_SWIPE_MAX_ABS_DY_PX).toBe(40)
  })
})
