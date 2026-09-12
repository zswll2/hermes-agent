import { useEffect } from 'react'

// iOS Safari never resizes window.innerHeight when the keyboard opens — it
// shrinks window.visualViewport and scrolls it — so a bottom-docked composer
// ends up under the keyboard. Mirror the occluded height into the
// `--keyboard-inset` CSS var (consumed by [data-slot='composer-dock'] in
// styles.css). Desktop Chromium has a visualViewport too, but it always
// matches the window, so the inset stays 0 there.
//
// The var lives on <html> and is intentionally NOT cleared on unmount: every
// ChatView (primary + tiles) computes the same value from the same source,
// and a var left behind after the last surface unmounts is unread — the dock
// selector only matches inside chat surfaces, and the next mount re-applies.
export function useVisualViewportInset() {
  useEffect(() => {
    const viewport = window.visualViewport

    if (!viewport) {
      return
    }

    const apply = () => {
      const occluded = Math.max(0, Math.round(window.innerHeight - viewport.offsetTop - viewport.height))
      document.documentElement.style.setProperty('--keyboard-inset', `${occluded}px`)
    }

    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)
    apply()

    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
    }
  }, [])
}
