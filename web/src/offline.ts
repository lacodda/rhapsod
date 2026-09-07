/**
 * Making the app itself available with the stand out of reach.
 *
 * The service worker does the caching (see `public/sw.js`); this is the app's
 * side of it - registering the worker, and telling it what the library holds
 * so the whole of it is cached rather than only the pieces that happened to
 * be opened (ADR 0003).
 */

import type { LibraryIndex } from '@/api'

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

/** The name the worker gives the library cache; see `public/sw.js`. */
const LIBRARY_CACHE = 'rhapsod-library'

/** What the device is holding of the library. */
export interface Held {
  /** Whether the index itself is cached - without it the app cannot start offline. */
  index: boolean
  /** Pieces whose text is cached. */
  pieces: number
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
    const paths = (await cache.keys()).map((request) => new URL(request.url).pathname)
    return {
      index: paths.includes('/api/library'),
      pieces: paths.filter((path) => path.startsWith('/api/pieces/')).length,
    }
  } catch {
    return null
  }
}

/**
 * Asks the worker to hold the whole library.
 *
 * Sent once the index is known, because the index is the list of what to
 * fetch. The pieces are cached one at a time in the background; nothing here
 * waits for it.
 */
export function cacheLibrary(library: LibraryIndex): void {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return
  worker.postMessage({
    type: 'cache-library',
    paths: ['/api/library', ...library.pieces.map((piece) => `/api/pieces/${piece.id}`)],
  })
}
