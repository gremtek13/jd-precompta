import { anneeDe } from './format'
import type { PartDuReleve } from './partsDuReleve'
import { montantRetenu } from './montantRetenu'
import { partDansLaPeriode, rattachements, type PaiementsDesPieces } from './rattachement'
import { moisEcoulesDeLAnnee } from './situationIntermediaire'
import type { CotisationComptee } from './cotisationRapprochee'
import type { ModeComptable, Piece } from './types'

// Calculs partagés entre l'Estimation cabinet (EstimationTab, un dossier à la fois) et la Simulation
// côté client (ClientSimulation, lecture seule) — mêmes chiffres, un seul endroit à faire évoluer si
// la règle de projection change un jour.

// `assujettiTva` décide du montant de chaque pièce — TVA comprise pour un dossier exonéré, hors
// taxes pour un assujetti — comme dans la 2035 dont ces repères sont l'estimation (voir
// lib/montantRetenu.ts). Sans valeur par défaut, pour la même raison qu'elle.
//
// `paiements` DATE chaque pièce comme la 2035 : une recette compte l'année de son ENCAISSEMENT quand le
// rapprochement la connaît — ou la part d'un virement groupé qui la règle (`paiementsDesPieces`) —, sa
// date de facture à défaut (lib/rattachement.ts). Sans valeur par défaut non plus : une liste vide
// ferait tout compter à la date de facture.
//
// `mode`, le modèle comptable du dossier : en ENGAGEMENT, une pièce compte à la date de sa facture,
// et le paiement ne date rien. Obligatoire comme les deux autres, dans chaque calcul de ce module.
function montantDansLaPeriode(
  pieces: Piece[], paiements: PaiementsDesPieces, debut: string, fin: string, assujettiTva: boolean,
  mode: ModeComptable,
): number {
  return pieces.reduce((sum, p) => {
    const part = partDansLaPeriode(rattachements(p, paiements.get(p.id) ?? [], mode), debut, fin)
    return part === 0 ? sum : sum + (montantRetenu(p, assujettiTva) ?? 0) * part
  }, 0)
}

// LES ENCAISSEMENTS SANS JUSTIFICATIF (lib/affectationBanque.ts) : un virement de l'Assurance maladie
// affecté à une catégorie de recettes. Pour un infirmier c'est l'essentiel du chiffre d'affaires — il ne
// transmet pas ses bordereaux —, et l'estimation ne comptait que les justificatifs de recette. À la date
// du mouvement, comme la 2035 ; toute catégorie de recettes, comme une pièce de vente compte quelle que
// soit sa catégorie.
function recettesAffecteesDansLaPeriode(parts: readonly PartDuReleve[], debut: string, fin: string): number {
  return parts.reduce(
    (sum, p) => (p.nature === 'recette' && p.ligne.date >= debut && p.ligne.date <= fin ? sum + p.montantPoste : sum),
    0,
  )
}

// Les cotisations comptent comme dans la 2035 (`cotisationsComptees`, lib/cotisationRapprochee.ts) : à la
// date et au montant du mouvement qui les paie, sinon à leur échéance. Sans valeur par défaut, comme les
// paiements.
function cotisationsDeLaPeriode(cotisations: readonly CotisationComptee[], debut: string, fin: string): number {
  return cotisations
    .filter((c) => c.date >= debut && c.date <= fin)
    .reduce((sum, c) => sum + c.montant, 0)
}

export function totauxPourAnnee(
  pieces: Piece[], cotisations: readonly CotisationComptee[], annee: number, assujettiTva: boolean,
  paiements: PaiementsDesPieces, mode: ModeComptable,
  // Sans valeur par défaut, comme les paiements : voir `recettesAffecteesDansLaPeriode`.
  partsDuReleve: readonly PartDuReleve[],
) {
  const debut = `${annee}-01-01`
  const fin = `${annee}-12-31`
  return {
    ca: montantDansLaPeriode(pieces, paiements, debut, fin, assujettiTva, mode)
      + recettesAffecteesDansLaPeriode(partsDuReleve, debut, fin),
    cotis: cotisationsDeLaPeriode(cotisations, debut, fin),
  }
}

export interface ProjectionAnnuelle {
  annee: number
  /** Mois écoulés depuis le 1er janvier, en 30/360 — le diviseur des ratios bancaires. */
  moisEcoules: number
  /** Recettes du 1er janvier à aujourd'hui inclus, à la date de leur encaissement (lib/rattachement.ts). */
  ca: number
  /** Échéances du 1er janvier à aujourd'hui inclus, à la date de leur paiement quand le relevé le connaît : « appelées à date », jamais une à venir. */
  cotis: number
  /** Null sous un mois d'observation : ramener quelques jours à douze mois n'est pas une projection. */
  caProjete: number | null
  cotisationsProjetees: number | null
}

/**
 * La projection de l'année en cours : ce qui est déjà là, ramené à douze mois. Une règle simple, et
 * elle le dit — pas de saisonnalité, pas de régularisation URSSAF.
 *
 * ELLE VIVAIT EN DOUBLE, DANS LES DEUX ÉCRANS, ET PORTAIT TROIS DÉFAUTS :
 *  - L'ANNÉE et le COMPTE DE MOIS ne venaient pas du même instant : l'année était figée au
 *    chargement du module, le mois relu à chaque rendu. Onglet laissé ouvert au passage d'une année,
 *    « Projection 2026 » multipliait l'année 2026 ENTIÈRE par douze. C'est le défaut de `ClientHome`
 *    (voir CLAUDE.md) ; ici l'année et les mois sortent d'UNE date, par construction.
 *  - « À DATE » COMPTAIT L'AVENIR : un échéancier de cotisation se crée d'avance pour toute l'année,
 *    donc « cotisations appelées à date » portait les échéances de décembre dès janvier — puis la
 *    projection multipliait encore ce total annuel, soit quatre fois l'année en mars. Seul ce qui est
 *    échu entre dans le « à date », et donc dans ce qu'on ramène à douze mois.
 *  - LE DIVISEUR était le NUMÉRO du mois, exact le dernier jour du mois seulement : le 1er février
 *    il comptait deux mois pour un. C'est le défaut corrigé sur la CAF des ratios bancaires, et la
 *    même règle s'applique ici (`moisEcoulesDeLAnnee`, 30/360), plancher d'un mois compris.
 */
