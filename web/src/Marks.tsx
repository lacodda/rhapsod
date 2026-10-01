/**
 * Marking a line, and writing about a piece.
 *
 * The selection is the interface: a reader drags across a sentence on a phone
 * the same way they would in any other app, and a small bar appears over what
 * they chose. Nothing here asks them to enter a mode first.
 */

import { TypoIcon } from '@/Icons'
import { useEffect, useRef, useState } from 'react'

import type { Quote } from '@/api'
import { afterPause, type Pause } from '@/pause'
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
/**
 * What a selection can become.
 *
 * Two things, because the reader selects words for two reasons: to keep a line
 * worth keeping, and to say a word is misspelt. Both are one tap on the
 * selection already made - a typo that needed a form would be a typo left
 * unreported.
 */
export function KeepBar({
  selection,
  onKeep,
  onTypo,
}: {
  selection: Selection
  onKeep: (text: string, paragraph: number) => void
  onTypo: (text: string, paragraph: number) => void
}) {
  return (
    <div
      className="absolute z-10 flex -translate-x-1/2 -translate-y-full gap-1 pb-2"
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
      <button
        type="button"
        title="Report a misspelling"
        onClick={() => {
          onTypo(selection.text, selection.paragraph)
        }}
        className="flex items-center rounded-lg bg-text px-2.5 py-1.5 text-bg shadow-lg"
      >
        <TypoIcon size={16} />
        <span className="sr-only">Report a misspelling</span>
      </button>
    </div>
  )
}

/**
 * The note on a piece, written in the reader's own words.
 *
 * Only what the reader typed is ever saved. The editor used to hold a copy of
 * the note taken when it opened and save whenever the two differed - so a
 * note that arrived after the piece did (a slow stand, the worker's copy
 * read a moment late) differed from the empty copy, and the empty copy was
 * saved over it. Until the reader types, the editor shows the note as it is
 * held and has nothing of its own.
 */
export function NoteEditor({ pieceId, marks }: { pieceId: string; marks: MarksStore }) {
  const saved = marks.notes.get(pieceId) ?? ''
  // What the reader has typed; `null` until they type anything.
  const [draft, setDraft] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  // The text the typing started from, and after each save the text that save
  // left: what the next save is an edit of. `null` when the note was not
  // known, which delivery reads as "keep whatever the stand has".
  const base = useRef<string | null>(null)
  const body = draft ?? saved
  // Open whenever there is something to show: a note that arrives after the
  // piece is shown as a note, not as "+ Write a note" over the top of it.
  const open = opened || draft !== null || saved.length > 0

  // Saved after a pause rather than on every keystroke: a note is typed in
  // bursts, and one request per character would be a request per thought.
  // Leaving the piece, or the app going to the background, saves at once
  // rather than dropping what the pause was waiting on (see `pause.ts`).
  const { setNote } = marks
  const pause = useRef<Pause | null>(null)
  useEffect(() => {
    const saving = afterPause((text) => {
      setNote(pieceId, text, base.current)
      base.current = text.trim()
    }, 800)
    pause.current = saving
    return () => {
      pause.current = null
      saving.stop()
    }
  }, [pieceId, setNote])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpened(true)
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
          // The first keystroke fixes what this edit is an edit of: the note
          // as shown, or "not known" when the reader's notes never arrived
          // and an empty box may be hiding one on the stand.
          if (draft === null) base.current = saved !== '' || marks.known ? saved : null
          setDraft(event.target.value)
          pause.current?.typed(event.target.value)
        }}
        rows={4}
        placeholder="What this left you with."
        className="w-full resize-y rounded-lg border border-line bg-soft px-3 py-2 text-lg leading-relaxed text-text outline-none focus-visible:border-accent"
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
      <p className="text-pretty break-words text-lg leading-relaxed text-text">{quote.text}</p>

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
        className="self-start font-mono text-2xs uppercase tracking-caption text-dim hover:text-bad"
      >
        remove
      </button>
    </li>
  )
}
