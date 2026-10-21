import { ecritureConforme, ecrituresSansPieceParMouvement, type LigneEcritureMouvement, type MouvementBancaire } from './affectationBanque'
import { libelleExploitable } from './appariementBanque'
import { refusEcritSurUnCompteDeBilan } from './classementsDuMouvement'
import { dePeriode, libellePeriode, periodesDeLAnnee, type DeclarationCa3, type PeriodeTva } from './declarationTva'
import { dernierJourDuMois, formatDate, formatMoney } from './format'
import type { CleRoleComptable, PlanComptable } from './planComptable'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { DeclarationTva, EcritureBrouillon, LigneBancaire, PeriodiciteTva } from './types'
import { dateFigee, estFigee } from './validationExercice'
import type { SourceEcritureVente } from './ecrituresVentesFacturees'
import type { ExigibiliteVenteFacturee } from './ventesFacturees'

// LA TVA SE LIQUIDE, SON PAIEMENT ET SON REMBOURSEMENT S'ÉCRIVENT (ligne 26.8 de la feuille de route).
//
// Le brouillon d'un dossier assujetti porte la TVA de chaque pièce et de chaque recette du relevé — collectée au
// 445710, déductible au 445660 et au 445620 —, et rien ne la soldait : le prélèvement du Trésor ne s'écrivait sur
// aucun compte, si bien qu'il ne pouvait qu'être ignoré, et manquait au FEC. Décision du cabinet du 06/10/2026 :
//
//   - À L'ENREGISTREMENT D'UNE DÉCLARATION, une écriture solde la TVA de la période — la LIQUIDATION. Elle retire
//     des comptes 445710, 445660 et 445620 les montants EXACTS, au centime, que le brouillon porte pour ce que la
//     CA3 compte (`tvaDesComptes`, lib/declarationTva.ts), et porte ce qui se paie au 445510 (TVA à décaisser, ligne
//     28) ou, pour un crédit, au 445670 (crédit de TVA à reporter, ligne 27 moins ligne 22) ; le remboursement d'un
//     crédit demandé au Trésor passe par le 445830 (ligne 26). L'arrondi à l'euro de chaque ligne de la CA3 fait la
//     différence, et va au 658000 (une charge) ou au 758000 (un produit) — jamais au-delà de dix euros : huit lignes
//     arrondies à cinquante centimes près n'en font pas plus de quatre, et au-delà, ce n'est pas un arrondi.
//   - LE PRÉLÈVEMENT, rapproché de sa déclaration, solde le 445510 face à la banque ; LE REMBOURSEMENT reçu solde le
//     445830. Le montant est libre — un paiement en deux fois, une majoration —, et l'écran dit une déclaration payée
//     en partie ou en trop (`suiviDesDeclarations`).
//
// LA BASE VÉRIFIE TOUT (migration `liquidation_de_la_tva`) : `liquidation_attendue` compose la même écriture depuis
// ce que la déclaration a enregistré, `enregistrer_declaration_tva` vérifie que la CA3 proposée se tient et l'écrit
// avec sa liquidation dans une transaction, `rapprocher_declaration_tva` compose le paiement. Ce module compose ce
// que la base vérifie, et dit AVANT le clic ce qu'elle refuserait, dans son ordre.
//
// UNE DÉCLARATION SAISIE À LA MAIN (`cases` nulle) n'existe que pour une période antérieure à l'ouverture d'un
// dossier repris : sa TVA est dans les à-nouveaux (445510, 445670), et elle ne sert qu'à rattacher son paiement ou
// son remboursement, et à reporter son crédit. Elle n'écrit pas de liquidation.

// Au-delà, l'écart entre la TVA des comptes et la TVA déclarée n'est pas un arrondi (`ecrire_liquidation_tva`).
export const ARRONDI_MAXIMAL = 10

// Les colonnes d'une déclaration dont sa liquidation se déduit.
export type DeclarationLiquidable = Pick<
  DeclarationTva,
  'periode_debut' | 'periode_fin' | 'cases' | 'tva_collectee' | 'tva_deductible' | 'tva_deductible_immobilisations'
>

const centimes = (euros: number) => Math.round(euros * 100)

// Le solde que la liquidation porte au compte de chaque RÔLE, en centimes, positif au débit — la composition de
// `liquidation_attendue`, ligne pour ligne, qui lit chaque compte au plan du dossier depuis l'étape PC2. Null pour une
// déclaration saisie à la main. Le compte ne se pose qu'à l'écriture (`ecritureDeLaLiquidation`) : l'arrondi, qui ne
// dépend d'aucun compte, se lit ici sans plan.
function soldesDeLaLiquidation(d: DeclarationLiquidable): [CleRoleComptable, number][] | null {
  if (!d.cases || d.tva_collectee == null || d.tva_deductible == null || d.tva_deductible_immobilisations == null) return null
  const ligne = (cle: string) => centimes(Number(d.cases?.[cle] ?? 0))
  const soldes: [CleRoleComptable, number][] = [
    ['tva_collectee', centimes(d.tva_collectee)],
    ['tva_deductible', -centimes(d.tva_deductible)],
    ['tva_immobilisations', -centimes(d.tva_deductible_immobilisations)],
    ['credit_tva_a_reporter', ligne('l27') - ligne('l22')],
    ['tva_a_decaisser', -ligne('l28')],
    ['remboursement_tva_demande', ligne('l26')],
  ]
  // `0 - …` et non `-…` : un arrondi nul reste un zéro positif.
  const arrondi = 0 - soldes.reduce((s, [, solde]) => s + solde, 0)
  return [...soldes, [arrondi > 0 ? 'arrondi_charge' : 'arrondi_produit', arrondi]]
}

