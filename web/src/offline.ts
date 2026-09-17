/**
 * Making the app itself available with the stand out of reach.
 *
 * The service worker does the caching (see `public/sw.js`); this is the app's
 * side of it - registering the worker, and telling it what the library holds
 * so the whole of it is cached rather than only the pieces that happened to
 * be opened (ADR 0003).
 */

import type { LibraryIndex } from '@/api'
import { wanted, type Chosen } from '@/packages'

/**
 * Registers the service worker, if this browser has one.
 *
 * Silent when it does not: a browser without service workers still reads the
 * library online, and a message about it would be about the browser rather
 * than about anything the reader can act on.
 */
export function registerWorker(): void {
  if (!('serviceWorker' in navigator)) return
  // After load, so the worker's install does not compete with the first paint
  // for the connection - on a phone that is the difference between the text
  // appearing now and appearing after a few hundred requests.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A worker that will not register - a page served over plain HTTP that
      // is not localhost - leaves an app that works online. Nothing here can
      // repair that, and the reader is not the one who would.
    })
  })
}

/**
 * Whether this page may hold anything offline at all.
 *
 * `isSecureContext` is the browser's own answer, and it is the one that
 * decides: over plain http the worker will not register and the caches are
 * not given out, however the app is written. `localhost` counts as secure,
 * which is what makes development work without a certificate.
 */
export function secure(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true
}

/**
 * Whether the offline part of the app is installed.
 *
 * Asked of the registration rather than of `controller`: a worker installed
 * on this visit does not control the page until the next load, and a reader
 * about to leave the house should be told they are ready, not told to reload
 * for a reason that is only true for another second.
 *
 * `null` where this browser has no service workers - a different answer from
 * "not installed", because nothing the reader does will change it.
 */
export async function installed(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration('/')) !== undefined
  } catch {
    // A browser that refuses to say - a private window in some browsers -
    // is one where nothing is held, which is what a reader needs to know.
    return false
  }
}

/** The name the worker gives the library cache; see `public/sw.js`. */
const LIBRARY_CACHE = 'rhapsod-library'

/** What a cached piece's path starts with; the rest of it is the piece's id. */
const PIECE_PREFIX = '/api/pieces/'

/** What the device is holding of the library. */
export interface Held {
  /** Whether the index itself is cached - without it the app cannot start offline. */
  index: boolean
  /** Pieces whose text is cached. */
  pieces: number
  /**
   * Ids of the pieces held.
   *
   * Counting is not enough once shelves are chosen: a device holding sixty
   * pieces of the wrong shelves would report the same number as one that is
   * actually ready, and the reader would be told to leave.
   */
  ids: Set<string>
}

/**
 * Counts what the worker has cached, or `null` where there is no cache.
 *
 * Read from the cache rather than asked of the worker: the worker may not be
 * controlling this page yet, and the cache is what actually answers a request
 * on a train.
 */
export async function held(): Promise<Held | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(LIBRARY_CACHE)
    const held = (await cache.keys()).map((request) => new URL(request.url).pathname)
    const ids = new Set(
      held.filter((path) => path.startsWith(PIECE_PREFIX)).map((path) => path.slice(PIECE_PREFIX.length)),
    )
    return { index: held.includes('/api/library'), pieces: ids.size, ids }
  } catch {
    return null
  }
}

/**
 * Asks the worker to hold the chosen shelves.
 *
 * Sent once the index is known, because the index is the list of what to
 * fetch. The pieces are cached one at a time in the background; nothing here
 * waits for it.
 *
 * A `cache-library` fill only adds, so a reader who narrows their selection
 * keeps the shelves they dropped until they refresh. That is deliberate:
 * quietly deleting a piece someone might be halfway through, because they
 * touched a checkbox, is not a thing a fill should do on its own.
 */
export function cacheLibrary(library: LibraryIndex, ids: Chosen): void {
  post('cache-library', library, ids)
}

/**
 * Asks the worker to fetch the chosen shelves again and drop everything else.
 *
 * The ordinary fill skips what is already held, which is right for a
 * background job and wrong for a reader who knows a piece was edited in the
 * vault: the copy on the device would stay as it was until the piece
 * happened to be opened at home. It is also how a narrowed selection is
 * actually applied - the shelves no longer chosen leave the device here, in
 * the one place the reader asked for it. Returns false when there is no
 * worker to ask, so the screen can say so rather than wait for nothing.
 */
export function refreshLibrary(library: LibraryIndex, ids: Chosen): boolean {
  return post('refresh-library', library, ids)
}

/**
 * The paths a selection means: the index, and the pieces on chosen shelves.
 *
 * The index is always held. Without it the app cannot start away from the
 * stand at all, and it is one small document however few shelves are kept.
 */
export function paths(library: LibraryIndex, ids: Chosen): string[] {
  // The index and the plan are always held, whatever shelves are kept: without
  // the index the app cannot start away from the stand at all, and the plan is
  // what a reader asks the next novella from. Both are one small document.
  return ['/api/library', '/api/topics', ...wanted(library.pieces, ids).map((piece) => `/api/pieces/${piece.id}`)]
}

function post(type: 'cache-library' | 'refresh-library', library: LibraryIndex, ids: Chosen): boolean {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return false
  worker.postMessage({ type, paths: paths(library, ids) })
  return true
}
