import { useCallback, useState } from 'react'
import { triSuivant, type EtatDuTri } from './triDesTableaux'

/**
 * L'état du tri d'UN tableau : local à l'écran, il n'écrit rien. Il revient à l'ordre d'origine quand `cleRemise`
 * change (le dossier) — l'état retient la clé sous laquelle il a été choisi, et un tri choisi pour un autre dossier
 * ne vaut plus rien, sans effet ni rendu intermédiaire.
 */
export function useTriDuTableau(cleRemise: string | null | undefined): {
  tri: EtatDuTri
  trierPar: (colonne: string) => void
  choisirTri: (etat: EtatDuTri) => void
} {
  const [retenu, setRetenu] = useState<{ cle: string | null | undefined; tri: EtatDuTri }>({ cle: cleRemise, tri: null })
  const tri = retenu.cle === cleRemise ? retenu.tri : null
  const trierPar = useCallback((colonne: string) => {
    setRetenu((r) => ({ cle: cleRemise, tri: triSuivant(r.cle === cleRemise ? r.tri : null, colonne) }))
  }, [cleRemise])
  const choisirTri = useCallback((etat: EtatDuTri) => setRetenu({ cle: cleRemise, tri: etat }), [cleRemise])
  return { tri, trierPar, choisirTri }
}
