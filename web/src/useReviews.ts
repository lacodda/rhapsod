/**
 * What is worth recalling today, held for the whole app.
 *
 * Fetched once per visit, like progress and marks: the library screen shows a
 * count and the review screen shows the cards, and asking the server twice for
 * the same short list would be a round trip spent on nothing.
 *
 * Answering a card removes it from the list at once rather than refetching.
 * The answer is queued like every other change, so on a train the card goes
 * away and the stand hears about it later.
 */

import { useCallback, useEffect, useState } from 'react'

import { answerCard, fetchDue, type Card } from '@/api'

export interface ReviewStore {
  /** The cards due today, in the order the server offered them. */
  cards: Card[]
  /** Answers a card: `again` asks for the piece back instead of retiring it. */
  answer: (pieceId: string, again: boolean) => void
}

export function useReviews(enabled: boolean): ReviewStore {
  const [cards, setCards] = useState<Card[]>([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void fetchDue()
      .then((answer) => {
        if (!cancelled) setCards(answer.due)
      })
      // A reader who cannot reach the server still gets to read; what they
      // lose is today's cards, not the library.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const answer = useCallback((pieceId: string, again: boolean): void => {
    void answerCard(pieceId, again)
    setCards((held) => held.filter((card) => card.piece_id !== pieceId))
  }, [])

  return { cards, answer }
}
