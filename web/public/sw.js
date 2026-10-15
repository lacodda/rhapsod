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
/**
 * The library, named by the shape of what it holds rather than by the app's
 * version: an app update must not cost the reader the library they carry, but
 * a piece cached in a shape the app no longer reads is worse than none. The
 * number moves only when a piece's JSON changes shape - 2 is paragraphs as
 * runs of text (v0.15.4) - and the old copy is dropped when this worker takes
 * over, at home, where the update arrived and the library refills.
 *
 * Named again in `src/offline.ts` as `LIBRARY_CACHE`.
 */
const LIBRARY = 'rhapsod-library-2'

/**
 * The reader's own state, as the stand last answered it.
 *
 * Apart from the library because the library cache is made equal to the
 * index on every refresh, and these reads are not in the index. Not versioned,
 * like the library: an app update must not cost the reader their marks on the
 * next train.
 */
const READER = 'rhapsod-reader'

/**
 * Put on an answer given from a cache because the stand did not answer.
 *
 * The app counts an answer as the stand being there; without this a held
 * piece opened on a train looked exactly like the stand answering. Named in
 * `src/offline.ts` as `FROM_CACHE`.
 */
const FROM_CACHE = 'x-rhapsod-cached'

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
          // Old shells go, and a library in a shape this app no longer reads.
          // The library in the current shape stays across every app update.
          names
            .filter(
              (name) =>
                (name.startsWith('rhapsod-shell-') && name !== SHELL) ||
                (name.startsWith('rhapsod-library') && name !== LIBRARY),
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/**
 * The library reads that are worth holding: the index, the pieces, and the
 * plan of what could be written.
 *
 * The plan is content like the rest: the author publishes it alongside the
 * novellas, it does not change while the reader is out, and asking for a
 * topic is the one thing a reader does on a train that is not reading. The
 * request itself was always queued - without the plan cached, there was
 * simply nothing on the screen to ask from.
 */
function isLibraryRead(url) {
  return url.pathname === '/api/library' || url.pathname === '/api/topics' || url.pathname.startsWith('/api/pieces/')
}

/**
 * The reads of the reader's own state that the app makes when it starts:
 * progress, notes, kept lines, today's cards, bookmarks, reactions, requests.
 * `READER_STATE` in `src/offline.ts` is the same list.
 *
 * Left to the network, these were what the app lost away from home: a note
 * written at home showed as "+ Write a note" on the train, and the note
 * written there replaced it on delivery. Held here they are the state as the
 * stand last knew it; the app lays its queue of what the reader did since over
 * them, so the copy never has to be reconciled with anything (see
 * `src/replay.ts`).
 */
const READER_STATE = [
  '/api/progress',
  '/api/notes',
  '/api/quotes',
  '/api/reviews',
  '/api/bookmarks',
  '/api/reactions',
  '/api/requests',
]

function isReaderRead(url) {
  return READER_STATE.includes(url.pathname)
}

/** A cached answer, marked as one. */
function fromCache(response) {
  const headers = new Headers(response.headers)
  headers.set(FROM_CACHE, '1')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
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
    if (response.ok) {
      await cache.put(request, response.clone())
    } else if (cacheName === READER && (response.status === 401 || response.status === 403)) {
      // The stand says this device is no longer signed in - signed out
      // everywhere, perhaps because it was lost. The reader's notes do not
      // stay readable on it. The queue of unsent changes is not here and is
      // not touched: it is delivered after the next sign-in.
      await cache.delete(request)
    }
    return response
  } catch (unreachable) {
    const cached = await cache.match(request)
    if (cached) return fromCache(cached)
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

  if (isReaderRead(url)) {
    event.respondWith(freshestFirst(request, READER))
    return
  }

  // The rest of the API is about the stand rather than for reading on the
  // road - its health, its sessions, the journal and the report - and is left
  // to the network: an old copy of any of them would be an answer about a
  // moment that has passed.
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
 * Fills the library cache in one pass, and says how it went.
 *
 * Sent by the app after it has the index, so that the whole library is
 * available offline rather than only the pieces that happened to be opened -
 * which is the promise ADR 0003 makes and the reason this file exists.
 *
 * The answer lists what it did not get. A fill that stopped when the stand
 * went away used to stop in silence, and the stand screen showed a refresh
 * that had fetched nothing as one that had worked.
 */
async function cacheLibrary(paths, { refresh = false } = {}) {
  const cache = await caches.open(LIBRARY)
  const missed = []
  let reached = true
  // One at a time rather than all at once: a few hundred requests in parallel
  // would fight the reader's own for the connection, and this is background
  // work with no deadline.
  for (const path of paths) {
    if (!reached) {
      missed.push(path)
      continue
    }
    try {
      if (!refresh && (await cache.match(path))) continue
      const response = await fetch(path)
      if (response.ok) {
        await cache.put(path, response)
      } else {
        // The stand is there and did not give this one. The copy held, if
        // any, stays; the rest of the fill goes on.
        missed.push(path)
      }
    } catch {
      // The stand went away mid-fill. What was cached stays cached, the rest
      // is not tried against a stand that is not there, and the next visit
      // home carries on from here.
      reached = false
      missed.push(path)
    }
  }
  // A refresh makes the cache equal to the index: a piece that left the
  // library leaves the device too, rather than staying readable offline
  // under a shelf that no longer lists it. Not after a fill cut short: the
  // pieces it never reached are not known to be gone.
  if (refresh && reached) {
    for (const request of await cache.keys()) {
      if (!paths.includes(new URL(request.url).pathname)) await cache.delete(request)
    }
  }
  return { type: 'library-filled', refresh, reached, missed }
}

/**
 * The fills, one after another.
 *
 * Two at once fought over one cache: a refresh deleting what it did not list
 * while a background fill put pieces back, and a reader who pressed "Fetch the
 * library again" a second time, with the first still running, started a
 * second pass over every piece. Each fill now waits for the one before it.
 */
let fills = Promise.resolve()

/** Fills asked for and not yet finished, the running one included. */
let busy = 0

/**
 * How the last fill ended, for a page asking after the report went past it.
 * Gone when the browser stops an idle worker, which is why the page keeps
 * the reports it heard as well.
 */
let reported = null

self.addEventListener('message', (event) => {
  // Whether a fill is under way, asked by the stand screen. Answered here
  // because only the worker knows: a worker the browser stopped part way
  // through a fill comes back with nothing running and no report to send,
  // and a page keeping its own count would wait for that report forever.
  if (event.data?.type === 'fill-status') {
    event.ports?.[0]?.postMessage({ type: 'fill-status', busy: busy > 0, last: reported })
    return
  }
  if (!Array.isArray(event.data?.paths)) return
  // Asked for by the reader, from the stand screen, a refresh fetches every
  // piece again whether or not a copy is held, so an edit published to the
  // vault reaches a device that has not opened the piece since.
  const refresh = event.data.type === 'refresh-library'
  if (event.data.type !== 'cache-library' && !refresh) return
  const { paths } = event.data
  busy += 1
  const fill = fills.then(() => cacheLibrary(paths, { refresh }))
  // A fill that failed outright must not stop the ones queued behind it.
  fills = fill.catch(() => undefined)
  event.waitUntil(
    fill
      .then((filled) => {
        reported = filled
        // To the page that asked: it is the one watching the count.
        event.source?.postMessage(filled)
      })
      .finally(() => {
        busy -= 1
      }),
  )
})
