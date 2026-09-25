import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  estEnApplication, lireEtatInstallation, prendreInvite, propositionInstallation, sAbonnerInstallation,
} from '../lib/installation'
import { IconInstaller } from './icons'

// « Installer l'application », en bas de la barre latérale d'ordinateur (voir lib/installation.ts pour
// ce que chaque navigateur permet). Il disparaît dans l'application installée, et sur mobile avec le
// reste de ce que la barre d'ordinateur ajoute.
export default function BoutonInstallation({ nomApplication }: { nomApplication: string }) {
  const etat = useSyncExternalStore(sAbonnerInstallation, lireEtatInstallation)
  const [consigneOuverte, setConsigneOuverte] = useState(false)
  const conteneur = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!consigneOuverte) return
    function surClicExterieur(e: MouseEvent) {
      if (conteneur.current && !conteneur.current.contains(e.target as Node)) setConsigneOuverte(false)
    }
    function surEchap(e: KeyboardEvent) {
      if (e.key === 'Escape') setConsigneOuverte(false)
    }
    document.addEventListener('mousedown', surClicExterieur)
    document.addEventListener('keydown', surEchap)
    return () => {
      document.removeEventListener('mousedown', surClicExterieur)
      document.removeEventListener('keydown', surEchap)
    }
  }, [consigneOuverte])

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
    if (proposition.type === 'consigne') {
      setConsigneOuverte((v) => !v)
      return
    }
    // L'invite est retirée AVANT d'être ouverte : un second clic du même rendu ne trouve plus rien,
    // au lieu d'appeler une seconde fois `prompt()`, qui lèverait.
    const invite = prendreInvite()
    if (!invite) return
    try {
      await invite.prompt()
      // Acceptée, `appinstalled` suit et le bouton disparaît ; refusée, l'invite est consommée et la
      // consigne prend le relais au clic suivant.
      await invite.userChoice
    } catch (erreur) {
      console.error('Fenêtre d’installation non ouverte :', erreur)
    }
  }

  return (
    <div className="barre-installation" ref={conteneur}>
      <button
        type="button"
        className="barre-installer"
        onClick={installer}
        aria-expanded={proposition.type === 'consigne' ? consigneOuverte : undefined}
        title="Installer l'application sur cet ordinateur"
      >
        <IconInstaller width={18} height={18} />
        <span className="barre-libelle">Installer l'application</span>
      </button>
      {proposition.type === 'consigne' && consigneOuverte && (
        <div className="options-menu consigne-installation" role="note">
          <strong>Installer l'application</strong>
          <p>{proposition.texte}</p>
        </div>
      )}
    </div>
  )
}
