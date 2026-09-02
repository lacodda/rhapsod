/**
 * The icons the interface draws.
 *
 * Real SVG rather than text glyphs. A character like `♪` is rendered by
 * whatever font on the device happens to carry it: its size, weight and
 * baseline are all somebody else's decision, and on a phone it came out small
 * enough to disappear beside the label it belongs to. A path is drawn at the
 * size it is given, the same on every machine.
 *
 * Every icon takes its colour from `currentColor`, so it follows the token on
 * the element around it and needs no colour of its own.
 */

/** What every icon accepts. Sized in pixels, because that is what a box is. */
interface IconProps {
  /** Edge length. The default suits a button label; a bare button wants more. */
  size?: number
  className?: string
}

/** Shared attributes: a square viewBox and strokes that scale with it. */
function frame(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
    className: `shrink-0${className ? ` ${className}` : ''}`,
  }
}

/** Loved: a star, filled, because the mark is the whole point of it. */
export function StarIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)} fill="currentColor" strokeWidth={1.25}>
      <path d="M12 3.6l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
    </svg>
  )
}

/** Come back: an arrow curving back on itself. */
export function ReturnIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4 8.5h10a5 5 0 0 1 0 10H8" />
      <path d="M7.5 5 4 8.5 7.5 12" />
    </svg>
  )
}

/**
 * For a song: a note.
 *
 * The one that was worst as a glyph - `♪` is small in most fonts and missing
 * from a few. Drawn here as a stem with a filled head, at the same weight as
 * its neighbours.
 */
export function NoteIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M9 18V6.5l9-2v11" />
      <circle cx="6.5" cy="18" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Read again: an arrow going round. */
export function RepeatIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4 12a8 8 0 0 1 8-8c2.6 0 4.9 1.2 6.4 3.2" />
      <path d="M20 12a8 8 0 0 1-8 8c-2.6 0-4.9-1.2-6.4-3.2" />
      <path d="M18.4 3.5v3.7h-3.7" />
      <path d="M5.6 20.5v-3.7h3.7" />
    </svg>
  )
}

/** The menu: three lines. */
export function MenuIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

/** Closing something: a cross. */
export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** A tick, for something already done. */
export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  )
}

/** Onward, into a screen or a piece. */
export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

/** Back to what came before. */
export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...frame(size, className)}>
      <path d="M20 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}
