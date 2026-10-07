import { describe, expect, it } from 'vitest'

import type { Card } from '@/api'
import { dueBy } from '@/useReviews'

const card = (piece_id: string, due_on: string): Card => ({ piece_id, title: piece_id, one_liner: null, step: 1, due_on })

describe('dueBy', () => {
  const schedule = [card('a/left-home', '2026-09-07'), card('a/on-the-trip', '2026-09-09'), card('a/next-week', '2026-09-16')]

  it('brings the cards that came due away from home, by the device calendar', () => {
    // The defect this exists for: the stand picked today's cards, and a phone
    // three days into a trip offered the ones of the morning it left.
    expect(dueBy(schedule, '2026-09-10').map((due) => due.piece_id)).toEqual(['a/left-home', 'a/on-the-trip'])
  })

  it('keeps a card due today and leaves one due tomorrow', () => {
    expect(dueBy(schedule, '2026-09-09').map((due) => due.piece_id)).toContain('a/on-the-trip')
    expect(dueBy(schedule, '2026-09-08').map((due) => due.piece_id)).toEqual(['a/left-home'])
  })

  it('crosses a month and a year as calendar dates do', () => {
    // Compared as text: exact for YYYY-MM-DD, with no time zone in the way.
    expect(dueBy([card('a/new-year', '2027-01-01')], '2026-12-31')).toEqual([])
    expect(dueBy([card('a/new-year', '2027-01-01')], '2027-01-01')).toHaveLength(1)
  })
})
