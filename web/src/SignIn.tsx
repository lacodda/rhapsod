/**
 * The gate, on a stand that has a password.
 *
 * One field, because there is one reader and nothing to choose. A stand
 * without a password never shows this screen at all.
 */

import { useState } from 'react'

import { ApiError, signIn } from '@/api'

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setError(null)
        void signIn(password)
          .then(() => {
            onSignedIn()
          })
          .catch((cause: unknown) => {
            setError(cause instanceof ApiError && cause.status === 401 ? 'That is not the password.' : 'The stand did not answer.')
            setBusy(false)
          })
      }}
      className="flex flex-col gap-4 px-3 py-12"
    >
      <label htmlFor="password" className="flex flex-col gap-2">
        <span className="text-base text-text">The password for this library</span>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          // The reader is on their own phone reaching their own stand; the
          // browser remembering this is a convenience, not a risk.
          autoComplete="current-password"
          autoFocus
          className="rounded-lg border border-line bg-soft px-3 py-2 text-base text-text outline-none focus-visible:border-accent"
        />
      </label>
      {error === null ? null : (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Opening…' : 'Read'}
      </button>
    </form>
  )
}
