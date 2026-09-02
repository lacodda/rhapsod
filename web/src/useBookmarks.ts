/**
 * The pieces the reader marked, held for the whole app.
 *
 * Fetched once and updated locally, like progress and marks: a colour appears
 * on every row of every shelf and in the drawer, and asking the server per
 * piece would put the same handful of rows on the wire once a line.
 *
 * Marking is optimistic. The change is queued and shown at once, because a
 * piece is marked where it is read - usually somewhere the stand cannot be
 * reached - and a mark that waited for the network would be a mark that
 * vanished on a train.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { clearBookmark, fetchBookmarks, setBookmark, type Bookmark, type BookmarkKind } from '@/api'

export interface BookmarkStore {
  /** Kind by piece id; a piece missing from it is unmarked. */
  kinds: Map<string, BookmarkKind>
  /** Every bookmark, newest first. */
  all: Bookmark[]
  /** Marks a piece, or changes its kind. */
  mark: (pieceId: string, kind: BookmarkKind) => void
  /** Takes the mark off. */
  unmark: (pieceId: string) => void
  /** Marks, unmarks, or changes kind - whichever the tap means. */
  toggle: (pieceId: string, kind: BookmarkKind) => void
}

export function useBookmarks(enabled: boolean): BookmarkStore {
  const [all, setAll] = useState<Bookmark[]>([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void fetchBookmarks()
      .then((marked) => {
        if (!cancelled) setAll(marked)
      })
      // A reader who cannot reach the stand still gets to read; what they
      // lose is the colours, not the library.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const kinds = useMemo(() => {
    const map = new Map<string, BookmarkKind>()
    for (const bookmark of all) map.set(bookmark.piece_id, bookmark.kind)
    return map
  }, [all])

  const mark = useCallback((pieceId: string, kind: BookmarkKind): void => {
    void setBookmark(pieceId, kind)
    setAll((held) => [
      { piece_id: pieceId, kind, marked_at: new Date().toISOString() },
      ...held.filter((bookmark) => bookmark.piece_id !== pieceId),
    ])
  }, [])

  const unmark = useCallback((pieceId: string): void => {
    void clearBookmark(pieceId)
    setAll((held) => held.filter((bookmark) => bookmark.piece_id !== pieceId))
  }, [])

  /**
   * What one tap on a kind means.
   *
   * Tapping the kind a piece already has takes the mark off - the same
   * gesture that put it there removes it, which is what a reader expects of
   * a toggle. Tapping a different kind changes it rather than adding a
   * second, because a piece has one mark.
   */
  const toggle = useCallback(
    (pieceId: string, kind: BookmarkKind): void => {
      if (kinds.get(pieceId) === kind) {
        unmark(pieceId)
      } else {
        mark(pieceId, kind)
      }
    },
    [kinds, mark, unmark],
  )

  return { kinds, all, mark, unmark, toggle }
}
