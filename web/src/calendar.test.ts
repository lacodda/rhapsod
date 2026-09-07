import { describe, expect, it } from 'vitest'

import type { Opened } from '@/api'
import { byDay, clockOffset, dayLabel, localDay, monthLabel } from '@/calendar'

function opened(day: string, pieceId: string): Opened {
  return { day, piece_id: pieceId, title: pieceId, opened_at: `${day}T08:00:00.000Z`, times: 1 }
}

describe('monthLabel', () => {
  it('names the month without going through a Date', () => {
    // A Date built from "2026-09" is midnight UTC on the first, which is
    // still August for anyone west of Greenwich.
    expect(monthLabel('2026-09')).toBe('September 2026')
    expect(monthLabel('2026-01')).toBe('January 2026')
  })

  it('hands back what it does not understand', () => {
    expect(monthLabel('nonsense')).toBe('nonsense')
  })
})

describe('dayLabel', () => {
  it('names today and yesterday rather than dating them', () => {
    expect(dayLabel('2026-09-07', '2026-09-07')).toBe('Today')
    expect(dayLabel('2026-09-06', '2026-09-07')).toBe('Yesterday')
  })

  it('finds yesterday across a month boundary', () => {
    expect(dayLabel('2026-08-31', '2026-09-01')).toBe('Yesterday')
  })

  it('dates any other day with its weekday', () => {
    expect(dayLabel('2026-09-05', '2026-09-07')).toBe('Saturday 5 September')
  })

  it('hands back what it does not understand', () => {
    expect(dayLabel('nonsense', '2026-09-07')).toBe('nonsense')
  })
})

describe('localDay', () => {
  it('reads the calendar date off the device clock', () => {
    // Local-time constructor, local-time answer: the same clock both ways.
    expect(localDay(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07')
    expect(localDay(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
})

describe('clockOffset', () => {
  it('is minutes east of UTC, the sign a zone is written with', () => {
    // A fixed fake rather than the real clock: `getTimezoneOffset` reports
    // minutes *behind* UTC, so a zone 3 hours ahead (180 minutes behind) has
    // to come back as -180, and a zone 10 hours behind (-600 minutes behind,
    // the Americas) has to come back as 600 - the opposite sign either way.
    expect(clockOffset({ getTimezoneOffset: () => 180 } as Date)).toBe(-180)
    expect(clockOffset({ getTimezoneOffset: () => -600 } as Date)).toBe(600)
  })
})

describe('byDay', () => {
  it('draws a border where the day changes and nowhere else', () => {
    const days = byDay([
      opened('2026-09-07', 'a/one'),
      opened('2026-09-07', 'a/two'),
      opened('2026-09-05', 'a/three'),
    ])
    expect(days.map((day) => day.day)).toEqual(['2026-09-07', '2026-09-05'])
    expect(days[0]?.opened.map((line) => line.piece_id)).toEqual(['a/one', 'a/two'])
    expect(days[1]?.opened).toHaveLength(1)
  })

  it('has nothing to say about nothing', () => {
    expect(byDay([])).toEqual([])
  })
})