// L'ÉCRITURE DE LIQUIDATION d'une déclaration, au dernier jour de sa période : chaque compte reçoit son solde, la TVA
// collectée au débit du 445710, la TVA déductible au crédit du 445660 et du 445620, le crédit de TVA au 445670, la
// TVA à payer au crédit du 445510, le remboursement demandé au débit du 445830, l'arrondi au 658000 ou au 758000.
// Rien pour une déclaration saisie à la main, ni pour un solde nul. Chaque compte est celui de son rôle dans le PLAN du
// dossier (445710, 445660… par défaut).
export function ecritureDeLaLiquidation(d: DeclarationLiquidable, plan: PlanComptable): LigneEcritureMouvement[] {
  const soldes = soldesDeLaLiquidation(d)
  if (!soldes) return []
  const libelle = `CA3 ${libellePeriode(d.periode_debut, d.periode_fin)}`
  return soldes
    .filter(([, solde]) => solde !== 0)
    .map(([role, solde]) => ({ compte: plan[role], sens: solde > 0 ? 'debit' : 'credit', montant: Math.abs(solde) / 100, libelle }))
}

// L'arrondi de la liquidation, en euros, signé comme son solde : positif, une charge au 658000 — la déclaration fait
// payer plus que ce que les comptes portent ; négatif, un produit au 758000. Zéro pour une déclaration saisie à la
// main. C'est la TVA nette déclarée moins la TVA nette des comptes : chaque ligne de taux de la CA3 est arrondie à
// l'euro, et ce qui en sépare la somme des centimes du brouillon est ce montant-là.
export function arrondiDeLaLiquidation(d: DeclarationLiquidable): number {
  const soldes = soldesDeLaLiquidation(d)
  if (!soldes) return 0
  return soldes[soldes.length - 1][1] / 100
}

// La TVA que la déclaration fait payer : la ligne 32 de sa CA3, ou, pour une déclaration saisie à la main, sa TVA
// nette moins le crédit qu'elle a reçu — la règle de `rapprocher_declaration_tva`.
export function aPayerDe(d: Pick<DeclarationTva, 'cases' | 'tva_declaree' | 'credit_anterieur'>): number {
  if (!d.cases) return Math.max(d.tva_declaree - d.credit_anterieur, 0)
  return Number(d.cases.l32 ?? 0)
}

// ── Le paiement et le remboursement ──────────────────────────────────────────────────────────────────

// L'écriture d'un mouvement rapproché d'une déclaration : un prélèvement débite la TVA à décaisser (445510) face à la
// banque, un remboursement reçu crédite le remboursement demandé (445830) — au montant, à la date et dans le sens du
// mouvement, sans TVA. Les comptes sont ceux du PLAN du dossier, que `rapprocher_declaration_tva` relit au même plan.
export function ecritureDuPaiementTva(
  ligne: Pick<LigneBancaire, 'montant' | 'libelle' | 'libelle_brut'>, plan: PlanComptable,
): LigneEcritureMouvement[] {
  const entree = ligne.montant > 0
  const montant = Math.abs(ligne.montant)
  const libelle = libelleExploitable(ligne) || ligne.libelle
  return [
    { compte: plan.banque, sens: entree ? 'debit' : 'credit', montant, libelle },
    {
      compte: entree ? plan.remboursement_tva_demande : plan.tva_a_decaisser,
      sens: entree ? 'credit' : 'debit',
      montant,
      libelle,
    },
  ]
}

// La phrase de la base pour un mouvement déjà classé autrement.
export const REFUS_PAIEMENT_TVA_CLASSE =
  'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie, ventilé sur '
  + 'plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.'

// Pourquoi ce mouvement ne peut pas être rapproché de cette déclaration, dit AVANT d'écrire, dans l'ordre de
// `rapprocher_declaration_tva`. Un mouvement qui paie déjà une déclaration n'est pas refusé : le rapprochement
// remplace le précédent. Un exercice validé n'est pas jugé ici : l'écran ne propose pas un mouvement figé.
export function refusPaiementTva(
  ligne: MouvementBancaire,
  declaration: Pick<DeclarationTva, 'periode_fin' | 'cases' | 'tva_declaree' | 'credit_anterieur' | 'remboursement_demande'>,
): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) {
    return REFUS_PAIEMENT_TVA_CLASSE
  }
  const surUnCompteDeBilan = refusEcritSurUnCompteDeBilan(ligne)
  if (surUnCompteDeBilan) return surUnCompteDeBilan
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  if (ligne.date <= declaration.periode_fin) {
    return `Un paiement de TVA suit la période qu’il règle : ce mouvement est du ${formatDate(ligne.date)}, `
      + `la période se termine le ${formatDate(declaration.periode_fin)}.`
  }
  if (ligne.montant < 0 && aPayerDe(declaration) <= 0) return 'Cette déclaration n’a pas de TVA à payer.'
  if (ligne.montant > 0 && declaration.remboursement_demande <= 0) {
    return 'Aucun remboursement de crédit n’a été demandé sur cette déclaration (ligne 26).'
  }
  return null
}

// ── L'enregistrement ─────────────────────────────────────────────────────────────────────────────────

// Une période se saisit à la main quand elle précède l'ouverture d'un dossier repris : sa TVA est dans les
// à-nouveaux. Toute autre se prépare par le calcul (lib/declarationTva.ts). L'ouverture tombe un 1er janvier, et une
// période ne franchit pas une année : une période est avant elle ou après elle, jamais à cheval.
export function seSaisitALaMain(periode: { fin: string }, ouverture: string | null): boolean {
  return ouverture !== null && periode.fin < ouverture
}

