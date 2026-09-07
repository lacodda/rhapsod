/**
 * The journal: what the reading adds up to over time.
 *
 * The library screen counts what has been read; this is *when*. Months first,
 * because a month is the unit a reader thinks in - "a good month" - and then
 * the days, each with what was in hand. Nothing here is a goal or a streak:
 * the numbers say what happened, and the reader decides what that means.
 */

import { useEffect, useState } from 'react'

import { fetchJournal, type Journal, type Month, type Opened } from '@/api'
import { byDay, clockOffset, dayLabel, monthLabel, timeLabel } from '@/calendar'
import { go, href } from '@/routing'

export function JournalScreen() {
  const [journal, setJournal] = useState<Journal | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchJournal(clockOffset())
      .then((kept) => {
        if (!cancelled) setJournal(kept)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return <p className="px-3 py-12 text-sm text-dim">The journal needs the stand, and it cannot be reached.</p>
  }
  if (!journal) {
    return <p className="px-3 py-12 text-sm text-dim">Turning the pages…</p>
  }

  const days = byDay(journal.history)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Journal</h1>
        <p className="text-sm text-dim">What the reading adds up to, month by month.</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="px-3 text-sm font-medium text-text">Months</h2>
        {journal.months.length === 0 ? (
          <p className="px-3 text-sm leading-relaxed text-dim">
            Nothing finished yet. A month appears here with the first piece read in it.
          </p>
        ) : (
          <Months months={journal.months} />
        )}
        <p className="px-3 font-mono text-xs text-dim">
          {journal.scheduled} in the schedule · {journal.recalled} carried through
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="px-3 text-sm font-medium text-text">Openings</h2>
        {days.length === 0 ? (
          <p className="px-3 pb-8 text-sm leading-relaxed text-dim">
            Nothing opened yet. Every piece you open is written here with the day and the hour.
          </p>
        ) : (
          days.map((day) => (
            <div key={day.day} className="flex flex-col gap-1">
              <h3 className="px-3 pt-2 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-dim">
                {dayLabel(day.day)}
              </h3>
              <ul className="flex flex-col">
                {day.opened.map((line) => (
                  <Line key={line.piece_id} line={line} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/**
 * The months as a table, newest first.
 *
 * A table rather than tiles: the point is comparing one month to the next,
 * and three numbers in a row read as a row.
 */
function Months({ months }: { months: Month[] }) {
  return (
    <div className="mx-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line font-mono text-[0.625rem] uppercase tracking-[0.14em] text-dim">
            <th scope="col" className="px-3 py-2 text-left font-normal">
              Month
            </th>
            <th scope="col" className="px-3 py-2 text-right font-normal">
              Read
            </th>
            <th scope="col" className="px-3 py-2 text-right font-normal">
              Words
            </th>
            <th scope="col" className="px-3 py-2 text-right font-normal">
              Recalled
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.month} className="border-b border-line last:border-b-0">
              <td className="px-3 py-2 text-text">{monthLabel(month.month)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-text">{month.read}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-text">{month.words.toLocaleString('en-US')}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-text">{month.recalled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One piece on one day: its title, the hour, and how many times if more than once. */
function Line({ line }: { line: Opened }) {
  return (
    <li>
      <a
        href={href({ name: 'piece', id: line.piece_id })}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'piece', id: line.piece_id })
        }}
        className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="min-w-0 truncate text-[0.9375rem] text-text">{line.title}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-dim">
          {timeLabel(line.opened_at)}
          {line.times > 1 ? ` ×${line.times}` : ''}
        </span>
      </a>
    </li>
  )
}
