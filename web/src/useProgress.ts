/**
 * What the reader has read, held for the whole app.
 *
 * One fetch, then local updates: the screens need it constantly - a counter on
 * every shelf, a mark on every row - and refetching after each paragraph would
 * put the library on the wire every few seconds of reading.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchProgress, report, type Progress, type ReadingState } from '@/api'

export interface ProgressStore {
  /** State by piece id; a piece missing from it has not been opened. */
  states: Map<string, ReadingState>
  stats: Progress['stats']
  /** The piece to continue, if there is one. */
  continueWith: string | null
  /** Records the paragraph the reader is looking at. */
  atParagraph: (id: string, paragraph: number) => void
  /** Finishes a piece, or puts a finished one back. */
  setRead: (id: string, read: boolean) => void
  /** Records that a piece was opened. */
  opened: (id: string) => void
}

const EMPTY_STATS = { read: 0, words: 0, streak: 0 }

/**
 * Applies one change to the held progress.
 *
 * A pure function over the previous value, so the callbacks below never depend
 * on the state they also write. A callback that reads and writes the same value
 * gets a new identity on every write, and an effect calling it loops - which is
 * what the reading view did on its first live run, until the browser ran out of
 * sockets.
 */
function applied(held: Progress | null, id: string, patch: Partial<ReadingState>): Progress {
  const pieces = held?.pieces ?? []
  const existing = pieces.find((state) => state.piece_id === id)
  const updated: ReadingState = {
    piece_id: id,
    status: 'reading',
    paragraph: 0,
    read_at: null,
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  return {
    pieces: [...pieces.filter((state) => state.piece_id !== id), updated],
    stats: held?.stats ?? EMPTY_STATS,
    continue_with: updated.status === 'reading' ? id : (held?.continue_with ?? null),
  }
}

export function useProgress(enabled: boolean): ProgressStore {
  const [progress, setProgress] = useState<Progress | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void fetchProgress()
      .then((loaded) => {
        if (!cancelled) setProgress(loaded)
      })
      // A reader who cannot reach the server still gets to read; what they
      // lose is the marks on the shelves, not the library.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const states = useMemo(() => {
    const map = new Map<string, ReadingState>()
    for (const state of progress?.pieces ?? []) map.set(state.piece_id, state)
    return map
  }, [progress])

  const atParagraph = useCallback((id: string, paragraph: number): void => {
    setProgress((held) => {
      // The server keeps the furthest paragraph, so a stale report cannot move
      // the reader backwards; the local copy follows the same rule, and a
      // report that would go backwards is not sent at all.
      const known = held?.pieces.find((state) => state.piece_id === id)?.paragraph ?? 0
      if (paragraph <= known) return held
      report(id, { paragraph })
      return applied(held, id, { paragraph })
    })
  }, [])

  const setRead = useCallback((id: string, read: boolean): void => {
    report(id, { read })
    setProgress((held) => applied(held, id, { status: read ? 'read' : 'reading', read_at: read ? new Date().toISOString() : null }))
  }, [])

  const opened = useCallback((id: string): void => {
    setProgress((held) => {
      // Opening a finished piece does not unfinish it, here or on the server.
      if (held?.pieces.find((state) => state.piece_id === id)?.status === 'read') return held
      report(id, {})
      return applied(held, id, { status: 'reading' })
    })
  }, [])

  return {
    states,
    stats: progress?.stats ?? EMPTY_STATS,
    continueWith: progress?.continue_with ?? null,
    atParagraph,
    setRead,
    opened,
  }
}
