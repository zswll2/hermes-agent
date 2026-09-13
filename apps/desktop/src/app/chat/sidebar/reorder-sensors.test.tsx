import { KeyboardSensor, PointerSensor, TouchSensor } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { sidebarReorderSensors } from './reorder-sensors'
import { ReorderableList } from './reorderable-list'

// Capture the props ReorderableList forwards into DndContext so the "DndContext
// actually receives these sensors" half of the contract is asserted against the
// real component, not a re-implementation.
const dndPropsHistory = vi.hoisted(() => [] as { sensors?: unknown[] }[])

vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    DndContext: (props: { sensors?: unknown[] }) => {
      dndPropsHistory.push(props)

      return null
    }
  }
})

describe('sidebarReorderSensors', () => {
  it('coarse: exactly one TouchSensor with the 400ms/5px long-press constraint', () => {
    const sensors = sidebarReorderSensors('coarse')

    expect(sensors).toHaveLength(1)
    expect(sensors[0].sensor).toBe(TouchSensor)
    expect(sensors[0].options).toEqual({ activationConstraint: { delay: 400, tolerance: 5 } })
  })

  it('coarse: no PointerSensor — quick swipes must never arm a drag', () => {
    const sensors = sidebarReorderSensors('coarse')

    expect(sensors.map(s => s.sensor)).not.toContain(PointerSensor)
  })

  it('fine: PointerSensor at distance 6 plus the KeyboardSensor pair, unchanged', () => {
    const sensors = sidebarReorderSensors('fine')

    expect(sensors).toHaveLength(2)
    expect(sensors[0].sensor).toBe(PointerSensor)
    expect(sensors[0].options).toEqual({ activationConstraint: { distance: 6 } })
    expect(sensors[1].sensor).toBe(KeyboardSensor)
    expect(sensors[1].options).toEqual({ coordinateGetter: sortableKeyboardCoordinates })
  })
})

describe('ReorderableList wiring', () => {
  it('hands the exact sensor descriptors to DndContext (coarse and fine)', () => {
    for (const kind of ['coarse', 'fine'] as const) {
      const sensors = sidebarReorderSensors(kind)

      render(
        <ReorderableList ids={['a', 'b']} onReorder={() => undefined} sensors={sensors}>
          <div />
        </ReorderableList>
      )

      const forwarded = dndPropsHistory.at(-1)?.sensors

      expect(forwarded).toBe(sensors)
    }
  })
})
