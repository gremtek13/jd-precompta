import { candidatsCotisations, candidatsPiecesDesMouvements, type CotisationRapprochable } from './appariementBanque'
import type { FacturesSources } from './facturesSources'
import { anneeDe, jourDe, moisDe } from './format'
import type { LigneBancaire, Piece } from './types'

// LES PROPOSITIONS DE CHAQUE MOUVEMENT DU RELEVÉ, CALCULÉES UNE FOIS (le banc de charge, 27/11/2026 ; HISTORIQUE.md « LE
// BANC DE CHARGE D'UNE ANNÉE, AU NIVEAU D'AUJOURD'HUI »). La liste de l'onglet Banque posait, pour chaque ligne affichée et à
// chaque rendu — donc à chaque frappe dans la recherche, sur un tableau non paginé de 3 000 mouvements —, `candidatsPieces`
// sur toutes les pièces et un parcours du relevé entier pour la récurrence. La table rend, pour chaque mouvement à traiter,
// ce que ces trois questions rendaient ligne à ligne, par les MÊMES prédicats ; l'écran la bâtit dans un `useMemo` sur ses
// seules données. propositionsDuReleve.test.ts la confronte, mouvement par mouvement, au calcul ligne à ligne d'avant.

export type Recurrence = { action: 'ignorer' | 'virement_personnel'; occurrences: number }

export interface PropositionsDuMouvement<C> {
  // La première pièce candidate (`candidatsPieces`) : la fiche montre de toute façon TOUTES les pièces triées.
  piece: Piece | null
  cotisation: C | null
  recurrence: Recurrence | null
}

// Un prélèvement récurrent (assurance, virement personnel...) sans règle "Toujours ignorer" — soit
// parce que le libellé varie légèrement d'un mois à l'autre (une date ou un numéro dedans), soit
// simplement parce que personne n'a pensé à créer la règle — se retraite à la main chaque mois sans
// que l'appli s'en souvienne. Repère ici un mouvement au même montant et à peu près au même jour du
// mois qu'un ou plusieurs mois précédents déjà résolus de façon cohérente (tous ignorés, ou tous
// marqués virement personnel) et propose d'appliquer la même résolution — jamais si les résolutions
// passées divergent, ni sur une seule occurrence antérieure (trop tôt pour parler de récurrence).
//
// La règle est celle que l'onglet tenait ligne à ligne, à l'identique ; seuls changent les mouvements qu'elle regarde : les
// mouvements résolus (les seuls qu'elle retient), rangés par montant au centime arrondi, et pour chaque mouvement ceux de cinq
// centimes voisins — |a − b| ≤ 0,01 n'écarte jamais deux arrondis de plus de 2 (comme l'index des pièces, appariementBanque.ts).
function recurrenceDe(ligne: LigneBancaire, voisines: readonly LigneBancaire[]): Recurrence | null {
  const jourLigne = jourDe(ligne.date)
  const moisLigne = anneeDe(ligne.date) * 12 + (moisDe(ligne.date) - 1)

  const correspondances = voisines.filter((l) => {
    if (l.id === ligne.id) return false
    if (Math.abs(l.montant - ligne.montant) > 0.01) return false
    const moisL = anneeDe(l.date) * 12 + (moisDe(l.date) - 1)
    if (moisL === moisLigne) return false
    if (Math.abs(jourDe(l.date) - jourLigne) > 3) return false
    return l.prelevement_personnel || l.statut === 'ignoree'
  })
  if (correspondances.length < 2) return null

  if (correspondances.every((l) => l.prelevement_personnel)) {
    return { action: 'virement_personnel', occurrences: correspondances.length }
  }
  if (correspondances.every((l) => l.statut === 'ignoree' && !l.prelevement_personnel)) {
    return { action: 'ignorer', occurrences: correspondances.length }
  }
  return null
}

const ECART_DES_CENTIMES_VOISINS = 2
const centimes = (montant: number) => Math.round(montant * 100)

/** La récurrence de chaque mouvement à traiter du relevé : mouvement → sa récurrence (absent : aucune). */
export function recurrencesDuReleve(lignes: readonly LigneBancaire[]): Map<string, Recurrence> {
  const resoluesParCentimes = new Map<number, LigneBancaire[]>()
  for (const l of lignes) {
    if (!(l.prelevement_personnel || l.statut === 'ignoree')) continue
    const cle = centimes(l.montant)
    const deja = resoluesParCentimes.get(cle)
    if (deja) deja.push(l)
    else resoluesParCentimes.set(cle, [l])
  }
  const recurrences = new Map<string, Recurrence>()
  for (const ligne of lignes) {
    if (ligne.statut !== 'non_rapprochee') continue
    const centre = centimes(ligne.montant)
    const voisines: LigneBancaire[] = []
    for (let ecart = -ECART_DES_CENTIMES_VOISINS; ecart <= ECART_DES_CENTIMES_VOISINS; ecart++) {
      for (const l of resoluesParCentimes.get(centre + ecart) ?? []) voisines.push(l)
    }
    const recurrence = voisines.length < 2 ? null : recurrenceDe(ligne, voisines)
    if (recurrence) recurrences.set(ligne.id, recurrence)
  }
  return recurrences
}

/**
 * Les propositions de chaque mouvement À TRAITER du relevé (`statut` « non_rapprochee ») : la pièce, l'échéance de
 * cotisation et la récurrence que la liste et la fiche disent. Un mouvement absent de la table n'en a aucune — un mouvement
 * rapproché ou ignoré n'en a jamais eu. Aucune valeur par défaut : les entrées sont celles des questions ligne à ligne.
 */
export function propositionsDuReleve<C extends CotisationRapprochable>(entrees: {
  lignes: readonly LigneBancaire[]
  justificatifs: readonly Piece[]
  piecesHorsRapprochement: ReadonlySet<string>
  facturesSources: FacturesSources
  cotisations: C[]
  cotisationsRapprochees: ReadonlySet<string>
}): Map<string, PropositionsDuMouvement<C>> {
  const aTraiter = entrees.lignes.filter((l) => l.statut === 'non_rapprochee')
  const pieces = candidatsPiecesDesMouvements(aTraiter, entrees.justificatifs, entrees.piecesHorsRapprochement, entrees.facturesSources)
  const recurrences = recurrencesDuReleve(entrees.lignes)
  return new Map(aTraiter.map((l) => [l.id, {
    piece: pieces.get(l.id)?.[0] ?? null,
    cotisation: candidatsCotisations(l, entrees.cotisations, entrees.cotisationsRapprochees)[0] ?? null,
    recurrence: recurrences.get(l.id) ?? null,
  }]))
}
