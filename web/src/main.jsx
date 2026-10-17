import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import './index.css'
import App from './App.jsx'
import { DEFAULT_THEME_ID, applyTheme, themeMeta } from './lib/themes'

try {
  const raw = localStorage.getItem('drawland.theme')
  const id = raw != null ? JSON.parse(raw) : DEFAULT_THEME_ID
  applyTheme(typeof id === 'string' ? themeMeta(id).id : DEFAULT_THEME_ID)
} catch {
  applyTheme(DEFAULT_THEME_ID)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
