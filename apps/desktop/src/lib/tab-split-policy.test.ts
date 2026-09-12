import { describe, expect, it } from 'vitest'

import { shouldAllowTabSplit, TAB_SPLIT_MIN_WIDTH_PX } from './tab-split-policy'

describe('shouldAllowTabSplit', () => {
  it('allows fine-pointer drops above the minimum width', () => {
    expect(shouldAllowTabSplit({ coarse: false, width: 1280 })).toBe(true)
    expect(shouldAllowTabSplit({ coarse: false, width: TAB_SPLIT_MIN_WIDTH_PX + 1 })).toBe(true)
  })

  it('rejects at and below the width boundary (640 is the last rejected width)', () => {
    expect(shouldAllowTabSplit({ coarse: false, width: TAB_SPLIT_MIN_WIDTH_PX })).toBe(false)
    expect(shouldAllowTabSplit({ coarse: false, width: TAB_SPLIT_MIN_WIDTH_PX - 1 })).toBe(false)
    expect(shouldAllowTabSplit({ coarse: false, width: 390 })).toBe(false)
  })

  it('rejects coarse pointers regardless of width', () => {
    expect(shouldAllowTabSplit({ coarse: true, width: 1280 })).toBe(false)
    expect(shouldAllowTabSplit({ coarse: true, width: TAB_SPLIT_MIN_WIDTH_PX + 1 })).toBe(false)
  })

  it('zero/negative widths never allow a split', () => {
    expect(shouldAllowTabSplit({ coarse: false, width: 0 })).toBe(false)
  })
})
