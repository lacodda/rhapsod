import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// The import attribute is required by Vite's native config loader.
import pkg from './package.json' with { type: 'json' }
import { stampWorker } from './src/stamp'

/**
 * Stamps the service worker with the app's version and the list of its files.
 *
 * Files in `public/` are copied verbatim, so `define` does not reach them and
 * the worker would ship with the placeholders in it - leaving every deploy
 * sharing one shell cache, and the worker holding nothing of the app. The
 * substitution happens on the built file, so `pnpm dev` serves the source as
 * it is written. The list is the build's own output, read after it is
 * written: it cannot name a file the build did not make, or miss one it did.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'rhapsod-stamp-service-worker',
    apply: 'build',
    // After the public directory has been copied into the output.
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url))
      const worker = join(dist, 'sw.js')
      // As the stand serves them: from the root, with forward slashes.
      const files = readdirSync(dist, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `/${relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/')}`)
        .filter((path) => path !== '/sw.js')
      writeFileSync(worker, stampWorker(readFileSync(worker, 'utf8'), pkg.version, files))
    },
  }
}

// Test configuration lives in vitest.config.ts: a `test` block here does not
// type-check against Vite's own config type.
export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // The API runs separately during development; proxying keeps the SPA on
    // same-origin paths, so no CORS handling is needed here or on the server.
    proxy: {
      '/api': 'http://127.0.0.1:8084',
    },
  },
})
