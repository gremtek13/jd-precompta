import { useEffect, useRef, useState } from 'react'

// « COPIER » UN TEXTE DANS LE PRESSE-PAPIERS, ET LE DIRE DEUX SECONDES — l'adresse de collecte d'un dossier, que l'onglet
// Accès du cabinet et « Mes pièces » du client copient de la même façon (ligne 22.93).
//
// Le « copié ✓ » s'efface au bout de deux secondes. Son minuteur part avec l'écran : laissé derrière lui, il rappelait un
// écran démonté, et dans la suite de tests un environnement déjà détruit (une erreur non gérée, au hasard de la charge ;
// défaut corrigé le 10/10/2026). `demonte` couvre la copie encore en vol au démontage, qui armerait sinon un minuteur que
// plus rien n'annule. Un presse-papiers refusé (permission, page non sécurisée) ne part pas en erreur non gérée : il se
// dit, et le texte reste affiché, à copier à la main.
//
// L'état se garde AVEC le texte copié : un texte qui change (une autre société) ne montre pas le « copié ✓ » du précédent.

export const DUREE_DU_COPIE_MS = 2000

export interface CopieDuTexte {
  /** Vrai les deux secondes qui suivent la copie de CE texte. */
  copie: boolean
  /** Vrai quand le navigateur a refusé la dernière copie de CE texte. */
  refusee: boolean
  copier: () => Promise<void>
}

export function useCopieDuTexte(texte: string | null): CopieDuTexte {
  const [texteCopie, setTexteCopie] = useState<string | null>(null)
  const [texteRefuse, setTexteRefuse] = useState<string | null>(null)
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demonte = useRef(false)
  useEffect(() => {
    demonte.current = false
    return () => {
      demonte.current = true
      if (minuteur.current !== null) clearTimeout(minuteur.current)
    }
  }, [])

  async function copier() {
    if (!texte) return
    try {
      await navigator.clipboard.writeText(texte)
    } catch {
      // Le navigateur refuse le presse-papiers : sans ce `catch`, le clic ne faisait rien et l'échec partait en erreur
      // non gérée.
      if (!demonte.current) setTexteRefuse(texte)
      return
    }
    if (demonte.current) return
    setTexteRefuse(null)
    setTexteCopie(texte)
    if (minuteur.current !== null) clearTimeout(minuteur.current)
    minuteur.current = setTimeout(() => setTexteCopie(null), DUREE_DU_COPIE_MS)
  }

  return { copie: texte !== null && texteCopie === texte, refusee: texte !== null && texteRefuse === texte, copier }
}
