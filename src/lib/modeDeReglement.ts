import type { LigneBancaire, ModeComptable } from './types'

// LE MODE DE RÈGLEMENT D'UN MOUVEMENT DU RELEVÉ (EXP58-Q1, décision du cabinet du 17/11/2026 : (B) « une colonne du
// mouvement, proposée puis corrigée par le cabinet » ; docs/conceptions/58-reponses-de-l-expert-comptable.md, § 1.1 et 1.2).
// Le FEC d'un BNC en trésorerie porte le mode de règlement de chaque écriture (LPF, art. A47 A-1, VIII, 7°, information 20 ;
// BOI-CF-IOR-60-40-20, § 290) ; pour un mouvement du relevé, l'application écrivait « Banque » (FEC22-Q2, (A)), et
// l'expert-comptable veut le type de règlement (FEC22-E3). La validation d'un exercice FIGE ModeRglt : le mode doit être
// juste AVANT la validation de 2025 de la répétition.
//
// CE MODULE TIENT trois choses, sans base ni horloge :
//   1. LA LISTE FERMÉE des modes d'un mouvement, celle de la contrainte `lignes_bancaires_mode_reglement_liste` et de
//      `poser_modes_de_reglement` (supabase/preparees/20261117193000_mode_de_reglement_des_mouvements.sql), que
//      modeDeReglement.test.ts confronte au texte de la migration. Chaque mode est un ModeRglt du FEC (`MODES_REGLEMENT`,
//      lib/champsBncDuFec.ts), écrit TEL QUE le fichier l'imprime : aucune table de codes, aucune lettre d'un logiciel. Les
//      sources : Code monétaire et financier, art. L. 314-1, II — 1° et 2° le versement et le retrait d'espèces, 3° a) les
//      prélèvements, b) les paiements par carte, c) les virements — ; art. L. 131-1 et suivants, le chèque ; Code de commerce,
//      art. L. 511-1 et suivants, la lettre de change (l'« Effet », une LCR) ; « Autre » pour ce qui n'est rien de cela.
//   2. LA PROPOSITION, tirée du LIBELLÉ de la banque, par ses seuls mots sûrs — le mot de type que la banque met en tête
//      (« VIR », « PRLV », « CB », « CHQ », « REM CHQ », « RETRAIT », un versement d'espèces) —, sinon RIEN : un mot qui ne
//      désigne pas l'instrument à coup sûr (« CARTE GRISE », « CHEQUE DEJEUNER », « COTIS CARTE ») ne propose rien, et
//      « Effet » ni « Autre » ne se proposent jamais. La proposition ne s'écrit JAMAIS sans le clic du cabinet : la base
//      refuse toute écriture du mode hors de sa fonction (`garder_mode_de_reglement`), l'import compris.
//   3. LES MOTS DE LA FICHE d'un mouvement : l'état du mode, ce que la base refuserait, dit avant le clic.
//
// LE FEC ne lit QUE le mode que le cabinet a posé, jamais la proposition (lib/champsBncDuFec.ts, `modeRgltDuReleve`) : un
// mouvement sans mode reste « Banque », comme hier.

/** Le drapeau de la migration `mode_de_reglement_des_mouvements` (EXP58-Q1, PRÉPARÉE le 17/11/2026) : baissé, la fiche d'un
 *  mouvement ne dit rien du mode, le FEC écrit « Banque » pour tout mouvement du relevé, à l'octet comme hier — la colonne et
 *  la fonction n'existent pas encore. Il se lève le jour de la migration. */
export const MODE_DE_REGLEMENT_PREVU = false

/** Les modes d'un mouvement, dans l'ordre de la contrainte et de la fonction. */
export const MODES_D_UN_MOUVEMENT = ['Virement', 'Prélèvement', 'Carte bancaire', 'Chèque', 'Espèces', 'Effet', 'Autre'] as const
export type ModeDUnMouvement = (typeof MODES_D_UN_MOUVEMENT)[number]

