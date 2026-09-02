import { useCallback, useEffect, useState } from 'react'

import { ApiError, fetchLibrary, fetchSession, type LibraryIndex, type Session } from '@/api'
import { Empty, LibraryScreen, SectionScreen } from '@/Library'
import { ReaderScreen } from '@/Reader'
import { go, useRoute } from '@/routing'
import { SignInScreen } from '@/SignIn'
import { useProgress } from '@/useProgress'

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
        if (!cancelled) setLibrary(index)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'The library could not be read.')
      })
    return () => {
      cancelled = true
    }
  }, [mayRead])

  const signedIn = useCallback(() => {
    setSession({ open: false, reader: true })
  }, [])

  return (
    <div className="min-h-dvh">
      <Header />
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
          <ReaderScreen key={route.id} library={library} id={route.id} progress={progress} />
        ) : route.name === 'section' ? (
          <SectionScreen library={library} section={route.section} progress={progress} />
        ) : (
          <LibraryScreen library={library} progress={progress} />
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
function Header() {
  return (
    <header className="mx-auto flex w-full max-w-[42rem] items-center justify-between px-4 py-4 sm:px-6">
      <a
        href="/"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          go({ name: 'library' })
        }}
        className="flex items-baseline gap-2 rounded-md px-2 py-1 font-mono text-sm font-semibold tracking-tight text-text hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        rhapsod
      </a>
      <span className="px-2 font-mono text-[0.6875rem] text-dim">v{__APP_VERSION__}</span>
    </header>
  )
}
