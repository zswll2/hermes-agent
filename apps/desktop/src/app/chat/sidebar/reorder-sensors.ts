import { KeyboardSensor, PointerSensor, type SensorDescriptor, TouchSensor } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

export type SidebarPointerKind = 'coarse' | 'fine'

/**
 * Touch reorder activation: hold ~400ms (tolerating a 5px drift) before the
 * drag claims the gesture. Anything shorter stays a scroll — `touch-action:
 * pan-y` on the session rows lets the browser take vertical pans immediately
 * (which pointercancels a PointerSensor mid-activation), so touch reordering
 * MUST ride the native-touch TouchSensor to work at all.
 */
const TOUCH_REORDER_CONSTRAINT = { delay: 400, tolerance: 5 }

/**
 * Pointer reorder activation: 6px of travel separates a click-to-open from a
 * drag-to-reorder. Unchanged from the sensor setup this module replaced.
 */
const POINTER_REORDER_CONSTRAINT = { distance: 6 }

/**
 * Sensors for the sidebar's reorder lists, picked by pointer kind:
 * coarse → TouchSensor (long-press activates; scrolls stay native),
 * fine   → PointerSensor + KeyboardSensor (mouse/trackpad + keyboard a11y).
 *
 * Returns plain SensorDescriptors: DndContext accepts them directly
 * (it runs the same setup useSensor would), so this stays a pure function
 * instead of a hook — call sites memoize on the pointer kind.
 */
export function sidebarReorderSensors(pointerKind: SidebarPointerKind): SensorDescriptor<any>[] {
  if (pointerKind === 'coarse') {
    return [{ sensor: TouchSensor, options: { activationConstraint: TOUCH_REORDER_CONSTRAINT } }]
  }

  return [
    { sensor: PointerSensor, options: { activationConstraint: POINTER_REORDER_CONSTRAINT } },
    { sensor: KeyboardSensor, options: { coordinateGetter: sortableKeyboardCoordinates } }
  ]
}