export function estUnModeDUnMouvement(valeur: unknown): valeur is ModeDUnMouvement {
  return typeof valeur === 'string' && (MODES_D_UN_MOUVEMENT as readonly string[]).includes(valeur)
}

/** Le plus de mouvements qu'un appel porte (la forme de `poser_modes_de_reglement`). */
export const MOUVEMENTS_PAR_APPEL = 1000

/** Les refus de `poser_modes_de_reglement`, dans l'ordre de la base, sous ses mots et ses codes ; ceux de sa garde. */
export const REFUS_DU_MODE_DE_REGLEMENT = {
  acces: { code: '42501', message: 'Accès refusé à ce dossier.' },
  forme: {
    code: '22023',
    message: 'Les modes de règlement à poser sont mal formés : autant de mouvements que de modes, chaque mouvement une fois, de 1 à 1 000.',
  },
  horsDuDossier: { code: '22023', message: "Un des mouvements n'est pas un mouvement de ce dossier." },
  horsDeLaListe: {
    code: '22023',
    message: "Un mode de règlement n'est pas de la liste : Virement, Prélèvement, Carte bancaire, Chèque, Espèces, Effet ou Autre.",
  },
  // La garde : une écriture du mode hors de la fonction.
  ecritureDirecte: {
    code: '42501',
    message: "Le mode de règlement d'un mouvement ne se pose, ne se corrige et ne se retire que par sa fonction, sur un clic du cabinet.",
  },
  insertion: {
    code: '42501',
    message: "Un mouvement ne s'importe pas avec un mode de règlement : le cabinet le pose ensuite, sur la fiche du mouvement.",
  },
} as const

// ── La proposition ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le mode que le libellé propose, et les mots du libellé qui l'ont fait proposer (normalisés : capitales, sans accent). */
export interface PropositionDuMode {
  mode: ModeDUnMouvement
  mots: string
}

// La normalisation de `libelleDitUnVersementDEspeces` (lib/controlesDeLaCaisse.ts) : sans accent, en capitales, la
// ponctuation en espace — « Prlv. SEPA » et « PRLV SEPA » se lisent de même.
function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

// Le versement d'espèces, tel que les banques l'écrivent (les mots de `VERSEMENT_D_ESPECES`, lib/controlesDeLaCaisse.ts), mais
// EN TÊTE du libellé : la caisse y lit un symptôme n'importe où — un crédit qu'aucun lot ne prend —, la proposition un mot de
// type, qui ouvre le libellé.
const VERSEMENT_D_ESPECES_EN_TETE = /^(VERSEMENTS?|VERSMT|VERST|VRST|VERS|VRS|DEPOTS?|DEP|REMISES?|REM)( (EN|D|DE|DES))? (ESPECES?|ESPCES?|ESP)\b/

const MOTS_DU_VIREMENT = new Set(['VIR', 'VIREMENT', 'VIREMENTS'])
const MOTS_DU_PRELEVEMENT = new Set(['PRLV', 'PRELEVEMENT', 'PRELEVEMENTS'])
const MOTS_DU_CHEQUE = new Set(['CHQ', 'CHEQUE'])
const MOTS_DE_LA_REMISE = new Set(['REMISE', 'REMISES', 'REM'])
const CHEQUES_REMIS = new Set(['CHQ', 'CHQS', 'CHEQUE', 'CHEQUES'])
const MOTS_DU_RETRAIT = new Set(['RETRAIT', 'RETRAITS'])

const porteUnChiffre = (mot: string | undefined) => mot !== undefined && /\d/.test(mot)