const PERIODE_MOIS = /^\d{4}-\d{2}-01$/

// Ce qu'on demande d'enregistrer. Pour une période préparée par le calcul, la CA3 ; la TVA nette, le crédit reçu
// et le remboursement en découlent. Pour une période saisie à la main, les trois montants tapés.
export interface DemandeDeDeclaration {
  periode: { debut: string; fin: string }
  ca3: DeclarationCa3 | null
  // Le remboursement DEMANDÉ, tel que tapé : la CA3 le borne au crédit de la période, la demande non — c'est ce qui
  // permet de dire qu'il le dépasse.
  remboursement: number | null
  // Saisis à la main seulement.
  tvaDeclaree: number | null
  credit: number | null
}

export interface ContexteDeDeclaration {
  assujettiTva: boolean
  // La date du jour à Paris (`aujourdHuiAParis`), celle de la base.
  aujourdhui: string
  declarations: readonly Pick<DeclarationTva, 'periode_debut' | 'periode_fin'>[]
  // La date des à-nouveaux d'un dossier repris, ou null.
  ouverture: string | null
  anneesValidees: readonly number[]
  // Les écritures des ventes facturées du dossier, telles que l'onglet les a lues (`EcrituresDesVentesDeLaCa3`) : une
  // période qui en compte ne s'enregistre que quand elles sont à jour. Sans valeur par défaut.
  ventesFacturees: EcrituresDesVentesDeLaCa3
}

// Les trois montants que la déclaration enregistre : ceux de la CA3, ou ceux saisis.
function montantsDeLaDemande(demande: DemandeDeDeclaration): { tva: number | null; credit: number | null; remboursement: number | null } {
  if (demande.ca3) return { tva: demande.ca3.netPeriode, credit: demande.ca3.cases.l22, remboursement: demande.remboursement }
  return { tva: demande.tvaDeclaree, credit: demande.credit, remboursement: demande.remboursement }
}

// LES VENTES FACTURÉES, À LA LIQUIDATION (ligne 28.6, chantier EC-Q3 ; étape VF3b2, puis VF4c3). La CA3 compte la TVA d'une
// facture source à son exigibilité (lib/declarationTva.ts), et ses écritures la portent au compte de la TVA collectée à
// cette date, au centime (lib/ecrituresVentesFacturees.ts, qui la lit du même module) : `tvaDesComptes` la compte, et la
// liquidation la solde. Mais seulement si ces écritures SONT au brouillon, telles que leurs sources les commandent : la
// base ne le vérifie pas — `enregistrer_declaration_tva` juge la déclaration contre elle-même, pas contre le brouillon —,
// et sans elles la liquidation solderait au 445710 une TVA qu'aucune écriture n'y a portée. D'où trois refus de
// l'application, dits avant le clic, après l'exercice validé et avant l'équilibre de la liquidation, dont ils sont la vraie
// cause (`refusDesVentesFacturees`) :
//   - UNE EXIGIBILITÉ ÉCARTÉE de la CA3 (2,1 %, un taux de la Corse ou d'outre-mer) : son écriture porte sa TVA au 445710,
//     mais aucune ligne de la déclaration de l'application ne la porte, et `enregistrer_declaration_tva` n'admet qu'une CA3
//     qui se déduit de ses lignes. Rien ne peut la porter juste : le refus reste pour elle ;
//   - LES ÉCRITURES DES VENTES FACTURÉES PAS LUES EN ENTIER — pas encore revenues, partielles, refusées, ou qui ne se tiennent
//     pas avec leurs sources : côté fermé, on ne sait pas ce que le 445710 porte ;
//   - UNE SOURCE DE LA PÉRIODE QUI N'EST PAS À JOUR — une facture, un avoir ou un encaissement dont une exigibilité tombe dans
//     la période, ou dont une écriture composée ou proposée y est datée : à écrire, à réécrire, à retirer, ou qui ne s'écrit
//     pas (un compte de contrepartie à choisir) ; validée ou à jour, elle porte exactement ce que la CA3 compte. Le
//     mouvement que des encaissements classent n'en est pas : son écriture ne touche aucun compte de TVA.
// Une période qu'aucune vente facturée ne touche s'enregistre comme hier, une fois ces écritures lues.

/**
 * Ce que l'onglet TVA sait des écritures des ventes facturées du dossier. `sans_bascule` : le dossier n'a pas basculé —
 * aucune facture n'y est source, la base le garantit, et rien n'est à lire. `en_attente` : la lecture n'est pas revenue.
 * `incomplete` : partielle, refusée ou rompue. `lue` : l'état de chaque source (lib/ecrituresVentesFactureesEcran.ts),
 * incohérent compris. Sans valeur par défaut.
 */
export type EcrituresDesVentesDeLaCa3 =
  | { etat: 'sans_bascule' }
  | { etat: 'en_attente' }
  | { etat: 'incomplete'; motif: string }
  | { etat: 'lue'; etats: EtatsDesSourcesDeVente }

// CE QUE LA LIQUIDATION LIT DE L'ÉTAT DES SOURCES (`etatsDesVentesFacturees`, lib/ecrituresVentesFactureesEcran.ts), décrit
// ici et non importé : ce module est lu par la 2035, que l'espace du client atteint, et le module d'écran des ventes facturées
// est au cabinet seul, import de type compris (ventesFactureesEcrituresCabinetSeul.test.ts suit chaque `from`). Le
// compilateur confronte les deux formes là où l'onglet TVA passe l'une pour l'autre, et liquidationTva.test.ts aussi.
export type EtatDeLaSourceDeVente = 'a_ecrire' | 'a_jour' | 'a_reecrire' | 'a_retirer' | 'validee' | 'ne_s_ecrit_pas'
export type EtatsDesSourcesDeVente =
  | {
    etat: 'lus'
    sources: readonly {
      source: SourceEcritureVente; etat: EtatDeLaSourceDeVente; nom: string
      aEcrire: readonly { date: string }[]; proposees: readonly { date: string }[]
    }[]
  }
  | { etat: 'incoherent'; motif: string }

