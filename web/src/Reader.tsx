/**
 * The reading view.
 *
 * Everything here serves one line of text at a time: a measure that stays near
 * 60-70 characters, a size that does not need a pinch on a phone, and leading
 * loose enough to read for seven minutes without losing the line. The trailing
 * blocks are set apart from the prose because they are not part of the read.
 */

import { useEffect, useRef, useState } from 'react'

import { ApiError, fetchNext, fetchPiece, type LibraryIndex, type Piece, type PieceSummary } from '@/api'
import { BookmarkBar } from '@/Bookmarks'
import { ArrowLeftIcon } from '@/Icons'
import { Empty, minutes } from '@/Library'
import { KeepBar, KeptLines, NoteEditor, useSelection } from '@/Marks'
import { go } from '@/routing'
import type { MarksStore } from '@/useMarks'
import type { BookmarkStore } from '@/useBookmarks'
import type { ProgressStore } from '@/useProgress'

/**
 * A wiki link as the writing format spells it: `[[path/to/piece|caption]]`,
 * or `[[caption]]` when the path is the caption. The path is vault-qualified
 * so the same text works inside the vault, which is why the reader has to
 * translate it rather than follow it.
 */
export const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu

/**
 * The id a vault path points at, or null when it names something outside the
 * library - a topic from the plan that has not been written yet.
 *
 * The path is matched by its tail rather than parsed: the vault prefix is the
 * author's own layout and is none of the reader's business, while the last two
 * segments are the shelf and the piece, which is exactly what an id is made
 * of.
 */
export function linkTarget(path: string, index: LibraryIndex | undefined): string | null {
  if (!index) return null
  const segments = path.split('/').filter(Boolean)
  const stem = segments.at(-1)
  if (!stem) return null
  const section = segments.at(-2)
  const candidates = index.pieces.filter((piece) => piece.title === stem)
  const first = candidates[0]
  if (!first) return null
  // A title can repeat across shelves; the shelf in the path decides. The
  // shelf directory is written `NN — Name`, and the index knows it by name.
  const shelf = section ? section.split(' — ').slice(1).join(' — ') : null
  const onShelf = shelf
    ? candidates.find((piece) =>
        index.sections.some((known) => known.id === piece.section && known.title === shelf),
      )
    : undefined
  return (onShelf ?? first).id
}

/**
 * Renders the light markdown the format uses inside a line - `**bold**` and
 * `[[wiki links]]` - and marks any kept lines found in it.
 *
 * The kept lines are matched by their text: an edit in the vault at worst
 * loses a highlight, where an offset would silently move it onto the wrong
 * sentence.
 */
function Rich({
  text,
  marked,
  library,
}: {
  text: string
  marked?: string[]
  library?: LibraryIndex
}) {
  const parts = text.split(/\*\*(.+?)\*\*/gu)
  return (
    <>
      {parts.map((part, index) =>
        // The odd parts are what stood between the markers.
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-text">
            {part}
          </strong>
        ) : (
          <Linked key={index} text={part} marked={marked} library={library} />
        ),
      )}
    </>
  )
}

/**
 * One run of text with its wiki links turned into what a reader can use: a
 * link when the piece is on the shelf, and the caption alone when it is not.
 *
 * Showing the raw brackets was the old behaviour and the reason this exists:
 * a path meant for the vault has no business being read as prose.
 */
function Linked({
  text,
  marked,
  library,
}: {
  text: string
  marked?: string[]
  library?: LibraryIndex
}) {
  const out: React.ReactNode[] = []
  let at = 0

  for (const match of text.matchAll(WIKI_LINK)) {
    const start = match.index ?? 0
    if (start > at) {
      out.push(<Marked key={`t${at}`} text={text.slice(at, start)} marked={marked} />)
    }
    const path = match[1]
    if (!path) continue
    const label = (match[2] ?? path.split('/').at(-1) ?? path).trim()
    const target = linkTarget(path.trim(), library)
    out.push(
      target ? (
        <button
          key={`l${start}`}
          type="button"
          onClick={() => go({ name: 'piece', id: target })}
          className="text-accent underline decoration-accent/40 underline-offset-2"
        >
          {label}
        </button>
      ) : (
        // Not written yet: the caption is all the reader needs, and a dead
        // link would be worse than none.
        <Marked key={`l${start}`} text={label} marked={marked} />
      ),
    )
    at = start + match[0].length
  }

  if (at === 0) return <Marked text={text} marked={marked} />
  if (at < text.length) {
    out.push(<Marked key={`t${at}`} text={text.slice(at)} marked={marked} />)
  }
  return <>{out}</>
}

