// Must be the FIRST import in src/main.tsx: it installs the browser bridge
// before any module reads `window.hermesDesktop`. In the Electron build the
// `__HERMES_WEB__` define is `'false'`, so this branch is dead-code-eliminated
// and web-bridge.ts never enters the bundle.
import { createWebBridge } from './web-bridge'
import { installWebAuthGuard } from './auth-guard'

if (__HERMES_WEB__ && typeof window !== 'undefined' && !window.hermesDesktop) {
  window.hermesDesktop = createWebBridge()
}

// gated 部署下，未登录直接交给 /login（否则渲染层会落到桌面专属的 "Hermes couldn't start"）。
installWebAuthGuard()

// SPIKE ONLY（点验用，不随正式版发布）：只对 /app-next 预览生效，让上游「简单模式」
// 默认为开 = 会话侧边栏 + 对话 + 输入框；生产 /app 与桌面端不受影响。
// 上游 simple 的持久化键见 src/store/interface-mode.ts。
if (
  __HERMES_WEB__ &&
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/app-next') &&
  window.localStorage.getItem('hermes.desktop.interfaceMode.v1') === null
) {
  window.localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple')
}