export const REFUS_VENTES_FACTUREES_EN_ATTENTE =
  'Les écritures des ventes facturées ne sont pas encore lues : la liquidation ne s’enregistre qu’une fois vérifié que '
  + 'chacune porte la TVA que la déclaration compte.'

const tauxEnClair = (taux: number) => `${String(taux).replace('.', ',')} %`

// L'état d'une source en mots : ceux de la section « Ventes facturées » (`LIBELLE_ETAT_SOURCE`), qu'un test confronte à
// cette copie — le module d'écran n'est pas importé ici (voir plus haut).
export const ETAT_DE_LA_SOURCE_EN_MOTS: Readonly<Record<EtatDeLaSourceDeVente, string>> = {
  a_ecrire: 'à écrire', a_jour: 'à jour', a_reecrire: 'à réécrire', a_retirer: 'à retirer', validee: 'validée', ne_s_ecrit_pas: 'ne s’écrit pas',
}

// La source qu'une exigibilité rend exigible : son encaissement, son avoir, ou sa facture (la livraison d'un bien, la
// facture sur l'option pour les débits) — l'écriture que la composition passe pour elle.
function sourceDeLExigibilite(s: SourceEcritureVente, x: ExigibiliteVenteFacturee): boolean {
  if (x.origine === 'encaissement') return s.genre === 'encaissement' && s.encaissementId === x.encaissementId
  if (x.origine === 'avoir') return s.genre === 'avoir' && s.factureId === x.avoirId
  return s.genre === 'facture' && s.factureId === x.factureId
}

/**
 * Pourquoi la déclaration de cette période ne peut pas s'enregistrer à cause de ses ventes facturées, sous des mots qui
 * nomment ce qui manque ; nul quand rien ne la retient. Dans l'ordre : une exigibilité écartée, une lecture qui manque,
 * une source qui n'est pas à jour.
 */
export function refusDesVentesFacturees(ca3: DeclarationCa3, ecritures: EcrituresDesVentesDeLaCa3): string | null {
  if (ca3.exigibilitesEcartees.length > 0) {
    const liste = ca3.exigibilitesEcartees.map(({ exigibilite: x }) =>
      `${x.numero ?? 'sans numéro'} (${x.tiers}) à ${tauxEnClair(x.taux)}, ${formatMoney(x.tvaCentimes / 100)} de TVA`).join(' ; ')
    return `Cette période compte la TVA d’une vente facturée à un taux qu’aucune ligne de la déclaration ne range (${liste}) : `
      + 'son écriture la porte au compte de la TVA collectée, et la liquidation la solderait sans qu’elle soit déclarée. '
      + 'Cette déclaration se dépose et se liquide hors de l’application.'
  }
  const { debut, fin } = ca3.periode
  const dans = (date: string) => date >= debut && date <= fin
  const exigibles = [...ca3.exigibilitesRetenues, ...ca3.exigibilitesEcartees].map((r) => r.exigibilite)
  switch (ecritures.etat) {
    case 'sans_bascule':
      return exigibles.length === 0 ? null
        : 'Cette période compte la TVA d’une facture source de sa vente, alors que le dossier ne se dit pas basculé : '
          + 'les lectures ne se tiennent pas. Recharge la page.'
    case 'en_attente':
      return REFUS_VENTES_FACTUREES_EN_ATTENTE
    case 'incomplete':
      return `Les écritures des ventes facturées n’ont pas pu être lues en entier (${ecritures.motif}) : la liquidation ne `
        + 'se décide pas sur une lecture partielle. Recharge la page.'
  }
  if (ecritures.etats.etat === 'incoherent') {
    return `Les écritures des ventes facturées ne se tiennent pas avec leurs sources (${ecritures.etats.motif}) : la `
      + 'liquidation ne se décide pas sur elles. Recharge la page.'
  }
  const sources = ecritures.etats.sources
  const enRetard: string[] = []
  for (const x of exigibles) {
    if (!sources.some((s) => sourceDeLExigibilite(s.source, x))) {
      enRetard.push(`une source de la facture ${x.numero ?? 'sans numéro'} que l’état des écritures ne liste pas`)
    }
  }
  for (const s of sources) {
    if (s.source.genre === 'mouvement' || s.etat === 'a_jour' || s.etat === 'validee') continue
    const concernee = exigibles.some((x) => sourceDeLExigibilite(s.source, x))
      || s.aEcrire.some((e) => dans(e.date)) || s.proposees.some((l) => dans(l.date))
    if (concernee) enRetard.push(`${s.nom} (${ETAT_DE_LA_SOURCE_EN_MOTS[s.etat]})`)
  }
  if (enRetard.length === 0) return null
  return `La liquidation attend les écritures des ventes facturées de la période : ${enRetard.join(' ; ')}. Sans elles, `
    + 'elle solderait au compte de la TVA collectée une TVA qu’aucune écriture à jour n’y porte. Elles se passent depuis la '
    + 'section « Ventes facturées » de l’onglet Écritures.'
}

