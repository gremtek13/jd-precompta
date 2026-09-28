import { seuilAlignement } from './alignementBanque'
import type { LigneBancaire, ModeComptable, Piece } from './types'

// LA DATE À LAQUELLE UNE PIÈCE COMPTE, DANS UNE COMPTABILITÉ DE TRÉSORERIE (BNC, déclaration 2035).
//
// Le bénéfice non commercial se détermine sur les recettes EFFECTIVEMENT ENCAISSÉES et les dépenses
// EFFECTIVEMENT PAYÉES au cours de l'année (CGI, art. 93, 1). L'application rattachait pourtant chaque
// pièce à l'année de sa DATE DE FACTURE (`anneeDe(date_piece)`) : une facture de décembre réglée en
// janvier partait dans la déclaration de l'année d'avant — une dépense déduite un an trop tôt, une
// recette imposée un an trop tôt, sur un document signé. La correction a été demandée par le cabinet
// (28/09/2026) avant tout travail sur la comptabilité d'engagement.
//
// LA RÈGLE, en un seul endroit, pour la 2035, la situation intermédiaire, l'estimation et les
// écritures — qui doivent tous rendre la même année pour le même euro :
//   - une pièce compte à la date de son PAIEMENT quand le rapprochement bancaire la connaît ;
//   - sinon à sa DATE DE FACTURE : une note de frais, payée hors du compte professionnel, et une pièce
//     dont le paiement n'est pas encore rapproché. Pour la seconde, c'est une supposition, et les
//     écrans qui produisent un chiffre annuel la DISENT (source `sans_paiement`) ;
//   - une pièce qu'aucun paiement ni aucune date ne situe ne compte nulle part (date `null`), et les
//     écrans la rendent « sans date », comme avant.
//
// La part de chaque paiement vient de `partsDesPaiements`, la formule de l'onglet TVA : c'est la
// même question — quand cette pièce a-t-elle été réglée ? — et une règle écrite deux fois n'attend
// que de diverger.

/** Ce dont le rattachement a besoin d'un mouvement bancaire : le reste de la ligne ne décide de rien. */
export type Paiement = Pick<LigneBancaire, 'piece_id' | 'date' | 'montant' | 'statut'>

/**
 * Un paiement dont on connaît le MOUVEMENT : en engagement, chaque règlement est une écriture qui
 * désigne sa ligne bancaire (lib/engagement.ts), et le contrôle des écritures compare ces désignations
 * aux rapprochements.
 */
export type PaiementIdentifie = Paiement & Pick<LigneBancaire, 'id'>

// Les paiements rapprochés de chaque pièce. Seul un mouvement RAPPROCHÉ paie une pièce : le statut est
// relu ici plutôt que supposé du côté de l'appelant, un `piece_id` sur une ligne remise à traiter
// étant exactement le lien qui ne doit plus rien dater.
export function paiementsParPiece<T extends Paiement>(lignes: readonly T[]): Map<string, T[]> {
  const parPiece = new Map<string, T[]>()
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.piece_id) continue
    const liste = parPiece.get(ligne.piece_id) ?? []
    liste.push(ligne)
    parPiece.set(ligne.piece_id, liste)
  }
  return parPiece
}

export interface PartsReglees {
  /** La part de la pièce que chaque paiement règle, à la date du paiement. */
  parts: { date: string; part: number }[]
  /** Ce qu'aucun paiement connu ne règle : 1 sans paiement, 0 pour une pièce réglée. */
  reste: number
}

// La part de la pièce que chaque paiement règle.
//
// Réglée quand les paiements couvrent le montant de la pièce À L'ÉCART D'ALIGNEMENT PRÈS (le seuil de
// `alignementBanque.ts`, décision du cabinet du 23/09/2026) : un frais bancaire ou un arrondi ne
// laisse pas un reste de quelques centimes à dater ailleurs. Chaque paiement porte alors sa part du
// total payé, et des frais qui font payer plus que la pièce ne la font pas compter plus d'une fois.
//
// Au-delà du seuil, c'est un PAIEMENT PARTIEL : chaque paiement porte sa part du montant de la pièce,
// et le reste n'est réglé par rien de connu. L'onglet TVA n'en fait rien (un acompte ne rend exigible
// que ce qu'il paie) ; `rattachementsTresorerie` le date à la facture, et le dit.
export function partsDesPaiements(
  piece: Pick<Piece, 'montant_ttc'>,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
): PartsReglees {
  const paye = paiements.reduce((s, m) => s + Math.abs(m.montant), 0)
  if (paye === 0) return { parts: [], reste: 1 }
  const montantPiece = Math.abs(piece.montant_ttc ?? 0)
  // Au centime, comme l'écart que mesure `ecartAvecBanque` : sans cet arrondi, 100,10 − 98,10 vaut
  // 2,0000000000000004 et un écart pile au seuil passerait pour un paiement partiel.
  const reste = Math.round((montantPiece - paye) * 100) / 100
  if (reste <= seuilAlignement(montantPiece)) {
    return { parts: paiements.map((m) => ({ date: m.date, part: Math.abs(m.montant) / paye })), reste: 0 }
  }
  return {
    parts: paiements.map((m) => ({ date: m.date, part: Math.abs(m.montant) / montantPiece })),
    reste: reste / montantPiece,
  }
}

