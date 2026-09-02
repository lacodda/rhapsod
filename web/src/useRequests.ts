/**
 * What could be written, and what the reader asked for.
 *
 * The plan is fetched once and held: it is a couple of thousand titles that
 * change only when the author republishes, and asking again per screen would
 * put the same list on the wire for nothing.
 *
 * Asking is optimistic and queued, like every other change the reader makes:
 * the decision to want something happens while reading, which is usually
 * nowhere near the stand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { askFor, fetchRequests, fetchTopics, withdrawRequest, type Plan, type Request, type Topic } from '@/api'

export interface RequestStore {
  /** The published plan. Empty shelves when none was published. */
  plan: Plan
  /** Everything asked for, newest first. */
  asked: Request[]
  /** Topic ids that have been asked for, for marking the list. */
  wanted: Set<string>
  /** Asks, or takes the request back - whichever the tap means. */
  toggle: (topic: Topic) => void
}

const NOTHING: Plan = { shelves: [] }

export function useRequests(enabled: boolean): RequestStore {
  const [plan, setPlan] = useState<Plan>(NOTHING)
  const [asked, setAsked] = useState<Request[]>([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void Promise.all([fetchTopics(), fetchRequests()])
      .then(([published, requested]) => {
        if (cancelled) return
        setPlan(published)
        setAsked(requested)
      })
      // A reader who cannot reach the stand still gets to read; what they
      // lose is the list of what could be written.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const wanted = useMemo(() => new Set(asked.map((request) => request.topic_id)), [asked])

  /**
   * One tap on a topic.
   *
   * Tapping something already asked for takes the request back: the gesture
   * that made it is the one that undoes it, which is what a reader expects.
   */
  const toggle = useCallback(
    (topic: Topic): void => {
      setAsked((held) => {
        if (held.some((request) => request.topic_id === topic.id)) {
          void withdrawRequest(topic.id)
          return held.filter((request) => request.topic_id !== topic.id)
        }
        void askFor(topic.id)
        return [
          { topic_id: topic.id, title: topic.title, section: topic.section, asked_at: new Date().toISOString() },
          ...held,
        ]
      })
    },
    [],
  )

  return { plan, asked, wanted, toggle }
}
