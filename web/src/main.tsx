import { overlayScrollbars } from 'dowel-ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'
import { watchForInstall } from '@/install'
import { registerWorker } from '@/offline'
import '@/styles.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('#root is missing from index.html')
}

// Before the render rather than after: the registration itself waits for the
// load event, and putting it here means a reload while offline already has a
// worker to answer from.
registerWorker()

// The browser fires its install offer once, early, and only the event it
// hands over can raise the prompt - so the listener has to be attached before
// the app renders anything.
watchForInstall()

// A phone draws its own scrollbar, one that takes no width; the theme's strip
// steps aside for it before anything is laid out, so the page never moves by
// the strip's width. Where the engine draws no such bar - a site in a browser
// on Windows - the strip stays.
overlayScrollbars()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
