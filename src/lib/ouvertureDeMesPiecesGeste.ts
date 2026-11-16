import { useRef, useState } from 'react'
import { ouvrirApercu } from './apercu'
import { FICHIER_INTROUVABLE, motDuRefus, type FichierDUnEnvoi } from './ouvertureDeMesPieces'
// LE GESTE « VOIR » DE L'ESPACE CLIENT (16/11/2026) : « Mes pièces » et « Mes derniers envois » de l'accueil l'appellent, écrit
// une fois. Le fichier s'ouvre par `ouvrirApercu` SEUL (lib/apercu.ts : pas de `noopener`, le retour de `window.open` lu, le
// chemin rejugé contre le dossier) ; un fichier que le module pur n'a pas su désigner ne part pas au stockage.
//
// SOUS VERROU : un `useRef` posé avant le premier `await` et relâché dans le `finally` — deux touchers rapides du même rendu
// (le bouton n'est désactivé qu'au rendu suivant) n'ouvrent pas deux fenêtres. L'état `enCours` n'est que l'affichage.
// Le refus se dit aux mots du client (`motDuRefus`), jamais avec le chemin ni la phrase du cabinet ; il s'efface au geste
// suivant. Ce module importe `supabase.ts` (par `apercu.ts`) ; les mots et le choix du fichier restent dans le module pur.

/** Validité de l'adresse signée : le temps de consulter un justificatif à l'écran, comme côté cabinet. */
const VALIDITE_SECONDES = 300

export interface OuvertureDeMesPieces {
  /** Ouvre le fichier, ou dit pourquoi il ne s'ouvre pas. Sans effet tant qu'une ouverture est en cours. */
  ouvrir: (fichier: FichierDUnEnvoi | null) => Promise<void>
  enCours: boolean
  /** La phrase de l'échec de la dernière ouverture, ou `null`. */
  refus: string | null
}

export function useOuvertureDeMesPieces(): OuvertureDeMesPieces {
  const verrou = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)

  async function ouvrir(fichier: FichierDUnEnvoi | null) {
    if (verrou.current) return
    verrou.current = true
    setEnCours(true)
    setRefus(null)
    try {
      if (fichier === null) {
        setRefus(FICHIER_INTROUVABLE)
        return
      }
      const resultat = await ouvrirApercu(fichier.seau, fichier.chemin, VALIDITE_SECONDES, fichier.dossierId)
      if (!resultat.ok) setRefus(motDuRefus(resultat.cause))
    } catch {
      // Un appel qui lève (le réseau coupé sous la signature) se dit comme un lien qui n'a pas pu se créer.
      setRefus(motDuRefus('lien'))
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }

  return { ouvrir, enCours, refus }
}
