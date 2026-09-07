/**
 * The stand, from where the reader is standing.
 *
 * Three things a reader on a train cannot otherwise find out: which version
 * this is, how much of the library the device is holding, and whether anything
 * they did is still waiting to be delivered. None of it is a setting. The
 * screen says what is true and offers nothing to press.
 */

import { useEffect, useRef, useState } from 'react'

import { fetchHealth, fetchLibrary, type Health, type LibraryIndex } from '@/api'
import { held, refreshLibrary, type Held } from '@/offline'
import { ago, size } from '@/units'
import type { SyncState } from '@/sync'

/** How long a refresh is watched for before the screen stops waiting. */
const REFRESH_WATCH_MS = 45_000
const REFRESH_POLL_MS = 1_500

export function StandScreen({ library, sync }: { library: LibraryIndex; sync: SyncState }) {
  // `undefined` is "not asked yet"; `null` is "asked, and the stand is away".
  const [health, setHealth] = useState<Health | null | undefined>(undefined)
  const [holding, setHolding] = useState<Held | null | undefined>(undefined)
  const [usage, setUsage] = useState<number | null>(null)
  /** How many pieces the index has - the freshly fetched one after a refresh. */
  const [total, setTotal] = useState(library.pieces.length)
  const [refresh, setRefresh] = useState<'idle' | 'running' | 'no-worker' | 'unreachable'>('idle')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refreshCache = async (): Promise<void> => {
    setRefresh('running')
    let index: LibraryIndex
    try {
      index = await fetchLibrary()
    } catch {
      if (mounted.current) setRefresh('unreachable')
      return
    }
    if (!refreshLibrary(index)) {
      if (mounted.current) setRefresh('no-worker')
      return
    }
    setTotal(index.pieces.length)
    // The worker fetches one piece at a time and says nothing when it is
    // done; the count is watched instead, and the watch ends when every
    // piece is held or the time is up.
    const until = Date.now() + REFRESH_WATCH_MS
    while (mounted.current && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_MS))
      const kept = await held()
      if (!mounted.current) return
      setHolding(kept)
      if (kept && kept.index && kept.pieces >= index.pieces.length) break
    }
    if (mounted.current) setRefresh('idle')
  }

  useEffect(() => {
    let cancelled = false
    void fetchHealth()
      .then((state) => {
        if (!cancelled) setHealth(state)
      })
      .catch(() => {
        if (!cancelled) setHealth(null)
      })
    void held().then((kept) => {
      if (!cancelled) setHolding(kept)
    })
    // What the browser has set aside for this origin: the library cache, the
    // queue, the shell. An estimate, and one some browsers refuse to give.
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      void navigator.storage
        .estimate()
        .then((estimate) => {
          if (!cancelled && typeof estimate.usage === 'number') setUsage(estimate.usage)
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">The stand</h1>
        <p className="text-sm text-dim">What this device knows about the library and the Pi it came from.</p>
      </header>

      <Facts title="This app">
        <Fact label="version" value={`v${__APP_VERSION__}`} />
      </Facts>

      <Facts title="The stand">
        {health === undefined ? (
          <Fact label="reaching" value="…" />
        ) : health === null ? (
          <Fact label="the stand" value="out of reach" />
        ) : (
          <>
            <Fact label="version" value={`v${health.version}`} />
            <Fact label="pieces" value={String(health.pieces)} />
            <Fact label="published" value={ago(health.indexed_seconds_ago)} />
          </>
        )}
      </Facts>

      <Facts title="On this device">
        {holding === undefined ? (
          <Fact label="library" value="…" />
        ) : holding === null ? (
          <Fact label="library" value="not held - this browser has no offline cache" />
        ) : (
          <Fact
            label="library"
            value={`${holding.pieces} of ${total} pieces held${holding.index ? '' : ', without the index'}`}
          />
        )}
        {usage !== null ? <Fact label="storage" value={size(usage)} /> : null}
        <Fact
          label="waiting"
          value={
            sync.waiting === 0
              ? 'nothing'
              : `${sync.waiting} ${sync.waiting === 1 ? 'change' : 'changes'}${sync.syncing ? ', sending' : ''}`
          }
        />
      </Facts>

      {/* The one thing to press. Not a setting: a reader who knows a piece
          was edited in the vault asks for the copy on this device to be
          replaced, and the count above shows it happening. */}
      {holding !== null ? (
        <div className="flex flex-col gap-2 px-3">
          <button
            type="button"
            onClick={() => {
              void refreshCache()
            }}
            disabled={refresh === 'running'}
            className="self-start rounded-lg border border-line px-3 py-1.5 text-sm text-text transition-colors hover:border-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:text-dim"
          >
            {refresh === 'running' ? 'Fetching the library again…' : 'Fetch the library again'}
          </button>
          <p className="text-xs leading-relaxed text-dim">
            {refresh === 'unreachable'
              ? 'The stand is out of reach; the copy on this device is unchanged.'
              : refresh === 'no-worker'
                ? 'This browser has no offline cache to refresh.'
                : 'Every piece is fetched again and anything no longer in the library is dropped, so an edit published to the vault reaches this device now rather than the next time the piece is opened at home.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** A group of facts under a heading. */
function Facts({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-3 text-sm font-medium text-text">{title}</h2>
      <dl className="mx-3 flex flex-col divide-y divide-line rounded-lg border border-line">{children}</dl>
    </section>
  )
}

/** One fact: what it is called, and what it is. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="font-mono text-xs text-dim">{label}</dt>
      <dd className="text-right text-sm text-text">{value}</dd>
    </div>
  )
}
