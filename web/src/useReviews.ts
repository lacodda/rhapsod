/**
 * What is worth recalling today, held for the whole app.
 *
 * Fetched once per visit, like progress and marks: the library screen shows a
 * count and the review screen shows the cards, and asking the server twice for
 * the same short list would be a round trip spent on nothing.
 *
 * What is fetched is the whole schedule, and "today" is worked out here, by
 * the device's own calendar. The stand used to pick today's cards itself, and
 * a phone holding that answer for the road carried the day of its last visit
 * home: three days into a trip it offered the cards of the morning it left,
 * and none that came due since.
 *
 * Answering a card removes it from the list at once rather than refetching.
 * The answer is queued like every other change, so on a train the card goes
 * away and the stand hears about it later.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { answerCard, fetchSchedule, type Card } from '@/api'
import { localDay } from '@/calendar'
import { replaySchedule, withQueue } from '@/replay'

export interface ReviewStore {
  /** The cards due today or earlier, soonest first. */
  cards: Card[]
  /** Answers a card: `again` asks for the piece back instead of retiring it. */
  answer: (pieceId: string, again: boolean) => void
}

/**
 * The cards of a schedule that are due by `today`.
 *
 * Everything on or before it, not only on it: a reader who was away for a
 * week comes back to what accumulated rather than to an empty screen that
 * quietly dropped six days of returns. The dates are compared as text, which
 * is exact for `YYYY-MM-DD` and keeps them out of the time zone.
 */
export function dueBy(schedule: Card[], today: string): Card[] {
  return schedule.filter((card) => card.due_on <= today)
}

export function useReviews(enabled: boolean): ReviewStore {
  const [schedule, setSchedule] = useState<Card[]>([])
  const [today, setToday] = useState(localDay)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    // A card answered on the train stays answered when the app is opened
    // again before the stand has heard.
    void withQueue(fetchSchedule).then(({ loaded, queued }) => {
      if (!cancelled) setSchedule(replaySchedule(loaded?.cards ?? [], queued))
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  // An installed app stays alive in the pocket for days. The day is read again
  // whenever the reader comes back to it, or the cards that came due overnight
  // would wait for the app to be closed and opened.
  useEffect(() => {
    const look = (): void => {
      if (document.visibilityState === 'visible') setToday(localDay())
    }
    document.addEventListener('visibilitychange', look)
    return () => {
      document.removeEventListener('visibilitychange', look)
    }
  }, [])

  const answer = useCallback((pieceId: string, again: boolean): void => {
    void answerCard(pieceId, again)
    setSchedule((held) => held.filter((card) => card.piece_id !== pieceId))
  }, [])

  const cards = useMemo(() => dueBy(schedule, today), [schedule, today])
  return { cards, answer }
}
