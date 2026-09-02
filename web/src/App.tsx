import { useCallback, useEffect, useState } from 'react'

import { ApiError, BOOKMARK_KINDS, fetchLibrary, fetchSession, type BookmarkKind, type LibraryIndex, type Session } from '@/api'
import { Empty, LibraryScreen, SectionScreen } from '@/Library'
import { BookmarksScreen } from '@/Bookmarks'
import { Drawer } from '@/Drawer'
import { MenuIcon } from '@/Icons'
import { Mark } from '@/Mark'
import { QuotesScreen } from '@/Quotes'
import { RequestsScreen } from '@/Requests'
import { ReviewsScreen } from '@/Reviews'
import { ReaderScreen } from '@/Reader'
import { cacheLibrary } from '@/offline'
import { go, useRoute } from '@/routing'
import { SignInScreen } from '@/SignIn'
import { useMarks } from '@/useMarks'
import { useProgress } from '@/useProgress'
import { useRequests } from '@/useRequests'
import { useReviews } from '@/useReviews'
import { useBookmarks } from '@/useBookmarks'
import { useEdgeSwipe } from '@/useEdgeSwipe'
import { useSync } from '@/useSync'
import type { SyncState } from '@/sync'

/**
 * The reading app.
 *
 * The index is fetched once and held: every screen after the first is rendered
 * from memory, which is what makes moving through the library feel like turning
 * pages rather than loading them. A piece's text is fetched when it is opened.
 */
export function App() {
  const route = useRoute()
  const [session, setSession] = useState<Session | null>(null)
  const [library, setLibrary] = useState<LibraryIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mayRead = session?.reader === true
  const progress = useProgress(mayRead)
  const marks = useMarks(mayRead)
  const reviews = useReviews(mayRead)
  const bookmarks = useBookmarks(mayRead)
  const requests = useRequests(mayRead)
  const sync = useSync()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchSession()
      .then((state) => {
        if (!cancelled) setSession(state)
      })
      .catch(() => {
        // A stand that cannot say whether it is locked is a stand that cannot
        // be read either; the library fetch below reports the real problem.
        if (!cancelled) setSession({ open: true, reader: true })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!mayRead) return undefined
    let cancelled = false
    void fetchLibrary()
      .then((index) => {
        if (cancelled) return
        setLibrary(index)
        // Everything, not only what gets opened: the promise is that the
        // library read at home is the library available on a train.
        cacheLibrary(index)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'The library could not be read.')
      })
    return () => {
      cancelled = true
    }
  }, [mayRead])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
  }, [])

  const openMenu = useCallback(() => {
    setMenuOpen(true)
  }, [])

  // The gesture is armed only when there is a library behind the drawer and
  // it is not already open.
  useEdgeSwipe(openMenu, mayRead && library !== null && !menuOpen)

  const signedIn = useCallback(() => {
    setSession({ open: false, reader: true })
  }, [])

  return (
    <div className="min-h-dvh">
      <Header
        quotes={marks.quotes.length}
        due={reviews.cards.length}
        sync={sync}
        onOpenMenu={mayRead && library ? openMenu : undefined}
      />

      {/* The drawer needs the index to list shelves, so it exists only once
          there is a library to show. */}
      {mayRead && library ? (
        <Drawer
          open={menuOpen}
          onClose={closeMenu}
          library={library}
          due={reviews.cards.length}
          quotes={marks.quotes.length}
          bookmarks={bookmarks.all.length}
          asked={requests.asked.length}
          hasPlan={requests.plan.shelves.length > 0}
          route={route}
        />
      ) : null}
      <main className="mx-auto w-full max-w-[42rem] px-4 pb-16 pt-4 sm:px-6">
        {session === null ? (
          <p className="px-3 py-12 text-sm text-dim">Reaching the library…</p>
        ) : !mayRead ? (
          <SignInScreen onSignedIn={signedIn} />
        ) : error !== null ? (
          <Empty title={error} />
        ) : !library ? (
          <p className="px-3 py-12 text-sm text-dim">Reading the shelves…</p>
        ) : library.pieces.length === 0 ? (
          <Empty
            title="The library is empty."
            detail="Publish a directory of markdown files to the stand, and they appear here."
          />
        ) : route.name === 'piece' ? (
          <ReaderScreen key={route.id} library={library} id={route.id} progress={progress} marks={marks} bookmarks={bookmarks} />
        ) : route.name === 'quotes' ? (
          <QuotesScreen library={library} marks={marks} />
        ) : route.name === 'today' ? (
          <ReviewsScreen reviews={reviews} />
        ) : route.name === 'ask' ? (
          <RequestsScreen requests={requests} />
        ) : route.name === 'bookmarks' ? (
          <BookmarksScreen
            library={library}
            bookmarks={bookmarks}
            kind={asKind(route.kind)}
          />
        ) : route.name === 'section' ? (
          <SectionScreen library={library} section={route.section} progress={progress} bookmarks={bookmarks.kinds} />
        ) : (
          <LibraryScreen library={library} progress={progress} due={reviews.cards.length} />
        )}
      </main>
    </div>
  )
}

