import { ecritureConforme, ecrituresSansPieceParMouvement, type LigneEcritureMouvement, type MouvementBancaire } from './affectationBanque'
import { libelleExploitable } from './appariementBanque'
import { refusEcritSurUnCompteDeBilan } from './classementsDuMouvement'
import {
  COMPTE_ARRONDIS_CHARGE, COMPTE_ARRONDIS_PRODUIT, COMPTE_BANQUE, COMPTE_CREDIT_TVA_A_REPORTER,
  COMPTE_REMBOURSEMENT_TVA_DEMANDE, COMPTE_TVA_A_DECAISSER, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE,
  COMPTE_TVA_IMMOBILISATIONS,
} from './comptes'
import { dePeriode, libellePeriode, periodesDeLAnnee, type DeclarationCa3, type PeriodeTva } from './declarationTva'
import { dernierJourDuMois, formatDate, formatMoney } from './format'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { DeclarationTva, EcritureBrouillon, LigneBancaire, PeriodiciteTva } from './types'
import { dateFigee, estFigee } from './validationExercice'

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

// Le solde que la liquidation porte à chaque compte, en centimes, positif au débit — la composition de
// `liquidation_attendue`, ligne pour ligne. Null pour une déclaration saisie à la main.
function soldesDeLaLiquidation(d: DeclarationLiquidable): [string, number][] | null {
  if (!d.cases || d.tva_collectee == null || d.tva_deductible == null || d.tva_deductible_immobilisations == null) return null
  const ligne = (cle: string) => centimes(Number(d.cases?.[cle] ?? 0))
  const soldes: [string, number][] = [
    [COMPTE_TVA_COLLECTEE, centimes(d.tva_collectee)],
    [COMPTE_TVA_DEDUCTIBLE, -centimes(d.tva_deductible)],
    [COMPTE_TVA_IMMOBILISATIONS, -centimes(d.tva_deductible_immobilisations)],
    [COMPTE_CREDIT_TVA_A_REPORTER, ligne('l27') - ligne('l22')],
    [COMPTE_TVA_A_DECAISSER, -ligne('l28')],
    [COMPTE_REMBOURSEMENT_TVA_DEMANDE, ligne('l26')],
  ]
  // `0 - …` et non `-…` : un arrondi nul reste un zéro positif.
  const arrondi = 0 - soldes.reduce((s, [, solde]) => s + solde, 0)
  return [...soldes, [arrondi > 0 ? COMPTE_ARRONDIS_CHARGE : COMPTE_ARRONDIS_PRODUIT, arrondi]]
}

// L'ÉCRITURE DE LIQUIDATION d'une déclaration, au dernier jour de sa période : chaque compte reçoit son solde, la TVA
// collectée au débit du 445710, la TVA déductible au crédit du 445660 et du 445620, le crédit de TVA au 445670, la
// TVA à payer au crédit du 445510, le remboursement demandé au débit du 445830, l'arrondi au 658000 ou au 758000.
// Rien pour une déclaration saisie à la main, ni pour un solde nul.
export function ecritureDeLaLiquidation(d: DeclarationLiquidable): LigneEcritureMouvement[] {
  const soldes = soldesDeLaLiquidation(d)
  if (!soldes) return []
  const libelle = `CA3 ${libellePeriode(d.periode_debut, d.periode_fin)}`
  return soldes
    .filter(([, solde]) => solde !== 0)
    .map(([compte, solde]) => ({ compte, sens: solde > 0 ? 'debit' : 'credit', montant: Math.abs(solde) / 100, libelle }))
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
// mouvement, sans TVA.
export function ecritureDuPaiementTva(ligne: Pick<LigneBancaire, 'montant' | 'libelle' | 'libelle_brut'>): LigneEcritureMouvement[] {
  const entree = ligne.montant > 0
  const montant = Math.abs(ligne.montant)
  const libelle = libelleExploitable(ligne) || ligne.libelle
  return [
    { compte: COMPTE_BANQUE, sens: entree ? 'debit' : 'credit', montant, libelle },
    {
      compte: entree ? COMPTE_REMBOURSEMENT_TVA_DEMANDE : COMPTE_TVA_A_DECAISSER,
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
}

// Les trois montants que la déclaration enregistre : ceux de la CA3, ou ceux saisis.
function montantsDeLaDemande(demande: DemandeDeDeclaration): { tva: number | null; credit: number | null; remboursement: number | null } {
  if (demande.ca3) return { tva: demande.ca3.netPeriode, credit: demande.ca3.cases.l22, remboursement: demande.remboursement }
  return { tva: demande.tvaDeclaree, credit: demande.credit, remboursement: demande.remboursement }
}

// POURQUOI CETTE DÉCLARATION NE PEUT PAS S'ENREGISTRER, dit AVANT le clic, dans l'ordre de la base : la fonction
// (`enregistrer_declaration_tva`), puis le déclencheur de la validation, puis la liquidation (`ecrire_liquidation_tva`).
// Un seul refus de plus que la base, et il la précède : un remboursement en centimes — la CA3 se dépose en euros
// entiers, et la base le refuserait plus loin, sous une phrase qui ne dirait pas pourquoi.
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
      p_ecriture: ecritureDeLaLiquidation(declaration),
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
): D[] {
  const parDeclaration = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.declaration_tva_id) continue
    parDeclaration.set(e.declaration_tva_id, [...(parDeclaration.get(e.declaration_tva_id) ?? []), e])
  }
  return declarations.filter((d) =>
    !estFigee(d.periode_fin, frontiere)
    && !ecritureConforme(parDeclaration.get(d.id) ?? [], ecritureDeLaLiquidation(d), d.periode_fin))
}

// LES MOUVEMENTS RAPPROCHÉS D'UNE DÉCLARATION DONT L'ÉCRITURE N'EST PLUS CELLE QUE LEUR MONTANT COMMANDE. DÉFENSIF,
// pour la même raison : `rapprocher_declaration_tva` écrit le lien et l'écriture ensemble. Un mouvement d'un exercice
// validé ne se juge plus.
export function paiementsTvaDesynchronises<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  frontiere: string | null,
): L[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return lignes.filter((l) =>
    !!l.declaration_tva_id
    && l.statut === 'rapprochee'
    && !estFigee(l.date, frontiere)
    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(l), l.date))
}
