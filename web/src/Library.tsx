/**
 * The shelves, and what stands on one.
 *
 * The library screen leads with what the reader was in the middle of, then
 * lists the shelves; a section lists its pieces. Both are a single column:
 * this is read on a phone first, and a column that works there works on a
 * desktop with a width limit around it.
 */

import type { LibraryIndex, PieceSummary, Section } from '@/api'
import { go } from '@/routing'
import type { ProgressStore } from '@/useProgress'

/** Reading time at a calm 180 words a minute, rounded up to a whole minute. */
export function minutes(words: number): number {
  return Math.max(1, Math.round(words / 180))
}

/** A link that navigates in the app but still opens in a new tab on demand. */
function navigate(event: React.MouseEvent, to: Parameters<typeof go>[0]): void {
  // A modified click is the reader asking the browser for a new tab, and that
  // has to keep working.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  go(to)
}

/** One piece in a list: the title, the line it wants remembered, and how far the reader got. */
function PieceRow({ piece, progress }: { piece: PieceSummary; progress: ProgressStore }) {
  const state = progress.states.get(piece.id)
  return (
    <li>
      <a
        href={`/read/${piece.id}`}
        onClick={(event) => {
          navigate(event, { name: 'piece', id: piece.id })
        }}
        className="group flex flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-baseline gap-2">
          <span className={`text-base font-medium group-hover:text-accent ${state?.status === 'read' ? 'text-dim' : 'text-text'}`}>
            {piece.title}
          </span>
          {state?.status === 'read' ? <Mark label="read" /> : null}
          {state?.status === 'reading' ? <Mark label="reading" accent /> : null}
        </span>
        {piece.one_liner ? <span className="text-sm leading-snug text-dim">{piece.one_liner}</span> : null}
        <span className="font-mono text-xs text-dim">{minutes(piece.words)} min</span>
      </a>
    </li>
  )
}

/** A small word carrying a state, so a glance down a list reads as one. */
function Mark({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] ${
        accent ? 'bg-accent/15 text-accent' : 'bg-soft text-dim'
      }`}
    >
      {label}
    </span>
  )
}

/** One shelf on the library screen, with how much of it is behind the reader. */
function SectionRow({ section, read }: { section: Section; read: number }) {
  return (
    <li>
      <a
        href={`/section/${section.id}`}
        onClick={(event) => {
          navigate(event, { name: 'section', section: section.id })
        }}
        className="group flex items-baseline justify-between gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-baseline gap-3">
          {section.number === null ? null : (
            <span className="font-mono text-xs tabular-nums text-dim">{String(section.number).padStart(2, '0')}</span>
          )}
          <span className={`text-base font-medium group-hover:text-accent ${read === section.pieces ? 'text-dim' : 'text-text'}`}>
            {section.title}
          </span>
        </span>
        <span className="font-mono text-xs tabular-nums text-dim">
          {read > 0 ? `${read}/${section.pieces}` : section.pieces}
        </span>
      </a>
    </li>
  )
}

/** The library: what to continue, what it adds up to, and every shelf. */
export function LibraryScreen({ library, progress }: { library: LibraryIndex; progress: ProgressStore }) {
  const readBySection = new Map<string, number>()
  for (const piece of library.pieces) {
    if (progress.states.get(piece.id)?.status === 'read') {
      readBySection.set(piece.section, (readBySection.get(piece.section) ?? 0) + 1)
    }
  }

  const resume = progress.continueWith === null ? null : (library.pieces.find((piece) => piece.id === progress.continueWith) ?? null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Library</h1>
        <p className="text-sm text-dim">
          {library.pieces.length} pieces on {library.sections.length} shelves
        </p>
      </header>

      {resume ? <Resume piece={resume} /> : null}

      <Stats stats={progress.stats} />

      <ul className="flex flex-col">
        {library.sections.map((section) => (
          <SectionRow key={section.id} section={section} read={readBySection.get(section.id) ?? 0} />
        ))}
      </ul>
    </div>
  )
}

/** The one thing a reader most often wants from this screen. */
function Resume({ piece }: { piece: PieceSummary }) {
  return (
    <a
      href={`/read/${piece.id}`}
      onClick={(event) => {
        navigate(event, { name: 'piece', id: piece.id })
      }}
      className="mx-3 flex flex-col gap-2 rounded-xl border border-line p-4 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Continue</span>
      <span className="text-lg font-medium leading-snug text-text">{piece.title}</span>
      {piece.one_liner ? <span className="text-sm leading-snug text-dim">{piece.one_liner}</span> : null}
    </a>
  )
}

/** What the reader has read. Nothing until there is something to show. */
function Stats({ stats }: { stats: ProgressStore['stats'] }) {
  if (stats.read === 0) return null
  return (
    <dl className="mx-3 flex gap-6 border-y border-line py-3 font-mono text-xs text-dim">
      <div className="flex gap-1.5">
        <dt>read</dt>
        <dd className="tabular-nums text-text">{stats.read}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt>words</dt>
        <dd className="tabular-nums text-text">{stats.words.toLocaleString('en-US')}</dd>
      </div>
      {stats.streak > 1 ? (
        <div className="flex gap-1.5">
          <dt>streak</dt>
          <dd className="tabular-nums text-text">{stats.streak} days</dd>
        </div>
      ) : null}
    </dl>
  )
}

/** One shelf: its pieces, in reading order. */
export function SectionScreen({ library, section, progress }: { library: LibraryIndex; section: string; progress: ProgressStore }) {
  const shelf = library.sections.find((candidate) => candidate.id === section)
  const pieces = library.pieces.filter((piece) => piece.section === section)

  if (!shelf) {
    return <Empty title="There is no such shelf." />
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{shelf.title}</h1>
        <p className="mt-1 text-sm text-dim">{pieces.length === 1 ? '1 piece' : `${pieces.length} pieces`}</p>
      </header>
      <ul className="flex flex-col">
        {pieces.map((piece) => (
          <PieceRow key={piece.id} piece={piece} progress={progress} />
        ))}
      </ul>
    </div>
  )
}

/** What a screen shows when there is nothing to show. */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-12">
      <p className="text-base text-text">{title}</p>
      {detail ? <p className="text-sm text-dim">{detail}</p> : null}
      <a
        href="/"
        onClick={(event) => {
          navigate(event, { name: 'library' })
        }}
        className="mt-2 text-sm text-accent underline underline-offset-4"
      >
        Back to the library
      </a>
    </div>
  )
}
