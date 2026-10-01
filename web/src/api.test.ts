import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, fetchLibrary } from '@/api'
import { sawServer, syncState } from '@/sync'

// Whether the stand is there is decided by who answered, not by whether an
// answer came. The worker answers from its copy when the stand is away, and
// a copy counted as the stand hid "the stand is away" the moment a held
// piece was opened on a train.

const INDEX = { sections: [], pieces: [] }

/** A fetch that answers with the index, from the stand or from the worker's copy. */
function answering({ cached }: { cached: boolean }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json(INDEX, { headers: cached ? { 'x-rhapsod-cached': '1' } : undefined })),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a read', () => {
  it('counts the stand as there when the stand answered', async () => {
    sawServer(false)
    answering({ cached: false })

    expect(await fetchLibrary()).toEqual(INDEX)
    expect(syncState().reachable).toBe(true)
  })

  it('counts the stand as away when the answer came from the worker', async () => {
    sawServer(true)
    answering({ cached: true })

    // Still readable - that is what the copy is for.
    expect(await fetchLibrary()).toEqual(INDEX)
    expect(syncState().reachable).toBe(false)
  })

  it('refuses the worker copy when only the stand will do', async () => {
    // A refresh of the library asked against the copy would fetch nothing
    // and then report success.
    answering({ cached: true })

    const read = fetchLibrary({ fresh: true })

    await expect(read).rejects.toBeInstanceOf(ApiError)
    await expect(read).rejects.toMatchObject({ status: 0 })
  })

  it('takes the stand answer when only the stand will do', async () => {
    answering({ cached: false })
    expect(await fetchLibrary({ fresh: true })).toEqual(INDEX)
  })
})
