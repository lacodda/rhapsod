/**
 * What the reader left behind, held for the whole app.
 *
 * Notes and quotes are fetched once and updated locally, like progress: the
 * shelves show which pieces carry a note, the reading view highlights the kept
 * lines, and the quotes page lists them all. Refetching for each of those would
 * put the same rows on the wire three times a screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { commentOnQuote, dropQuote, fetchNotes, fetchQuotes, keepQuote, saveNote, type Note, type Quote } from '@/api'

export interface MarksStore {
  /** Note body by piece id; a piece missing from it has no note. */
  notes: Map<string, string>
  /** Every quote, newest first. */
  quotes: Quote[]
  /** The quotes of one piece, in the order they appear in it. */
  quotesIn: (pieceId: string) => Quote[]
  /** Writes the note on a piece; an empty body clears it. */
  setNote: (pieceId: string, body: string) => void
  /** Keeps a line. */
  keep: (quote: { piece_id: string; paragraph: number; text: string; comment: string | null }) => void
  /** Changes what the reader said about a quote. */
  comment: (id: string, comment: string | null) => void
  /** Removes a quote. */
  drop: (id: string) => void
}

export function useMarks(enabled: boolean): MarksStore {
  const [notes, setNotes] = useState<Note[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void Promise.all([fetchNotes(), fetchQuotes()])
      .then(([loadedNotes, loadedQuotes]) => {
        if (cancelled) return
        setNotes(loadedNotes)
        setQuotes(loadedQuotes)
      })
      // A reader who cannot reach the server still gets to read; what they
      // lose is their own marks, not the library.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const byPiece = useMemo(() => {
    const map = new Map<string, string>()
    for (const note of notes) map.set(note.piece_id, note.body)
    return map
  }, [notes])

  const quotesIn = useCallback(
    (pieceId: string): Quote[] =>
      quotes
        .filter((quote) => quote.piece_id === pieceId)
        // Two lines kept from the same paragraph are ordered by when they were
        // kept. The tiebreak is not on the id: ids are minted on the device
        // and say nothing about order, and subtracting two of them would give
        // NaN - which sorts as "equal" and quietly leaves the order to chance.
        .sort((a, b) => a.paragraph - b.paragraph || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    [quotes],
  )

  const setNote = useCallback((pieceId: string, body: string): void => {
    const trimmed = body.trim()
    void saveNote(pieceId, trimmed)
    setNotes((held) => {
      const without = held.filter((note) => note.piece_id !== pieceId)
      // An emptied note is no note, here as on the server.
      return trimmed.length === 0 ? without : [{ piece_id: pieceId, body: trimmed, updated_at: new Date().toISOString() }, ...without]
    })
  }, [])

  const keep = useCallback((quote: { piece_id: string; paragraph: number; text: string; comment: string | null }): void => {
    // The quote appears at once, with the id the device minted for it. It used
    // to wait for the server to answer with an id - which on a train never
    // came, leaving a reader who marked a line with nothing to show for it.
    setQuotes((held) => [keepQuote(quote), ...held])
  }, [])

  const comment = useCallback((id: string, text: string | null): void => {
    const trimmed = text?.trim() ?? null
    void commentOnQuote(id, trimmed === '' ? null : trimmed)
    setQuotes((held) => held.map((quote) => (quote.id === id ? { ...quote, comment: trimmed === '' ? null : trimmed } : quote)))
  }, [])

  const drop = useCallback((id: string): void => {
    void dropQuote(id)
    setQuotes((held) => held.filter((quote) => quote.id !== id))
  }, [])

  return { notes: byPiece, quotes, quotesIn, setNote, keep, comment, drop }
}
