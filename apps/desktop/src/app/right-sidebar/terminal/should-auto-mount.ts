/** Auto-mount gate for the persistent terminal host.
 *
 *  `takeover` is persisted, so it is already true on a cold start whenever the
 *  pane was open when the app last closed — including on a phone, where
 *  auto-spawning that shell takes over the first screen. `sessionIntent`
 *  (from setTerminalTakeover) separates "was open" from "the user opened it",
 *  so a narrow cold start stays shell-free while every explicit open still
 *  mounts. Wide viewports are unchanged: restoring an open pane there is the
 *  VS Code behaviour users expect. */
export function shouldAutoMountTerminal({
  narrow,
  sessionIntent,
  takeover
}: {
  narrow: boolean
  sessionIntent: boolean
  takeover: boolean
}): boolean {
  return takeover && (!narrow || sessionIntent)
}