// POURQUOI CETTE DÉCLARATION NE PEUT PAS S'ENREGISTRER, dit AVANT le clic, dans l'ordre de la base : la fonction
// (`enregistrer_declaration_tva`), puis le déclencheur de la validation, puis la liquidation (`ecrire_liquidation_tva`).
// Deux refus de plus que la base. Un remboursement en centimes, qui la précède — la CA3 se dépose en euros entiers, et la
// base le refuserait plus loin, sous une phrase qui ne dirait pas pourquoi. Et les ventes facturées de la période
// (`refusDesVentesFacturees`), que la base accepterait : dites avant l'équilibre de la liquidation, dont elles sont la
// vraie raison.
export function refusEnregistrement(demande: DemandeDeDeclaration, contexte: ContexteDeDeclaration): string | null {
  const { debut, fin } = demande.periode
  if (!contexte.assujettiTva) return 'Ce dossier n’est pas assujetti à la TVA : il n’a pas de déclaration à enregistrer.'
  if (!PERIODE_MOIS.test(debut) || fin !== dernierJourDuMois(fin) || debut > fin || debut.slice(0, 4) !== fin.slice(0, 4)) {
    return 'Une période de TVA va du premier jour d’un mois au dernier jour d’un mois, dans une même année.'
  }
  if (fin >= contexte.aujourdhui) return 'La période n’est pas terminée : sa déclaration s’enregistre une fois déposée.'
  if (contexte.declarations.some((d) => d.periode_debut <= fin && debut <= d.periode_fin)) {
    return 'Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci : retirez-la d’abord.'
  }
  const { tva, credit, remboursement } = montantsDeLaDemande(demande)
  if (tva == null || credit == null || credit < 0) {
    return 'La TVA nette de la période et le crédit reporté (ligne 22, positif ou nul) sont à renseigner.'
  }
  if (remboursement == null || remboursement < 0) return 'Le remboursement demandé (ligne 26) est un montant positif ou nul.'
  if (!Number.isInteger(remboursement)) return 'Le remboursement demandé (ligne 26) se demande en euros entiers.'
  if (remboursement > Math.max(credit - tva, 0)) {
    return 'Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).'
  }
  const aLaMain = seSaisitALaMain(demande.periode, contexte.ouverture)
  if (!demande.ca3 && !aLaMain) {
    return 'Une déclaration s’enregistre telle que l’application l’a préparée : seule une période antérieure à '
      + 'l’ouverture du dossier, dont la TVA est dans les à-nouveaux, se saisit à la main.'
  }
  if (demande.ca3 && aLaMain) {
    return 'Cette période précède l’ouverture du dossier : sa TVA est dans les à-nouveaux, et sa déclaration se saisit '
      + 'à la main, sans liquidation.'
  }
  const figee = dateFigee(fin, contexte.anneesValidees)
  if (figee) return `${figee} : une déclaration de TVA ne s’y enregistre plus.`
  if (demande.ca3) {
    const ventes = refusDesVentesFacturees(demande.ca3, contexte.ventesFacturees)
    if (ventes) return ventes
    const arrondi = Math.abs(arrondiDeLaLiquidation(declarationDeLaCa3(demande.ca3, demande.periode)))
    if (arrondi > ARRONDI_MAXIMAL) {
      return `La liquidation ne s’équilibre pas : un écart de ${formatMoney(arrondi)} entre la TVA des comptes et la `
        + 'TVA déclarée n’est pas un arrondi.'
    }
  }
  return null
}

// Ce que la déclaration enregistrera d'une CA3 préparée : ses cases, et la TVA exacte des comptes. L'onglet TVA en
// montre la liquidation avant le clic.
export function declarationDeLaCa3(ca3: DeclarationCa3, periode: { debut: string; fin: string }): DeclarationLiquidable {
  return {
    periode_debut: periode.debut,
    periode_fin: periode.fin,
    cases: { ...ca3.cases },
    tva_collectee: ca3.tvaDesComptes.collectee,
    tva_deductible: ca3.tvaDesComptes.deductible,
    tva_deductible_immobilisations: ca3.tvaDesComptes.immobilisations,
  }
}

// LES PARAMÈTRES DE `enregistrer_declaration_tva`. Pour une CA3 préparée, la TVA nette est sa ligne 16 moins ses
// lignes 19 à 21, le crédit sa ligne 22 et le remboursement sa ligne 26 — la base vérifie qu'ils s'en déduisent —, et
// l'écriture celle que ses cases et ses montants exacts commandent. Pour une saisie à la main, les montants tapés, et
// ni cases, ni montants, ni écriture.
export function parametresEnregistrement(
  dossierId: string,
  demande: DemandeDeDeclaration,
  dateDeclaration: string | null,
  // Le plan du dossier : la liquidation se compose à ses comptes, que `enregistrer_declaration_tva` relit au même plan.
  plan: PlanComptable,
): Record<string, unknown> {
  const { debut, fin } = demande.periode
  if (demande.ca3) {
    const declaration = declarationDeLaCa3(demande.ca3, demande.periode)
    return {
      p_dossier_id: dossierId,
      p_periode_debut: debut,
      p_periode_fin: fin,
      p_tva_declaree: demande.ca3.netPeriode,
      p_credit_anterieur: demande.ca3.cases.l22,
      p_remboursement_demande: demande.ca3.cases.l26,
      p_date_declaration: dateDeclaration,
      p_cases: declaration.cases,
      p_tva_collectee: declaration.tva_collectee,
      p_tva_deductible: declaration.tva_deductible,
      p_tva_deductible_immobilisations: declaration.tva_deductible_immobilisations,
      p_ecriture: ecritureDeLaLiquidation(declaration, plan),
    }
  }
  return {
    p_dossier_id: dossierId,
    p_periode_debut: debut,
    p_periode_fin: fin,
    p_tva_declaree: demande.tvaDeclaree,
    p_credit_anterieur: demande.credit,
    p_remboursement_demande: demande.remboursement,
    p_date_declaration: dateDeclaration,
    p_cases: null,
    p_tva_collectee: null,
    p_tva_deductible: null,
    p_tva_deductible_immobilisations: null,
    p_ecriture: [],
  }
}

