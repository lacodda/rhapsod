import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'
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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
