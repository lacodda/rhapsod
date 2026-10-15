import { describe, expect, it } from 'vitest'

import type { Span } from '@/api'
import { keptRanges, markRuns, visibleText } from '@/inline'

/** The paragraph the reader kept a line from on the stand: half plain, half bold. */
const curling: Span[] = [
  { text: 'Now the mechanism, and here is the thing to carry away. ' },
  { text: 'The stone listens to the ice, not to you.', strong: true },
  { text: ' You let it go, and that is all.' },
]

/** The marked text of a block, as a reader would see it highlighted. */
const highlighted = (runs: Span[], lines: string[]): string =>
  markRuns(runs, lines)
    .filter((run) => run.marked)
    .map((run) => run.text)
    .join('')

describe('markRuns', () => {
  it('picks out a kept line that crosses a bold run', () => {
    // On the stand this line was saved and never highlighted again: each run
    // was searched on its own, and the line is in none of them whole.
    const line = 'thing to carry away. The stone listens to the ice, not to you. You let it go'
    expect(highlighted(curling, [line])).toBe(line)
  })

  it('keeps the look of every run it cuts', () => {
    const runs = markRuns(curling, ['carry away. The stone'])
    const bold = runs.filter((run) => run.strong)
    expect(bold.map((run) => [run.text, run.marked])).toEqual([
      ['The stone', true],
      [' listens to the ice, not to you.', false],
    ])
  })

  it('draws a block with nothing kept as the runs it came as', () => {
    expect(markRuns(curling, [])).toEqual(curling.map((run) => ({ ...run, marked: false })))
  })

  it('finds a line selected across a soft line break', () => {
    // A browser draws the break in the file as a space, and the selection
    // reads back a space.
    const runs: Span[] = [{ text: 'On the\nice the drops are called ' }, { text: 'pebble', em: true }, { text: '.' }]
    expect(highlighted(runs, ['On the ice the drops are called pebble'])).toBe('On the\nice the drops are called pebble')
  })

  it('merges lines that overlap into one highlight', () => {
    const start = visibleText(curling).indexOf('The stone')
    expect(keptRanges(curling, ['The stone listens', 'listens to the ice'])).toEqual([[start, start + 'The stone listens to the ice'.length]])
  })

  it('leaves a line that is no longer in the text unmarked', () => {
    // An edit in the vault loses a highlight rather than moving it.
    expect(highlighted(curling, ['The stone listens to the river'])).toBe('')
  })
})

describe('visibleText', () => {
  it('is what a selection reads back', () => {
    expect(visibleText(curling)).toBe(
      'Now the mechanism, and here is the thing to carry away. The stone listens to the ice, not to you. You let it go, and that is all.',
    )
  })
})