// `facture` : la date de la facture en ENGAGEMENT, où elle fait foi par définition — ce n'est pas la
// supposition de `sans_paiement`, qu'un rapprochement viendrait corriger.
export type SourceRattachement = 'paiement' | 'note_de_frais' | 'sans_paiement' | 'facture'

export interface Rattachement {
  /** Null pour une part que rien ne date : ni paiement connu, ni date de pièce. */
  date: string | null
  part: number
  source: SourceRattachement
}

const ORDRE_SOURCE: Record<SourceRattachement, number> = { paiement: 0, note_de_frais: 1, sans_paiement: 2, facture: 3 }

// Où une pièce compte, et pour quelle part. Les parts somment à 1 ; celles d'une même date et d'une
// même source sont réunies (deux paiements le même jour ne font qu'une date), et l'ordre est fixe —
// par date, la part sans date en dernier — pour que deux appels sur la même pièce rendent la même
// chose, ce dont dépend la répartition des centimes d'une écriture.
export function rattachementsTresorerie(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece'>,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
): Rattachement[] {
  const { parts, reste } = partsDesPaiements(piece, paiements)
  const fractions: Rattachement[] = parts.map((p) => ({ date: p.date, part: p.part, source: 'paiement' }))
  if (reste > 0) {
    fractions.push({
      date: piece.date_piece,
      part: reste,
      source: piece.type_piece === 'note_frais' ? 'note_de_frais' : 'sans_paiement',
    })
  }

  const reunies: Rattachement[] = []
  for (const f of fractions) {
    const meme = reunies.find((r) => r.date === f.date && r.source === f.source)
    if (meme) meme.part += f.part
    else reunies.push({ ...f })
  }
  return reunies.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1
      if (b.date === null) return -1
      return a.date.localeCompare(b.date)
    }
    return ORDRE_SOURCE[a.source] - ORDRE_SOURCE[b.source]
  })
}

// Où une pièce compte, selon le MODÈLE COMPTABLE du dossier. En trésorerie, la règle ci-dessus. En
// ENGAGEMENT (lib/engagement.ts), à la date de sa FACTURE et en entier : c'est la facture qui crée la
// charge ou le produit, le paiement ne fait que solder la dette — il ne date donc rien, pas même une
// partie. Une pièce sans date n'y compte nulle part, comme en trésorerie, et les écrans la disent
// « sans date ». Sans valeur par défaut pour le modèle : un appelant qui l'oublie doit le découvrir à la
// compilation, pas en lisant une situation intermédiaire datée au paiement dans une société à l'IS.
export function rattachements(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece'>,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
  mode: ModeComptable,
): Rattachement[] {
  if (mode === 'engagement') return [{ date: piece.date_piece, part: 1, source: 'facture' }]
  return rattachementsTresorerie(piece, paiements)
}

// La part d'une pièce qui tombe dans une période, bornes comprises, en dates `AAAA-MM-JJ`. Une part
// sans date n'appartient à aucune période.
export function partDansLaPeriode(rattachements: readonly Rattachement[], debut: string, fin: string): number {
  return rattachements.reduce((s, r) => (r.date !== null && r.date >= debut && r.date <= fin ? s + r.part : s), 0)
}

// La part d'une pièce qui tombe dans un exercice civil.
export function partDeLAnnee(rattachements: readonly Rattachement[], annee: number): number {
  return partDansLaPeriode(rattachements, `${annee}-01-01`, `${annee}-12-31`)
}

// Les exercices où une pièce compte au moins en partie — ce qui fait apparaître une année dans un
// sélecteur d'exercice.
export function anneesDesRattachements(rattachements: readonly Rattachement[]): number[] {
  return [...new Set(rattachements.flatMap((r) => (r.date ? [Number(r.date.slice(0, 4))] : [])))]
}
