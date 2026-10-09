// Must be the FIRST import in src/main.tsx: it installs the browser bridge
// before any module reads `window.hermesDesktop`. In the Electron build the
// `__HERMES_WEB__` define is `'false'`, so this branch is dead-code-eliminated
// and web-bridge.ts never enters the bundle.
import { createWebBridge } from './web-bridge'
import { installWebAuthGuard } from './auth-guard'
import { installMobileLinkTargets } from './web-links'
import { installWebUpdateCheck } from '../web-update'

if (__HERMES_WEB__ && typeof window !== 'undefined' && !window.hermesDesktop) {
  window.hermesDesktop = createWebBridge()
}

// gated 部署下，未登录直接交给 /login（否则渲染层会落到桌面专属的 "Hermes couldn't start"）。
installWebAuthGuard()

if (__HERMES_WEB__) {
  // 构建号自检：主屏 WebApp 被 iOS 保活时不会重新导航，只有页面内代码能发现重新部署。
  window.__HERMES_WEB_UPDATE_COPY__ = '有新版本，点一下刷新'
  installWebUpdateCheck()

  // 手机：正文里的外链一律新页面打开（渲染层默认是就地预览面板）。
  installMobileLinkTargets()

  // iOS 安全区让位（顶部工具簇 / 输入区）。Electron 下 env() 恒 0，且这里是动态
  // import → 打包时该 CSS 不会进入桌面产物。
  void import('../web-surface.css')
}

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
