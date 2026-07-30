/** 全屏页顶部窗口拖动区（macOS Overlay 标题栏 / Win·Linux 无边框时拖动）。 */
export function PageDragRegion() {
  return <div className="page-drag" data-tauri-drag-region aria-hidden />;
}