/**
 * LE MODE QUE LE LIBELLÉ DE LA BANQUE PROPOSE, ou rien. Seul le libellé lu (`libelle`) se lit — la ligne brute porte aussi la
 * date et les montants du fichier —, et seuls ses PREMIERS mots, où la banque écrit le type de l'opération ; un mot sûr
 * seulement, et, quand le mot le dit, le sens du mouvement qui va avec :
 *   - Espèces : un CRÉDIT qui commence par un versement d'espèces (« VERSEMENT ESPECES », « VRST ESP », « DEPOT ESPECES ») ;
 *     un DÉBIT qui commence par « RETRAIT » (« RETRAIT DAB », « RETRAIT 12/03 »), ou par « CB RETRAIT » : un retrait est un
 *     service à lui (CMF, art. L. 314-1, II, 2°), même quand la carte le fait ;
 *   - Carte bancaire : « CB » en tête ; « CARTE » suivi d'un mot qui porte un chiffre (un numéro masqué, une date : « CARTE
 *     X1234 », « CARTE 12/03 ») — jamais « CARTE GRISE » ; « PAIEMENT CB », « PAIEMENT CARTE », « ACHAT CB », « ACHAT CARTE »,
 *     « FACTURE CARTE », « FACTURE CB », « PAIEMENT PAR CARTE » ;
 *   - Chèque : « CHQ » ou « CHEQUE » en tête, seuls ou suivis d'un numéro (« CHQ 1234567 », « CHEQUE N 1234567 ») — jamais
 *     « CHEQUE DEJEUNER » ; un CRÉDIT qui commence par une remise de chèques (« REMISE CHEQUES », « REM CHQ », « REMISE DE
 *     CHEQUES ») ;
 *   - Virement : « VIR », « VIREMENT » en tête (« VIR SEPA », « VIR INST », « VIREMENT RECU ») ;
 *   - Prélèvement : « PRLV », « PRELEVEMENT » en tête (« PRLV SEPA », « PRELEVEMENT EUROPEEN »).
 * Un libellé qui commence autrement — une date, un rejet (« REJET PRLV »), un avoir (« AVOIR CB »), des frais, le générique
 * « Mouvement bancaire » — ne propose rien : le cabinet choisit.
 */
export function proposerModeDeReglement(ligne: Pick<LigneBancaire, 'libelle' | 'montant'>): PropositionDuMode | null {
  if (typeof ligne.libelle !== 'string' || !Number.isFinite(ligne.montant) || ligne.montant === 0) return null
  const texte = normaliser(ligne.libelle)
  const [m0, m1, m2] = texte.split(' ')
  const credit = ligne.montant > 0
  const propose = (mode: ModeDUnMouvement, mots: string): PropositionDuMode => ({ mode, mots })
  // Les espèces d'abord : « REMISE ESPECES » n'est pas une remise de chèques, « CB RETRAIT » n'est pas un paiement par carte.
  if (credit) {
    const versement = VERSEMENT_D_ESPECES_EN_TETE.exec(texte)
    if (versement) return propose('Espèces', versement[0])
  } else {
    if (MOTS_DU_RETRAIT.has(m0)) return propose('Espèces', m0)
    if ((m0 === 'CB' || m0 === 'CARTE') && MOTS_DU_RETRAIT.has(m1)) return propose('Espèces', `${m0} ${m1}`)
  }
  if (m0 === 'CB') return propose('Carte bancaire', m0)
  if (m0 === 'CARTE' && porteUnChiffre(m1)) return propose('Carte bancaire', m0)
  if ((m0 === 'PAIEMENT' || m0 === 'ACHAT' || m0 === 'FACTURE') && (m1 === 'CB' || m1 === 'CARTE')) return propose('Carte bancaire', `${m0} ${m1}`)
  if (m0 === 'PAIEMENT' && m1 === 'PAR' && m2 === 'CARTE') return propose('Carte bancaire', 'PAIEMENT PAR CARTE')
  if (MOTS_DU_CHEQUE.has(m0) && (m1 === undefined || porteUnChiffre(m1) || (m1 === 'N' && porteUnChiffre(m2)))) return propose('Chèque', m0)
  if (credit && MOTS_DE_LA_REMISE.has(m0)) {
    if (CHEQUES_REMIS.has(m1)) return propose('Chèque', `${m0} ${m1}`)
    if (m1 === 'DE' && CHEQUES_REMIS.has(m2)) return propose('Chèque', `${m0} DE ${m2}`)
  }
  if (MOTS_DU_VIREMENT.has(m0)) return propose('Virement', m0)
  if (MOTS_DU_PRELEVEMENT.has(m0)) return propose('Prélèvement', m0)
  return null
}

