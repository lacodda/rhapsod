/**
 * The reader that works with the stand out of reach.
 *
 * Two caches, because the two things have different lives. The shell - the
 * app itself - is replaced wholesale when a new version is deployed. The
 * library is content: it changes when novellas are published, it is what the
 * reader came for, and it must survive an app update untouched.
 *
 * Nothing here is generated. A build plugin would produce a precache manifest
 * of hashed asset names, which is exactly the part this does not need: the
 * shell is fetched network-first and falls back to the cache, so a stale asset
 * list cannot strand the app on an old build.
 *
 * The version below is replaced at build time with the app's own, so a deploy
 * retires the previous shell.
 */

const VERSION = '__APP_VERSION__'
const SHELL = `rhapsod-shell-${VERSION}`
const LIBRARY = 'rhapsod-library'

/** What the app is, as opposed to what it holds. */
const ENTRY = '/index.html'

self.addEventListener('install', (event) => {
  // The entry point is the one thing worth having before the first offline
  // start; the assets it pulls are cached as they are fetched. Waiting for a
  // full asset list here would delay the install for files the reader may
  // never need.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(ENTRY))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          // Old shells go; the library cache is not versioned and stays.
          names.filter((name) => name.startsWith('rhapsod-shell-') && name !== SHELL).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/** The library reads that are worth holding: the index and the pieces. */
function isLibraryRead(url) {
  return url.pathname === '/api/library' || url.pathname.startsWith('/api/pieces/')
}

/**
 * Answers from the network, falling back to what was cached.
 *
 * Network first rather than cache first: at home the reader should see a
 * library that was published a minute ago, and the fallback is what makes the
 * train work. A read that succeeds refreshes the cache on the way past.
 */
async function freshestFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (unreachable) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw unreachable
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isLibraryRead(url)) {
    event.respondWith(freshestFirst(request, LIBRARY))
    return
  }

  // The rest of the API is the reader's own state, which the app queues and
  // holds in memory; a cached copy of it would be a second source of truth
  // with no way to reconcile. Left to the network on purpose.
  if (url.pathname.startsWith('/api/')) return

  // A navigation is answered with the app itself: every route is the same
  // document, and a deep link opened offline has to reach it.
  if (request.mode === 'navigate') {
    event.respondWith(freshestFirst(new Request(ENTRY), SHELL).catch(() => caches.match(ENTRY)))
    return
  }

  event.respondWith(freshestFirst(request, SHELL))
})

/**
 * Fills the library cache in one pass.
 *
 * Sent by the app after it has the index, so that the whole library is
 * available offline rather than only the pieces that happened to be opened -
 * which is the promise ADR 0003 makes and the reason this file exists.
 */
async function cacheLibrary(paths) {
  const cache = await caches.open(LIBRARY)
  // One at a time rather than all at once: a few hundred requests in parallel
  // would fight the reader's own for the connection, and this is background
  // work with no deadline.
  for (const path of paths) {
    try {
      if (await cache.match(path)) continue
      const response = await fetch(path)
      if (response.ok) await cache.put(path, response)
    } catch {
      // The stand went away mid-fill. What was cached stays cached, and the
      // next visit home carries on from there.
      return
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-library' && Array.isArray(event.data.paths)) {
    event.waitUntil(cacheLibrary(event.data.paths))
  }
})
