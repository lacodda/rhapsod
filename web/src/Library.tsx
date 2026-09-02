/**
 * The shelves, and what stands on one.
 *
 * The library screen lists sections; a section lists its pieces. Both are a
 * single column: this is read on a phone first, and a column that works there
 * works on a desktop with a width limit around it.
 */

import type { LibraryIndex, PieceSummary, Section } from '@/api'
import { go } from '@/routing'

/** One piece in a list: the title, and the line it wants remembered. */
function PieceRow({ piece }: { piece: PieceSummary }) {
  return (
    <li>
      <a
        href={`/read/${piece.id}`}
        onClick={(event) => {
          // Plain clicks navigate in the app; a modified click is the reader
          // asking the browser for a new tab, and that has to keep working.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'piece', id: piece.id })
        }}
        className="group flex flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="text-base font-medium text-text group-hover:text-accent">{piece.title}</span>
        {piece.one_liner ? <span className="text-sm leading-snug text-dim">{piece.one_liner}</span> : null}
        <span className="font-mono text-xs text-dim">{minutes(piece.words)} min</span>
      </a>
    </li>
  )
}

/** Reading time at a calm 180 words a minute, rounded up to a whole minute. */
export function minutes(words: number): number {
  return Math.max(1, Math.round(words / 180))
}

/** One shelf on the library screen. */
function SectionRow({ section }: { section: Section }) {
  return (
    <li>
      <a
        href={`/section/${section.id}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'section', section: section.id })
        }}
        className="group flex items-baseline justify-between gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-baseline gap-3">
          {section.number === null ? null : (
            <span className="font-mono text-xs tabular-nums text-dim">{String(section.number).padStart(2, '0')}</span>
          )}
          <span className="text-base font-medium text-text group-hover:text-accent">{section.title}</span>
        </span>
        <span className="font-mono text-xs tabular-nums text-dim">{section.pieces}</span>
      </a>
    </li>
  )
}

/** The library: every shelf, in reading order. */
export function LibraryScreen({ library }: { library: LibraryIndex }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Library</h1>
        <p className="mt-1 text-sm text-dim">
          {library.pieces.length} pieces on {library.sections.length} shelves
        </p>
      </header>
      <ul className="flex flex-col">
        {library.sections.map((section) => (
          <SectionRow key={section.id} section={section} />
        ))}
      </ul>
    </div>
  )
}

/** One shelf: its pieces, in reading order. */
export function SectionScreen({ library, section }: { library: LibraryIndex; section: string }) {
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
          <PieceRow key={piece.id} piece={piece} />
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
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'library' })
        }}
        className="mt-2 text-sm text-accent underline underline-offset-4"
      >
        Back to the library
      </a>
    </div>
  )
}
