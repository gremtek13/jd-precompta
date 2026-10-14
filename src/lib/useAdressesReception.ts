import { useCallback, useEffect, useRef, useState } from 'react'
import { lireLesAdressesDuDossier, type LectureAdressesDuDossier } from './adressesReceptionLecture'

// L'ADRESSE DE RÉCEPTION D'UN DOSSIER, LUE PAR UN ÉCRAN (espace client, étape A6b1) : la fenêtre et le bloc de « Tes plateformes »
// la lisent de la même façon, par ce crochet. `lu` est NUL tant que la lecture n'est pas revenue — rien ne se dit alors —, et
// la lecture est gardée AVEC le dossier pour lequel elle a été faite : un autre dossier repart en chargement, et la réponse
// tardive d'un dossier quitté ne s'inscrit pas (la plus lente n'écrit jamais en dernier).
export function useAdressesReception(dossierId: string): {
  lu: LectureAdressesDuDossier | null
  // Relit ; `depuisZero` remet d'abord « en cours » (le bloc qui ne montre plus l'ancienne adresse pendant la relecture).
  relire: (depuisZero?: boolean) => Promise<void>
} {
  const [lecture, setLecture] = useState<{ cle: string; lu: LectureAdressesDuDossier } | null>(null)
  const dossierAffiche = useRef(dossierId)

  useEffect(() => {
    let annule = false
    dossierAffiche.current = dossierId
    lireLesAdressesDuDossier(dossierId).then((lu) => { if (!annule) setLecture({ cle: dossierId, lu }) })
    return () => { annule = true }
  }, [dossierId])

  const relire = useCallback(async (depuisZero = false) => {
    if (depuisZero) setLecture(null)
    const lu = await lireLesAdressesDuDossier(dossierId)
    if (dossierAffiche.current === dossierId) setLecture({ cle: dossierId, lu })
  }, [dossierId])

  return { lu: lecture?.cle === dossierId ? lecture.lu : null, relire }
}
