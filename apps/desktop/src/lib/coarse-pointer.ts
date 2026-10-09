/** 是否触摸设备（粗指针）。
 *
 *  用于"手机上不提供拖拽"这类裁定：手机/平板上手指拖拽应该只滚动，
 *  而桌面（精细指针）与触控板不受影响。React 组件里用 useMediaQuery('(pointer: coarse)')，
 *  非 React 回调（pointerdown 之类）用这个谓词。
 */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}
