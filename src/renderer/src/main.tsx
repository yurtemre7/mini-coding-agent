import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './OverlayApp'
import './index.css'
import { applyTheme, loadThemePref } from './lib/theme'

applyTheme(loadThemePref()) // before the first render, so a dark preference never flashes light

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('view') === 'overlay' ? <OverlayApp /> : <App />}
  </StrictMode>
)
