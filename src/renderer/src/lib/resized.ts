export type Corner = 'left' | 'right'

/** New window box while dragging a bottom corner by (dx, dy) from `start`. Pure, so it is testable. */
export function resized(start: { x: number; y: number; width: number; height: number }, corner: Corner, dx: number, dy: number) {
  const width = Math.max(280, start.width + (corner === 'right' ? dx : -dx))
  const height = Math.max(240, start.height + dy)
  return { x: corner === 'right' ? start.x : start.x + start.width - width, y: start.y, width, height }
}
