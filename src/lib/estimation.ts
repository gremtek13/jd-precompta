import { anneeDe } from './format'
import type { PartDuReleve } from './partsDuReleve'
import { montantRetenu } from './montantRetenu'
import { partDansLaPeriode, rattachements, type PaiementsDesPieces } from './rattachement'
import { moisEcoulesDeLAnnee } from './situationIntermediaire'
import type { CotisationComptee } from './cotisationRapprochee'
import { categorieDesFraisBancaires, type EcrituresDesVentesDeLa2035, type FraisSansPoste } from './declaration2035'
import { fraisDesMouvements } from './ecrituresVentesFacturees'
import type { PlanComptable } from './planComptable'
import { centimesDesRecettesDeCaisse, type RecettesDeCaissePourLEstimation } from './recettesDeCaisse'
import type { Categorie, ModeComptable, Piece } from './types'
import { exemplaireDUneFactureSource, recettesFactureesParMois, type VentesFacturees } from './ventesFacturees'

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
  mode: ModeComptable, recettesFacturees: RecettesFacturees,
): number {
  return pieces.reduce((sum, p) => {
    // L'EXEMPLAIRE D'UNE FACTURE SOURCE NE COMPTE PLUS (lib/ventesFacturees.ts, § 8 de la conception) : c'est sa facture qui
    // compte la vente, dans les recettes facturées. « Non comptées », l'appelant ne sait pas quelle pièce est un exemplaire
    // — la session d'un client ne lit pas les factures — et la pièce compte comme hier : la vente l'est alors une fois, par
    // elle, et la facture pas du tout.
    if (recettesFacturees.etat === 'comptees' && exemplaireDUneFactureSource(p, recettesFacturees)) return sum
    const part = partDansLaPeriode(rattachements(p, paiements.get(p.id) ?? [], mode), debut, fin)
    return part === 0 ? sum : sum + (montantRetenu(p, assujettiTva) ?? 0) * part
  }, 0)
}

// LES VENTES FACTURÉES (ligne 28.6, chantier EC-Q3, étape VF3b3 ; lib/ventesFacturees.ts). Une facture validée SOURCE de sa
// vente compte elle-même — ses encaissements en trésorerie, la facture et ses avoirs à leur date d'émission en engagement
// (EC3-Q12) — et la pièce désignée comme son exemplaire ne compte plus.
//
// L'estimation les reçoit sous la forme que « Ma simulation » d'un client « Banque » recevra de la base à l'étape VF8
// (EC3-Q11) : UN TOTAL HORS TAXE PAR MOIS, sans détail — pour que le cabinet et le client fassent le même calcul, celui de ce
// module. Ou l'état « non comptées », que l'appelant CHOISIT et que son écran DIT : ce n'est pas une valeur par défaut. La
// simulation du client le passe jusqu'à VF8 (sa session ne lit pas les factures) ; l'Estimation du cabinet, jamais.
//
// LA PRÉCISION D'UN MOIS. « À date », la projection compte le mois du jour en entier. En trésorerie, c'est exact : la base ne
// laisse dater aucun encaissement dans l'avenir (`enregistrer_encaissement`, le jour à Paris). En engagement, une facture
// datée plus tard dans le mois compterait déjà : la base ne refuse pas une date d'émission à venir.
export type RecettesFacturees =
  | {
      etat: 'comptees'
      /** « AAAA-MM » → centimes hors taxes (`recettesFactureesParMois`). */
      parMois: ReadonlyMap<string, number>
      /** Les factures et avoirs sources : la pièce désignée comme l'exemplaire de l'un d'eux ne compte plus. */
      sources: ReadonlySet<string>
    }
  | { etat: 'non_comptees' }

/** L'état « non comptées » : l'appelant ne compte pas les ventes facturées, et son écran le dit. */
export const RECETTES_FACTUREES_NON_COMPTEES: RecettesFacturees = { etat: 'non_comptees' }

