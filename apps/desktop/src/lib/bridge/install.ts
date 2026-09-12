// Must be the FIRST import in src/main.tsx: it installs the browser bridge
// before any module reads `window.hermesDesktop`. In the Electron build the
// `__HERMES_WEB__` define is `'false'`, so this branch is dead-code-eliminated
// and web-bridge.ts never enters the bundle.
import { createWebBridge } from './web-bridge'

if (__HERMES_WEB__ && typeof window !== 'undefined' && !window.hermesDesktop) {
  window.hermesDesktop = createWebBridge()
}
