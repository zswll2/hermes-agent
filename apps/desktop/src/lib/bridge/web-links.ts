/** 手机专属的链接行为：一律用新页面打开。
 *
 *  桌面渲染层的默认是「就地预览面板」——Electron 里那是内嵌 webview，⌘/Ctrl 点击才交给系统浏览器
 *  （`wantsNativeBrowser` / `hudForcesNativeLinks`）。手机上既没有 ⌘ 键、也没有像样的预览面板，
 *  按用户裁定改成"新标签页打开"。
 *
 *  为什么用捕获阶段的委派点击而不是改组件：正文由 markdown 渲染、链接来源很多
 *  （markdown-text / 内联嵌入 / PrettyLink / 插件贡献），逐处改上游组件是长期维护税；
 *  这里只拦 http(s) 链接，且在 window.open 里同步执行以保留"用户手势"（iOS 才允许开新页）。
 */
import { isCoarsePointer } from '@/lib/coarse-pointer'

export function installMobileLinkTargets(): void {
  if (typeof window === 'undefined' || !isCoarsePointer()) {
    return
  }

  document.addEventListener(
    'click',
    event => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null

      if (!anchor || anchor.hasAttribute('download')) {
        return
      }

      const href = anchor.getAttribute('href') || ''

      // 只接管真正的外链：锚点、相对路径、file: 与 /api/files/**（文件类走"打开方式"那条路）不动。
      if (!/^https?:\/\//i.test(href)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      window.open(href, '_blank', 'noopener,noreferrer')
    },
    true
  )
}
