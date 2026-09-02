/**
 * Today's returns.
 *
 * A card is the piece's title and the line it wants remembered - not its text.
 * The point is to find out whether the piece is still there in your head, and
 * showing the prose would answer the question for you.
 *
 * Two answers, and neither is a grade. "I remember" retires this return and
 * sets the next one; "open" takes you to the piece and keeps its place in the
 * schedule, because going back to read something is not the same as having
 * recalled it.
 */

import type { Card } from '@/api'
import { go } from '@/routing'
import type { ReviewStore } from '@/useReviews'

/** How many returns a piece has: the schedule is a day, a week and a month. */
const STEPS = 3

export function ReviewsScreen({ reviews }: { reviews: ReviewStore }) {
  if (reviews.cards.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-3 py-12">
        <p className="text-lg font-medium text-text">Nothing to recall today.</p>
        <p className="text-sm leading-relaxed text-dim">
          A piece comes back a day after you finish it, then a week later, then a month. Finish something and it
          will be here tomorrow.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Today</h1>
        <p className="text-sm text-dim">
          {reviews.cards.length} {reviews.cards.length === 1 ? 'piece' : 'pieces'} to bring back
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {reviews.cards.map((card) => (
          <CardRow key={card.piece_id} card={card} reviews={reviews} />
        ))}
      </ul>
    </div>
  )
}

/** One card: the line, and the two ways to answer it. */
function CardRow({ card, reviews }: { card: Card; reviews: ReviewStore }) {
  return (
    <li className="mx-3 flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex flex-col gap-2">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-base font-medium leading-snug text-text">{card.title}</span>
          <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-dim">
            {card.step} of {STEPS}
          </span>
        </span>
        {card.one_liner ? (
          <blockquote className="border-l-2 border-accent pl-4 text-lg font-medium leading-snug text-text">
            {card.one_liner}
          </blockquote>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            reviews.answer(card.piece_id, false)
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          I remember
        </button>
        <a
          href={`/read/${card.piece_id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            // Answered before navigating: the card is being opened, which is
            // what keeps its place in the schedule and brings it back
            // tomorrow rather than retiring the step.
            reviews.answer(card.piece_id, true)
            go({ name: 'piece', id: card.piece_id })
          }}
          className="rounded-lg bg-soft px-4 py-2 text-sm font-medium text-dim transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open it
        </a>
      </div>
    </li>
  )
}
