/**
 * Getting what the reader did to the stand, whenever the stand is there.
 *
 * The app never waits for the network to show a change as done: it writes to
 * the local queue and returns (ADR 0003). This module is the other half - it
 * drains that queue, in order, whenever there is reason to think the server
 * can be reached, and tells the app whether anything is still waiting.
 *
 * "Online" here means the stand answered, not that the browser thinks it has a
 * connection: the Pi is on a home network, so a phone with four bars of mobile
 * data is offline as far as this library is concerned. `navigator.onLine` is
 * used only as a hint about when to try again, never as an answer.
 */

import { forget, pending, unkept, waiting, type Change } from '@/queue'
import { rehold, staleBy } from '@/offline'

/** What the app shows about the queue. */
export interface SyncState {
  /** True once a request has reached the stand and not since failed. */
  reachable: boolean
  /** Changes still waiting to be delivered. */
  waiting: number
  /**
   * How many of those live only in this page, because the browser would not
   * keep them on the device. Closing the page loses them, and the reader is
   * told.
   */
  unkept: number
  /** True while a drain is running. */
  syncing: boolean
  /**
   * True when the stand turned a change away because this device is not
   * signed in. The change is kept: it is waiting for the reader to sign in
   * again, not for the stand to come back.
   */
  signIn: boolean
}

type Listener = (state: SyncState) => void

let state: SyncState = { reachable: true, waiting: 0, unkept: 0, syncing: false, signIn: false }
const listeners = new Set<Listener>()

/** The current state, for a component mounting mid-flight. */
export const syncState = (): SyncState => state

/** Watches the queue. Returns the unsubscribe. */
export function watch(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(patch: Partial<SyncState>): void {
  const next = { ...state, ...patch }
  // Identity matters: React re-renders on a new object, and a drain that
  // changes nothing should not repaint the screen a reader is looking at.
  if (
    next.reachable === state.reachable &&
    next.waiting === state.waiting &&
    next.unkept === state.unkept &&
    next.syncing === state.syncing &&
    next.signIn === state.signIn
  ) {
    return
  }
  state = next
  for (const listener of listeners) listener(state)
}

/** Records that the stand answered, or did not. */
export function sawServer(reachable: boolean): void {
  publish({ reachable })
}

/** Re-reads how many changes are waiting, for the indicator. */
export async function countWaiting(): Promise<void> {
  try {
    publish({ waiting: await waiting(), unkept: unkept() })
  } catch {
    // The count is for the indicator; a failure to read it changes nothing
    // about what is waiting.
  }
}

/**
 * Answers that refuse the change itself, rather than the moment.
 *
 * A quote on a piece that no longer exists (404), a body the stand cannot
 * read (400, 422), a change that contradicts what it holds (409), something
 * gone for good (410): retrying any of these forever would block every change
 * behind it, so the change is dropped and the queue moves on. Nothing else
 * is. Dropping is the one outcome that cannot be undone, so an answer not on
 * this list keeps the change rather than guessing at what it meant.
 */
const REFUSED = new Set([400, 404, 409, 410, 422])

/**
 * Answers that refuse the moment, because this device is not signed in.
 *
 * Every write needs a live session. After "Sign out everywhere", or a session
 * that ran out, every queued change answers 401 - and when those were taken
 * as refusals, a journey's worth of reading was thrown away the moment the
 * app opened, before the sign-in screen had even drawn.
 */
const SIGNED_OUT = new Set([401, 403])

/** Why a drain stopped with changes still waiting. */
class Stop extends Error {
  readonly why: 'later' | 'signed-out'

  constructor(why: 'later' | 'signed-out') {
    super(why)
    this.why = why
  }
}

/** What became of a change the stand answered. */
type Delivery = 'landed' | 'refused'

/** Reads a status as the queue has to act on it. */
function judged(status: number): Delivery {
  if (status >= 200 && status < 300) return 'landed'
  if (SIGNED_OUT.has(status)) throw new Stop('signed-out')
  if (REFUSED.has(status)) return 'refused'
  // A 5xx is the stand having a bad moment, and the rest are not ours to
  // interpret: both are worth waiting for.
  throw new Stop('later')
}

/** Fetches, turning a stand out of reach into a stop. */
async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new Stop('later')
  }
}

/**
 * Sends one queued change, saying what became of it.
 *
 * Sent as it was queued. A note carries the text its edit started from, and
 * the stand settles it against the note it holds, in one locked step (see
 * `settle_note` in `src/marks.rs`): read here and written there, the note
 * could change in between, and a phone's clock would still decide.
 */
async function deliver(change: Change): Promise<Delivery> {
  const response = await reach(`/api${change.path}`, {
    method: change.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change.body),
  })
  return judged(response.status)
}

let draining: Promise<void> | null = null

/**
 * Delivers everything waiting, oldest first.
 *
 * Concurrent calls share one drain: the app asks on regaining focus, on the
 * browser reporting a connection, and after each write, and three drains at
 * once would deliver the same change three times.
 */
export function drain(): Promise<void> {
  draining ??= run().finally(() => {
    draining = null
  })
  return draining
}

async function run(): Promise<void> {
  let queued: Change[]
  try {
    queued = await pending()
  } catch {
    return
  }
  if (queued.length === 0) {
    // Nothing waits, so nothing waits for a sign-in either.
    publish({ signIn: false })
    await countWaiting()
    return
  }

  publish({ syncing: true, waiting: queued.length })
  const stale = new Set<string>()
  try {
    for (const change of queued) {
      try {
        await deliver(change)
      } catch (cause) {
        // Everything from here on stays queued: order is the point, and
        // delivering a later change over a stuck earlier one would apply them
        // out of sequence. A stand that wants a sign-in is a stand that
        // answered, so it is not "away".
        if (cause instanceof Stop && cause.why === 'signed-out') {
          publish({ reachable: true, signIn: true })
        } else {
          publish({ reachable: false })
        }
        return
      }
      if (change.id !== undefined) await forget(change.id)
      const read = staleBy(change.path)
      if (read !== null) stale.add(read)
      publish({ waiting: Math.max(0, state.waiting - 1) })
    }
    publish({ reachable: true, signIn: false })
  } finally {
    publish({ syncing: false })
    await countWaiting()
    if (stale.size > 0) rehold(stale)
  }
}
