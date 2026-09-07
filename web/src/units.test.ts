import { describe, expect, it } from 'vitest'

import { ago, size } from '@/units'

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
