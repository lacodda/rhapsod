/**
 * The way to the rest of the library without leaving the piece.
 *
 * Everything the reader can reach was already there - shelves, today's cards,
 * the kept lines - but reaching any of it meant leaving the page and losing
 * the place on screen. The drawer slides over the text and closes onto the
 * same paragraph.
 *
 * A drawer rather than a bar of tabs along the bottom: a permanent bar costs a
 * line of text on every screen of a seven-minute read, and this format is read
 * on a phone where that line is dear. The panel appears when it is asked for
 * and gets out of the way afterwards.
 */

import { useEffect, useRef } from 'react'

import type { LibraryIndex } from '@/api'
import { go, type Route } from '@/routing'

/** How wide the panel is: enough for a shelf title, never the whole screen. */
const WIDTH = 'w-[18rem] max-w-[85vw]'

export function Drawer({
  open,
  onClose,
  library,
  due,
  quotes,
  bookmarks,
  route,
}: {
  open: boolean
  onClose: () => void
  library: LibraryIndex
  due: number
  quotes: number
  bookmarks: number
  /** The current route, so the drawer can mark where the reader already is. */
  route: Route
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes it, the way every other overlay on a desktop does.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // The page behind must not scroll while the drawer is over it: on a phone,
  // dragging the panel would otherwise carry the text underneath with it and
  // lose exactly the place this exists to keep.
  useEffect(() => {
    if (!open) return undefined
    const held = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = held
    }
  }, [open])

  // Focus moves into the panel when it opens, so a keyboard is inside it and
  // Escape has something to act on.
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])

  const goTo = (to: Route): void => {
    go(to)
    onClose()
  }

  return (
    <>
      {/* The scrim is what closes the drawer on a tap outside it, and what
          tells the eye the text underneath is not the thing being used. */}
      <button
        type="button"
        aria-label="Close the menu"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        tabIndex={open ? 0 : -1}
      />

      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Library"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex ${WIDTH} flex-col overflow-y-auto overscroll-contain border-r border-line bg-raise transition-transform duration-200 focus:outline-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Library</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the menu"
            className="rounded-md px-2 py-1 font-mono text-sm text-dim hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-1 border-b border-line px-2 py-3">
          <Entry label="All shelves" active={route.name === 'library'} onClick={() => { goTo({ name: 'library' }) }} />
          <Entry
            label="Today"
            count={due}
            accent
            active={route.name === 'today'}
            onClick={() => { goTo({ name: 'today' }) }}
          />
          <Entry
            label="Bookmarks"
            count={bookmarks}
            active={route.name === 'bookmarks'}
            onClick={() => { goTo({ name: 'bookmarks' }) }}
          />
          <Entry label="Kept lines" count={quotes} active={route.name === 'quotes'} onClick={() => { goTo({ name: 'quotes' }) }} />
        </nav>

        <div className="flex flex-col gap-1 px-2 py-3">
          <span className="px-3 pb-1 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-dim">Shelves</span>
          {library.sections.map((shelf) => (
            <Entry
              key={shelf.id}
              label={shelf.title}
              count={shelf.pieces}
              active={route.name === 'section' && route.section === shelf.id}
              onClick={() => { goTo({ name: 'section', section: shelf.id }) }}
            />
          ))}
        </div>
      </div>
    </>
  )
}

/** One line of the drawer: a place to go, and how much is in it. */
function Entry({
  label,
  count,
  active = false,
  accent = false,
  onClick,
}: {
  label: string
  count?: number
  active?: boolean
  accent?: boolean
  onClick: () => void
}) {
  // A count of zero is not drawn: "Today 0" is a line that says nothing and
  // takes a row from the shelves, which say something.
  const shown = count !== undefined && count > 0 ? count : null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active ? 'bg-soft text-text' : 'text-dim hover:bg-soft hover:text-text'
      }`}
    >
      <span className="leading-snug">{label}</span>
      {shown !== null ? (
        <span className={`shrink-0 font-mono text-xs tabular-nums ${accent ? 'text-accent' : 'text-dim'}`}>{shown}</span>
      ) : null}
    </button>
  )
}