// UN REMBOURSEMENT N'EST ACCORDÉ QU'AU-DELÀ D'UN SEUIL (CGI, ann. II, art. 242-0 A et 242-0 C) : 760 € en cours
// d'année, 150 € au titre du 31 décembre. L'application ne refuse pas une demande plus petite — c'est l'administration
// qui en juge —, l'écran la signale. Rien sous un remboursement nul.
export function seuilRemboursement(periodeFin: string): number {
  return periodeFin.slice(5) === '12-31' ? 150 : 760
}

export function remboursementSousLeSeuil(periodeFin: string, remboursement: number): boolean {
  return remboursement > 0 && remboursement < seuilRemboursement(periodeFin)
}

// ── Ce qui se suit ───────────────────────────────────────────────────────────────────────────────────

export type EtatPaiementTva = 'rien_a_payer' | 'a_payer' | 'payee' | 'payee_en_partie' | 'payee_en_trop'
export type EtatRemboursementTva = 'sans_objet' | 'attendu' | 'recu' | 'recu_en_partie' | 'recu_en_trop'

export interface SuiviDeDeclaration<D, L> {
  declaration: D
  aPayer: number
  paye: number
  etatPaiement: EtatPaiementTva
  remboursementDemande: number
  rembourse: number
  etatRemboursement: EtatRemboursementTva
  // Les mouvements rapprochés de la déclaration, prélèvements et remboursements, dans l'ordre du relevé.
  mouvements: L[]
}

function etat<E extends string>(attendu: number, recu: number, etats: [E, E, E, E, E]): E {
  const [sansObjet, enAttente, solde, enPartie, enTrop] = etats
  if (attendu <= 0) return recu > 0 ? enTrop : sansObjet
  if (recu === 0) return enAttente
  if (recu === attendu) return solde
  return recu < attendu ? enPartie : enTrop
}

// CE QUE CHAQUE DÉCLARATION FAIT PAYER, ET CE QUE LE RELEVÉ EN PORTE : ses prélèvements face à la TVA à payer, ses
// remboursements reçus face au remboursement demandé. Comparés en centimes ; un mouvement ne compte que rapproché.
export function suiviDesDeclarations<
  D extends Pick<DeclarationTva, 'id' | 'cases' | 'tva_declaree' | 'credit_anterieur' | 'remboursement_demande'>,
  L extends Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'statut' | 'declaration_tva_id'>,
>(declarations: readonly D[], lignes: readonly L[]): SuiviDeDeclaration<D, L>[] {
  return declarations.map((declaration) => {
    const mouvements = lignes
      .filter((l) => l.declaration_tva_id === declaration.id && l.statut === 'rapprochee')
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const aPayer = centimes(aPayerDe(declaration))
    const paye = mouvements.filter((l) => l.montant < 0).reduce((s, l) => s - centimes(l.montant), 0)
    const demande = centimes(declaration.remboursement_demande)
    const rembourse = mouvements.filter((l) => l.montant > 0).reduce((s, l) => s + centimes(l.montant), 0)
    return {
      declaration,
      aPayer: aPayer / 100,
      paye: paye / 100,
      etatPaiement: etat(aPayer, paye, ['rien_a_payer', 'a_payer', 'payee', 'payee_en_partie', 'payee_en_trop']),
      remboursementDemande: demande / 100,
      rembourse: rembourse / 100,
      etatRemboursement: etat(demande, rembourse, ['sans_objet', 'attendu', 'recu', 'recu_en_partie', 'recu_en_trop']),
      mouvements,
    }
  })
}

// Ce que le relevé a payé d'une déclaration, et ce qu'il lui a remboursé, en mots : l'onglet TVA les met en pastilles dans
// l'historique, la fiche d'un mouvement sous la déclaration qu'il paie. Écrits une fois, pour que les deux disent pareil.
export function phraseDuPaiement(s: Pick<SuiviDeDeclaration<unknown, unknown>, 'etatPaiement' | 'aPayer' | 'paye'>): string {
  switch (s.etatPaiement) {
    case 'rien_a_payer': return 'rien à payer'
    case 'a_payer': return `${formatMoney(s.aPayer)} à payer`
    case 'payee': return 'payée'
    case 'payee_en_partie': return `payée ${formatMoney(s.paye)} sur ${formatMoney(s.aPayer)}`
    case 'payee_en_trop': return `payée ${formatMoney(centimes(s.paye - s.aPayer) / 100)} de trop`
  }
}

export function phraseDuRemboursement(
  s: Pick<SuiviDeDeclaration<unknown, unknown>, 'etatRemboursement' | 'remboursementDemande' | 'rembourse'>,
): string | null {
  switch (s.etatRemboursement) {
    case 'sans_objet': return null
    case 'attendu': return `remboursement de ${formatMoney(s.remboursementDemande)} attendu`
    case 'recu': return 'remboursement reçu'
    case 'recu_en_partie': return `remboursé ${formatMoney(s.rembourse)} sur ${formatMoney(s.remboursementDemande)}`
    case 'recu_en_trop': return `remboursé ${formatMoney(centimes(s.rembourse - s.remboursementDemande) / 100)} de trop`
  }
}