/** One run of plain text, with the kept lines inside it picked out. */
function Marked({ text, marked }: { text: string; marked?: string[] }) {
  if (!marked || marked.length === 0) return <>{text}</>

  // Longest first, so a quote inside another quote does not split it.
  for (const quote of [...marked].sort((a, b) => b.length - a.length)) {
    const at = text.indexOf(quote)
    if (at === -1) continue
    return (
      <>
        <Marked text={text.slice(0, at)} marked={marked} />
        <mark className="bg-accent/20 text-text">{quote}</mark>
        <Marked text={text.slice(at + quote.length)} marked={marked} />
      </>
    )
  }
  return <>{text}</>
}

/** A trailing block, set apart from the prose it follows. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-dim">{title}</h2>
      {children}
    </section>
  )
}

/**
 * A block in a frame of its own, for text that is not a continuation of what
 * precedes it.
 *
 * The reference needs this and the song seed does not: a rule above a heading
 * reads as "next section of the same thing", which is true of the seed after
 * the one-liner and false of a dry factual card after the seed. On the stand
 * the two ran together and the reference read as more song notes.
 */
function Framed({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-raise p-5">
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-dim">{title}</h2>
      {children}
    </section>
  )
}

/**
 * The reading view for one piece.
 *
 * Keyed by the piece's id from outside, so opening another piece mounts a
 * fresh screen rather than clearing this one's state on the way in: a piece
 * half-replaced by the next one is a frame the reader should never see.
 */
