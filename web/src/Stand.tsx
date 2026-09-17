/**
 * The stand, from where the reader is standing.
 *
 * The screen opens with the one question worth asking before leaving the
 * house - whether the library will be there on the train - and answers it
 * yes or no with the reason. Everything under it is the evidence: which
 * version this is, how much of the library the device holds, whether
 * anything the reader did is still waiting to be delivered.
 *
 * The answer is computed rather than left to the reader to assemble. Facts
 * spread across four groups are a puzzle; a reader standing in a doorway
 * wants the conclusion (see `readiness.ts`).
 */

import { useEffect, useRef, useState } from 'react'

import { fetchHealth, fetchLibrary, type Health, type LibraryIndex, type Section } from '@/api'
import { cacheLibrary, held, installed, refreshLibrary, secure, type Held } from '@/offline'
import { CheckIcon, CrossIcon, PendingIcon } from '@/Icons'
import { readiness, verdict, type Check, type Readiness } from '@/readiness'
import { install, offerable, standalone, watchOffer } from '@/install'
import { choose, chosen, holds, wanted, type Chosen } from '@/packages'
import { ago, size } from '@/units'
import type { SyncState } from '@/sync'

/**
 * How many of the pieces the road needs are on the device.
 *
 * Not `held.pieces`: that counts everything in the cache, including shelves
 * the reader stopped keeping and pieces withdrawn from the library. Counting
 * the wanted ones is what makes "ready" mean ready.
 */
function countHeld(kept: Held, index: LibraryIndex, shelves: Chosen): number {
  return wanted(index.pieces, shelves).filter((piece) => kept.ids.has(piece.id)).length
}

/** How long a refresh is watched for before the screen stops waiting. */
const REFRESH_WATCH_MS = 45_000
const REFRESH_POLL_MS = 1_500

/**
 * How often the screen re-counts while the first fill is still running.
 *
 * Slower than a refresh the reader asked for and is watching: this one runs
 * unasked, and reading the cache is not free.
 */
const FILL_POLL_MS = 2_500