type DeclarationSuivie = Pick<DeclarationTva, 'id' | 'periode_fin' | 'cases' | 'tva_declaree' | 'credit_anterieur' | 'remboursement_demande'>
type MouvementSuivi = Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'statut' | 'declaration_tva_id'>

// Ce qu'il reste à recevoir de la déclaration DANS LE SENS DU MOUVEMENT, en centimes : la TVA qui reste à payer pour un
// prélèvement, le remboursement qui reste attendu pour un encaissement. Un mouvement déjà rapproché d'elle ne compte
// pas dans son propre reste : le rapprocher de nouveau le remplacerait.
function resteDu<D extends DeclarationSuivie, L extends MouvementSuivi>(ligne: L, s: SuiviDeDeclaration<D, L>): number {
  const dejaCompte = s.mouvements.some((m) => m.id === ligne.id) ? centimes(Math.abs(ligne.montant)) : 0
  return ligne.montant > 0
    ? centimes(s.remboursementDemande) - centimes(s.rembourse) + dejaCompte
    : centimes(s.aPayer) - centimes(s.paye) + dejaCompte
}

// LES DÉCLARATIONS QU'UN MOUVEMENT PEUT PAYER — ou rembourser —, de la plus probable à la moins probable : celles
// dont la période est finie avant lui, qui ont une TVA à payer (un prélèvement) ou un remboursement demandé (un
// encaissement) ; d'abord celle dont le reste dû est exactement son montant, puis celles qui ont encore quelque chose
// à recevoir, puis les autres — une majoration se paie sur une déclaration déjà payée —, chaque fois la période la plus
// récente d'abord.
export function declarationsPourLeMouvement<D extends DeclarationSuivie, L extends MouvementSuivi>(
  ligne: L,
  suivis: readonly SuiviDeDeclaration<D, L>[],
): D[] {
  if (ligne.montant === 0) return []
  const entree = ligne.montant > 0
  const montant = centimes(Math.abs(ligne.montant))
  const rangs = suivis
    .filter((s) => s.declaration.periode_fin < ligne.date)
    .filter((s) => (entree ? s.remboursementDemande > 0 : s.aPayer > 0))
    .map((s) => {
      const reste = resteDu(ligne, s)
      return { declaration: s.declaration, rang: reste === montant ? 0 : reste > 0 ? 1 : 2 }
    })
  return rangs
    .sort((a, b) => a.rang - b.rang || b.declaration.periode_fin.localeCompare(a.declaration.periode_fin))
    .map((r) => r.declaration)
}

// LES DÉCLARATIONS DONT CE MOUVEMENT RÈGLE EXACTEMENT LE RESTE, et dont la période est finie avant lui — la plus récente
// d'abord. Une seule : la fiche d'un mouvement la PROPOSE. Plusieurs : elles conviennent aussi bien, et la fiche les
// montre toutes sans en mettre une en avant — l'ordre de tri trancherait à la place de l'opérateur.
export function declarationsDuMontant<D extends DeclarationSuivie, L extends MouvementSuivi>(
  ligne: L,
  suivis: readonly SuiviDeDeclaration<D, L>[],
): D[] {
  if (ligne.montant === 0) return []
  const montant = centimes(Math.abs(ligne.montant))
  return suivis
    .filter((s) => s.declaration.periode_fin < ligne.date && resteDu(ligne, s) === montant)
    .map((s) => s.declaration)
    .sort((a, b) => b.periode_fin.localeCompare(a.periode_fin))
}

// UN MOUVEMENT À TRAITER QUI RESSEMBLE AU PAIEMENT — OU AU REMBOURSEMENT — D'UNE DÉCLARATION ENREGISTRÉE : son montant
// est exactement ce qui en reste dû, et il suit sa période. Les règles d'affectation ne le rangent pas dans une
// catégorie en lot (lib/reglesAffectation.ts) : une règle au nom du Trésor le mettrait en charge, et la TVA
// compterait dans la 2035.
export function paiementTvaPlausible<D extends DeclarationSuivie, L extends MouvementSuivi>(
  ligne: L,
  suivis: readonly SuiviDeDeclaration<D, L>[],
): boolean {
  return declarationsDuMontant(ligne, suivis).length > 0
}

// La phrase qui écarte un tel mouvement du lot des règles d'affectation, en nommant la déclaration à laquelle il
// ressemble — la plus récente, quand plusieurs conviennent.
export function raisonPaiementTvaPlausible<D extends DeclarationSuivie & Pick<DeclarationTva, 'periode_debut'>, L extends MouvementSuivi>(
  ligne: L,
  suivis: readonly SuiviDeDeclaration<D, L>[],
): string | null {
  const [d] = declarationsDuMontant(ligne, suivis)
  if (!d) return null
  const periode = dePeriode(libellePeriode(d.periode_debut, d.periode_fin))
  return ligne.montant < 0
    ? `Il ressemble au paiement de la TVA ${periode} : à rapprocher de sa déclaration, pas à affecter — la TVA compterait en charge.`
    : `Il ressemble au remboursement du crédit de TVA ${periode} : à rapprocher de sa déclaration, pas à affecter — il compterait en recette.`
}

// LES REMBOURSEMENTS DE CRÉDIT DE TVA NE SONT PAS UN RYTHME D'ACTIVITÉ : écrits au 512, ils entreraient dans la
// moyenne des encaissements du plan de trésorerie et flatteraient le taux d'endettement, sur le document qu'on montre
// à une banque — comme le déblocage d'un emprunt, que le plan écarte déjà. Les paiements, eux, restent : la TVA se
// paie chaque période, c'est une sortie régulière. Le SOLDE compte tout.
export function idsRemboursementsTva(
  lignes: readonly Pick<LigneBancaire, 'id' | 'statut' | 'montant' | 'declaration_tva_id'>[],
): ReadonlySet<string> {
  return new Set(lignes.filter((l) => l.statut === 'rapprochee' && !!l.declaration_tva_id && l.montant > 0).map((l) => l.id))
}

