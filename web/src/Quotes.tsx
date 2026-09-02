/**
 * Everything the reader kept, in one place.
 *
 * The page a song gets written from: lines pulled out of thirty pieces, each
 * one a tap away from the paragraph it came from.
 */

import type { LibraryIndex } from '@/api'
import { Empty } from '@/Library'
import { go } from '@/routing'
import type { MarksStore } from '@/useMarks'

/** "1 line from 1 piece", and every other combination of the two counts. */
export function summary(lines: number, pieces: number): string {
  const line = lines === 1 ? '1 line' : `${lines} lines`
  const piece = pieces === 1 ? '1 piece' : `${pieces} pieces`
  return `${line} from ${piece}`
}

export function QuotesScreen({ library, marks }: { library: LibraryIndex; marks: MarksStore }) {
  if (marks.quotes.length === 0) {
    return (
      <Empty
        title="Nothing kept yet."
        detail="Select a line while reading and keep it; every line you keep shows up here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Kept lines</h1>
        <p className="mt-1 text-sm text-dim">{summary(marks.quotes.length, new Set(marks.quotes.map((quote) => quote.piece_id)).size)}</p>
      </header>

      <ul className="flex flex-col gap-6 px-3">
        {marks.quotes.map((quote) => {
          const piece = library.pieces.find((candidate) => candidate.id === quote.piece_id)
          return (
            <li key={quote.id} className="flex flex-col gap-2 border-l-2 border-accent/40 pl-4">
              <p className="text-pretty break-words text-[1.0625rem] leading-relaxed text-text">{quote.text}</p>
              {quote.comment ? <p className="text-sm leading-relaxed text-dim">{quote.comment}</p> : null}
              <a
                href={`/read/${quote.piece_id}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  go({ name: 'piece', id: quote.piece_id })
                }}
                className="self-start font-mono text-xs text-dim hover:text-accent"
              >
                {/* A quote whose piece is gone from the library still reads;
                    it names what it came from rather than vanishing. */}
                {piece?.title ?? quote.piece_id}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
