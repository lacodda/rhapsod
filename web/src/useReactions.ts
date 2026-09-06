/**
 * How the pieces landed, held for the whole app.
 *
 * The same shape as bookmarks and for the same reason: a reaction shows in the
 * reader and in the report, and asking the server per piece would put the same
 * handful of rows on the wire once a line.
 *
 * Reacting is optimistic. A piece is reacted to where it is read - usually
 * somewhere the stand cannot be reached - and a reaction that waited for the
 * network would be one that vanished on a train.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { clearReaction, fetchReactions, setReaction, type Reaction, type ReactionKind } from '@/api'

/**
 * What one tap on a kind means, given what the piece already carries.
 *
 * Pulled out of the hook so it can be tested as the rule it is: tapping the
 * kind a piece already has takes the reaction off - the gesture that put it
 * there removes it - and tapping the other kind changes it rather than adding
 * a second, because a piece has one reaction.
 */
export function tapMeans(current: ReactionKind | undefined, tapped: ReactionKind): 'clear' | ReactionKind {
  return current === tapped ? 'clear' : tapped
}

export interface ReactionStore {
  /** Kind by piece id; a piece missing from it has no reaction. */
  kinds: Map<string, ReactionKind>
  /** Every reaction, newest first. */
  all: Reaction[]
  /** Reacts, unreacts, or changes kind - whichever the tap means. */
  toggle: (pieceId: string, kind: ReactionKind) => void
}

export function useReactions(enabled: boolean): ReactionStore {
  const [all, setAll] = useState<Reaction[]>([])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    void fetchReactions()
      .then((felt) => {
        if (!cancelled) setAll(felt)
      })
      // A reader who cannot reach the stand still gets to read; what they lose
      // is what they already said, not the library.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])

  const kinds = useMemo(() => {
    const map = new Map<string, ReactionKind>()
    for (const reaction of all) map.set(reaction.piece_id, reaction.kind)
    return map
  }, [all])

  const toggle = useCallback(
    (pieceId: string, kind: ReactionKind): void => {
      if (tapMeans(kinds.get(pieceId), kind) === 'clear') {
        void clearReaction(pieceId)
        setAll((held) => held.filter((reaction) => reaction.piece_id !== pieceId))
      } else {
        void setReaction(pieceId, kind)
        setAll((held) => [
          { piece_id: pieceId, kind, felt_at: new Date().toISOString() },
          ...held.filter((reaction) => reaction.piece_id !== pieceId),
        ])
      }
    },
    [kinds],
  )

  return { kinds, all, toggle }
}
