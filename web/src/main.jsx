import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import './index.css'
import App from './App.jsx'

// Settings saved while the app was called postcards.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('postcards.')) continue
    const renamed = `drawland.${key.slice('postcards.'.length)}`
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key))
    localStorage.removeItem(key)
  }
} catch {
  // No localStorage (private mode): nothing was saved.
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