// ── Les mots de l'écran ────────────────────────────────────────────────────────────────────────────────────────────────

/** Le mode tel que la fiche le dit : les espèces disent leur sens, que le signe du mouvement porte. */
export function libelleDuMode(mode: ModeDUnMouvement, montant: number): string {
  if (mode !== 'Espèces') return mode
  return montant > 0 ? 'Espèces (un versement)' : 'Espèces (un retrait)'
}

/** Pourquoi le libellé propose ce mode : ses premiers mots, sans rien d'autre du libellé. */
export function raisonDeLaProposition(p: PropositionDuMode): string {
  return `le libellé de la banque commence par « ${p.mots} »`
}

/** Ce que le FEC écrira pour ce mouvement, dit sous la fiche. */
export const MODE_NON_POSE_DIT = 'Aucun mode posé : le FEC écrit « Banque » pour ce mouvement.'

/** Ce que la fiche dit quand le mode n'a pas été lu avec le mouvement : aucun geste ne part d'une valeur qu'on ne connaît pas. */
export const MODE_ILLISIBLE_DIT = 'Le mode de règlement de ce mouvement n’a pas pu être lu : recharge la page avant de le poser.'

// ── L'état de la fiche ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * CE QUE LA FICHE D'UN MOUVEMENT DIT DE SON MODE. `absent` : le drapeau baissé, ou un dossier en engagement, dont le FEC a
 * dix-huit colonnes (VIII, 3°) — la fiche d'hier. `illisible` : le mouvement a été lu sans sa colonne, ou avec une valeur que
 * la liste ne connaît pas — aucun geste. `fige` : un exercice validé couvre le mouvement (`garder_mouvement_valide` refuserait),
 * le mode se dit sans geste. `ouvert` : le mode posé (nul : aucun), la proposition du libellé quand elle diffère de lui, et les
 * modes au choix.
 */
export type ModeDeLaFiche =
  | { etat: 'absent' }
  | { etat: 'illisible' }
  | { etat: 'fige'; mode: ModeDUnMouvement | null; figeePar: string }
  | { etat: 'ouvert'; mode: ModeDUnMouvement | null; proposition: PropositionDuMode | null }

export function modeDeLaFiche(
  ligne: Pick<LigneBancaire, 'libelle' | 'montant' | 'mode_reglement'>,
  // L'exercice validé qui fige le mouvement, avec les mots de la base (`dateFigee`), ou nul.
  figeePar: string | null,
  modeComptable: ModeComptable,
  // `MODE_DE_REGLEMENT_PREVU`, passé par l'appelant : la fiche se joue dans ses deux états.
  prevu: boolean,
): ModeDeLaFiche {
  if (!prevu || modeComptable !== 'tresorerie') return { etat: 'absent' }
  const lu = ligne.mode_reglement
  if (lu === undefined || (lu !== null && !estUnModeDUnMouvement(lu))) return { etat: 'illisible' }
  if (figeePar !== null) return { etat: 'fige', mode: lu, figeePar }
  const proposition = proposerModeDeReglement(ligne)
  return { etat: 'ouvert', mode: lu, proposition: proposition !== null && proposition.mode !== lu ? proposition : null }
}

/** Les arguments de `poser_modes_de_reglement` pour un seul mouvement : un mode nul retire celui qui était posé. */
export function argumentsDuMode(dossierId: string, ligneId: string, mode: ModeDUnMouvement | null): {
  p_dossier_id: string; p_lignes: string[]; p_modes: (ModeDUnMouvement | null)[]
} {
  return { p_dossier_id: dossierId, p_lignes: [ligneId], p_modes: [mode] }
}
