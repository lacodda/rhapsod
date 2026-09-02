import { describe, expect, it } from 'vitest'

import { href, parse } from '@/routing'
import { summary } from '@/Quotes'

describe('the quotes route', () => {
  it('is reachable by its own path', () => {
    expect(parse('/quotes')).toEqual({ name: 'quotes' })
    expect(href({ name: 'quotes' })).toBe('/quotes')
  })

  it('does not swallow a piece whose shelf is called quotes', () => {
    // A shelf could be named anything; only the bare path is the page.
    expect(parse('/read/quotes/a-piece')).toEqual({ name: 'piece', id: 'quotes/a-piece' })
  })
})

describe('the quotes summary', () => {
  it('counts one line from one piece without a plural', () => {
    // "1 line from 1 pieces" was on the screen the first time this page was
    // looked at; both counts get the same treatment.
    expect(summary(1, 1)).toBe('1 line from 1 piece')
    expect(summary(2, 1)).toBe('2 lines from 1 piece')
    expect(summary(9, 3)).toBe('9 lines from 3 pieces')
  })
})
