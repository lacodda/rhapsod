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
