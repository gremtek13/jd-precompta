import { useState, useSyncExternalStore } from 'react'
import {
  estEnApplication, lireEtatInstallation, prendreInvite, propositionInstallation, sAbonnerInstallation,
} from '../lib/installation'
import { IconInstaller } from './icons'

// « Installer l'application », une entrée du menu du compte — à côté de l'apparence, du thème et de
// la déconnexion, là où le cabinet l'a voulue plutôt qu'en bouton permanent dans la barre (voir
// lib/installation.ts pour ce que chaque navigateur permet). Elle disparaît dans l'application
// installée, et sur un téléphone, où les navigateurs n'ouvrent pas cette invite.
export default function BoutonInstallation({ nomApplication, fermerMenu }: {
  nomApplication: string
  /** Referme le menu qui porte l'entrée : la fenêtre d'installation du navigateur prend la suite. */
  fermerMenu: () => void
}) {
  const etat = useSyncExternalStore(sAbonnerInstallation, lireEtatInstallation)
  const [consigneOuverte, setConsigneOuverte] = useState(false)

  const proposition = propositionInstallation({
    enApplication: estEnApplication(),
    etat,
    userAgent: navigator.userAgent,
    pointsTactiles: navigator.maxTouchPoints ?? 0,
    nomApplication,
    adresse: window.location.origin,
  })
  if (proposition.type === 'rien') return null

  async function installer() {
    // La consigne se déplie SOUS l'entrée, menu ouvert : c'est une phrase à lire, pas une action.
    if (proposition.type === 'consigne') {
      setConsigneOuverte((v) => !v)
      return
    }
    // L'invite est retirée AVANT d'être ouverte : un second clic du même rendu ne trouve plus rien,
    // au lieu d'appeler une seconde fois `prompt()`, qui lèverait. Et `prompt()` part avant le
    // premier `await`, dans le geste de l'utilisateur, comme le navigateur l'exige.
    const invite = prendreInvite()
    if (!invite) return
    fermerMenu()
    try {
      await invite.prompt()
      // Acceptée, `appinstalled` suit et l'entrée disparaît ; refusée, l'invite est consommée et la
      // consigne prend le relais au clic suivant.
      await invite.userChoice
    } catch (erreur) {
      console.error('Fenêtre d’installation non ouverte :', erreur)
    }
  }

  return (
    <>
      <button
        type="button"
        className="nav-menu-item"
        onClick={installer}
        aria-expanded={proposition.type === 'consigne' ? consigneOuverte : undefined}
      >
        <IconInstaller width={16} height={16} />
        Installer l'application
      </button>
      {proposition.type === 'consigne' && consigneOuverte && (
        <p className="menu-consigne" role="note">{proposition.texte}</p>
      )}
    </>
  )
}
