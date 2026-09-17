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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
