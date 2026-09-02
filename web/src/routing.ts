/**
 * Where the reader is, kept in the address bar.
 *
 * A router library would be three screens of dependency for three routes. The
 * History API is what a router uses anyway, and using it directly keeps the
 * back button — the one navigation control a phone reader actually presses —
 * honest without anything in between.
 */

import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'section'; section: string }
  | { name: 'piece'; id: string }
  | { name: 'quotes' }
  | { name: 'today' }
  // The kind is part of the address: a filter the reader can bookmark in
  // their own browser, and one the back button steps through.
  | { name: 'bookmarks'; kind?: string }

/** Reads the current path as a route. An unknown path is the library. */
export function parse(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/gu, '').split('/')

  if (parts[0] === 'quotes') {
    return { name: 'quotes' }
  }
  if (parts[0] === 'today') {
    return { name: 'today' }
  }
  if (parts[0] === 'bookmarks') {
    return parts[1] ? { name: 'bookmarks', kind: parts[1] } : { name: 'bookmarks' }
  }
  if (parts[0] === 'section' && parts[1]) {
    return { name: 'section', section: parts[1] }
  }
  // A piece's id is two segments — a shelf and a piece on it — so the URL
  // shows where in the library the reader is, not an opaque token.
  if (parts[0] === 'read' && parts[1] && parts[2]) {
    return { name: 'piece', id: `${parts[1]}/${parts[2]}` }
  }
  return { name: 'library' }
}

/** The path a route lives at. */
export function href(route: Route): string {
  switch (route.name) {
    case 'section':
      return `/section/${route.section}`
    case 'piece':
      return `/read/${route.id}`
    case 'quotes':
      return '/quotes'
    case 'today':
      return '/today'
    case 'bookmarks':
      return route.kind ? `/bookmarks/${route.kind}` : '/bookmarks'
    default:
      return '/'
  }
}

/** Goes to a route, adding it to the history so back returns here. */
export function go(route: Route): void {
  window.history.pushState({}, '', href(route))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** The current route, updated on back, forward and `go`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname))

  useEffect(() => {
    const update = (): void => {
      setRoute(parse(window.location.pathname))
    }
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('popstate', update)
    }
  }, [])

  return route
}
