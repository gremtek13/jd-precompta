import { useCallback, useEffect, useRef, useState } from 'react'
import type { EspaceVentes } from './espaceVentes'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from './paiementsAssuranceMaladie'
import { lireLesPaiementsAssuranceMaladie, type PaiementsLus } from './paiementsAssuranceMaladieLecture'

// LA LECTURE DES PAIEMENTS DE L'ASSURANCE MALADIE, TENUE PAR UN ÉCRAN (NOE5b). À part de la lecture elle-même, que les
// tests d'écran remplacent : le crochet appelle la fonction du module, jamais une copie.

/**
 * La lecture des paiements, gardée avec le dossier qu'elle a lu, et sa relecture (attendue : un geste relâche son verrou
 * APRÈS elle). Partagée par l'onglet Banque — la fiche d'un crédit, la section NOEMIE et les candidats d'une vente facturée
 * lisent la même — ; « Ma banque » monte la section seule, qui l'appelle elle-même. Drapeau de NOE3 baissé : rien ne se lit,
 * et la lecture reste nulle.
 */
export function useLesPaiementsAssuranceMaladie(dossierId: string, espace: EspaceVentes):
  { lu: PaiementsLus | null; relire: () => Promise<void> } {
  const [lecture, setLecture] = useState<{ cle: string; lu: PaiementsLus } | null>(null)
  // La dernière demande seule écrit : une lecture plus lente, partie avant une relecture, ne l'écrase pas.
  const derniere = useRef(0)
  const relire = useCallback(async () => {
    if (!PAIEMENTS_ASSURANCE_MALADIE_PREVUS) return
    const jeton = ++derniere.current
    const lu = await lireLesPaiementsAssuranceMaladie(dossierId, espace)
    if (jeton === derniere.current) setLecture({ cle: `${dossierId}|${espace}`, lu })
  }, [dossierId, espace])
  useEffect(() => {
    const jetons = derniere
    void relire()
    // Démonté ou changé de dossier : aucune réponse en vol n'écrit plus.
    return () => { jetons.current++ }
  }, [relire])
  const lu = lecture !== null && lecture.cle === `${dossierId}|${espace}` && lecture.lu.dossierId === dossierId ? lecture.lu : null
  return { lu: PAIEMENTS_ASSURANCE_MALADIE_PREVUS ? lu : null, relire }
}
