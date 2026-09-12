import { describe, expect, it } from 'vitest'

import { collectNarrowUserSplitExits, NARROW_MIN_COLUMN_PX } from './narrow-fold'
import { group, split } from './model'

const g = (id: string) => group([id])

describe('collectNarrowUserSplitExits', () => {
  it('exits every pane of the smaller column of a user split at phone width', () => {
    const tree = split('row', [g('workspace'), g('terminal')], [3, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual(['terminal'])
  })

  it('keeps the larger-weight column even when both are below the min width', () => {
    const tree = split('row', [g('workspace'), g('terminal')], [1, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual(['terminal'])
    expect(collectNarrowUserSplitExits(tree, 390)).not.toContain('workspace')
  })

  it('never exits the uncloseable workspace column', () => {
    const tree = split('row', [g('terminal'), g('workspace')], [3, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual([])
  })

  it('leaves unmarked splits alone (programmatic or pre-marker history)', () => {
    const tree = split('row', [g('workspace'), g('terminal')], [3, 1])

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual([])
  })

  it('leaves column-orientation user splits alone (full width, stacked)', () => {
    const tree = split('column', [g('workspace'), g('terminal')], [1, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual([])
  })

  it('keeps a user split whose smaller column is still readable', () => {
    const tree = split('row', [g('workspace'), g('terminal')], [1, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 1280)).toEqual([])
  })

  it('respects the custom min-width boundary (smaller side share * width)', () => {
    const tree = split('row', [g('workspace'), g('terminal')], [1, 1], 's1', 'user')

    expect(collectNarrowUserSplitExits(tree, 559, NARROW_MIN_COLUMN_PX)).toEqual(['terminal'])
    expect(collectNarrowUserSplitExits(tree, 560, NARROW_MIN_COLUMN_PX)).toEqual([])
  })

  it('recurses into the kept side for nested user splits', () => {
    const nested = split('row', [g('workspace'), g('files')], [1, 1], 's-inner', 'user')
    const tree = split('row', [nested, g('terminal')], [3, 1], 's-outer', 'user')

    expect(collectNarrowUserSplitExits(tree, 390)).toEqual(['terminal', 'files'])
  })

  it('handles a single group tree', () => {
    expect(collectNarrowUserSplitExits(g('workspace'), 390)).toEqual([])
  })

  it('handles null', () => {
    expect(collectNarrowUserSplitExits(null, 390)).toEqual([])
  })
})
