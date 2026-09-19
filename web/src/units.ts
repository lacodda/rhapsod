/**
 * Saying how long ago and how much, in words a reader reads past.
 *
 * These are the two numbers the stand screen has that are not counts, and
 * both are worse as raw values: "indexed 93784 seconds ago" is a sum, not a
 * fact.
 */

/** Seconds as "just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function ago(seconds: number): string {
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** Bytes as "312 kB" or "4.2 MB": one decimal past a megabyte, none below. */
export function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * How long ago an instant was, given as an ISO timestamp.
 *
 * `ago` takes seconds, which is what the health endpoint gives; sessions carry
 * the moment itself. Converting here rather than at each call site keeps one
 * idea of what "2 days ago" means on a screen.
 *
 * A timestamp that cannot be read is said to be unknown rather than rendered
 * as "NaN days ago": these come from the database and should always parse, so
 * the case is about being honest if one ever does not.
 */
export function since(stamp: string, now: number = Date.now()): string {
  const at = Date.parse(stamp)
  if (Number.isNaN(at)) return 'at an unknown time'
  // A clock a little ahead of the stand's would otherwise read as "-1 days
  // ago"; there is no useful thing to say about the future here.
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  return ago(seconds)
}
