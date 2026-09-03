import { describe, expect, it } from 'vitest'

import type { LibraryIndex } from '@/api'
import { linkTarget, WIKI_LINK } from '@/Reader'

/**
 * A library the size of the real one is not needed: two shelves, one of them
 * holding two pieces with the same title, is every case the resolver has.
 */
const library: LibraryIndex = {
  sections: [
    { id: '02-istoriya', number: 2, title: 'История', pieces: 2 },
    { id: '06-izvestnye-lichnosti', number: 6, title: 'Известные личности', pieces: 1 },
  ],
  pieces: [
    {
      id: '02-istoriya/god-bez-leta',
      section: '02-istoriya',
      title: 'Год без лета',
      written: null,
      words: 1000,
      one_liner: null,
    },
    {
      id: '02-istoriya/tesla',
      section: '02-istoriya',
      title: 'Тесла',
      written: null,
      words: 1000,
      one_liner: null,
    },
    {
      id: '06-izvestnye-lichnosti/tesla',
      section: '06-izvestnye-lichnosti',
      title: 'Тесла',
      written: null,
      words: 1000,
      one_liner: null,
    },
  ],
}

describe('WIKI_LINK', () => {
  it('reads the form the writing format uses', () => {
    // `[[vault path|caption]]`: the path is qualified so the same text works
    // inside the vault, and the caption is what a reader should see.
    const [match] = [...'[[Studio/Новеллы/02 — История/Год без лета|Год без лета]]'.matchAll(WIKI_LINK)]
    expect(match?.[1]).toBe('Studio/Новеллы/02 — История/Год без лета')
    expect(match?.[2]).toBe('Год без лета')
  })

  it('reads a link with no caption', () => {
    const [match] = [...'[[Тесла]]'.matchAll(WIKI_LINK)]
    expect(match?.[1]).toBe('Тесла')
    expect(match?.[2]).toBeUndefined()
  })

  it('finds every link in a line, not just the first', () => {
    const line = 'см. [[A]] и [[B]] рядом'
    expect([...line.matchAll(WIKI_LINK)]).toHaveLength(2)
  })
})

describe('linkTarget', () => {
  it('resolves a vault path to a piece in the library', () => {
    // The vault prefix is the author's own layout: the reader matches the
    // tail, which is the shelf and the piece.
    expect(linkTarget('Studio/Новеллы/02 — История/Год без лета', library)).toBe('02-istoriya/god-bez-leta')
  })

  it('uses the shelf in the path when a title repeats', () => {
    // Two pieces are called "Тесла"; the directory decides which one is meant,
    // and picking the first match would send the reader to the wrong shelf.
    expect(linkTarget('Studio/Новеллы/06 — Известные личности/Тесла', library)).toBe(
      '06-izvestnye-lichnosti/tesla',
    )
  })

  it('returns null for a topic that has not been written yet', () => {
    // Neighbours may name a topic from the plan. That is not a broken link,
    // it is a piece that does not exist, and the caption alone is the answer.
    expect(linkTarget('Studio/Новеллы/05 — Философия/Китайская комната', library)).toBeNull()
  })

  it('returns null when the library has not loaded', () => {
    expect(linkTarget('Studio/Новеллы/02 — История/Год без лета', undefined)).toBeNull()
  })
})
