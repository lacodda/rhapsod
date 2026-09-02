import { describe, expect, it } from 'vitest'

import { href, parse } from '@/routing'

describe('parse', () => {
  it('reads a piece as its shelf and its name', () => {
    // The two segments are what make the address bar say where in the library
    // the reader is; a single opaque id would not.
    expect(parse('/read/19-lyubov-i-pary/abelyar-i-eloiza')).toEqual({
      name: 'piece',
      id: '19-lyubov-i-pary/abelyar-i-eloiza',
    })
  })

  it('reads a shelf', () => {
    expect(parse('/section/02-istoriya')).toEqual({ name: 'section', section: '02-istoriya' })
  })

  it('treats anything it does not know as the library', () => {
    // A deep link that no longer resolves should land the reader somewhere
    // they can read from, not on an error.
    expect(parse('/')).toEqual({ name: 'library' })
    expect(parse('/read/incomplete')).toEqual({ name: 'library' })
    expect(parse('/nonsense/path')).toEqual({ name: 'library' })
  })

  it('does not care about trailing slashes', () => {
    expect(parse('/section/02-istoriya/')).toEqual({ name: 'section', section: '02-istoriya' })
  })
})

describe('href', () => {
  it('round-trips every route', () => {
    for (const route of [
      { name: 'library' },
      { name: 'section', section: '02-istoriya' },
      { name: 'piece', id: '02-istoriya/god-bez-leta' },
    ] as const) {
      expect(parse(href(route))).toEqual(route)
    }
  })
})
