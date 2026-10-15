/**
 * Making the app itself available with the stand out of reach.
 *
 * The service worker does the caching (see `public/sw.js`); this is the app's
 * side of it - registering the worker, and telling it what the library holds
 * so the whole of it is cached rather than only the pieces that happened to
 * be opened (ADR 0003). The reader's own state is held too, read by read, so
 * the app starts away from home with the reader's marks and not only with the
 * library.
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
  // Before anything is sent: the fill the app asks for at start reports while
  // the library screen is up, and the stand screen opened later still has to
  // know how it ended.
  listen()
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
const LIBRARY_CACHE = 'rhapsod-library-2'

/**
 * The header the worker puts on an answer it gave from its own copy, because
 * the stand did not answer; see `public/sw.js`.
 *
 * Without it a cached answer looked exactly like the stand answering, and the
 * app counted it as the stand being there: opening a held piece on a train
 * hid "the stand is away", and fetching the library again away from home
 * looked like it worked.
 */
export const FROM_CACHE = 'x-rhapsod-cached'

/** Whether an answer came from the worker's copy rather than from the stand. */
export const fromCache = (response: Response): boolean => response.headers.get(FROM_CACHE) !== null

/**
 * The reads of the reader's own state that the worker holds; `public/sw.js`
 * keeps the same list.
 *
 * Everything the app loads about the reader at the start, so that it starts
 * away from home with the reader's marks rather than without them. Without
 * them a note the reader wrote at home showed as "+ Write a note" on the
 * train, and the note written there replaced it on delivery.
 */
export const READER_STATE = [
  '/api/progress',
  '/api/notes',
  '/api/quotes',
  '/api/reviews',
  '/api/bookmarks',
  '/api/reactions',
  '/api/requests',
]

/**
 * The held read that a delivered change makes stale, if any.
 *
 * `/notes/<id>` changes what `/api/notes` answers, `/quotes/<id>` what
 * `/api/quotes` does, and so on; a typo report changes nothing the worker
 * holds.
 */
export function staleBy(changePath: string): string | null {
  const read = `/api/${changePath.split('/')[1] ?? ''}`
  return READER_STATE.includes(read) ? read : null
}

/**
 * Reads the given paths again through the worker, so its copy is the stand's
 * current answer.
 *
 * Called after the queue lands. The copy was taken when the app opened, which
 * at home is usually before the drain that delivered the train's changes -
 * and the next time the app opened away from home it showed the state from
 * before that journey. Nothing is done with the answers: the point is the
 * worker storing them on the way past.
 */
export function rehold(reads: Iterable<string>): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return
  for (const read of reads) {
    void fetch(read).catch(() => undefined)
  }
}

/** What the worker says when a fill of the library ends. */
export interface Filled {
  type: 'library-filled'
  /** Whether it was the reader's refresh rather than the background fill. */
  refresh: boolean
  /** False when the stand went out of reach part way through. */
  reached: boolean
  /** The paths it did not get - not attempted, or not given by the stand. */
  missed: string[]
}

/** The last fill the worker reported to this page, if any has. */
let last: Filled | null = null

const fillListeners = new Set<(filled: Filled) => void>()

let listening = false

/**
 * Hears the worker's reports for the life of the page.
 *
 * One listener for the page rather than one per screen: the stand screen used
 * to listen only while a refresh it started was running, so the report of the
 * fill the app makes at start - the one that says the stand went away part way
 * - reached nobody, and the screen went on saying the rest was "still being
 * fetched" with nothing fetching it.
 */
function listen(): void {
  if (listening || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  listening = true
  const container = navigator.serviceWorker
  container.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Partial<Filled> | null
    if (data?.type !== 'library-filled') return
    last = data as Filled
    for (const listener of fillListeners) listener(last)
  })
  // A listener added this way does not start the message queue the way
  // `onmessage` does; without this a report sent early could wait unread.
  container.startMessages()
}

/** The last fill reported to this page: how the library last arrived, or did not. */
export const lastFill = (): Filled | null => last

/** Listens for the worker reporting a finished fill. Returns the unsubscribe. */
export function watchFills(listener: (filled: Filled) => void): () => void {
  listen()
  fillListeners.add(listener)
  return () => {
    fillListeners.delete(listener)
  }
}

/** What the worker says about its fills. */
export interface FillStatus {
  /** Whether a fill is under way, or waiting behind one that is. */
  busy: boolean
  /**
   * How its last fill ended - or the last this page heard of, when the
   * worker has been stopped and started since and remembers none.
   */
  last: Filled | null
}

/**
 * Whether the worker is filling the library now, and how its last fill ended;
 * `null` where there is no worker to ask, or it does not answer.
 *
 * Asked rather than counted here. A page that counted the fills it sent and
 * the reports it got back waited forever on a worker the browser stopped part
 * way through - that worker comes back with nothing running and nothing to
 * report, and only it can say so. The last report rides along because it
 * travels apart from this answer: told "nothing is running", the page must not
 * have to wait for the message that says why.
 */