export function ReaderScreen({
  library,
  id,
  progress,
  marks,
  bookmarks,
}: {
  library: LibraryIndex
  id: string
  progress: ProgressStore
  marks: MarksStore
  bookmarks: BookmarkStore
}) {
  const [piece, setPiece] = useState<Piece | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [next, setNext] = useState<PieceSummary | null>(null)
  const paragraphs = useRef<(HTMLParagraphElement | null)[]>([])
  const restored = useRef(false)

  const state = progress.states.get(id)
  const isRead = state?.status === 'read'

  useEffect(() => {
    let cancelled = false
    void fetchPiece(id)
      .then((loaded) => {
        if (!cancelled) setPiece(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'The piece could not be opened.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // What to offer at the end. Asked for while the reader is still reading, so
  // the card is there when they arrive rather than appearing under their thumb.
  useEffect(() => {
    let cancelled = false
    void fetchNext(id)
      .then((answer) => {
        if (!cancelled) setNext(answer.next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id])

  const { opened } = progress
  useEffect(() => {
    opened(id)
  }, [id, opened])

  // Restore the reading position once both the text and the reader's progress
  // are here. Waiting for both matters: the progress arrives on its own
  // request, and restoring on the text alone put every piece back at the top -
  // which is what the first live run of this screen did.
  const savedAt = state?.paragraph ?? null
  useEffect(() => {
    if (!piece || savedAt === null || restored.current) return
    restored.current = true
    // A piece opened from the top starts at the top: scrolling to paragraph
    // zero would be a jump for no reason.
    if (savedAt <= 0) return
    const element = paragraphs.current[savedAt]
    if (element) {
      element.scrollIntoView({ block: 'start' })
      // A paragraph flush against the top edge reads as a page that was cut;
      // the header's height back is where a person would have stopped.
      window.scrollBy({ top: -72 })
    }
  }, [piece, savedAt])

  // Follow the reader down the page. The reported paragraph is the last one
  // whose top has passed the middle of the screen: that is the line being
  // read, not the one about to appear.
  const { atParagraph } = progress
  useEffect(() => {
    if (!piece) return undefined
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const middle = window.innerHeight / 2
        let at = 0
        paragraphs.current.forEach((element, index) => {
          if (element && element.getBoundingClientRect().top < middle) at = index
        })
        atParagraph(id, at)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [piece, id, atParagraph])

  const [selection, clearSelection] = useSelection(piece !== null)
  const kept = marks.quotesIn(id)
  // The lines kept from this piece, matched back onto the text by their words
  // rather than by an offset: a piece edited in the vault would shift every
  // offset, and a highlight on the wrong sentence is worse than none.
  const highlights = new Map<number, string[]>()
  for (const quote of kept) {
    highlights.set(quote.paragraph, [...(highlights.get(quote.paragraph) ?? []), quote.text])
  }

  const order = library.pieces.map((summary) => summary.id)
  const at = order.indexOf(id)
  const previous = at > 0 ? (library.pieces[at - 1] ?? null) : null

  // On a desktop the arrows are the fastest way through a library; on a phone
  // there is no keyboard and the links below do the same job.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft' && previous) go({ name: 'piece', id: previous.id })
      if (event.key === 'ArrowRight' && next) go({ name: 'piece', id: next.id })
      if (event.key === 't') go({ name: 'library' })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [previous, next])

  if (error !== null) {
    return <Empty title={error} />
  }
  if (!piece) {
    // A held frame rather than a spinner: the text arrives in a moment, and a
    // spinner would make a fast load flash.
    return <div className="px-3 py-12 text-sm text-dim">Opening…</div>
  }

  const shelf = library.sections.find((section) => section.id === piece.section)

  return (
    <article className="flex flex-col gap-8 px-3">
      <header className="flex flex-col gap-3">
        {shelf ? (
          <a
            href={`/section/${shelf.id}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              go({ name: 'section', section: shelf.id })
            }}
            className="font-mono text-xs uppercase tracking-[0.14em] text-dim hover:text-accent"
          >
            {shelf.title}
          </a>
        ) : null}
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-text sm:text-4xl">
          {piece.title}
        </h1>
        <p className="font-mono text-xs text-dim">
          {minutes(piece.words)} min · {piece.words} words
        </p>
      </header>

      <div className="relative flex flex-col gap-5">
        {piece.paragraphs.map((paragraph, index) => (
          <p
            key={index}
            data-paragraph={index}
            ref={(element) => {
              paragraphs.current[index] = element
            }}
            className="text-pretty text-[1.0625rem] leading-[1.75] text-text sm:text-lg sm:leading-[1.8]"
          >
            <Rich text={paragraph} marked={highlights.get(index)} library={library} />
          </p>
        ))}
        {selection ? (
          <KeepBar
            selection={selection}
            onKeep={(text, at) => {
              marks.keep({ piece_id: id, paragraph: at, text, comment: null })
              clearSelection()
            }}
          />
        ) : null}
      </div>

      {piece.neighbours.length > 0 ? (
        <Block title="Neighbours">
          <ul className="flex flex-col gap-2">
            {piece.neighbours.map((neighbour, index) => (
              <li key={index} className="text-[0.9375rem] leading-relaxed text-dim">
                <Rich text={neighbour} library={library} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {piece.one_liner ? (
        <Block title="In one line">
          <blockquote className="border-l-2 border-accent pl-4 text-lg font-medium leading-snug text-text">
            {piece.one_liner}
          </blockquote>
        </Block>
      ) : null}

      {piece.song.length > 0 ? (
        <Block title="Song seed">
          <ul className="flex flex-col gap-2">
            {piece.song.map((line, index) => (
              <li key={index} className="text-[0.9375rem] leading-relaxed text-dim">
                <Rich text={line} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {piece.reference.length > 0 ? (
        <Framed title="What this was">
          <ul className="flex flex-col gap-2">
            {piece.reference.map((line, index) => (
              <li key={index} className="text-[0.9375rem] leading-relaxed text-dim">
                <Rich text={line} />
              </li>
            ))}
          </ul>
        </Framed>
      ) : null}

      {kept.length > 0 ? (
        <Block title="Kept lines">
          <KeptLines quotes={kept} marks={marks} />
        </Block>
      ) : null}

      <Block title="Keep this one">
        <BookmarkBar pieceId={id} bookmarks={bookmarks} />
      </Block>

      <Block title="Note">
        <NoteEditor pieceId={id} marks={marks} />
      </Block>

      <Finish id={id} isRead={isRead} next={next} previous={previous} progress={progress} />
    </article>
  )
}

/**
 * The end of a piece: whether it is finished, and what comes next.
 *
 * Finishing is a button rather than something that happens on reaching the
 * bottom: scrolling past the song seed to see how long a piece is should not
 * silently mark it read, and a reader who abandons one halfway has not
 * finished it either.
 */
function Finish({
  id,
  isRead,
  next,
  previous,
  progress,
}: {
  id: string
  isRead: boolean
  next: PieceSummary | null
  previous: PieceSummary | null
  progress: ProgressStore
}) {
  return (
    <div className="flex flex-col gap-6 border-t border-line pt-6 pb-4">
      <button
        type="button"
        onClick={() => {
          progress.setRead(id, !isRead)
        }}
        className={`self-start rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          isRead ? 'bg-soft text-dim hover:text-text' : 'bg-accent text-on-accent hover:opacity-90'
        }`}
      >
        {isRead ? 'Read · mark unread' : 'Mark as read'}
      </button>

      {next ? (
        <a
          href={`/read/${next.id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            go({ name: 'piece', id: next.id })
          }}
          className="flex flex-col gap-2 rounded-xl border border-line p-4 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Next, unread</span>
          <span className="text-lg font-medium leading-snug text-text">{next.title}</span>
          {next.one_liner ? <span className="text-sm leading-snug text-dim">{next.one_liner}</span> : null}
          <span className="font-mono text-xs text-dim">{minutes(next.words)} min</span>
        </a>
      ) : (
        <p className="text-sm text-dim">That was the last unread piece.</p>
      )}

      {previous ? (
        <a
          href={`/read/${previous.id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            go({ name: 'piece', id: previous.id })
          }}
          className="flex items-center gap-2 self-start rounded-lg px-3 py-2 text-sm text-dim transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeftIcon size={16} />
          {previous.title}
        </a>
      ) : null}
    </div>
  )
}
