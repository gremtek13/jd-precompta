import { anneeDe } from './format'
import { moisEcoulesDeLAnnee } from './situationIntermediaire'
import type { CotisationDeclaree, Piece } from './types'

// Calculs partagés entre l'Estimation cabinet (EstimationTab, un dossier à la fois) et la Simulation
// côté client (ClientSimulation, lecture seule) — mêmes chiffres, un seul endroit à faire évoluer si
// la règle de projection change un jour.

export function totauxPourAnnee(pieces: Piece[], cotisations: CotisationDeclaree[], annee: number) {
  const ca = pieces
    .filter((p) => p.date_piece?.startsWith(String(annee)))
    .reduce((sum, p) => sum + (p.montant_ht ?? p.montant_ttc ?? 0), 0)
  const cotis = cotisations
    .filter((c) => c.echeance.startsWith(String(annee)))
    .reduce((sum, c) => sum + (c.montant_verse ?? c.montant_appele), 0)
  return { ca, cotis }
}

export interface ProjectionAnnuelle {
  annee: number
  /** Mois écoulés depuis le 1er janvier, en 30/360 — le diviseur des ratios bancaires. */
  moisEcoules: number
  /** Recettes datées du 1er janvier à aujourd'hui inclus. */
  ca: number
  /** Échéances du 1er janvier à aujourd'hui inclus : « appelées à date », jamais une à venir. */
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
  recettes: Piece[], cotisations: CotisationDeclaree[], dateDuJour: string,
): ProjectionAnnuelle {
  const annee = anneeDe(dateDuJour)
  // `totauxPourAnnee` garde l'année ; la borne du jour en fait un « à date ». Les deux filtres
  // passent par la même règle de montant que le calcul des repères — un seul endroit.
  const { ca, cotis } = totauxPourAnnee(
    recettes.filter((p) => p.date_piece != null && p.date_piece <= dateDuJour),
    cotisations.filter((c) => c.echeance <= dateDuJour),
    annee,
  )
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
): Map<string, number> {
  const totaux = new Map<string, number>()
  for (const p of piecesValidees) {
    if (!p.date_piece?.startsWith(String(annee))) continue
    if (p.type_piece === 'vente') continue
    if (immobilisationPieceIds.has(p.id)) continue
    const poste = categories.find((c) => c.id === p.categorie_id)?.poste_2035
    if (!poste) continue
    totaux.set(poste, (totaux.get(poste) ?? 0) + (p.montant_ht ?? p.montant_ttc ?? 0))
  }
  return totaux
}
