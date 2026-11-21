import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, loadThemePref } from './lib/theme'

applyTheme(loadThemePref()) // before the first render, so a dark preference never flashes light

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
