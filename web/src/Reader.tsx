/**
 * The reading view.
 *
 * Everything here serves one line of text at a time: a measure that stays near
 * 60-70 characters, a size that does not need a pinch on a phone, and leading
 * loose enough to read for seven minutes without losing the line. The trailing
 * blocks are set apart from the prose because they are not part of the read.
 */

import { useEffect, useState } from 'react'

import { ApiError, fetchPiece, type LibraryIndex, type Piece } from '@/api'
import { Empty, minutes } from '@/Library'
import { go } from '@/routing'

/** Renders the light markdown the format uses inside a line: `**bold**`. */
function Rich({ text }: { text: string }) {
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
          part
        ),
      )}
    </>
  )
}

/** The piece's prose, one paragraph per element. */
function Prose({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="flex flex-col gap-5">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-pretty text-[1.0625rem] leading-[1.75] text-text sm:text-lg sm:leading-[1.8]">
          <Rich text={paragraph} />
        </p>
      ))}
    </div>
  )
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

/** The one line the piece wants remembered. */
function OneLiner({ line }: { line: string }) {
  return (
    <blockquote className="border-l-2 border-accent pl-4 text-lg font-medium leading-snug text-text">{line}</blockquote>
  )
}

/**
 * The reading view for one piece.
 *
 * Keyed by the piece's id from outside, so opening another piece mounts a
 * fresh screen rather than clearing this one's state on the way in: a piece
 * half-replaced by the next one is a frame the reader should never see.
 */
export function ReaderScreen({ library, id }: { library: LibraryIndex; id: string }) {
  const [piece, setPiece] = useState<Piece | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // The reading position is the top of the page for every new piece; the
  // browser would otherwise keep the scroll of the list it came from.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  const order = library.pieces.map((summary) => summary.id)
  const at = order.indexOf(id)
  const previous = at > 0 ? library.pieces[at - 1] : null
  const next = at >= 0 && at < order.length - 1 ? library.pieces[at + 1] : null

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

      <Prose paragraphs={piece.paragraphs} />

      {piece.neighbours.length > 0 ? (
        <Block title="Neighbours">
          <ul className="flex flex-col gap-2">
            {piece.neighbours.map((neighbour, index) => (
              <li key={index} className="text-[0.9375rem] leading-relaxed text-dim">
                <Rich text={neighbour} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {piece.one_liner ? (
        <Block title="In one line">
          <OneLiner line={piece.one_liner} />
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

      <nav className="flex items-stretch justify-between gap-3 border-t border-line pt-6 pb-4">
        {previous ? <Step piece={previous} direction="previous" /> : <span />}
        {next ? <Step piece={next} direction="next" /> : <span />}
      </nav>
    </article>
  )
}

/** The way on: the piece before this one, or the one after it. */
function Step({ piece, direction }: { piece: { id: string; title: string }; direction: 'previous' | 'next' }) {
  return (
    <a
      href={`/read/${piece.id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        go({ name: 'piece', id: piece.id })
      }}
      className={`flex max-w-[48%] flex-col gap-1 rounded-lg px-3 py-2 transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        direction === 'next' ? 'items-end text-right' : 'items-start text-left'
      }`}
    >
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-dim">
        {direction === 'next' ? 'Next' : 'Previous'}
      </span>
      <span className="text-sm font-medium leading-snug text-text">{piece.title}</span>
    </a>
  )
}