export function StandScreen({ library, sync }: { library: LibraryIndex; sync: SyncState }) {
  // `undefined` is "not asked yet"; `null` is "asked, and the stand is away".
  const [health, setHealth] = useState<Health | null | undefined>(undefined)
  const [holding, setHolding] = useState<Held | null | undefined>(undefined)
  const [usage, setUsage] = useState<number | null>(null)
  /** The index the counts are taken against - refreshed one after a refresh. */
  const [index, setIndex] = useState(library)
  const [refresh, setRefresh] = useState<'idle' | 'running' | 'no-worker' | 'unreachable'>('idle')
  /** Whether the offline part of the app is installed; `undefined` until asked. */
  const [worker, setWorker] = useState<boolean | null | undefined>(undefined)
  /** The shelves this device keeps. `null` is all of them (see `packages.ts`). */
  const [keeping, setKeeping] = useState<Chosen>(() => chosen())
  /** Whether the browser has an install offer waiting to be raised. */
  const [offer, setOffer] = useState(() => offerable())
  const mounted = useRef(true)

  /** How many pieces the road needs: the whole library, or the chosen shelves. */
  const want = wanted(index.pieces, keeping).length

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The browser may make its offer after this screen is open, and it is
  // spent the moment it is used.
  useEffect(
    () =>
      watchOffer(() => {
        setOffer(offerable())
      }),
    [],
  )

  /**
   * Fetches the chosen shelves again and drops everything else.
   *
   * This is also how a narrowed selection is applied: the fill that runs on
   * its own only adds, so shelves the reader stopped keeping leave the device
   * here - when they ask, and not behind their back.
   */
  const refreshCache = async (shelves: Chosen): Promise<void> => {
    setRefresh('running')
    let fresh: LibraryIndex
    try {
      fresh = await fetchLibrary()
    } catch {
      if (mounted.current) setRefresh('unreachable')
      return
    }
    if (!refreshLibrary(fresh, shelves)) {
      if (mounted.current) setRefresh('no-worker')
      return
    }
    setIndex(fresh)
    const want = wanted(fresh.pieces, shelves).length
    // The worker fetches one piece at a time and says nothing when it is
    // done; the count is watched instead, and the watch ends when every
    // piece is held or the time is up.
    const until = Date.now() + REFRESH_WATCH_MS
    while (mounted.current && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_MS))
      const kept = await held()
      if (!mounted.current) return
      setHolding(kept)
      // Held is counted against the selection, not the cache: a refresh that
      // drops shelves finishes when the wanted ones are there, whatever is
      // still on its way out.
      if (kept && kept.index && countHeld(kept, fresh, shelves) >= want) break
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
    void installed().then((yes) => {
      if (!cancelled) setWorker(yes)
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

  /**
   * Keeps counting while the library is still arriving.
   *
   * The worker fills in the background and says nothing when it is done. Read
   * once on mount, the screen showed "Not ready for the road" to a reader
   * watching the last pieces land - and went on showing it until the page was
   * opened again. Seen on the stand with all 62 pieces already held.
   *
   * The watch stops as soon as everything wanted is there, so a screen left
   * open on a ready device is not polling a cache that will not change.
   */
  useEffect(() => {
    if (refresh === 'running') return undefined
    if (holding === null) return undefined
    if (holding !== undefined && holding.index && countHeld(holding, index, keeping) >= want) return undefined
    const timer = setInterval(() => {
      void held().then((kept) => {
        if (mounted.current) setHolding(kept)
      })
    }, FILL_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [holding, index, keeping, want, refresh])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">The stand</h1>
        <p className="text-sm text-dim">What this device knows about the library and the Pi it came from.</p>
      </header>

      <Road
        state={readiness({
          secure: secure(),
          // A browser with no service workers at all fails the check the same
          // way as one where none is installed: either way nothing is held.
          worker: worker === undefined ? null : worker === null ? false : worker,
          index: holding === undefined ? null : holding === null ? false : holding.index,
          held: holding === undefined ? null : holding === null ? 0 : countHeld(holding, index, keeping),
          total: want,
        })}
      />

      <OnYourScreen offer={offer} />

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
            value={`${countHeld(holding, index, keeping)} of ${want} pieces held${
              keeping === null ? '' : ` on ${keeping.length} of ${index.sections.length} shelves`
            }${holding.index ? '' : ', without the index'}`}
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

      {/* Which shelves ride along. The only choice on this screen, and it is
          a real one: a library of three hundred pieces is not all wanted in a
          bag. It is about this device, so it never reaches the stand. */}
      {holding !== null ? (
        <Shelves
          sections={index.sections}
          keeping={keeping}
          onChange={(next) => {
            setKeeping(next)
            choose(
              next,
              index.sections.map((section) => section.id),
            )
            // Widening takes effect on its own - the fill adds what is
            // missing. Narrowing only frees the space at the next refresh,
            // which the line under the button says.
            cacheLibrary(index, next)
          }}
        />
      ) : null}

      {/* The one thing to press. Not a setting: a reader who knows a piece
          was edited in the vault asks for the copy on this device to be
          replaced, and the count above shows it happening. */}
      {holding !== null ? (
        <div className="flex flex-col gap-2 px-3">
          <button
            type="button"
            onClick={() => {
              void refreshCache(keeping)
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
                : 'Every piece of the shelves you keep is fetched again, and everything else is dropped - an edit published to the vault reaches this device now rather than the next time the piece is opened at home, and shelves you stopped keeping give their space back.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The answer, and the four things it is made of.
 *
 * The verdict is a sentence, not a badge: "Ready for the road." is read at a
 * glance and understood without learning what a colour means. The checks
 * under it are always all four - a reader who is not ready wants to see what
 * does work as much as what does not - and only the failing one carries its
 * explanation, because the others explain nothing worth the room.
 */
function Road({ state }: { state: Readiness }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1 px-3">
        {/* The verdict is ordinary text, not a coloured one. `good` and `warn`
            are display tones: measured on the light theme they come out at
            4.1:1 against the page, and this is the sentence the reader acts
            on. The colour lives in the marks below, where it is an icon
            beside a label rather than the label itself. */}
        <h2 className="text-lg font-medium text-text">{verdict(state)}</h2>
        {state.blocker ? <p className="text-sm leading-relaxed text-dim">{state.blocker.detail}</p> : null}
      </header>

      <ul className="mx-3 flex flex-col divide-y divide-line rounded-lg border border-line">
        {state.checks.map((check) => (
          <Requirement key={check.id} check={check} />
        ))}
      </ul>
    </section>
  )
}

/** One check: whether it holds, and what it is. */
function Requirement({ check }: { check: Check }) {
  const [Icon, tone] =
    check.state === 'yes'
      ? [CheckIcon, 'text-good']
      : check.state === 'no'
        ? [CrossIcon, 'text-warn']
        : [PendingIcon, 'text-faint']

  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <Icon size={14} className={tone} />
      <span className={`text-sm ${check.state === 'yes' ? 'text-dim' : 'text-text'}`}>{check.label}</span>
    </li>
  )
}

/**
 * Putting the reader on the phone's own screen.
 *
 * Shown only where it is worth showing: an app already installed says
 * nothing, because the reader has done the thing being suggested. Where the
 * browser offers a prompt there is a button; where it does not - iOS, which
 * installs from the share sheet - there are the words, because a button that
 * cannot work is worse than none.
 */
function OnYourScreen({ offer }: { offer: boolean }) {
  // Asked at render rather than held in state: it changes when the reader
  // opens the installed app, which is a different page load.
  if (standalone()) return null

  return (
    <section className="flex flex-col gap-2 px-3">
      <h2 className="text-sm font-medium text-text">On your screen</h2>
      {offer ? (
        <button
          type="button"
          onClick={() => {
            void install()
          }}
          className="self-start rounded-lg border border-line px-3 py-1.5 text-sm text-text transition-colors hover:border-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Put rhapsod on this device
        </button>
      ) : null}
      <p className="text-xs leading-relaxed text-dim">
        {offer
          ? 'Installed, the library opens by its own icon rather than by an address on your home network - and opens without the browser around it.'
          : 'This browser installs from its own menu: on iPhone, Share and then "Add to Home Screen". The library then opens by its icon rather than by an address on your home network.'}
      </p>
    </section>
  )
}

/**
 * The shelves this device keeps for the road.
 *
 * A list of checkboxes rather than a set of packages to install: the reader
 * is saying what they want with them, not managing downloads. "All of them"
 * is its own row at the top because it is the common answer and the default,
 * and because unticking it one shelf at a time would be tedious in a library
 * of twenty shelves.
 */
function Shelves({
  sections,
  keeping,
  onChange,
}: {
  sections: Section[]
  keeping: Chosen
  onChange: (next: Chosen) => void
}) {
  const all = keeping === null

  const toggle = (id: string): void => {
    // Starting from "all of them" means every shelf is on, so unticking one
    // has to name the rest rather than leave the list empty.
    const now = keeping ?? sections.map((section) => section.id)
    const next = now.includes(id) ? now.filter((kept) => kept !== id) : [...now, id]
    onChange(next.length === sections.length ? null : next)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-3 text-sm font-medium text-text">Kept on this device</h2>
      <ul className="mx-3 flex flex-col divide-y divide-line rounded-lg border border-line">
        <li>
          <Shelf
            label="All of them"
            note={`${sections.length} shelves`}
            on={all}
            onToggle={() => {
              // Unticking "all of them" keeps nothing: the reader is about to
              // say what they want, and starting from an empty list is fewer
              // taps than unticking twenty shelves.
              onChange(all ? [] : null)
            }}
          />
        </li>
        {sections.map((section) => (
          <li key={section.id}>
            <Shelf
              label={section.title}
              note={`${section.pieces} ${section.pieces === 1 ? 'piece' : 'pieces'}`}
              on={holds(keeping, section.id)}
              onToggle={() => {
                toggle(section.id)
              }}
            />
          </li>
        ))}
      </ul>
      <p className="px-3 text-xs leading-relaxed text-dim">
        Shelves you add are fetched in the background. Shelves you remove stay on the device until you fetch the
        library again below - nothing is deleted from under a piece you may be halfway through.
      </p>
    </section>
  )
}

/** One shelf, and whether it rides along. */
function Shelf({
  label,
  note,
  on,
  onToggle,
}: {
  label: string
  note: string
  on: boolean
  onToggle: () => void
}) {
  // `min-h-11` is 44px: a checkbox row is hit with a thumb on a phone, and
  // the text alone left it at 32.
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-soft">
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        className="size-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <span className={`flex-1 text-sm ${on ? 'text-text' : 'text-dim'}`}>{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{note}</span>
    </label>
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