/**
 * Ce que « Ma simulation » dit qu'elle ne compte pas, jusqu'à VF8 (EC3-Q11). Juste : elle compte les pièces de vente du client
 * — l'exemplaire d'une facture compris, faute de savoir laquelle est source — et les recettes que le cabinet a classées sur
 * son relevé ; une facture validée dans l'application n'y entre pas comme telle. Au tutoiement de l'espace client.
 */
export const SIMULATION_SANS_VENTES_FACTUREES = 'Cette simulation ne compte pas encore les factures validées dans '
  + 'l’application : seulement tes pièces de vente et les recettes que ton cabinet a classées sur ton relevé.'

/**
 * La simulation le dit-elle ? Quand le dossier a basculé (`dossiers.ventes_par_les_factures`, que la session du client lit
 * avec le reste de son dossier) — ou quand elle n'a pas pu le lire : on ne tait pas une réserve qu'on ne sait pas écarter.
 * Avant la bascule, aucune facture n'est source : la simulation compte tout ce qui se compte, et se tait.
 */
export function simulationDitNePasCompterLesVentesFacturees(ventesParLesFactures: boolean | null | undefined): boolean {
  return ventesParLesFactures !== false
}

/** Les recettes facturées du dossier, telles que le cabinet les compte, dans le modèle comptable du dossier. */
export function recettesFactureesDuDossier(ventes: VentesFacturees, mode: ModeComptable): RecettesFacturees {
  return { etat: 'comptees', parMois: recettesFactureesParMois(ventes, mode), sources: ventes.sources }
}

