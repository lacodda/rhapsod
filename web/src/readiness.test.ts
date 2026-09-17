import { describe, expect, it } from 'vitest'

import { readiness, verdict, type RoadFacts } from '@/readiness'

/** A device that is ready: every check passes. */
const READY: RoadFacts = { secure: true, worker: true, index: true, held: 62, total: 62 }

const facts = (patch: Partial<RoadFacts>): RoadFacts => ({ ...READY, ...patch })

describe('readiness', () => {
  it('says yes only when everything holds', () => {
    const state = readiness(READY)
    expect(state.ready).toBe(true)
    expect(state.blocker).toBeNull()
    expect(verdict(state)).toBe('Ready for the road.')
  })

  it('says no over plain http, whatever else is true', () => {
    const state = readiness(facts({ secure: false }))
    expect(state.ready).toBe(false)
    expect(state.blocker?.id).toBe('secure')
  })

  it('blames the connection rather than the worker when both are missing', () => {
    // The worker cannot install without a secure context, so reporting the
    // worker would send the reader after a symptom.
    const state = readiness(facts({ secure: false, worker: false }))
    expect(state.blocker?.id).toBe('secure')
  })

  it('names the worker when the connection is secure and it is still absent', () => {
    const state = readiness(facts({ worker: false }))
    expect(state.ready).toBe(false)
    expect(state.blocker?.id).toBe('worker')
  })

  it('is not ready without the index, however many pieces are held', () => {
    const state = readiness(facts({ index: false }))
    expect(state.ready).toBe(false)
    expect(state.blocker?.id).toBe('index')
  })

  it('is not ready while pieces are still being fetched', () => {
    const state = readiness(facts({ held: 40, total: 62 }))
    expect(state.ready).toBe(false)
    expect(state.blocker?.id).toBe('pieces')
    expect(state.blocker?.detail).toContain('40 of 62')
  })

  it('counts an empty library as held, not as missing', () => {
    // Nothing published is the author's business, not a fault of the device.
    const state = readiness(facts({ held: 0, total: 0 }))
    expect(state.ready).toBe(true)
  })

  it('treats more held than the index lists as held', () => {
    // A piece withdrawn from the library stays in the cache until a refresh;
    // that is not a reason to tell the reader they cannot leave.
    const state = readiness(facts({ held: 63, total: 62 }))
    expect(state.ready).toBe(true)
  })

  it('answers "not known yet" rather than "no" while the cache is being read', () => {
    const state = readiness(facts({ index: null, held: null }))
    expect(state.ready).toBeNull()
    expect(state.blocker).toBeNull()
    expect(verdict(state)).toBe('Checking…')
  })

  it('answers no while still counting, when something already failed', () => {
    // A known failure is an answer; waiting for the count would withhold it.
    const state = readiness(facts({ secure: false, index: null, held: null }))
    expect(state.ready).toBe(false)
    expect(state.blocker?.id).toBe('secure')
  })

  it('keeps every check in the answer, not only the failing one', () => {
    // The screen lists them all: the reader sees what does work as well.
    const state = readiness(facts({ worker: false }))
    expect(state.checks.map((check) => check.id)).toEqual(['secure', 'worker', 'index', 'pieces'])
    expect(state.checks[0]?.state).toBe('yes')
  })

  it('tells the reader what to do about a missing worker, not what is broken', () => {
    const state = readiness(facts({ worker: false }))
    expect(state.blocker?.detail).toContain('Reloading')
  })
})
