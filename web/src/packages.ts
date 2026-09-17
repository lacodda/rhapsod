/**
 * Which shelves this device keeps for the road.
 *
 * Holding the whole library was the right first answer and stops being one as
 * the library grows: three hundred pieces are not all wanted in a bag, and a
 * phone that fetches every one of them spends the reader's storage on shelves
 * they never open. The choice is by shelf rather than by piece - a reader
 * thinks "the ones about physics", not in titles - and it is a choice about
 * this device, so it lives on this device and is never sent to the stand.
 *
 * The default is everything. A reader who never opens this screen gets what
 * they had before, which is the promise ADR 0003 made.
 */

/** Where the choice is kept. Per-device, per-browser, on purpose. */
const KEY = 'rhapsod.shelves'

/**
 * The shelves chosen, or `null` for "all of them".
 *
 * `null` is not the same as every id listed: the library gains shelves when
 * the author writes them, and a reader who chose nothing in particular should
 * get those too rather than silently keeping an old list.
 */
export type Chosen = string[] | null

/**
 * What this device is set to hold.
 *
 * Storage that throws - a private window, blocked site data - reads as "all
 * of it": the reader loses their selection, not their library.
 */
export function chosen(): Chosen {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    // Anything that is not a list of strings is not a choice this code wrote.
    const ids = parsed.filter((id): id is string => typeof id === 'string')
    return ids.length === parsed.length ? ids : null
  } catch {
    return null
  }
}

/**
 * Records what this device should hold.
 *
 * Passing `null`, or every shelf there is, stores nothing: "all of them" is
 * the absence of a choice, so a library that grows later is still held whole.
 */
export function choose(ids: Chosen, all: readonly string[]): void {
  try {
    if (ids === null || ids.length === all.length) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Nothing to do and nothing to tell the reader: the selection is a
    // convenience, and the library still works without it being remembered.
  }
}

/** Whether a shelf is one of the chosen. */
export function holds(ids: Chosen, shelf: string): boolean {
  return ids === null || ids.includes(shelf)
}

/** A piece, as far as this module cares: which shelf it is on. */
interface Shelved {
  id: string
  section: string
}

/**
 * The pieces a selection covers.
 *
 * This is what the worker is told to fetch and what "held" is counted
 * against, so the two can never mean different things.
 */
export function wanted<T extends Shelved>(pieces: readonly T[], ids: Chosen): T[] {
  if (ids === null) return [...pieces]
  const set = new Set(ids)
  return pieces.filter((piece) => set.has(piece.section))
}
