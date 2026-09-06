import { describe, expect, it } from 'vitest'

import { REACTION_KINDS } from '@/api'
import { REACTIONS } from '@/Feedback'
import { tapMeans } from '@/useReactions'

describe('tapMeans', () => {
  it('takes the reaction off when the kind tapped is the one already there', () => {
    // The gesture that put it there removes it; a reader who taps a lit
    // button expects it to go out.
    expect(tapMeans('good', 'good')).toBe('clear')
    expect(tapMeans('struck', 'struck')).toBe('clear')
  })

  it('changes the kind rather than adding a second', () => {
    // A piece has one reaction. Tapping the other kind means the other kind,
    // not both.
    expect(tapMeans('good', 'struck')).toBe('struck')
    expect(tapMeans('struck', 'good')).toBe('good')
  })

  it('reacts to a piece that has no reaction yet', () => {
    expect(tapMeans(undefined, 'good')).toBe('good')
  })
})

describe('reaction kinds', () => {
  it('draws every kind the server accepts', () => {
    // The kinds live in three places - the table, the API type and this table
    // of labels - and a kind added to two of them would be a button that
    // renders as undefined rather than an error anyone sees.
    for (const kind of REACTION_KINDS) {
      expect(REACTIONS[kind], `no way to draw ${kind}`).toBeDefined()
      expect(REACTIONS[kind].label.length).toBeGreaterThan(0)
    }
    expect(Object.keys(REACTIONS)).toHaveLength(REACTION_KINDS.length)
  })

  it('gives the two kinds different colours', () => {
    // They are not degrees of one scale, and drawing them alike would say
    // they were. The tokens are the line's own: Tailwind's stock palette is
    // dropped from the dowel theme and compiles to nothing.
    expect(REACTIONS.good.ring).not.toBe(REACTIONS.struck.ring)
  })
})
