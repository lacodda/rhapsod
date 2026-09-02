import { describe, expect, it } from 'vitest'

import { begins, DISTANCE, EDGE, judge, SLOPE, type Start } from '@/gesture'

/** A drag starting at the very edge, with a finger. */
const atEdge: Start = { x: 4, y: 300, touch: true }

describe('begins', () => {
  it('watches a finger that starts at the edge', () => {
    expect(begins(atEdge)).toBe(true)
    expect(begins({ ...atEdge, x: EDGE })).toBe(true)
  })

  it('ignores a drag that starts in the text', () => {
    // A drag in the middle of a page is the reader selecting a line to keep.
    // Opening the drawer over that would take the gesture away from the
    // feature it belongs to.
    expect(begins({ ...atEdge, x: EDGE + 1 })).toBe(false)
    expect(begins({ ...atEdge, x: 200 })).toBe(false)
  })

  it('ignores a mouse', () => {
    // A pointer near the left edge of a window is not a gesture, and a
    // desktop has the button in the header anyway.
    expect(begins({ ...atEdge, touch: false })).toBe(false)
  })
})

describe('judge', () => {
  it('opens once the drag has gone far enough sideways', () => {
    expect(judge(atEdge, atEdge.x + DISTANCE + 1, atEdge.y)).toBe('open')
  })

  it('keeps watching a drag that has not gone far enough', () => {
    // Half a gesture is not a gesture: a drawer that flew open on the first
    // few pixels would open every time a thumb brushed the edge.
    expect(judge(atEdge, atEdge.x + DISTANCE - 1, atEdge.y)).toBe('watching')
  })

  it('abandons a drag that runs down the page', () => {
    // Scrolling is what a reader does most, and it must never open anything.
    expect(judge(atEdge, atEdge.x + 5, atEdge.y + SLOPE + 1)).toBe('abandon')
    expect(judge(atEdge, atEdge.x + 5, atEdge.y - SLOPE - 1)).toBe('abandon')
  })

  it('treats a diagonal scroll as a scroll, however far it also went sideways', () => {
    // The order of the two checks is the whole of this: a swipe that has
    // travelled far enough horizontally but also dropped down the page is a
    // reader scrolling with an untidy thumb, not someone opening a menu.
    const verdict = judge(atEdge, atEdge.x + DISTANCE * 3, atEdge.y + SLOPE + 10)
    expect(verdict).toBe('abandon')
  })
})
