/**
 * One answer to the only question a reader asks before leaving the house:
 * will this work on the train?
 *
 * Everything needed for that answer is already on the stand screen, spread
 * across four groups of facts - the secure context, the worker, the index,
 * the pieces held. Spread out, it asks the reader to do the reasoning: to
 * know that a worker without a secure context is not a worker, that an index
 * without pieces opens an empty library. This module does that reasoning once
 * and says yes or no.
 *
 * The rule for what goes in: a check earns its place only if failing it means
 * the library does not open away from home. Storage estimates, versions and
 * the queue are facts about the stand, not about the road, and stay facts.
 */

/** What the road needs, in the order it breaks. */
export type CheckId = 'secure' | 'worker' | 'index' | 'pieces'

/** Whether a check passed, failed, or has not answered yet. */
export type CheckState = 'yes' | 'no' | 'asking'

/** One thing that has to be true, and what it means when it is not. */
export interface Check {
  id: CheckId
  /** What is being checked, as a reader would say it. */
  label: string
  state: CheckState
  /**
   * What this means. Written for the failing case, because that is when it is
   * read - and it says what to do, not what went wrong.
   */
  detail: string
}

/** The answer, and the reasoning behind it. */
export interface Readiness {
  /**
   * `true` only when every check passed. `false` when one failed, and
   * `null` while any of them is still asking: "not ready" and "not known
   * yet" are different answers and the screen shows them differently.
   */
  ready: boolean | null
  /** The first failing check - the one thing to fix. */
  blocker: Check | null
  checks: Check[]
}

/** What the readiness answer is computed from. */
export interface RoadFacts {
  /** Whether the page is in a secure context, so a worker is allowed at all. */
  secure: boolean
  /** Whether this browser has service workers, and one is registered. */
  worker: boolean | null
  /** Whether the index is in the cache; `null` while the cache is being read. */
  index: boolean | null
  /** Pieces held on the device; `null` while the cache is being read. */
  held: number | null
  /**
   * Pieces the road needs: the whole library, or only the chosen shelves.
   *
   * Counted against the selection rather than the library, because a reader
   * who keeps two shelves of ten is ready with twenty pieces and telling them
   * otherwise would make the choice useless.
   */
  total: number
}

/**
 * Whether the reader can leave.
 *
 * Order matters: the checks are listed the way the failures cause each other,
 * so the first failing one is the real problem and the rest are its symptoms.
 * A page served over plain http cannot register a worker, and without a worker
 * nothing is cached - showing all three as failures would be true and useless.
 */
export function readiness(facts: RoadFacts): Readiness {
  const checks: Check[] = [
    {
      id: 'secure',
      label: 'a secure connection',
      state: facts.secure ? 'yes' : 'no',
      detail: facts.secure
        ? 'This page is served over https, so the browser allows an offline copy.'
        : 'Browsers keep offline storage for secure pages only. Open this stand over https and everything below follows; over plain http nothing can be held, however long the app is left open.',
    },
    {
      id: 'worker',
      label: 'an offline reader',
      state: facts.worker === null ? 'asking' : facts.worker ? 'yes' : 'no',
      detail: facts.worker
        ? 'The part of the app that answers when the stand is out of reach is installed.'
        : facts.secure
          ? 'This browser has not installed the offline part of the app. Reloading the page once usually installs it; a private window never will.'
          : 'Nothing can be installed until the connection is secure - fix that first.',
    },
    {
      id: 'index',
      label: 'the list of what is on the shelves',
      state: facts.index === null ? 'asking' : facts.index ? 'yes' : 'no',
      detail: facts.index
        ? 'The library opens away from home, not just the pieces already read.'
        : 'Without the index the app has no shelves to show and cannot start away from the stand, even where every piece is held.',
    },
    {
      id: 'pieces',
      label: 'the pieces themselves',
      state:
        facts.held === null
          ? 'asking'
          : // An empty library is held completely, and saying "no" about it
            // would blame the reader for the author not having published.
            facts.total === 0 || facts.held >= facts.total
            ? 'yes'
            : 'no',
      detail:
        facts.held === null
          ? 'Counting what this device holds.'
          : facts.total === 0
            ? 'There is nothing on the shelves yet.'
            : facts.held >= facts.total
              ? `All ${facts.total} pieces of the shelves you keep are on this device.`
              : `${facts.held} of ${facts.total} pieces are held. The rest are still being fetched - staying on this page while the stand is reachable finishes the job.`,
    },
  ]

  const blocker = checks.find((check) => check.state === 'no') ?? null
  const asking = checks.some((check) => check.state === 'asking')

  return {
    // A known failure outranks an unanswered check: if the connection is not
    // secure, the answer is no whether or not the cache has finished counting.
    ready: blocker !== null ? false : asking ? null : true,
    blocker,
    checks,
  }
}

/** The one line at the top of the screen. */
export function verdict(state: Readiness): string {
  if (state.ready === null) return 'Checking…'
  if (state.ready) return 'Ready for the road.'
  return 'Not ready for the road.'
}
