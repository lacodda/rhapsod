/**
 * What the build writes into the service worker.
 *
 * Files in `public/` are copied verbatim, so `define` does not reach the
 * worker; the build stamps it after the copy (see `vite.config.ts`). Kept
 * apart from the config so the worker's own tests run the stamped worker
 * rather than a description of the stamping.
 */

/** Where the app's version goes: it names the shell cache. */
const VERSION_MARK = '__APP_VERSION__'

/**
 * Where the list of the app's files goes. An array literal, so the worker as
 * written is still valid script - and one that will not install, because
 * there is no such file to hold.
 */
const FILES_MARK = "['__SHELL_FILES__']"

/** The document every route is answered with; `ENTRY` in `public/sw.js`. */
export const ENTRY = '/index.html'

/**
 * The worker as built: named by the version, holding every file of the app.
 *
 * Every file, not a chosen few: a list someone keeps by hand is a list that
 * forgets the next script the build splits off, and the app then opens to a
 * blank page on the train. `files` are paths as the stand serves them - from
 * the build's output, the worker itself left out.
 */
export function stampWorker(source: string, version: string, files: readonly string[]): string {
  if (!source.includes(VERSION_MARK)) {
    // A worker that did not take the version would cache under a name that
    // never changes, and no deploy would ever retire the old shell.
    throw new Error(`sw.js has no ${VERSION_MARK} to stamp; the shell cache would never be versioned`)
  }
  if (!source.includes(FILES_MARK)) {
    throw new Error(`sw.js has no ${FILES_MARK} to stamp; the app would not be held for the road`)
  }
  if (!files.includes(ENTRY)) {
    // Every route is answered with the entry; a shell without it opens nothing.
    throw new Error(`the build has no ${ENTRY}; there is no app for the worker to hold`)
  }
  const held = [...new Set(files)].sort()
  return source.replaceAll(VERSION_MARK, version).replace(FILES_MARK, JSON.stringify(held))
}
