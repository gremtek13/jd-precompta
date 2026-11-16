import type { ReactNode } from 'react'
import {
  ariaSortDe, choixDuSelecteur, etatDuSelecteur, valeurDuSelecteur,
  type ColonneTriable, type EtatDuTri,
} from '../lib/triDesTableaux'

// L'EN-TÊTE D'UNE COLONNE TRIABLE (demande du cabinet du 16/11/2026). Le `<th>` porte `aria-sort`, que lit un
// lecteur d'écran ; le geste est un VRAI bouton, atteint au clavier, dont le nom est le libellé de la colonne. La
// flèche est dessinée par la feuille de style (`.tri-en-tete::after`, d'après `aria-sort`), sans texte de remplacement :
// l'état se lit à `aria-sort`, jamais à un dessin, et le texte de l'en-tête reste son libellé, au caractère près.
export function EnTeteTriable({ colonne, etat, onTrier, className, children }: {
  colonne: string
  etat: EtatDuTri
  onTrier: (colonne: string) => void
  className?: string
  children: ReactNode
}) {
  const sort = ariaSortDe(etat, colonne)
  return (
    <th aria-sort={sort} className={className}>
      <button type="button" className="tri-en-tete" onClick={() => onTrier(colonne)}>
        {children}
      </button>
    </th>
  )
}

// LE SÉLECTEUR « TRIER PAR » D'UN TABLEAU REPLIÉ EN FICHES. Replié, le tableau n'a plus d'en-têtes visibles : le même
// tri se choisit ici, sur les mêmes colonnes. Il vit DANS l'enveloppe `.tableau-adaptable`, avant le tableau, et ne
// paraît que sous la largeur où le tableau se replie (`etroite` : 520 pixels de carte, sinon 860).
export function SelecteurDeTri<T>({ colonnes, etat, onChoisir, etroite = false }: {
  colonnes: readonly ColonneTriable<T>[]
  etat: EtatDuTri
  onChoisir: (etat: EtatDuTri) => void
  etroite?: boolean
}) {
  // Le champ DANS son libellé, sans identifiant : un `useId` décalerait ceux des formulaires de l'écran.
  return (
    <label className={`tri-replie${etroite ? ' tri-replie-etroite' : ''}`}>
      <span>Trier par</span>
      <select value={valeurDuSelecteur(etat)} onChange={(e) => onChoisir(etatDuSelecteur(e.target.value, colonnes))}>
        {choixDuSelecteur(colonnes).map((c) => <option key={c.valeur} value={c.valeur}>{c.libelle}</option>)}
      </select>
    </label>
  )
}
