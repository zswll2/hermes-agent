// The single entry point NEW code should use to reach the desktop bridge.
// Existing call sites that read `window.hermesDesktop` directly keep working
// (the web build installs the same object at startup); migrate them to
// `getBridge()` opportunistically via mechanical PRs, not feature work.
export function isWebBuild(): boolean {
  return __HERMES_WEB__
}

export function getBridge(): Window['hermesDesktop'] {
  const bridge = window.hermesDesktop

  if (!bridge) {
    throw new Error('hermesDesktop bridge is not installed (web build missing its install shim?)')
  }

  return bridge
}

export { WebApiAuthError, WebApiError, WebBridgeCapabilityError } from './web-bridge'
