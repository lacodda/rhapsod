/**
 * Reading the journal's dates.
 *
 * The server groups by the device's clock and sends calendar dates - `2026-09`
 * and `2026-09-07` - which are not instants. Turning one into a `Date` and
 * back would run it through the time zone twice and land a day early for
 * anyone west of Greenwich, so every label here is built from the digits.
 */

import type { Opened } from '@/api'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Minutes east of UTC on this device, as the journal endpoint wants it. */
export function clockOffset(now: Date = new Date()): number {
  // `getTimezoneOffset` is minutes *behind* UTC - positive in the Americas -
  // which is the opposite sign of how anyone writes a zone.
  return -now.getTimezoneOffset()
}

/** `2026-09` as "September 2026". An unrecognised string comes back as it is. */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-')
  const name = MONTHS[Number(index) - 1]
  return name && year ? `${name} ${year}` : month
}

/** A calendar date as `YYYY-MM-DD`, by the device's clock. */
export function localDay(now: Date = new Date()): string {
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * `2026-09-07` as "Sunday 7 September", or "Today" and "Yesterday" for the
 * two days a reader does not need named.
 */
export function dayLabel(day: string, today: string = localDay()): string {
  if (day === today) return 'Today'
  if (day === dayBefore(today)) return 'Yesterday'
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  // UTC on purpose: the parts are a calendar date, and building the Date in
  // UTC and reading it back in UTC is the one way through `Date` that does
  // not shift it.
  const weekday = new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  })
  const name = MONTHS[month - 1] ?? ''
  return `${weekday} ${date} ${name}`
}

/** The calendar day before a `YYYY-MM-DD`. */
function dayBefore(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return ''
  const before = new Date(Date.UTC(year, month - 1, date - 1))
  return before.toISOString().slice(0, 10)
}

/** The time of day an opening was, by this device's clock. */
export function timeLabel(openedAt: string): string {
  return new Date(openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** One day of the history: the day and everything opened on it. */
export interface Day {
  day: string
  opened: Opened[]
}

/**
 * The history as days, in the order the server sent the lines.
 *
 * The server already collapsed openings to a line per piece per day and put
 * the newest day first; this only draws the borders between days.
 */
export function byDay(history: Opened[]): Day[] {
  const days: Day[] = []
  for (const line of history) {
    const last = days[days.length - 1]
    if (last && last.day === line.day) {
      last.opened.push(line)
    } else {
      days.push({ day: line.day, opened: [line] })
    }
  }
  return days
}
