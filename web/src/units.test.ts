import { describe, expect, it } from 'vitest'

import { ago, since, size } from '@/units'

describe('ago', () => {
  it('rounds down to the largest unit that is at least one', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59)).toBe('just now')
    expect(ago(60)).toBe('1 minute ago')
    expect(ago(3599)).toBe('59 minutes ago')
    expect(ago(3600)).toBe('1 hour ago')
    expect(ago(93784)).toBe('1 day ago')
    expect(ago(14 * 86400)).toBe('14 days ago')
  })
})

describe('size', () => {
  it('picks the unit by the size and the precision by the unit', () => {
    expect(size(0)).toBe('0 B')
    expect(size(999)).toBe('999 B')
    expect(size(312_400)).toBe('312 kB')
    expect(size(4_180_000)).toBe('4.2 MB')
  })
})

describe('since', () => {
  const now = Date.parse('2026-09-19T12:00:00.000Z')

  it('reads a timestamp the way the rest of the screen reads seconds', () => {
    expect(since('2026-09-19T11:59:30.000Z', now)).toBe('just now')
    expect(since('2026-09-19T11:30:00.000Z', now)).toBe('30 minutes ago')
    expect(since('2026-09-19T09:00:00.000Z', now)).toBe('3 hours ago')
    expect(since('2026-09-17T12:00:00.000Z', now)).toBe('2 days ago')
  })

  it('does not count backwards when a clock is ahead of the stand', () => {
    // A phone a minute fast would otherwise be shown as signed in "-1 days
    // ago", which reads as a bug in the stand rather than in the clock.
    expect(since('2026-09-19T12:05:00.000Z', now)).toBe('just now')
  })

  it('says it does not know rather than showing NaN', () => {
    expect(since('not a timestamp', now)).toBe('at an unknown time')
  })
})
