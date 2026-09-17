import { describe, expect, it } from 'vitest'

import type { LibraryIndex } from '@/api'
import { paths } from '@/offline'

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
