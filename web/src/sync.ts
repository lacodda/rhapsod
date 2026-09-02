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

import { forget, pending, waiting, type Change } from '@/queue'

/** What the app shows about the queue. */
export interface SyncState {
  /** True once a request has reached the stand and not since failed. */
  reachable: boolean
  /** Changes still waiting to be delivered. */
  waiting: number
  /** True while a drain is running. */
  syncing: boolean
}

type Listener = (state: SyncState) => void

let state: SyncState = { reachable: true, waiting: 0, syncing: false }
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
  if (next.reachable === state.reachable && next.waiting === state.waiting && next.syncing === state.syncing) return
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
    publish({ waiting: await waiting() })
  } catch {
    // A browser that will not open IndexedDB - a private window in some
    // browsers - still reads; it just cannot promise to deliver later.
  }
}

/** Sends one queued change, saying whether it landed. */
async function deliver(change: Change): Promise<boolean> {
  const response = await fetch(`/api${change.path}`, {
    method: change.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change.body),
  })

  // A 4xx is the server refusing this change, not the stand being away: a
  // quote on a piece that no longer exists, a comment on one already removed.
  // Retrying it forever would block every change behind it, so it is dropped
  // and the queue moves on. A 5xx is the server having a bad moment, and that
  // is worth waiting for.
  if (response.status >= 500) throw new Error(`the stand answered ${response.status}`)
  return true
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
    await countWaiting()
    return
  }

  publish({ syncing: true, waiting: queued.length })
  try {
    for (const change of queued) {
      try {
        await deliver(change)
      } catch {
        // The stand is away or having a bad moment. Everything after this
        // stays queued: order is the point, and delivering a later change
        // over a stuck earlier one would apply them out of sequence.
        publish({ reachable: false })
        return
      }
      if (change.id !== undefined) await forget(change.id)
      publish({ waiting: Math.max(0, state.waiting - 1) })
    }
    publish({ reachable: true })
  } finally {
    publish({ syncing: false })
    await countWaiting()
  }
}
