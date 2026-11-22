import { useCallback, useEffect, useRef, useState } from 'react'
import { ECRITURES_LIBRES_PREVUES } from './ecritureLibre'
import { lireLesEcrituresLibres } from './ecrituresLibresLecture'
import type { LectureDesEcrituresLibres } from './ecrituresLibresVue'

// LES ÉCRITURES LIBRES D'UN DOSSIER, LUES PAR UN ÉCRAN DU CABINET QUI N'A PAS DE CHARGEMENT À LUI OÙ LES JOINDRE (EL5 ; le patron
// de lib/useAdressesReception.ts) : `lu` est NUL tant que la lecture n'est pas revenue, gardée AVEC le dossier lu — un autre
// dossier repart en chargement, et la réponse tardive d'un dossier quitté ne s'inscrit pas. LE DRAPEAU BAISSÉ, l'absence tout de
// suite et AUCUNE requête : la table n'est pas en base.
export function useEcrituresLibres(dossierId: string, prevues: boolean = ECRITURES_LIBRES_PREVUES): {
  lu: LectureDesEcrituresLibres | null
  relire: () => Promise<void>
} {
  const [lecture, setLecture] = useState<LectureDesEcrituresLibres | null>(null)
  const dossierAffiche = useRef(dossierId)

  useEffect(() => {
    dossierAffiche.current = dossierId
    if (!prevues) return
    let annule = false
    lireLesEcrituresLibres(dossierId).then((lu) => { if (!annule) setLecture(lu) })
    return () => { annule = true }
  }, [dossierId, prevues])

  const relire = useCallback(async () => {
    if (!prevues) return
    const lu = await lireLesEcrituresLibres(dossierId)
    if (dossierAffiche.current === dossierId) setLecture(lu)
  }, [dossierId, prevues])

  if (!prevues) return { lu: { dossierId, etat: 'absentes' }, relire }
  return { lu: lecture?.dossierId === dossierId ? lecture : null, relire }
}
