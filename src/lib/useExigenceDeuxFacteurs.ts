import { useEffect, useState } from 'react'
import { DEUX_FACTEURS_EXIGES_EXPORTE, type ExigenceLue } from './deuxFacteursExiges'
import { lireMonExigence } from './deuxFacteursExigesAppels'
import { niveauDuJeton } from './doubleAuthentification'

/**
 * Ce que la base exige du compte connecté (C7, second temps), lu une fois par compte et par niveau, et seulement à
 * `aal1` : une session `aal2` satisfait toute exigence. Le drapeau baissé, rien n'est lu (la porte reste ouverte, comme
 * hier). Une réponse pour un autre compte ou un autre niveau ne s'affiche jamais : la clé la garde.
 */
export function useExigenceDeuxFacteurs(userId: string | null, jeton: string | null): ExigenceLue {
  const niveau = jeton ? niveauDuJeton(jeton) : null
  const cle = DEUX_FACTEURS_EXIGES_EXPORTE && userId !== null && niveau !== 'aal2' ? `${userId}|${niveau ?? '?'}` : null
  const [lue, setLue] = useState<{ cle: string | null; valeur: ExigenceLue }>({ cle: null, valeur: { etat: 'lecture' } })
  useEffect(() => {
    if (cle === null) return
    let annule = false
    void lireMonExigence().then((issue) => {
      if (!annule) setLue({ cle, valeur: issue.ok ? { etat: 'lue', valeur: issue.valeur } : { etat: 'illisible' } })
    })
    return () => { annule = true }
  }, [cle])
  return lue.cle === cle ? lue.valeur : { etat: 'lecture' }
}
