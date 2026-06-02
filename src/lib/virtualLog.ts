export type VirtualWindow = {
  start: number
  end: number
  offsetTop: number
  totalHeight: number
}

export function calculateVirtualWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): VirtualWindow {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 }
  }

  const safeScrollTop = Math.max(0, scrollTop)
  const safeViewportHeight = Math.max(0, viewportHeight)
  const safeOverscan = Math.max(0, overscan)
  const firstVisible = Math.floor(safeScrollTop / rowHeight)
  const visibleCount = Math.ceil(safeViewportHeight / rowHeight)
  const start = Math.max(0, firstVisible - safeOverscan)
  const end = Math.min(total, firstVisible + visibleCount + safeOverscan)

  return {
    start,
    end,
    offsetTop: start * rowHeight,
    totalHeight: total * rowHeight,
  }
}
