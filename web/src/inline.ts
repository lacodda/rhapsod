/**
 * Kept lines picked out of text that arrives as runs.
 *
 * A kept line is the words the reader selected, and a selection does not stop
 * at a bold word or a link: on the stand a line kept across one was saved and
 * never highlighted again, because each run was searched on its own. Here the
 * runs are read as one text, the lines are found in that, and the runs are cut
 * where a highlight starts and ends.
 *
 * Matched by words rather than by offset, as before: a piece edited in the vault
 * at worst loses a highlight, where an offset would move it onto the wrong
 * sentence.
 */

import type { Span } from '@/api'

/** A run, cut so that it is either inside a kept line or outside every one. */
export interface MarkedRun extends Span {
  marked: boolean
}

/** The text of a block as a reader sees it. */
export const visibleText = (runs: Span[]): string => runs.map((run) => run.text).join('')

/**
 * Text with each run of whitespace made one space, and where each character of
 * the result came from.
 *
 * A browser draws `a\nb` and `a  b` as `a b`, and a selection reads them back
 * that way; the text keeps what the file had. Searching the collapsed text and
 * mapping back is what lets a line selected across a soft break be found.
 */
function collapse(text: string): { text: string; origin: number[] } {
  let out = ''
  const origin: number[] = []
  let space = false
  for (let at = 0; at < text.length; at += 1) {
    const ch = text.charAt(at)
    if (/\s/u.test(ch)) {
      if (!space && out.length > 0) {
        out += ' '
        origin.push(at)
      }
      space = true
      continue
    }
    space = false
    out += ch
    origin.push(at)
  }
  // A trailing space was pushed for whitespace that ended the text.
  if (out.endsWith(' ')) {
    out = out.slice(0, -1)
    origin.pop()
  }
  return { text: out, origin }
}

const squeeze = (text: string): string => text.split(/\s+/u).filter(Boolean).join(' ')

/** Where the kept lines stand in the visible text, as merged [start, end) ranges. */
export function keptRanges(runs: Span[], lines: string[]): [number, number][] {
  const whole = collapse(visibleText(runs))
  const ranges: [number, number][] = []
  for (const line of lines) {
    const wanted = squeeze(line)
    if (wanted === '') continue
    const at = whole.text.indexOf(wanted)
    if (at === -1) continue
    const start = whole.origin[at]
    const last = whole.origin[at + wanted.length - 1]
    if (start === undefined || last === undefined) continue
    ranges.push([start, last + 1])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/**
 * The runs of a block cut at the edges of its kept lines.
 *
 * Every run keeps its look - strong, emphasis, link - and gains whether it is
 * inside a kept line, so a highlight that crosses a bold word is drawn over
 * both halves of it.
 */
export function markRuns(runs: Span[], lines: string[] = []): MarkedRun[] {
  const ranges = keptRanges(runs, lines)
  const pieces: MarkedRun[] = []
  let offset = 0
  for (const run of runs) {
    const end = offset + run.text.length
    // The edges inside this run: where highlights start and stop.
    const cuts = new Set<number>([offset, end])
    for (const [start, stop] of ranges) {
      if (start > offset && start < end) cuts.add(start)
      if (stop > offset && stop < end) cuts.add(stop)
    }
    const sorted = [...cuts].sort((a, b) => a - b)
    for (let index = 0; index + 1 < sorted.length; index += 1) {
      const from = sorted[index]
      const to = sorted[index + 1]
      if (from === undefined || to === undefined || from === to) continue
      const marked = ranges.some(([start, stop]) => start <= from && to <= stop)
      pieces.push({ ...run, text: run.text.slice(from - offset, to - offset), marked })
    }
    offset = end
  }
  return pieces
}
