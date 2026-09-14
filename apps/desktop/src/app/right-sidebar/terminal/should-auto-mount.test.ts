import { beforeEach, describe, expect, it } from 'vitest'

import { $terminalTakeover, $terminalTakeoverIntent, setTerminalTakeover } from '../store'

import { shouldAutoMountTerminal } from './should-auto-mount'

const combos: Array<{ narrow: boolean; sessionIntent: boolean; takeover: boolean } & { expected: boolean }> = [
  // Narrow cold start: takeover restored from storage, no explicit open yet —
  // the phone-first-open bug. No shell.
  { takeover: true, narrow: true, sessionIntent: false, expected: false },
  // Narrow + the user opened the pane this session (⌃`, statusbar, palette,
  // injection, agent link) — mount.
  { takeover: true, narrow: true, sessionIntent: true, expected: true },
  // Wide: VS Code parity — a persisted open pane auto-restores its shell.
  { takeover: true, narrow: false, sessionIntent: false, expected: true },
  { takeover: true, narrow: false, sessionIntent: true, expected: true }
]

describe('shouldAutoMountTerminal', () => {
  it.each(combos)(
    'takeover=$takeover narrow=$narrow intent=$sessionIntent -> $expected',
    ({ expected, narrow, sessionIntent, takeover }) => {
      expect(shouldAutoMountTerminal({ narrow, sessionIntent, takeover })).toBe(expected)
    }
  )

  it('never auto-mounts with takeover=false, whatever the viewport or latch', () => {
    expect(shouldAutoMountTerminal({ narrow: true, sessionIntent: true, takeover: false })).toBe(false)
    expect(shouldAutoMountTerminal({ narrow: false, sessionIntent: true, takeover: false })).toBe(false)
  })
})

describe('setTerminalTakeover intent latch', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $terminalTakeover.set(false)
    $terminalTakeoverIntent.set(false)
  })

  it('an explicit open latches session intent; the persisted flag alone never does', () => {
    setTerminalTakeover(true)

    expect($terminalTakeover.get()).toBe(true)
    expect($terminalTakeoverIntent.get()).toBe(true)
  })

  it('closing does not unlatch — keep-alive semantics survive a collapse', () => {
    setTerminalTakeover(true)
    setTerminalTakeover(false)

    expect($terminalTakeover.get()).toBe(false)
    expect($terminalTakeoverIntent.get()).toBe(true)
  })

  it('a latched explicit open makes the narrow gate pass (the ⌃`-on-a-phone path)', () => {
    setTerminalTakeover(true)

    expect(
      shouldAutoMountTerminal({ narrow: true, sessionIntent: $terminalTakeoverIntent.get(), takeover: true })
    ).toBe(true)
  })
})
