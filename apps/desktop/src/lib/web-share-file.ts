/** 手机专属：把"打开文件"交给系统面板。
 *
 *  iOS 的分享面板里就是「用其他应用打开 / 存储到文件 / 快速查看」，即用户说的"打开方式"；
 *  网页里唯一能调起它的入口是 Web Share API（`navigator.share({ files })`，iOS 15+）。
 *
 *  取文件走与附件下载同一条已鉴权通道（`/api/files/download`，同源 cookie + token 查询串），
 *  拿回 blob 再包成 File 交给系统。返回 true = 面板已弹出（用户取消也算已交付）；
 *  返回 false = 不支持/取文件失败 → 调用方回退到原有预览或下载。
 */
import { attachmentFilename } from '@/lib/download-filename'
import { filePathFromMediaPath, mediaExternalUrl } from '@/lib/media'

export async function shareGatewayFileNatively(path: string): Promise<boolean> {
  const nav = typeof navigator === 'undefined' ? null : navigator

  if (!nav?.share || !nav.canShare) {
    return false
  }

  try {
    const response = await fetch(mediaExternalUrl(path), { credentials: 'same-origin' })

    if (!response.ok) {
      return false
    }

    const blob = await response.blob()
    const name = attachmentFilename(
      filePathFromMediaPath(path),
      blob.type,
      response.headers.get('content-disposition')
    )
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })

    if (!nav.canShare({ files: [file] })) {
      return false
    }

    await nav.share({ files: [file] })

    return true
  } catch (error) {
    // 用户主动取消 = 面板已经交付过了，不要再回退到预览（那会很突兀）。
    return (error as { name?: string } | null)?.name === 'AbortError'
  }
}
