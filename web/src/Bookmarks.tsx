/**
 * Marking a piece to find it again.
 *
 * Four kinds, fixed. A reader marking a piece means one of a small number of
 * things, and a set they could define would buy a settings screen in exchange
 * for flexibility one reader rarely wants.
 *
 * The colours come from the line's vocabulary, not from a palette of their
 * own. Tailwind's stock colours are dropped from the dowel theme and compile
 * to nothing - a dot painted `bg-emerald-500` would be an invisible dot - and
 * the four semantic tokens happen to be exactly four, which is how many kinds
 * there are. They also follow the theme into light mode, which a hex value
 * would not.
 */

import { BOOKMARK_KINDS, type Bookmark, type BookmarkKind, type LibraryIndex } from '@/api'
import { minutes } from '@/Library'
import { go } from '@/routing'
import type { BookmarkStore } from '@/useBookmarks'

/** What each kind is called and how it looks. */
export const KINDS: Record<BookmarkKind, { label: string; glyph: string; dot: string; ring: string }> = {
  loved: { label: 'Loved', glyph: '★', dot: 'bg-good', ring: 'text-good' },
  return: { label: 'Come back', glyph: '↺', dot: 'bg-info', ring: 'text-info' },
  song: { label: 'For a song', glyph: '♪', dot: 'bg-warn', ring: 'text-warn' },
  reread: { label: 'Read again', glyph: '↻', dot: 'bg-dim', ring: 'text-dim' },
}

/** The dot shown beside a piece that carries a mark. */
export function BookmarkDot({ kind }: { kind: BookmarkKind }) {
  const { label, dot } = KINDS[kind]
  return <span aria-label={label} title={label} className={`inline-block size-2 shrink-0 rounded-full ${dot}`} />
}

/**
 * The row of four, offered at the end of a piece.
 *
 * All four are always shown rather than hidden behind a menu: there are only
 * four, and a mark that takes two taps is a mark that does not get made.
 */
export function BookmarkBar({ pieceId, bookmarks }: { pieceId: string; bookmarks: BookmarkStore }) {
  const current = bookmarks.kinds.get(pieceId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BOOKMARK_KINDS.map((kind) => {
        const { label, glyph, ring } = KINDS[kind]
        const chosen = current === kind
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={chosen}
            onClick={() => {
              bookmarks.toggle(pieceId, kind)
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              chosen ? `border-current ${ring}` : 'border-line text-dim hover:border-line-2 hover:text-text'
            }`}
          >
            <span aria-hidden>{glyph}</span>
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Everything the reader marked, filtered by kind. */
export function BookmarksScreen({
  library,
  bookmarks,
  kind,
}: {
  library: LibraryIndex
  bookmarks: BookmarkStore
  /** `null` shows every kind. */
  kind: BookmarkKind | null
}) {
  const shown = kind === null ? bookmarks.all : bookmarks.all.filter((bookmark) => bookmark.kind === kind)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Bookmarks</h1>
        <div className="flex flex-wrap gap-2">
          <Filter label="All" count={bookmarks.all.length} active={kind === null} to={null} />
          {BOOKMARK_KINDS.map((candidate) => (
            <Filter
              key={candidate}
              label={KINDS[candidate].label}
              count={bookmarks.all.filter((bookmark) => bookmark.kind === candidate).length}
              active={kind === candidate}
              to={candidate}
            />
          ))}
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="px-3 py-8 text-sm leading-relaxed text-dim">
          Nothing marked yet. At the end of a piece there is a row of four marks - one tap and it is here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((bookmark) => (
            <Row key={bookmark.piece_id} bookmark={bookmark} library={library} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One filter chip. A kind nobody has used is not offered. */
function Filter({ label, count, active, to }: { label: string; count: number; active: boolean; to: BookmarkKind | null }) {
  if (count === 0 && to !== null) return null
  return (
    <button
      type="button"
      onClick={() => {
        go(to === null ? { name: 'bookmarks' } : { name: 'bookmarks', kind: to })
      }}
      className={`rounded-lg px-3 py-1 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active ? 'bg-soft text-text' : 'text-dim hover:text-text'
      }`}
    >
      {label} {count}
    </button>
  )
}

/** One marked piece. */
function Row({ bookmark, library }: { bookmark: Bookmark; library: LibraryIndex }) {
  const piece = library.pieces.find((candidate) => candidate.id === bookmark.piece_id)

  // A piece renamed in the vault leaves a mark pointing at nothing. Saying so
  // beats a row that goes nowhere, and the export still carries it.
  if (!piece) {
    return (
      <li className="px-3 py-3 text-sm text-dim">
        <BookmarkDot kind={bookmark.kind} /> <span className="ml-2">{bookmark.piece_id} — no longer in the library</span>
      </li>
    )
  }

  return (
    <li>
      <a
        href={`/read/${piece.id}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'piece', id: piece.id })
        }}
        className="group flex flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex items-center gap-2">
          <BookmarkDot kind={bookmark.kind} />
          <span className="text-base font-medium text-text group-hover:text-accent">{piece.title}</span>
        </span>
        {piece.one_liner ? <span className="text-sm leading-snug text-dim">{piece.one_liner}</span> : null}
        <span className="font-mono text-xs text-dim">{minutes(piece.words)} min</span>
      </a>
    </li>
  )
}
