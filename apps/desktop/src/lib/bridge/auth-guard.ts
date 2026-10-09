/**
 * Web-only boot guard — 未登录时把浏览器交给 dashboard 的登录页。
 *
 * 为什么需要：桌面渲染层**没有登录界面**（Electron 里后端是本机、无鉴权）。会话缺失/过期时
 * 它把 401 解读成「后端没起来」，落到桌面专属的故障屏（"Hermes couldn't start" + Retry /
 * Repair install / Gateway settings / Open logs）——在浏览器里这些按钮毫无意义，用户永远看
 * 不到登录框（登录框在 dashboard SPA 的 /login，是另一个前端）。
 *
 * 生产 /app 看不到这个问题：nginx 把插件路由的 401 拦成 302 → /login（`error_page 401 =
 * @app_login`）。**静态托管的 /app-next 没有代理可拦**（HTML 永远 200），所以只能由应用自己
 * 做：启动时探一次会话，401/403 就带着 ?next= 跳登录页。
 *
 * 只对 gated 部署生效：token 模式实例（loopback e2e）注入的是 __HERMES_SESSION_TOKEN__，
 * __HERMES_AUTH_REQUIRED__ 为 false，必须原样放过。
 */
export function installWebAuthGuard(): void {
  if (!__HERMES_WEB__ || typeof window === 'undefined') {
    return
  }

  if (window.__HERMES_AUTH_REQUIRED__ !== true) {
    return
  }

  void (async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' })

      if (res.status === 401 || res.status === 403) {
        const next = encodeURIComponent(window.location.pathname + window.location.search)

        window.location.replace(`/login?next=${next}`)
      }
    } catch {
      // 网络故障不等于会话缺失 —— 交给应用自己报错，别把人甩去登录页。
    }
  })()
}
