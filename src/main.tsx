import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Les deux polices de l'interface, servies par l'application elle-même et plus par Google (voir
// lib/polices.ts) : Manrope, et Inter en repli de la pile d'index.css. Mêmes graisses qu'avant.
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import './index.css'
import App from './App.tsx'
import { ecouterInstallation } from './lib/installation'

// Avant tout rendu : l'invite d'installation du navigateur n'arrive qu'une fois par chargement de page,
// et la barre latérale qui la propose n'est pas encore montée (voir lib/installation.ts).
ecouterInstallation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