export async function fillStatus(): Promise<FillStatus | null> {
  const worker = typeof navigator === 'undefined' ? null : navigator.serviceWorker?.controller
  if (!worker) return null
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const done = (answer: FillStatus | null): void => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(answer)
    }
    // A worker from before this question was asked does not answer it; the
    // page is then no better informed than without a worker.
    const timer = setTimeout(() => {
      done(null)
    }, STATUS_WAIT_MS)
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { busy?: unknown; last?: Filled | null } | null
      done({ busy: data?.busy === true, last: data?.last ?? last })
    }
    worker.postMessage({ type: 'fill-status' }, [channel.port2])
  })
}

/** How long the worker is given to say whether it is filling. */
const STATUS_WAIT_MS = 2_000

/**
 * Why the pieces this device lacks are not here, as far as it can tell.
 *
 * - `fetching`: a fill is under way, or about to be.
 * - `away`: the last fill lost the stand part way through.
 * - `refused`: the stand was there and would not give some of them.
 * - `stopped`: nothing is fetching them, and nothing said why it ended short.
 */
export type Arrival = 'fetching' | 'away' | 'refused' | 'stopped'

/**
 * The arrival a screen should show, from what the worker says now and how the
 * last fill ended.
 *
 * `null` from the worker - none to ask yet - counts as fetching: on a first
 * visit the app's fill is waiting for the worker to take the page, and saying
 * "stopped" for those few seconds would send the reader to a button for
 * nothing.
 */
export function arrival(busy: boolean | null, filled: Filled | null): Arrival {
  if (busy !== false) return 'fetching'
  if (filled === null) return 'stopped'
  if (!filled.reached) return 'away'
  return filled.missed.some((path) => path.startsWith(PIECE_PREFIX)) ? 'refused' : 'stopped'
}

/** How a refresh fell short, in pieces - the unit the screen counts in. */
export interface Shortfall {
  fetched: number
  total: number
  /** False when the stand went away part way, rather than refusing some. */
  reached: boolean
}

/**
 * What a finished fill means to the reader: `null` when every piece arrived.
 *
 * Counted in pieces, not paths: the index and the plan ride along in every
 * fill, and "40 of 42" for a shelf of forty pieces would be a riddle.
 */
export function shortfall(filled: Filled, sent: string[]): Shortfall | null {
  const pieces = sent.filter((path) => path.startsWith(PIECE_PREFIX))
  const missed = filled.missed.filter((path) => path.startsWith(PIECE_PREFIX)).length
  if (missed === 0) return null
  return { fetched: pieces.length - missed, total: pieces.length, reached: filled.reached }
}

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
  void postWhenReady('cache-library', library, ids)
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

/**
 * Sends the fill, waiting for a worker to send it to.
 *
 * On a first visit the worker is still installing when the index arrives, so
 * there is no controller and `post` drops the message on the floor: the
 * device held nothing until the reader happened to open the app a second
 * time. Seen on the stand - a cold visit cached 0 of 62 pieces, and the
 * screen honestly said it was not ready for the road.
 *
 * `ready` resolves once a worker is active for this page, and the controller
 * arrives with `controllerchange` a moment later - the worker calls
 * `clients.claim()`, so this does not wait for a reload.
 */
async function postWhenReady(
  type: 'cache-library' | 'refresh-library',
  library: LibraryIndex,
  ids: Chosen,
): Promise<boolean> {
  if (post(type, library, ids)) return true
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    await navigator.serviceWorker.ready
    if (!post(type, library, ids)) {
      // Active but not yet controlling this page: claim() is on its way.
      await new Promise<void>((resolve) => {
        const done = (): void => {
          navigator.serviceWorker.removeEventListener('controllerchange', done)
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(done, CLAIM_WAIT_MS)
        navigator.serviceWorker.addEventListener('controllerchange', done)
      })
      if (!post(type, library, ids)) return false
    }
    // The page was not the worker's when it loaded the reader's marks, so
    // those reads went past it and nothing of them is held. Read once more
    // now that they pass through it, or the first trip after a first visit
    // starts without the reader's notes.
    rehold(READER_STATE)
    return true
  } catch {
    // No worker to be had; the app still reads online.
    return false
  }
}

/** How long to wait for a freshly activated worker to claim this page. */
const CLAIM_WAIT_MS = 5_000

/** The cache of the reader's own state; see `public/sw.js`. */
const READER_CACHE = 'rhapsod-reader'

/**
 * Drops what this device holds for the reader: the library and the reader's
 * own state.
 *
 * For signing this device out. The worker forgets a held read when the stand
 * refuses it, but a device signed out does not ask again until it is signed in
 * - and away from home it opened the library and the notes from its copy as
 * if nothing had happened. The queue is not here: what is still waiting is the
 * reader's work, and it is delivered after the next sign-in.
 */
export async function forgetHeld(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    await Promise.all([caches.delete(LIBRARY_CACHE), caches.delete(READER_CACHE)])
  } catch {
    // A browser that will not open its caches holds nothing to forget.
  }
}
