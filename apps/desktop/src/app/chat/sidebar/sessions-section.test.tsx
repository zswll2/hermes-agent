import { cleanup, render } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { SidebarSessionsSection, VIRTUALIZE_THRESHOLD } from './sessions-section'
import type { VirtualSessionListProps } from './virtual-session-list'

afterEach(cleanup)

// The resume path folds the narrow drawer after handing off to the caller —
// spy on the layout seam without disturbing the rest of the module.
const { closeNarrowSidebarDrawer } = vi.hoisted(() => ({ closeNarrowSidebarDrawer: vi.fn() }))

vi.mock('@/store/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/store/layout')>()

  return { ...actual, closeNarrowSidebarDrawer }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        dateDivider: {
          earlierThisMonth: 'Earlier this month',
          lastMonth: 'Last month',
          lastWeek: 'Last week',
          older: 'Older',
          today: 'Today',
          yesterday: 'Yesterday'
        }
      }
    }
  })
}))

const mockVirtualListPropsHistory: VirtualSessionListProps[] = []

vi.mock('./virtual-session-list', () => ({
  VirtualSessionList: (props: VirtualSessionListProps) => {
    mockVirtualListPropsHistory.push(props)

    return <div data-testid="virtual-session-list">Virtual List ({props.rows.length} rows)</div>
  }
}))

const mockRowPropsHistory: Array<{ onResume?: () => void; session: SessionInfo }> = []

vi.mock('./session-row', () => ({
  SidebarSessionRow: (props: { session: SessionInfo }) => {
    mockRowPropsHistory.push(props)

    return <div data-testid={`session-row-${props.session.id}`}>{props.session.id}</div>
  }
}))

function makeSession(id: string, startedAt = 1000): SessionInfo {
  return {
    handoff_platform: null,
    handoff_state: null,
    id,
    last_active: startedAt,
    profile: 'default',
    started_at: startedAt
  } as unknown as SessionInfo
}

function generateSessions(count: number): SessionInfo[] {
  return Array.from({ length: count }, (_, i) => makeSession(`session-${i + 1}`, 10000 - i * 100))
}

const noop = () => {}

describe('SidebarSessionsSection memoization & virtualizer stability', () => {
  it('memoizes flatRows and passes the exact same rows array reference across parent re-renders', () => {
    mockVirtualListPropsHistory.length = 0

    const sessions = generateSessions(VIRTUALIZE_THRESHOLD + 5)

    const { rerender } = render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        onToggleUnread={noop}
        open={true}
        pinned={false}
        sessions={sessions}
      />
    )

    expect(mockVirtualListPropsHistory.length).toBe(1)
    const initialRowsRef = mockVirtualListPropsHistory[0].rows
    expect(initialRowsRef.length).toBeGreaterThan(VIRTUALIZE_THRESHOLD)

    // Re-render parent with the exact same sessions array and props
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        onToggleUnread={noop}
        open={true}
        pinned={false}
        sessions={sessions}
      />
    )

    expect(mockVirtualListPropsHistory.length).toBe(2)
    const nextRowsRef = mockVirtualListPropsHistory[1].rows

    // Confirm that the flatRows array reference remains strictly identical across renders (useMemo proof)
    expect(nextRowsRef).toBe(initialRowsRef)
  })

  it('re-computes flatRows reference when grouping or sessions change', () => {
    mockVirtualListPropsHistory.length = 0

    const initialSessions = generateSessions(VIRTUALIZE_THRESHOLD + 2)

    const { rerender } = render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="none"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        onToggleUnread={noop}
        open={true}
        pinned={false}
        sessions={initialSessions}
      />
    )

    const firstRowsRef = mockVirtualListPropsHistory[0].rows

    // Switch on date dividers
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="date"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        onToggleUnread={noop}
        open={true}
        pinned={false}
        sessions={initialSessions}
      />
    )

    const secondRowsRef = mockVirtualListPropsHistory[1].rows
    expect(secondRowsRef).not.toBe(firstRowsRef)

    // Change sessions array identity
    const updatedSessions = generateSessions(VIRTUALIZE_THRESHOLD + 4)
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="date"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        onToggleUnread={noop}
        open={true}
        pinned={false}
        sessions={updatedSessions}
      />
    )

    const thirdRowsRef = mockVirtualListPropsHistory[2].rows
    expect(thirdRowsRef).not.toBe(secondRowsRef)
  })
})

describe('session resume folds the narrow drawer', () => {
  const sectionProps = (onResumeSession: (id: string, session?: SessionInfo) => void, sessions: SessionInfo[]) => ({
    activeSessionId: null,
    emptyState: <div>Empty</div>,
    label: 'Sessions',
    onArchiveSession: noop,
    onDeleteSession: noop,
    onResumeSession,
    onToggle: noop,
    onTogglePin: noop,
    onToggleUnread: noop,
    open: true,
    pinned: false,
    sessions
  })

  it('virtual path: the wrapped onResumeSession hands off to the caller, then folds', () => {
    mockVirtualListPropsHistory.length = 0
    closeNarrowSidebarDrawer.mockClear()

    const order: string[] = []
    const onResumeSession = vi.fn(() => order.push('caller'))

    closeNarrowSidebarDrawer.mockImplementation(() => order.push('closer'))

    render(<SidebarSessionsSection {...sectionProps(onResumeSession, generateSessions(VIRTUALIZE_THRESHOLD + 5))} />)

    expect(mockVirtualListPropsHistory.length).toBe(1)
    mockVirtualListPropsHistory[0].onResumeSession('session-2')

    expect(onResumeSession).toHaveBeenCalledWith('session-2', undefined)
    expect(closeNarrowSidebarDrawer).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['caller', 'closer'])
  })

  it('flat path: a row resume hands off to the caller, then folds', () => {
    mockRowPropsHistory.length = 0
    closeNarrowSidebarDrawer.mockClear()

    const order: string[] = []
    const onResumeSession = vi.fn(() => order.push('caller'))

    closeNarrowSidebarDrawer.mockImplementation(() => order.push('closer'))

    const sessions = generateSessions(3)

    render(<SidebarSessionsSection {...sectionProps(onResumeSession, sessions)} />)

    const row = mockRowPropsHistory.find(props => props.session.id === 'session-2')

    expect(row).toBeTruthy()
    row!.onResume!()

    expect(onResumeSession).toHaveBeenCalledWith('session-2', sessions[1])
    expect(closeNarrowSidebarDrawer).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['caller', 'closer'])
  })
})