export function projectionAnnuelle(
  recettes: Piece[], cotisations: readonly CotisationComptee[], dateDuJour: string, assujettiTva: boolean,
  paiements: PaiementsDesPieces, mode: ModeComptable,
  partsDuReleve: readonly PartDuReleve[],
): ProjectionAnnuelle {
  const annee = anneeDe(dateDuJour)
  // Du 1er janvier à aujourd'hui : la borne du jour fait un « à date », pour les recettes (à leur
  // encaissement) comme pour les échéances. La même règle de montant que le calcul des repères.
  const ca = montantDansLaPeriode(recettes, paiements, `${annee}-01-01`, dateDuJour, assujettiTva, mode)
    + recettesAffecteesDansLaPeriode(partsDuReleve, `${annee}-01-01`, dateDuJour)
  const cotis = cotisationsDeLaPeriode(cotisations, `${annee}-01-01`, dateDuJour)
  const moisEcoules = moisEcoulesDeLAnnee(dateDuJour)
  const annualiser = (montant: number) => (moisEcoules >= 1 ? (montant * 12) / moisEcoules : null)
  return { annee, moisEcoules, ca, cotis, caProjete: annualiser(ca), cotisationsProjetees: annualiser(cotis) }
}

export function ecartPct(valeurN: number, valeurN1: number | null): string {
  if (!valeurN1) return '—'
  return `${valeurN >= valeurN1 ? '+' : ''}${(((valeurN - valeurN1) / valeurN1) * 100).toFixed(0)} %`
}

/**
 * Le détail par poste des CHARGES d'un exercice, pour la carte « Détail par poste (autres charges) ».
 *
 * DEUX ÉCRIVAINS, DEUX CONVENTIONS DE SIGNE, DANS LA MÊME COLONNE. Ce calcul vivait dans
 * `EstimationTab` et multipliait chaque dépense par −1 : le bouton « Calculer le détail par poste »
 * écrivait donc des montants NÉGATIFS dans `references_postes_annuels`, pendant que le formulaire
 * juste au-dessus y écrit ce que le cabinet tape — un loyer se saisit « 12000 », pas « −12000 ».
 * Les deux lignes s'affichent dans le MÊME tableau, l'une à 12 000,00 € et l'autre à −8 450,00 €,
 * sans que rien n'explique la différence.
 *
 * La convention du projet est pourtant écrite ailleurs : `cases2035.ts` dit « `montant` reste
 * positif, le signe est porté par la nature », et `totauxPourAnnee` juste au-dessus rend un `ca` et
 * des `cotis` positifs. C'est donc le calcul qui rentre dans le rang, pas la saisie.
 *
 * ET LES RECETTES N'ONT RIEN À FAIRE ICI, ce que le commentaire d'origine disait déjà sans que le
 * code le fasse : « ici on ne veut que les postes de charge issus des catégories ». Une pièce de
 * vente dont la catégorie porte un poste 2035 entrait dans une carte intitulée « autres charges »,
 * indiscernable d'une charge une fois écrite. Le chiffre d'affaires a son propre champ, dans
 * `references_annuelles`.
 *
 * Le montant est accumulé TEL QUEL — pas en valeur absolue : un avoir sur une charge la diminue,
 * exactement comme dans `declaration2035`, dont ce regroupement reprend la logique (catégorie →
 * poste, pièces immobilisées exclues pour ne pas compter une dépense capitalisée comme une charge
 * courante en plus).
 */
export function chargesParPostePourAnnee(
  piecesValidees: Piece[],
  categories: { id: string; poste_2035: string | null }[],
  immobilisationPieceIds: ReadonlySet<string>,
  annee: number,
  assujettiTva: boolean,
  // Comme la 2035 : une dépense compte l'année de son PAIEMENT (lib/rattachement.ts) — de sa facture,
  // en engagement.
  paiements: PaiementsDesPieces,
  mode: ModeComptable,
  // Les dépenses payées sans justificatif — les frais bancaires, les intérêts et l'assurance d'une
  // échéance d'emprunt — à la date du mouvement, dans leur poste (lib/partsDuReleve.ts).
  partsDuReleve: readonly PartDuReleve[],
): Map<string, number> {
  const totaux = new Map<string, number>()
  for (const p of piecesValidees) {
    if (p.type_piece === 'vente') continue
    if (immobilisationPieceIds.has(p.id)) continue
    const part = partDansLaPeriode(rattachements(p, paiements.get(p.id) ?? [], mode), `${annee}-01-01`, `${annee}-12-31`)
    if (part === 0) continue
    const poste = categories.find((c) => c.id === p.categorie_id)?.poste_2035
    if (!poste) continue
    totaux.set(poste, (totaux.get(poste) ?? 0) + (montantRetenu(p, assujettiTva) ?? 0) * part)
  }
  for (const part of partsDuReleve) {
    if (part.nature !== 'depense' || anneeDe(part.ligne.date) !== annee || !part.poste) continue
    totaux.set(part.poste, (totaux.get(part.poste) ?? 0) + part.montantPoste)
  }
  return totaux
}
