import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markUserGesture,
  registerHapticTrigger,
  resetHapticGestureGateForTests,
  triggerHaptic,
  type HapticTrigger
} from './haptics'

// The gesture gate exists for the engine rule behind "Blocked call to
// navigator.vibrate because user hasn't tapped on the frame": web-haptics
// vibrates from any trigger, so startup-phase intents (streamStart on the
// first token) fired before the first tap. These tests pin the gate itself —
// the E2E run stubs navigator.vibrate and counts real firings around a tap.
describe('haptic first-gesture gate', () => {
  const trigger: HapticTrigger = vi.fn(async () => undefined)

  beforeEach(() => {
    resetHapticGestureGateForTests()
    registerHapticTrigger(trigger)
    vi.mocked(trigger).mockClear()
  })

  afterEach(() => {
    registerHapticTrigger(null)
  })

  it('suppresses every intent before the first user gesture', () => {
    triggerHaptic('tap')
    triggerHaptic('selection')
    triggerHaptic('streamStart')

    expect(trigger).not.toHaveBeenCalled()
  })

  it('opens the gate on the first window pointerdown', () => {
    window.dispatchEvent(new Event('pointerdown'))

    triggerHaptic('tap')

    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('opens the gate on touchstart too (browsers without pointer events)', () => {
    window.dispatchEvent(new Event('touchstart'))

    triggerHaptic('close')

    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('markUserGesture is an equivalent explicit source', () => {
    markUserGesture()

    triggerHaptic('open')

    expect(trigger).toHaveBeenCalledTimes(1)
  })
})
