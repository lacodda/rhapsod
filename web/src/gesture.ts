/**
 * The rules of the edge swipe, apart from the browser that delivers it.
 *
 * The hook wires up pointer events; this decides what those events mean. Kept
 * separate because the deciding is where the mistakes live - a threshold that
 * lets a scroll open the drawer, or an edge so wide that keeping a line of
 * text opens it instead - and none of that needs a DOM to test.
 */

/** How far from the left edge a drag has to start to count as the gesture. */
export const EDGE = 24

/** How far it has to travel before it opens anything. */
export const DISTANCE = 60

/** Beyond this much vertical movement it is a scroll, not a swipe. */
export const SLOPE = 40

/** Where a drag began. */
export interface Start {
  x: number
  y: number
  /** Only a finger makes this gesture; a mouse near the edge does not. */
  touch: boolean
}

/** Whether a drag starting here is worth watching at all. */
export function begins(start: Start): boolean {
  return start.touch && start.x <= EDGE
}

/** What a movement to this point means for a drag that began at `start`. */
export type Verdict = 'open' | 'abandon' | 'watching'

export function judge(start: Start, x: number, y: number): Verdict {
  // Vertical first: a drag that runs down the page is the reader scrolling,
  // and scrolling must never open anything, however far it also drifts
  // sideways on the way.
  if (Math.abs(y - start.y) > SLOPE) return 'abandon'
  if (x - start.x > DISTANCE) return 'open'
  return 'watching'
}
