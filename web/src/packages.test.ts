import { beforeEach, describe, expect, it, vi } from 'vitest'

import { choose, chosen, holds, wanted } from '@/packages'

/** The shelves a library has, for the "all of them" rule. */
const ALL = ['01-physics', '02-myths', '03-people']

const PIECES = [
  { id: '01-physics/entropy', section: '01-physics' },
  { id: '01-physics/light', section: '01-physics' },
  { id: '02-myths/icarus', section: '02-myths' },
  { id: '03-people/abelard', section: '03-people' },
]

/** A localStorage that behaves, standing in for the browser's. */
function store(): Storage {
  const held = new Map<string, string>()
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value)
    },
    removeItem: (key) => {
      held.delete(key)
    },
    clear: () => {
      held.clear()
    },
    key: (index) => [...held.keys()][index] ?? null,
    get length() {
      return held.size
    },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', store())
})

describe('chosen', () => {
  it('is "all of them" until a choice is made', () => {
    expect(chosen()).toBeNull()
  })

  it('remembers a narrowed selection', () => {
    choose(['02-myths'], ALL)
    expect(chosen()).toEqual(['02-myths'])
  })

  it('stores nothing when every shelf is chosen', () => {
    // "All of them" has to stay the absence of a choice, or shelves written
    // later would be left off a list the reader never meant to close.
    choose([...ALL], ALL)
    expect(localStorage.getItem('rhapsod.shelves')).toBeNull()
    expect(chosen()).toBeNull()
  })

  it('reads a selection of no shelves as a real choice, not as all', () => {
    choose([], ALL)
    expect(chosen()).toEqual([])
  })

  it('falls back to all of them when the stored value is not a list of ids', () => {
    localStorage.setItem('rhapsod.shelves', '{"shelves":["01-physics"]}')
    expect(chosen()).toBeNull()
  })

  it('falls back to all of them when the stored value is not JSON', () => {
    localStorage.setItem('rhapsod.shelves', 'the ones about physics')
    expect(chosen()).toBeNull()
  })

  it('falls back to all of them when the list holds something that is not an id', () => {
    localStorage.setItem('rhapsod.shelves', '["01-physics",7]')
    expect(chosen()).toBeNull()
  })

  it('reads as all of them where storage throws', () => {
    // A private window: the reader loses the selection, never the library.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage)
    expect(chosen()).toBeNull()
  })

  it('does not throw where storage refuses to be written', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage)
    expect(() => {
      choose(['02-myths'], ALL)
    }).not.toThrow()
  })
})

describe('holds', () => {
  it('holds every shelf when nothing was chosen', () => {
    expect(holds(null, '03-people')).toBe(true)
  })

  it('holds only the chosen', () => {
    expect(holds(['02-myths'], '02-myths')).toBe(true)
    expect(holds(['02-myths'], '01-physics')).toBe(false)
  })
})

describe('wanted', () => {
  it('wants the whole library when nothing was chosen', () => {
    expect(wanted(PIECES, null)).toHaveLength(4)
  })

  it('wants only the pieces on chosen shelves', () => {
    expect(wanted(PIECES, ['01-physics']).map((piece) => piece.id)).toEqual([
      '01-physics/entropy',
      '01-physics/light',
    ])
  })

  it('wants nothing when no shelf is chosen', () => {
    expect(wanted(PIECES, [])).toEqual([])
  })

  it('ignores a chosen shelf the library no longer has', () => {
    // A shelf renamed in the vault leaves an id behind in this device's
    // selection; it should take nothing with it.
    expect(wanted(PIECES, ['02-myths', '09-gone']).map((piece) => piece.id)).toEqual(['02-myths/icarus'])
  })

  it('does not hand back an array that mutates the library', () => {
    const all = wanted(PIECES, null)
    all.pop()
    expect(PIECES).toHaveLength(4)
  })
})
