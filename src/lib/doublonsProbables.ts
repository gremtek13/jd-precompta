import { paiementNet } from './alignementBanque'
import { cleFournisseur, formatDate, formatMoney } from './format'
import { montantRetenu } from './montantRetenu'
import type { PaiementsDesPieces } from './rattachement'
import type { Piece } from './types'

// LE DOUBLON PROBABLE (relecture du 04/11/2026, D1 ; PIECES-Q2, sur la recommandation) : le même achat entré deux fois — le PDF
// déposé par le cabinet et la photo du praticien, ou le même ticket photographié deux fois. Les deux pièces passent tous les
// contrôles : leurs octets diffèrent (l'empreinte du fichier), leur texte lu aussi, d'un caractère (`lib/doublonsTexte.ts`),
// et le mois d'abonnement ne vise qu'un mois voisin vide (`moisEnDoubleSurAbonnement`). La 2035 compte alors la charge deux
// fois — une dépense payée une fois ne se déduit qu'une fois (CGI, art. 93, 1).
//
// LA RÈGLE, une seule pour tous les écrans (Justificatifs, la fiche d'une pièce, la Vue d'ensemble, Clôture, la validation) :
// deux pièces de DÉPENSE (achat ou note de frais), au même MONTANT RETENU au centime (`lib/montantRetenu.ts` : le TTC d'un
// dossier exonéré, le HT d'un assujetti), datées à SEPT JOURS au plus l'une de l'autre, du même fournisseur — la CLÉ
// D'IDENTITÉ de `cleFournisseur`, mot à mot, jamais une sous-chaîne —, dont l'une au moins n'a aucun paiement connu.
//
// CE QU'ELLE ÉCARTE, et pourquoi :
//   - Deux fournisseurs LUS et DIFFÉRENTS : deux achats, par construction.
//   - Deux pièces que des paiements règlent CHACUNE (le relevé, un virement groupé, la caisse) : la banque prouve deux
//     sorties d'argent, donc deux achats. C'est aussi ce qui laisse au cabinet un geste pour lever un faux signal : deux
//     achats identiques se rapprochent chacun de son débit, et le doublon se tait. Un paiement qu'un rejet défait ne
//     compte pas (`paiementNet`).
//   - Une pièce sans date, sans montant, ou à un montant nul : rien à comparer — le préalable des pièces sans date et la
//     validation en lot les disent déjà.
//   - Les pièces de VENTE : la même facture émise portée par deux pièces a son contrôle, par les preuves du pont
//     (`lib/ventesJumelles.ts`), et l'exemplaire d'une facture source ne compte nulle part ; une recette d'un BNC vient du
//     relevé. Le défaut relevé est celui d'une charge.
//
// UN FOURNISSEUR ILLISIBLE (`cleFournisseur` nul : aucun tiers lu, ou aucun mot qui désigne quelqu'un) SE RAPPROCHE DE TOUT :
// c'est le cas même du doublon — la photo dont la lecture a raté le nom, face au PDF qui le porte. L'écarter tairait le
// défaut là où il naît ; le retenir coûte, au pire, un regard sur deux pièces de même montant à une semaine d'écart. La paire
// le dit (`fournisseurLu` faux), pour que le cabinet sache sur quoi tient le signal.
//
// JAMAIS BLOQUANT : deux achats identiques existent (deux boîtes du même consommable dans la semaine). Le geste reste celui
// d'aujourd'hui — supprimer la pièce en trop, après confirmation —, et rien ne s'écrit d'ici.
//
// LA TENUE : les pièces se rangent par sens et par montant au centime, puis par date ; seules les pièces d'un même rang, à
// sept jours, se comparent. Linéaire au nombre de pièces tant que les montants se répartissent ; mesuré à 500 pièces
// (doublonsProbables.test.ts).

/** Ce que la règle lit d'une pièce. */
export type PiecePourDoublon = Pick<Piece,
  'id' | 'type_piece' | 'date_piece' | 'tiers' | 'montant_ht' | 'montant_tva' | 'montant_ttc' | 'nom_fichier'>

export const ECART_MAXIMAL_EN_JOURS = 7

export interface DoublonProbable<P extends PiecePourDoublon = PiecePourDoublon> {
  /** La plus ancienne des deux (à date égale, celle de plus petit identifiant). */
  a: P
  b: P
  /** Le montant retenu commun. */
  montant: number
  /** L'écart entre leurs dates, en jours. */
  jours: number
  /** Vrai quand le fournisseur est lu sur les deux, à la même clé ; faux quand l'un des deux est illisible. */
  fournisseurLu: boolean
}

export interface DoublonsProbables<P extends PiecePourDoublon = PiecePourDoublon> {
  paires: DoublonProbable<P>[]
  /** Pour chaque pièce en doublon probable, les AUTRES pièces de ses paires, dans l'ordre de leurs dates. */
  parPiece: ReadonlyMap<string, P[]>
}

const SANS_DOUBLON: DoublonsProbables<never> = { paires: [], parPiece: new Map() }

// Le jour civil d'une date `AAAA-MM-JJ`, en jours depuis l'origine : aucune horloge, aucun fuseau.
function jourCivil(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null
}

