import { describe, expect, it } from 'vitest'

import type { LibraryIndex } from '@/api'
import { arrival, paths, shortfall, staleBy } from '@/offline'

const LIBRARY: LibraryIndex = {
  sections: [
    { id: '01-physics', number: 1, title: 'Physics', pieces: 2 },
    { id: '02-myths', number: 2, title: 'Myths', pieces: 1 },
  ],
  pieces: [
    { id: '01-physics/entropy', section: '01-physics', title: 'Entropy', written: null, words: 1200, one_liner: null },
    { id: '01-physics/light', section: '01-physics', title: 'Light', written: null, words: 1100, one_liner: null },
    { id: '02-myths/icarus', section: '02-myths', title: 'Icarus', written: null, words: 1300, one_liner: null },
  ],
}

describe('paths', () => {
  it('asks for the index, the plan and every piece when all shelves are kept', () => {
    expect(paths(LIBRARY, null)).toEqual([
      '/api/library',
      '/api/topics',
      '/api/pieces/01-physics/entropy',
      '/api/pieces/01-physics/light',
      '/api/pieces/02-myths/icarus',
    ])
  })

  it('asks only for the pieces on the chosen shelves', () => {
    expect(paths(LIBRARY, ['02-myths'])).toEqual(['/api/library', '/api/topics', '/api/pieces/02-myths/icarus'])
  })

  it('keeps the index and the plan even when no shelf is chosen', () => {
    // Without the index the app cannot start away from the stand at all, and
    // the plan is what the reader asks the next novella from: neither is a
    // shelf, so neither is given up with the shelves.
    expect(paths(LIBRARY, [])).toEqual(['/api/library', '/api/topics'])
  })
})

describe('shortfall', () => {
  const sent = ['/api/library', '/api/topics', '/api/pieces/a/one', '/api/pieces/a/two', '/api/pieces/a/three']

  it('says nothing when every piece arrived', () => {
    // The plan missing is not a piece missing; the screen counts pieces.
    expect(shortfall({ type: 'library-filled', refresh: true, reached: true, missed: ['/api/topics'] }, sent)).toBeNull()
  })

  it('counts the pieces a refresh did not get', () => {
    expect(
      shortfall(
        { type: 'library-filled', refresh: true, reached: false, missed: ['/api/pieces/a/two', '/api/pieces/a/three'] },
        sent,
      ),
    ).toEqual({ fetched: 1, total: 3, reached: false })
  })
})

describe('staleBy', () => {
  it('names the held read a delivered change makes stale', () => {
    expect(staleBy('/notes/02-myths/icarus')).toBe('/api/notes')
    expect(staleBy('/quotes')).toBe('/api/quotes')
    expect(staleBy('/quotes/q1')).toBe('/api/quotes')
    expect(staleBy('/progress/02-myths/icarus')).toBe('/api/progress')
  })

  it('names nothing for a change the worker holds nothing of', () => {
    expect(staleBy('/typos')).toBeNull()
  })
})

describe('arrival', () => {
  const filled = (reached: boolean, missed: string[]) => ({ type: 'library-filled' as const, refresh: false, reached, missed })

  it('is fetching while the worker says a fill is under way, whatever the last one said', () => {
    expect(arrival(true, filled(false, ['/api/pieces/a/two']))).toBe('fetching')
  })

  it('is fetching while there is no worker to ask yet', () => {
    // A first visit: the app's fill waits for the worker to take the page.
    expect(arrival(null, null)).toBe('fetching')
  })

  it('is away when the last fill lost the stand', () => {
    expect(arrival(false, filled(false, ['/api/pieces/a/two']))).toBe('away')
  })

  it('is refused when the stand was there and kept pieces back', () => {
    expect(arrival(false, filled(true, ['/api/pieces/a/two']))).toBe('refused')
  })

  it('is stopped when nothing runs and nothing said why', () => {
    // A worker the browser stopped part way sends no report at all; the plan
    // missing is not a piece missing.
    expect(arrival(false, null)).toBe('stopped')
    expect(arrival(false, filled(true, ['/api/topics']))).toBe('stopped')
  })
})
