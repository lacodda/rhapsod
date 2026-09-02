import { describe, expect, it } from 'vitest'

import { minutes } from '@/Library'

describe('minutes', () => {
  it('reports the reading time a piece actually takes', () => {
    // The format aims at five to seven minutes; the number shown has to match
    // what the reader will experience, or it stops being worth showing.
    expect(minutes(900)).toBe(5)
    expect(minutes(1250)).toBe(7)
  })

  it('never says zero minutes', () => {
    // A short piece is a one-minute read, not a no-minute one.
    expect(minutes(0)).toBe(1)
    expect(minutes(40)).toBe(1)
  })
})