// Les recettes facturées des mois de `debut` à `fin` (des dates civiles), bornes comprises, en euros.
function recettesFactureesDesMois(recettesFacturees: RecettesFacturees, debut: string, fin: string): number {
  if (recettesFacturees.etat === 'non_comptees') return 0
  const premier = debut.slice(0, 7)
  const dernier = fin.slice(0, 7)
  let centimes = 0
  for (const [mois, c] of recettesFacturees.parMois) if (mois >= premier && mois <= dernier) centimes += c
  return centimes / 100
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

// Les recettes de caisse d'une période, en euros (lib/recettesDeCaisse.ts). Une caisse absente ou non comptée y ajoute un zéro
// exact : x + 0 vaut x pour tout flottant, et le chiffre d'hier ne bouge pas d'un caractère.
function recettesDeCaisseDeLaPeriode(caisse: RecettesDeCaissePourLEstimation, debut: string, fin: string): number {
  return centimesDesRecettesDeCaisse(caisse, debut, fin) / 100
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
  // Sans valeur par défaut non plus : voir `RecettesFacturees`.
  recettesFacturees: RecettesFacturees,
  // LES RECETTES DE CAISSE (étape C3a ; lib/recettesDeCaisse.ts), à leur date, pour ce qu'elles ajoutent à leur poste, comme
  // dans la 2035. Sans valeur par défaut : absente, le drapeau baissé ; « non comptées », ce que la simulation d'un client
  // passe et dit.
  recettesDeCaisse: RecettesDeCaissePourLEstimation,
) {
  const debut = `${annee}-01-01`
  const fin = `${annee}-12-31`
  return {
    ca: montantDansLaPeriode(pieces, paiements, debut, fin, assujettiTva, mode, recettesFacturees)
      + recettesAffecteesDansLaPeriode(partsDuReleve, debut, fin)
      + recettesFactureesDesMois(recettesFacturees, debut, fin)
      + recettesDeCaisseDeLaPeriode(recettesDeCaisse, debut, fin),
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
  recettesFacturees: RecettesFacturees,
  recettesDeCaisse: RecettesDeCaissePourLEstimation,
): ProjectionAnnuelle {
  const annee = anneeDe(dateDuJour)
  // Du 1er janvier à aujourd'hui : la borne du jour fait un « à date », pour les recettes (à leur
  // encaissement) comme pour les échéances. La même règle de montant que le calcul des repères. Les
  // recettes facturées, au mois près : celui du jour compte en entier (voir `RecettesFacturees`).
  const ca = montantDansLaPeriode(recettes, paiements, `${annee}-01-01`, dateDuJour, assujettiTva, mode, recettesFacturees)
    + recettesAffecteesDansLaPeriode(partsDuReleve, `${annee}-01-01`, dateDuJour)
    + recettesFactureesDesMois(recettesFacturees, `${annee}-01-01`, dateDuJour)
    + recettesDeCaisseDeLaPeriode(recettesDeCaisse, `${annee}-01-01`, dateDuJour)
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
  // Entières, `code` et `dossier_id` compris : la catégorie « Frais bancaires » du dossier s'y choisit
  // (`categorieDesFraisBancaires`).
  categories: readonly Categorie[],
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
  // Le plan du dossier et les écritures de ses ventes facturées (étape VF8g) : les frais d'un mouvement d'encaissements,
  // voir `fraisDEncaissementsDeLAnnee`. Sans valeur par défaut, comme dans la 2035 et la situation : un appelant qui les
  // oublierait enregistrerait le repère d'un dossier basculé sans ses frais bancaires ; l'absence de bascule se DIT
  // (`sans_bascule`).
  plan: Pick<PlanComptable, 'services_bancaires'>,
  ecrituresDesVentes: EcrituresDesVentesDeLa2035,
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
  const frais = fraisDEncaissementsDeLAnnee(categories, annee, plan, ecrituresDesVentes)
  if (frais.poste !== null && frais.centimes !== 0) totaux.set(frais.poste, (totaux.get(frais.poste) ?? 0) + frais.centimes / 100)
  return totaux
}

// LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS (ligne 28.65, chantier EC-Q3, étape VF8g ; la règle de la 2035, VF4C3-Q1, et de la
// situation intermédiaire) : quand la banque crédite un peu moins que les encaissements de factures sources qu'un mouvement
// règle, l'écriture du mouvement porte la différence au compte des services bancaires — une charge de l'exercice du
// MOUVEMENT. Les MÊMES fonctions que la 2035 et la situation, jamais une règle recopiée : `fraisDesMouvements` lit la sortie
// de la composition, rien n'est recalculé ; `categorieDesFraisBancaires` choisit la catégorie (celle du dossier, sinon la
// commune), dont le poste reçoit la charge, POSITIVE comme le reste de ce détail. Sans catégorie ou sans poste : sur aucune
// ligne, et dit (`fraisSansPosteDeLAnnee`), jamais un poste deviné. En centimes entiers jusqu'au poste. Sans bascule, rien.
function fraisDEncaissementsDeLAnnee(
  categories: readonly Categorie[], annee: number, plan: Pick<PlanComptable, 'services_bancaires'>,
  ecrituresDesVentes: EcrituresDesVentesDeLa2035,
): { poste: string | null; centimes: number; sansPoste: FraisSansPoste[] } {
  if (ecrituresDesVentes.etat !== 'composees') return { poste: null, centimes: 0, sansPoste: [] }
  const composition = ecrituresDesVentes.composition
  const categorie = categorieDesFraisBancaires(categories, composition.dossierId)
  const poste = categorie?.poste_2035 || null
  let centimes = 0
  const sansPoste: FraisSansPoste[] = []
  for (const frais of fraisDesMouvements(composition, plan)) {
    if (anneeDe(frais.date) !== annee) continue
    if (poste === null) sansPoste.push({ frais, categorie })
    else centimes += frais.centimes
  }
  return { poste, centimes, sansPoste }
}

/**
 * Les frais d'un mouvement d'encaissements de l'exercice que le détail par poste ne range sur aucune ligne — la catégorie
 * « Frais bancaires » du dossier sans poste 2035, ou aucune catégorie de ce code —, pour que l'écran le DISE avant le clic.
 */
export function fraisSansPosteDeLAnnee(
  categories: readonly Categorie[], annee: number, plan: Pick<PlanComptable, 'services_bancaires'>,
  ecrituresDesVentes: EcrituresDesVentesDeLa2035,
): FraisSansPoste[] {
  return fraisDEncaissementsDeLAnnee(categories, annee, plan, ecrituresDesVentes).sansPoste
}