/**
 * Les pièces qu'un paiement connu règle — le relevé, les parts des virements groupés ou mixtes, la caisse —, celles dont les
 * paiements se soldent à zéro (un prélèvement et son rejet) exceptées. `null` : les paiements ne sont pas lus en entier, et
 * aucune pièce ne se dit payée — la règle signale alors plus, jamais moins.
 */
export function piecesRegleesPourLesDoublons(paiements: PaiementsDesPieces | null): ReadonlySet<string> | null {
  if (paiements === null) return null
  return new Set([...paiements].filter(([, liste]) => liste.length > 0 && paiementNet(liste).centimes !== 0).map(([id]) => id))
}

/**
 * Les doublons probables parmi `pieces` — validées comme à valider : un doublon se corrige mieux avant la validation.
 * `assujettiTva` décide du montant retenu ; `reglees`, les pièces qu'un paiement connu règle (`piecesRegleesPourLesDoublons`),
 * ou `null` quand ils ne sont pas lus en entier. Aucune valeur par défaut : un appelant qui oublierait le statut du dossier
 * comparerait le mauvais montant.
 */
export function doublonsProbables<P extends PiecePourDoublon>(
  pieces: readonly P[], assujettiTva: boolean, reglees: ReadonlySet<string> | null,
): DoublonsProbables<P> {
  const rangs = new Map<number, { piece: P; jour: number; cle: string | null }[]>()
  for (const piece of pieces) {
    if (piece.type_piece !== 'achat' && piece.type_piece !== 'note_frais') continue
    if (!piece.date_piece) continue
    const jour = jourCivil(piece.date_piece)
    const montant = montantRetenu(piece, assujettiTva)
    if (jour === null || montant === null) continue
    const centimes = Math.round(montant * 100)
    if (centimes === 0) continue
    const rang = rangs.get(centimes) ?? []
    rang.push({ piece, jour, cle: cleFournisseur(piece.tiers) })
    rangs.set(centimes, rang)
  }
  const paires: DoublonProbable<P>[] = []
  for (const [centimes, rang] of rangs) {
    if (rang.length < 2) continue
    rang.sort((x, y) => x.jour - y.jour || (x.piece.id < y.piece.id ? -1 : x.piece.id > y.piece.id ? 1 : 0))
    for (let i = 0; i < rang.length; i++) {
      for (let j = i + 1; j < rang.length && rang[j].jour - rang[i].jour <= ECART_MAXIMAL_EN_JOURS; j++) {
        const x = rang[i]
        const y = rang[j]
        if (x.cle !== null && y.cle !== null && x.cle !== y.cle) continue
        if (reglees !== null && reglees.has(x.piece.id) && reglees.has(y.piece.id)) continue
        paires.push({
          a: x.piece, b: y.piece, montant: centimes / 100, jours: y.jour - x.jour, fournisseurLu: x.cle !== null && y.cle !== null,
        })
      }
    }
  }
  if (paires.length === 0) return SANS_DOUBLON
  paires.sort((p, q) => (p.a.date_piece ?? '').localeCompare(q.a.date_piece ?? '') || p.a.id.localeCompare(q.a.id) || p.b.id.localeCompare(q.b.id))
  const parPiece = new Map<string, P[]>()
  const noter = (piece: P, autre: P) => parPiece.set(piece.id, [...(parPiece.get(piece.id) ?? []), autre])
  for (const p of paires) {
    noter(p.a, p.b)
    noter(p.b, p.a)
  }
  return { paires, parPiece }
}

/** Une pièce nommée pour l'écran : son fichier, son fournisseur, sa date et son montant. */
export function nommerLaPiece(p: PiecePourDoublon, montant: number): string {
  return `« ${p.nom_fichier} » (${p.tiers?.trim() || 'fournisseur non lu'}, ${formatDate(p.date_piece)}, ${formatMoney(montant)})`
}

/** Ce que la ligne, la fiche et la carte de Clôture disent d'une pièce : les autres pièces qui la doublent probablement. */
export function phraseDuDoublon(autres: readonly PiecePourDoublon[], assujettiTva: boolean): string {
  const noms = autres.map((a) => nommerLaPiece(a, montantRetenu(a, assujettiTva) ?? 0))
  const tete = autres.length === 1 ? 'Doublon probable de ' : 'Doublon probable de ces pièces : '
  return `${tete}${noms.join(', ')} — même montant, même fournisseur (ou un fournisseur non lu), à sept jours au plus. `
    + 'Si c’est le même achat, supprime la pièce en trop : comptée deux fois, la charge l’est aussi dans la 2035. Deux achats '
    + 'identiques restent tous deux ; rapprocher chacun de son débit fait taire le signal.'
}

/** Le détail du point de la Vue d'ensemble et du préalable : les premières paires, nommées. */
export function detailDesDoublonsProbables(paires: readonly DoublonProbable[]): string | undefined {
  if (paires.length === 0) return undefined
  const lignes = paires.slice(0, 5).map((p) =>
    `${nommerLaPiece(p.a, p.montant)} et ${nommerLaPiece(p.b, p.montant)}${p.fournisseurLu ? '' : ' — fournisseur non lu sur l’une'}`)
  return `${lignes.join(' ; ')}${paires.length > 5 ? ` ; et ${paires.length - 5} autre(s)` : ''}. Dans Justificatifs, le filtre `
    + '« Doublons probables » les montre ; si c’est le même achat, supprimer la pièce en trop.'
}
