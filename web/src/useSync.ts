/**
 * Whether the stand is there, and whether anything is still waiting for it.
 *
 * A thin subscription over the sync module, so a component can render the
 * indicator without knowing how the queue drains.
 */

import { useEffect, useState } from 'react'

import { drain, syncState, watch, countWaiting, type SyncState } from '@/sync'

/**
 * How often a waiting queue is tried again while the app is on screen.
 *
 * The other moments to try - the app opening, the browser reporting a
 * connection, the reader coming back to it - all need something to happen. A
 * reader who walks in the door with the app already open, and joins the home
 * Wi-Fi without the browser saying so, is in none of them. A minute is soon
 * enough not to be noticed and rare enough to cost nothing on a train.
 */
const RETRY_MS = 60_000

export function useSync(): SyncState {
  const [state, setState] = useState<SyncState>(syncState)

  useEffect(() => {
    const stop = watch(setState)
    // What is already waiting from a previous visit: the queue outlives the
    // page, and a reader coming home should see it go down rather than have
    // to make one more change to trigger a drain.
    void countWaiting()
    void drain()

    // The moments worth trying again: the browser noticing a connection, and
    // the reader coming back to the tab - which on a phone is what happens
    // when they walk in the door and open the app.
    const retry = (): void => {
      void drain()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') retry()
    }
    // And, while something is waiting and the app is in front of the reader,
    // every so often for no reason at all. Nothing is asked of the stand when
    // the queue is empty or the app is in the background.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && syncState().waiting > 0) retry()
    }, RETRY_MS)
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return state
}
