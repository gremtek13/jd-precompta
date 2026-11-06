// LA LECTURE DE L'ÉTAT DU DOSSIER (ligne 51.5, étape C2), pour la carte de l'accueil du client. La règle et les mots :
// lib/etatDuDossier.ts.
import { useEffect, useState } from 'react'
import { ETAT_DU_DOSSIER_EXPORTE, lireLEtatDuDossier, type LectureDeLEtat } from './etatDuDossier'
import { supabase } from './supabase'

/**
 * L'état de la société `dossierId`, ou `null` tant que la lecture n'est pas revenue (et toujours, drapeau baissé ou sans
 * société : ni appel, ni carte). Gardée AVEC le dossier lu : la réponse d'une société quittée ne s'affiche jamais sous
 * une autre. Revenue, elle peut être incomplète (refusée, illisible, une requête qui lève) — jamais une liste vide.
 */
export function useEtatDuDossier(dossierId: string | null): LectureDeLEtat | null {
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureDeLEtat } | null>(null)

  useEffect(() => {
    if (!ETAT_DU_DOSSIER_EXPORTE || !dossierId) return
    let annule = false
    lireLEtatDuDossier(supabase.rpc('phase_des_exercices', { p_dossier_id: dossierId }))
      .then((lecture) => { if (!annule) setLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  return lue !== null && lue.dossierId === dossierId ? lue.lecture : null
}
