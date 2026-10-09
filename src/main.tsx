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
import { lireRetourDuLien } from './lib/recuperationMotDePasse'

// Avant tout rendu : l'invite d'installation du navigateur n'arrive qu'une fois par chargement de page,
// et la barre latérale qui la propose n'est pas encore montée (voir lib/installation.ts).
ecouterInstallation()

// Avant tout rendu aussi, et c'est voulu : l'adresse d'un lien « Mot de passe oublié » n'existe qu'au chargement. Le
// client Supabase, construit à l'import de lib/supabase.ts, ne vide le fragment qu'après avoir vérifié le jeton auprès
// du service — un aller-retour réseau, qui ne peut finir avant la fin de ce script, le paquet n'ayant aucun `await` de
// niveau module (lib/recuperationMotDePasse.ts ; joué sur le vrai client : lib/recuperationMotDePasseClient.test.ts).
const retourDuLien = lireRetourDuLien(window.location.href)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App retourDuLien={retourDuLien} />
  </StrictMode>,
)
