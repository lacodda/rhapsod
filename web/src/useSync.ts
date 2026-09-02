/**
 * Whether the stand is there, and whether anything is still waiting for it.
 *
 * A thin subscription over the sync module, so a component can render the
 * indicator without knowing how the queue drains.
 */

import { useEffect, useState } from 'react'

import { drain, syncState, watch, countWaiting, type SyncState } from '@/sync'

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
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return state
}