// LES PÉRIODES D'UN EXERCICE QU'AUCUNE DÉCLARATION NE COUVRE : terminées, après l'ouverture d'un dossier repris, et
// dont un mois au moins n'est dans aucune déclaration enregistrée. Leur TVA reste aux comptes 4457 et 4456, que rien
// ne solde. Rendu à part de la CA3 : c'est la validation d'un exercice et la Checklist qui le disent.
export function periodesNonDeclarees(
  declarations: readonly Pick<DeclarationTva, 'periode_debut' | 'periode_fin'>[],
  annee: number,
  periodicite: PeriodiciteTva,
  aujourdhui: string,
  ouverture: string | null,
): PeriodeTva[] {
  const moisDeclares = new Set<string>()
  for (const d of declarations) {
    for (let mois = d.periode_debut.slice(0, 7); mois <= d.periode_fin.slice(0, 7); mois = moisSuivant(mois)) moisDeclares.add(mois)
  }
  return periodesDeLAnnee(annee, periodicite).filter((p) =>
    p.fin < aujourdhui
    && (ouverture === null || p.debut >= ouverture)
    && moisDeLaPeriode(p).some((m) => !moisDeclares.has(m)))
}

// LES PÉRIODES EN RETARD DU DOSSIER ENTIER, pour la Checklist : celles des exercices où le dossier a une activité (un
// mouvement du relevé, une pièce datée), dont la CA3 aurait dû être déposée — la période finie avant le premier jour du
// mois précédent : une CA3 se dépose dans le mois qui suit sa période, au plus tard le 24, et réclamer celle du trimestre
// qui vient de finir crierait avant l'échéance —, après l'ouverture d'un dossier repris, et hors des exercices validés :
// une déclaration ne s'y enregistre plus, et leur validation l'a déjà dit (`periodes-tva-non-declarees`).
export function periodesEnRetard(
  declarations: readonly Pick<DeclarationTva, 'periode_debut' | 'periode_fin'>[],
  periodicite: PeriodiciteTva,
  anneesActives: readonly number[],
  premierJourDuMois: string,
  ouverture: string | null,
  frontiere: string | null,
): PeriodeTva[] {
  const [annee, mois] = premierJourDuMois.split('-').map(Number)
  const limite = mois === 1 ? `${annee - 1}-12-01` : `${annee}-${String(mois - 1).padStart(2, '0')}-01`
  return [...new Set(anneesActives)].sort((a, b) => a - b)
    .flatMap((a) => periodesNonDeclarees(declarations, a, periodicite, limite, ouverture))
    .filter((p) => !estFigee(p.fin, frontiere))
}

function moisSuivant(mois: string): string {
  const [annee, m] = mois.split('-').map(Number)
  return m === 12 ? `${annee + 1}-01` : `${annee}-${String(m + 1).padStart(2, '0')}`
}

function moisDeLaPeriode(p: PeriodeTva): string[] {
  const mois: string[] = []
  for (let m = p.debut.slice(0, 7); m <= p.fin.slice(0, 7); m = moisSuivant(m)) mois.push(m)
  return mois
}

// ── Les contrôles du brouillon ───────────────────────────────────────────────────────────────────────

// LES DÉCLARATIONS DONT L'ÉCRITURE DE LIQUIDATION N'EST PLUS CELLE QUE LEUR DÉCLARATION COMMANDE : absente, sur un
// autre compte, d'un autre montant, à une autre date — ou présente sur une déclaration saisie à la main. DÉFENSIF : la
// base les écrit dans la même transaction, et aucun geste de l'application ne retire l'une sans l'autre. Un contrôle qui
// parle trop se corrige ; celui qui se tait ne se voit pas.
//
// Une déclaration d'un exercice VALIDÉ ne se juge plus : la base refuse de réécrire sa liquidation. Sans valeur par
// défaut.
export function liquidationsDesynchronisees<D extends DeclarationLiquidable & Pick<DeclarationTva, 'id'>>(
  ecritures: readonly EcritureBrouillon[],
  declarations: readonly D[],
  frontiere: string | null,
  // Le plan du dossier : l'écriture attendue se recompose à ses comptes.
  plan: PlanComptable,
): D[] {
  const parDeclaration = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.declaration_tva_id) continue
    parDeclaration.set(e.declaration_tva_id, [...(parDeclaration.get(e.declaration_tva_id) ?? []), e])
  }
  return declarations.filter((d) =>
    !estFigee(d.periode_fin, frontiere)
    && !ecritureConforme(parDeclaration.get(d.id) ?? [], ecritureDeLaLiquidation(d, plan), d.periode_fin))
}

// LES MOUVEMENTS RAPPROCHÉS D'UNE DÉCLARATION DONT L'ÉCRITURE N'EST PLUS CELLE QUE LEUR MONTANT COMMANDE. DÉFENSIF,
// pour la même raison : `rapprocher_declaration_tva` écrit le lien et l'écriture ensemble. Un mouvement d'un exercice
// validé ne se juge plus.
export function paiementsTvaDesynchronises<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  frontiere: string | null,
  // Le plan du dossier : l'écriture attendue se recompose à ses comptes.
  plan: PlanComptable,
): L[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return lignes.filter((l) =>
    !!l.declaration_tva_id
    && l.statut === 'rapprochee'
    && !estFigee(l.date, frontiere)
    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(l, plan), l.date))
}
