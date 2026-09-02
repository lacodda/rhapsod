/**
 * Marking a line, and writing about a piece.
 *
 * The selection is the interface: a reader drags across a sentence on a phone
 * the same way they would in any other app, and a small bar appears over what
 * they chose. Nothing here asks them to enter a mode first.
 */

import { useEffect, useState } from 'react'

import type { Quote } from '@/api'
import type { MarksStore } from '@/useMarks'

/** Where a selection sits on screen, and what it says. */
interface Selection {
  text: string
  paragraph: number
  top: number
  left: number
}

/**
 * Watches the document selection and reports one inside the reading text.
 *
 * A selection that spans paragraphs is taken as belonging to the first of
 * them: the anchor only has to find the quote again, and a line that crosses a
 * paragraph break is one the reader chose deliberately.
 */
export function useSelection(enabled: boolean): [Selection | null, () => void] {
  const [selection, setSelection] = useState<Selection | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    const check = (): void => {
      const current = window.getSelection()
      const text = current?.toString().trim() ?? ''
      if (!current || current.isCollapsed || text.length === 0) {
        setSelection(null)
        return
      }

      const node = current.anchorNode
      const element = node instanceof Element ? node : node?.parentElement
      const paragraph = element?.closest<HTMLElement>('[data-paragraph]')
      if (!paragraph) {
        setSelection(null)
        return
      }

      const box = current.getRangeAt(0).getBoundingClientRect()
      setSelection({
        text,
        paragraph: Number(paragraph.dataset.paragraph ?? 0),
        // Placed relative to the document, not the viewport: the bar has to
        // stay over the words when the page scrolls under it.
        top: box.top + window.scrollY,
        left: box.left + box.width / 2,
      })
    }

    document.addEventListener('selectionchange', check)
    return () => {
      document.removeEventListener('selectionchange', check)
    }
  }, [enabled])

  const clear = (): void => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return [selection, clear]
}

/** The bar that appears over a selection. */
export function KeepBar({ selection, onKeep }: { selection: Selection; onKeep: (text: string, paragraph: number) => void }) {
  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-full pb-2"
      style={{ top: selection.top, left: selection.left }}
      // The bar must not steal the selection out from under itself.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      <button
        type="button"
        onClick={() => {
          onKeep(selection.text, selection.paragraph)
        }}
        className="rounded-lg bg-text px-3 py-1.5 text-sm font-medium text-bg shadow-lg"
      >
        Keep this line
      </button>
    </div>
  )
}

/** The note on a piece, written in the reader's own words. */
export function NoteEditor({ pieceId, marks }: { pieceId: string; marks: MarksStore }) {
  const saved = marks.notes.get(pieceId) ?? ''
  const [body, setBody] = useState(saved)
  const [open, setOpen] = useState(saved.length > 0)

  // Saved after a pause rather than on every keystroke: a note is typed in
  // bursts, and one request per character would be a request per thought.
  const { setNote } = marks
  useEffect(() => {
    if (body === saved) return undefined
    const timer = window.setTimeout(() => {
      setNote(pieceId, body)
    }, 800)
    return () => {
      window.clearTimeout(timer)
    }
  }, [body, saved, pieceId, setNote])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        className="self-start rounded-lg px-3 py-2 text-sm text-dim transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        + Write a note
      </button>
    )
  }

  return (
    <label className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        rows={4}
        placeholder="What this left you with."
        className="w-full resize-y rounded-lg border border-line bg-soft px-3 py-2 text-[0.9375rem] leading-relaxed text-text outline-none focus-visible:border-accent"
      />
    </label>
  )
}

/** The lines kept from one piece, under the text they came from. */
export function KeptLines({ quotes, marks }: { quotes: Quote[]; marks: MarksStore }) {
  if (quotes.length === 0) return null
  return (
    <ul className="flex flex-col gap-4">
      {quotes.map((quote) => (
        <KeptLine key={quote.id} quote={quote} marks={marks} />
      ))}
    </ul>
  )
}

function KeptLine({ quote, marks }: { quote: Quote; marks: MarksStore }) {
  const [comment, setComment] = useState(quote.comment ?? '')
  const [editing, setEditing] = useState(false)

  return (
    <li className="flex flex-col gap-2 border-l-2 border-accent/40 pl-3">
      <p className="text-pretty break-words text-[0.9375rem] leading-relaxed text-text">{quote.text}</p>

      {editing ? (
        <input
          value={comment}
          onChange={(event) => {
            setComment(event.target.value)
          }}
          onBlur={() => {
            setEditing(false)
            if (comment !== (quote.comment ?? '')) marks.comment(quote.id, comment)
          }}
          placeholder="A thought about it"
          autoFocus
          className="rounded-md border border-line bg-soft px-2 py-1 text-sm text-text outline-none focus-visible:border-accent"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(true)
          }}
          className="self-start text-left text-sm text-dim hover:text-accent"
        >
          {quote.comment ?? '+ comment'}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          marks.drop(quote.id)
        }}
        className="self-start font-mono text-[0.625rem] uppercase tracking-[0.1em] text-dim hover:text-bad"
      >
        remove
      </button>
    </li>
  )
}