/**
 * The one fixed thing on every screen: the way back to the shelves.
 *
 * It scrolls away with the page instead of sitting over it - on a phone a
 * sticky bar costs a line of text on every screen of a seven-minute read.
 */
function Header({
  quotes,
  due,
  sync,
  onOpenMenu,
}: {
  quotes: number
  due: number
  sync: SyncState
  /** Absent before there is a library to show, which is when the menu would
      open onto nothing. */
  onOpenMenu?: () => void
}) {
  return (
    <header className="mx-auto flex w-full max-w-[42rem] items-center justify-between px-4 py-4 sm:px-6">
      <span className="flex items-center gap-1">
        {onOpenMenu ? (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open the menu"
            className="rounded-md px-2 py-1.5 text-dim transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* Three lines: the one icon a phone reader does not have to be
                taught. */}
            <MenuIcon size={18} />
          </button>
        ) : null}
        <a
          href="/"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            go({ name: 'library' })
          }}
          className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-sm font-semibold tracking-tight text-text hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Mark />
          rhapsod
        </a>
      </span>
      <span className="flex items-baseline gap-3">
        {due > 0 ? (
          <a
            href="/today"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              go({ name: 'today' })
            }}
            className="rounded-md px-2 py-1 font-mono text-xs text-accent hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            today {due}
          </a>
        ) : null}
        {quotes > 0 ? (
          <a
            href="/quotes"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              go({ name: 'quotes' })
            }}
            className="rounded-md px-2 py-1 font-mono text-xs text-dim hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            kept {quotes}
          </a>
        ) : null}
        <SyncMark sync={sync} />
        <span className="px-2 font-mono text-[0.6875rem] text-dim">v{__APP_VERSION__}</span>
      </span>
    </header>
  )
}

/**
 * The kind named in the address, if it is one the app knows.
 *
 * A typed URL with a kind nothing matches shows everything rather than an
 * empty screen: the reader asked for their bookmarks, and the filter is the
 * part that was wrong.
 */
function asKind(kind: string | undefined): BookmarkKind | null {
  return kind !== undefined && (BOOKMARK_KINDS as readonly string[]).includes(kind) ? (kind as BookmarkKind) : null
}

/**
 * Whether anything the reader did is still waiting for the stand.
 *
 * Nothing is shown in the ordinary case - at home, with an empty queue, there
 * is nothing to say, and a green tick on every screen is noise. It appears
 * only when there is something to know: changes are waiting, or the stand
 * cannot be reached.
 *
 * It says what is true rather than what it fears: "kept on this phone" is the
 * honest description of a change written locally, where "offline" would be
 * about the network and "unsaved" would be wrong - it is saved, just not
 * there yet.
 */
function SyncMark({ sync }: { sync: SyncState }) {
  if (sync.waiting === 0 && sync.reachable) return null

  const label = sync.waiting > 0 ? `${sync.waiting} kept on this phone` : 'the stand is away'
  return (
    <span
      className="px-2 font-mono text-[0.6875rem] text-dim"
      // The count is not a decoration: a reader who is about to wipe the
      // browser's data should be able to find out that something is waiting.
      title={
        sync.waiting > 0
          ? 'Changes made here are kept on this device and sent when the library is in reach.'
          : 'The library is out of reach. It comes back when you are home.'
      }
    >
      {sync.syncing ? 'sending…' : label}
    </span>
  )
}
