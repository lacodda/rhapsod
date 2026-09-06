/**
 * What the reader tells the author, smaller than a note.
 *
 * A note is a paragraph the reader sits down to write, and most of what is
 * worth saying never reaches that size. These are the gestures that do: a tap
 * that says how a piece landed, and a selection that says a word is misspelt.
 *
 * The colours come from the line's vocabulary. Tailwind's stock palette is
 * dropped from the dowel theme and compiles to nothing, so a button painted
 * `text-emerald-500` would be an invisible button.
 */

import { useEffect, useState } from 'react'

import { fetchReport, REACTION_KINDS, type Abandoned, type ReactionKind, type Report } from '@/api'
import { SparkIcon, ThumbIcon } from '@/Icons'
import { go, href } from '@/routing'
import type { ReactionStore } from '@/useReactions'

/**
 * What each reaction is called and how it looks.
 *
 * Two, and they are not degrees of one scale: "it works" and "it did something
 * to me" are different statements, which is why they get different shapes
 * rather than one shape twice. `struck` wears the product's own accent because
 * it is the thing the whole library is written for.
 */
export const REACTIONS: Record<
  ReactionKind,
  { label: string; Icon: (props: { size?: number }) => React.ReactElement; ring: string }
> = {
  good: { label: 'Good', Icon: ThumbIcon, ring: 'text-good' },
  struck: { label: 'Struck me', Icon: SparkIcon, ring: 'text-accent' },
}

/**
 * The pair offered at the end of a piece.
 *
 * Both always shown rather than hidden behind a menu: there are two, and a
 * reaction that takes two taps is a reaction that does not get made.
 */
export function ReactionBar({ pieceId, reactions }: { pieceId: string; reactions: ReactionStore }) {
  const current = reactions.kinds.get(pieceId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {REACTION_KINDS.map((kind) => {
        const { label, Icon, ring } = REACTIONS[kind]
        const chosen = current === kind
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={chosen}
            onClick={() => {
              reactions.toggle(pieceId, kind)
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              chosen ? `border-current ${ring}` : 'border-line text-dim hover:border-line-2 hover:text-text'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * What the reading looked like, for the author.
 *
 * The reader and the author are one person here, which is the reason this
 * screen states what it is for. It is not a scoreboard: the numbers along the
 * top are context, and the list below them is the point - the pieces that lost
 * the reader, and how far in.
 */
export function ReportScreen() {
  const [report, setReport] = useState<Report | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchReport()
      .then((seen) => {
        if (!cancelled) setReport(seen)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return <p className="px-3 py-12 text-sm text-dim">The report needs the stand, and it cannot be reached.</p>
  }
  if (!report) {
    return <p className="px-3 py-12 text-sm text-dim">Counting…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">The reading</h1>
        <p className="text-sm leading-relaxed text-dim">
          Nothing here is collected on purpose: every number is read from what the reading already recorded.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2 px-3">
        <Tally label="Read" value={report.read} />
        <Tally label="Started" value={report.unfinished} />
        <Tally label="Waiting" value={report.untouched} />
        <Tally label="Good" value={report.good} />
        <Tally label="Struck" value={report.struck} />
        <Tally label="Typos" value={report.typos} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="px-3 text-sm font-medium text-text">Where they were put down</h2>
        {report.abandoned.length === 0 ? (
          <p className="px-3 pb-8 text-sm leading-relaxed text-dim">
            Nothing was put down and left. A piece counts here once it has been a day since the reader was last in it -
            before that it is simply being read.
          </p>
        ) : (
          <ul className="flex flex-col">
            {report.abandoned.map((piece) => (
              <Stopped key={piece.piece_id} piece={piece} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** One number with its name. */
function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line px-3 py-2">
      <span className="font-mono text-lg text-text">{value}</span>
      <span className="text-xs text-dim">{label}</span>
    </div>
  )
}

/**
 * One piece the reader stopped in, with a bar showing how far.
 *
 * The bar is the whole reason this is a screen rather than a list of titles: a
 * piece given up on two paragraphs in and one given up on at the last are the
 * same row of text and completely different problems.
 */
function Stopped({ piece }: { piece: Abandoned }) {
  const percent = Math.round(piece.through * 100)
  return (
    <li>
      <a
        href={href({ name: 'piece', id: piece.piece_id })}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'piece', id: piece.piece_id })
        }}
        className="flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[0.9375rem] text-text">{piece.title}</span>
          <span className="shrink-0 font-mono text-xs text-dim">{percent}%</span>
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-soft">
          <span className="block h-full rounded-full bg-dim" style={{ width: `${percent}%` }} />
        </span>
        <span className="font-mono text-xs text-faint">
          paragraph {piece.paragraph} of {piece.paragraphs}
        </span>
      </a>
    </li>
  )
}
