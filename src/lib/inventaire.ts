import { rang360 } from './amortissements'
import { FORME_COMPTE_DE_ROLE, type DefinitionRoleComptable } from './planComptable'
import type { ModeComptable } from './types'

// LES ÉCRITURES D'INVENTAIRE, EN MODULE (ligne 35, lot INV1 ; docs/conceptions/35-inventaire.md, § 3, § 4.4 et § 6).
//
// Un dossier en ENGAGEMENT (BIC, IS) reçoit à chaque clôture les régularisations que l'inventaire impose : charges et
// produits constatés d'avance (486, 487 ; PCG, art. 1214-48), factures non parvenues et à établir (408, 418 ; art. 1214-40
// et 1214-41), charges à payer et produits à recevoir des comptes rattachés, provisions pour risques et dépréciations des
// créances (151, 491 ; art. 1211-15 et 1214-49). Ce module, PUR et en centimes entiers, COMPOSE ce que le cabinet a décidé :
// il ne devine rien (aucune régularisation tirée d'une pièce, d'une date ni d'un montant), il ne lit ni la base ni
// « maintenant » ; la future fonction `enregistrer_operation_inventaire` (INV2) recomposera les mêmes lignes en entiers et
// les comparera en multiensemble à ce qu'il propose, comme pour les dotations.
//
// Les choix que le cabinet n'a pas encore tranchés (INV-Q3, INV-Q4, INV-Q6) sont des PARAMÈTRES OBLIGATOIRES, sans défaut :
// l'appelant passe la recommandation du document tant que la réponse n'est pas venue, et rien ne la cache ici.
//
// Les comptes : aucun compte de rôle en dur (lib/comptesEnDur.test.ts). Les douze rôles neufs (§ 4.4) entreront au catalogue
// avec INV2 et INV4 ; d'ici là, et ensuite, l'appelant passe les comptes du plan du dossier (`ComptesDInventaire`). Seules
// les RACINES du PCG (486, 408, 4286…) vivent ici : elles jugent qu'un compte est à sa place, jamais n'en fournissent un.
//
// La trésorerie (BNC, 2035) n'entre jamais ici : toute composition la refuse (INV-Q10, recommandation (A)).

// ── Les sortes, en listes fermées ────────────────────────────────────────────────────────────────────────────────────────

export const NATURES_D_INVENTAIRE = ['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir', 'provision'] as const
export type NatureDInventaire = (typeof NATURES_D_INVENTAIRE)[number]

/** Les régularisations qui se contre-passent au 1er janvier suivant : toutes, sauf la provision (§ 3.4, INV-Q1 (A)). */
export const NATURES_A_EXTOURNER = ['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir'] as const
export type NatureAExtourner = (typeof NATURES_A_EXTOURNER)[number]

export const GENRES_DE_PROVISION = ['risque', 'depreciation_creance'] as const
export type GenreDeProvision = (typeof GENRES_DE_PROVISION)[number]

/** INV-Q3, non tranchée : une FNP ou une FAE d'un dossier assujetti, TTC avec sa TVA d'attente (A, recommandée) ou HT (B). */
export const TVA_DES_FACTURES_ATTENDUES = ['ttc_avec_tva_d_attente', 'hors_taxes'] as const
export type TvaDesFacturesAttendues = (typeof TVA_DES_FACTURES_ATTENDUES)[number]

/** INV-Q4, non tranchée : par différence (A, recommandée), ou reprise intégrale puis dotation nouvelle (B). */
export const REAJUSTEMENTS_DES_PROVISIONS = ['par_difference', 'reprise_puis_dotation'] as const
export type ReajustementDesProvisions = (typeof REAJUSTEMENTS_DES_PROVISIONS)[number]

/** INV-Q6, non tranchée : le prorata proposé en jours réels (A, recommandée) ou en mois de trente jours (B). */
export const METHODES_DU_PRORATA = ['jours_reels', 'mois_de_trente_jours'] as const
export type MethodeDuProrata = (typeof METHODES_DU_PRORATA)[number]

// ── Les rôles et les comptes ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les douze rôles neufs du catalogue (§ 4.4), leurs racines au PCG de 2026 et leur nom, pour les mots d'un refus. */
export const ROLES_D_INVENTAIRE = [
  { role: 'charges_constatees_avance', racines: ['486'], nom: 'Charges constatées d’avance' },
  { role: 'produits_constates_avance', racines: ['487'], nom: 'Produits constatés d’avance' },
  { role: 'factures_non_parvenues', racines: ['408'], nom: 'Fournisseurs — factures non parvenues' },
  { role: 'factures_a_etablir', racines: ['418'], nom: 'Clients — factures à établir' },
  { role: 'tva_factures_non_parvenues', racines: ['44586'], nom: 'TVA sur factures non parvenues' },
  { role: 'tva_factures_a_etablir', racines: ['44587'], nom: 'TVA sur factures à établir' },
  { role: 'provisions_risques', racines: ['151'], nom: 'Provisions pour risques' },
  { role: 'depreciation_clients', racines: ['491'], nom: 'Dépréciations des comptes de clients' },
  { role: 'dotations_provisions_exploitation', racines: ['6815'], nom: 'Dotations aux provisions d’exploitation' },
  { role: 'dotations_depreciations_actif_circulant', racines: ['6817'], nom: 'Dotations aux dépréciations des actifs circulants' },
  { role: 'reprises_provisions_exploitation', racines: ['7815'], nom: 'Reprises sur provisions d’exploitation' },
  { role: 'reprises_depreciations_actif_circulant', racines: ['7817'], nom: 'Reprises sur dépréciations des actifs circulants' },
] as const
export type RoleDInventaire = (typeof ROLES_D_INVENTAIRE)[number]['role']

/** Les comptes du plan du dossier pour ces rôles ; un rôle absent est un plan qui ne le porte pas (la composition se refuse). */
export type ComptesDInventaire = Readonly<Partial<Record<RoleDInventaire, string>>>

// Les comptes de régularisation PAR NATURE qui ne sont pas un rôle (§ 4.4), en racines du PCG de 2026 (art. 1121-1) :
// rémunérations dues au personnel (4282 congés à payer, 4286 autres charges à payer), organismes sociaux (4382, 4386 ; 439
// pour leurs produits à recevoir), État (44812 ; 4482), intérêts courus sur emprunts (1688) et bancaires (518). JAMAIS le
// 467 ni le 468 (INV-Q2 (A)) : ils portent le dirigeant non associé (PC4-Q2) et le rôle `autres_debiteurs_crediteurs`, et
// l'extourne ferait mentir le compte courant chaque 1er janvier.
//
// Deux comptes que le § 4.4 nomme n'y sont PAS, parce que leur contrepartie sort de la classe que le § 4.1 donne à leur
// nature (INV1-Q1) : le 4084 (FNP d'un fournisseur d'immobilisations), dont la contrepartie est une immobilisation
// (classe 2), et le 4098 (avoirs à obtenir), dont la contrepartie est un rabais obtenu, au crédit du 609 (classe 6). Les
// admettre sous la règle de classe écrirait une immobilisation en charge, ou un avoir sur achat en produit.
export const RACINES_DES_CHARGES_A_PAYER = ['4282', '4286', '4382', '4386', '44812', '1688', '518'] as const
export const RACINES_DES_PRODUITS_A_RECEVOIR = ['4482', '439'] as const
// La FNP des intérêts courus (4088, contrepartie au 661), à côté du rôle 408.
export const RACINES_DES_FNP_HORS_ROLE = ['4088'] as const

// Un numéro de compte : des chiffres seulement, trois au moins (la forme des comptes du brouillon). Un compte de rôle,
// lui, a les six chiffres du plan (`FORME_COMPTE_DE_ROLE`).
const FORME_D_UN_COMPTE = /^[0-9]{3,}$/

const sousLaRacine = (compte: string, racines: readonly string[]) => racines.some((r) => compte.startsWith(r))

function racinesDuRole(role: RoleDInventaire): readonly string[] {
  return ROLES_D_INVENTAIRE.find((r) => r.role === role)!.racines
}

function nomDuRole(role: RoleDInventaire): string {
  return ROLES_D_INVENTAIRE.find((r) => r.role === role)!.nom
}

/** Le compte du plan pour un rôle d'inventaire, s'il a la forme d'un compte de rôle et se tient sous sa racine ; sinon `null`. */
export function compteDuRole(comptes: ComptesDInventaire, role: RoleDInventaire): string | null {
  const compte = comptes[role]
  if (compte === undefined || !FORME_COMPTE_DE_ROLE.test(compte) || !sousLaRacine(compte, racinesDuRole(role))) return null
  return compte
}

// ── Les refus et leurs mots ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un refus, dit avant le clic ; `code` est celui que la fonction de la base lèvera (INV2) : 22023 la saisie, 23514 l'exercice
 *  figé. Dans une liste, l'ordre est celui des contrôles de la fonction : le premier est celui que la base dirait. */
export interface RefusDInventaire {
  cle: string
  code: '22023' | '23514'
  message: string
}

const refus = (cle: string, message: string, code: RefusDInventaire['code'] = '22023'): RefusDInventaire => ({ cle, code, message })

export const MOTS_DES_REFUS = {
  tresorerie: 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.',
  exercice: 'L’exercice de la régularisation est illisible : une année entre 2000 et 2100.',
  exerciceFige: 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.',
  exerciceAVenir: 'Cet exercice n’est pas encore commencé : son inventaire ne se passe pas avant lui.',
  avantLOuverture: 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.',
  nature: 'La nature de la régularisation est inconnue : une charge ou un produit constaté d’avance, une facture non parvenue '
    + 'ou à établir, une charge à payer ou un produit à recevoir.',
  provisionParSonEvaluation: 'Une provision s’écrit par son évaluation au 31 décembre, pas comme une régularisation.',
  compteDeCharge: 'Le compte de charge est un compte de la classe 6 du plan du dossier.',
  compteDeProduit: 'Le compte de produit est un compte de la classe 7 du plan du dossier.',
  compteDeRegularisation: {
    cca: 'Une charge constatée d’avance s’écrit au compte des charges constatées d’avance du plan du dossier.',
    pca: 'Un produit constaté d’avance s’écrit au compte des produits constatés d’avance du plan du dossier.',
    fnp: 'Une facture non parvenue s’écrit au compte des factures non parvenues du plan du dossier, ou sous le 4088 pour des '
      + 'intérêts courus.',
    fae: 'Une facture à établir s’écrit au compte des factures à établir du plan du dossier.',
    charge_a_payer: 'Une charge à payer s’écrit sous le 4282, le 4286, le 4382, le 4386, le 44812, le 1688 ou le 518 ; jamais au '
      + '467 ni au 468, qui portent le compte du dirigeant.',
    produit_a_recevoir: 'Un produit à recevoir s’écrit sous le 4482 ou le 439 ; jamais au 467 ni au 468, qui portent le compte '
      + 'du dirigeant.',
  } satisfies Record<NatureAExtourner, string>,
  montant: 'Le montant est un nombre de centimes entier et positif.',
  tvaIllisible: 'La TVA est un nombre de centimes entier, positif ou nul.',
  tvaHorsFacture: 'Seules une facture non parvenue et une facture à établir portent une TVA d’attente.',
  tvaNonAssujetti: 'Un dossier qui ne collecte pas la TVA écrit la régularisation toutes taxes comprises, sans ligne de TVA.',
  tvaHorsTaxes: 'Les factures non parvenues et à établir s’écrivent hors taxes, sans TVA d’attente (INV-Q3).',
  objet: 'L’objet de la régularisation tient en 1 à 200 caractères, sur une ligne : il part au FEC.',
  genre: 'Le genre de la provision est inconnu : une provision pour risques ou la dépréciation d’une créance.',
  compteDeProvision: {
    risque: 'Une provision pour risques s’écrit sous le 151.',
    depreciation_creance: 'La dépréciation d’une créance s’écrit sous le 491.',
  } satisfies Record<GenreDeProvision, string>,
  cible: 'L’évaluation d’une provision est un nombre de centimes entier, positif ou nul.',
  ciblePrecedente: 'La provision au 31 décembre précédent est un nombre de centimes entier, positif ou nul.',
  periode: 'La période couverte se lit en deux dates civiles, son début au plus tard à sa fin.',
  periodeAvantLaCloture: 'La période couverte finit au plus tard le 31 décembre : rien n’est constaté d’avance.',
  ventilation: 'Les provisions ventilées doivent faire exactement le solde repris du compte.',
} as const

/** Le refus d'un plan qui ne porte pas, ou porte mal, un compte de rôle d'inventaire. */
export function refusDuPlan(role: RoleDInventaire): RefusDInventaire {
  return refus(`plan:${role}`, `Le plan du dossier ne porte pas de compte « ${nomDuRole(role)} » sous le `
    + `${racinesDuRole(role).join(', ')} : le régler avant d’écrire l’inventaire.`)
}

// ── Les écritures ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LigneDInventaire {
  compte: string
  sens: 'debit' | 'credit'
  /** En centimes, entier et strictement positif. */
  centimes: number
}

export interface EcritureDInventaire {
  /** AAAA-MM-JJ : le 31 décembre de l'exercice, ou le 1er janvier suivant pour l'extourne. */
  date: string
  /** Le journal des opérations diverses (§ 3.2). */
  journal: 'OD'
  libelle: string
  lignes: LigneDInventaire[]
}

const cloture = (exercice: number) => `${exercice}-12-31`
const lendemainDeLaCloture = (exercice: number) => `${exercice + 1}-01-01`

const debit = (compte: string, centimes: number): LigneDInventaire => ({ compte, sens: 'debit', centimes })
const credit = (compte: string, centimes: number): LigneDInventaire => ({ compte, sens: 'credit', centimes })
// Une ligne à zéro ne s'écrit pas (une TVA nulle, une reprise d'une provision qui n'existait pas).
const nonNulles = (lignes: LigneDInventaire[]) => lignes.filter((l) => l.centimes > 0)

/** Vrai quand la somme des débits égale celle des crédits (le FEC rejette une écriture déséquilibrée). */
export function estEquilibree(ecriture: Pick<EcritureDInventaire, 'lignes'>): boolean {
  return ecriture.lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.centimes : -l.centimes), 0) === 0
}

/** La contre-passation au 1er janvier suivant : les mêmes comptes en sens inverse, « Extourne — » devant le libellé. */
export function extourneDe(constatation: EcritureDInventaire, exercice: number): EcritureDInventaire {
  return {
    date: lendemainDeLaCloture(exercice),
    journal: 'OD',
    libelle: `Extourne — ${constatation.libelle}`,
    lignes: constatation.lignes.map((l) => ({ ...l, sens: l.sens === 'debit' ? 'credit' : 'debit' })),
  }
}

// ── Les contrôles communs ───────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que la fonction de la base saura de l'exercice : jamais « maintenant » lu ici, l'appelant le donne. */
export interface ExerciceDeLInventaire {
  exercice: number
  /** L'exercice est validé : ses écritures sont figées (23514). */
  valide: boolean
  /** L'année en cours, lue à Paris par l'appelant (`aujourdHuiAParis`), comme la base la lira. */
  anneeEnCours: number
  /** Le premier exercice tenu dans l'application ; `null` : aucun n'est connu, aucune borne basse. */
  premierExercice: number | null
}

function refusDeLExercice(e: ExerciceDeLInventaire): RefusDInventaire[] {
  if (!Number.isInteger(e.exercice) || e.exercice < 2000 || e.exercice > 2100) return [refus('exercice', MOTS_DES_REFUS.exercice)]
  if (e.valide) return [refus('exerciceFige', MOTS_DES_REFUS.exerciceFige, '23514')]
  if (e.exercice > e.anneeEnCours) return [refus('exerciceAVenir', MOTS_DES_REFUS.exerciceAVenir)]
  if (e.premierExercice !== null && e.exercice < e.premierExercice) return [refus('avantLOuverture', MOTS_DES_REFUS.avantLOuverture)]
  return []
}

const centimesPositifs = (n: number) => Number.isSafeInteger(n) && n > 0
const centimesPositifsOuNuls = (n: number) => Number.isSafeInteger(n) && n >= 0

function refusDeLObjet(objet: string): RefusDInventaire[] {
  const t = objet.trim()
  // En caractères, comme `char_length` de la base : un caractère hors du plan de base compte pour un, pas pour deux.
  const longueur = [...t].length
  return longueur === 0 || longueur > 200 || /[\r\n]/.test(t) ? [refus('objet', MOTS_DES_REFUS.objet)] : []
}

// Le libellé composé, jamais recopié d'un tiers (§ 3.2) : « CCA 31/12/AAAA — <libellé du compte> — <objet> ».
function libelleCompose(entete: string, exercice: number, libelleDuCompte: string | null, objet: string): string {
  const compte = libelleDuCompte?.trim()
  return [`${entete} 31/12/${exercice}`, ...(compte ? [compte] : []), objet.trim()].join(' — ')
}

// ── Les régularisations à extourner ─────────────────────────────────────────────────────────────────────────────────────

const SIGLES: Record<NatureAExtourner, string> = {
  cca: 'CCA', pca: 'PCA', fnp: 'FNP', fae: 'FAE', charge_a_payer: 'Charge à payer', produit_a_recevoir: 'Produit à recevoir',
}

const DU_COTE_DES_CHARGES: ReadonlySet<NatureAExtourner> = new Set(['cca', 'fnp', 'charge_a_payer'])

/** Ce que le cabinet saisit pour une régularisation. */
export interface SaisieDeRegularisation {
  nature: NatureDInventaire
  /** Le compte de charge (classe 6) ou de produit (classe 7) régularisé, du plan du dossier. */
  compteResultat: string
  /** Son libellé au plan, qui entre dans le libellé composé ; `null` : le libellé se passe de lui. */
  libelleCompteResultat: string | null
  /** Le compte de régularisation, dans la liste fermée de sa nature (§ 4.4). */
  compteRegularisation: string
  /** Hors taxes pour un assujetti, toutes taxes comprises pour un exonéré (la règle de `montantRetenu`). */
  montantCentimes: number
  /** La TVA d'attente d'une FNP ou d'une FAE d'un dossier assujetti (INV-Q3) ; 0 partout ailleurs. */
  tvaCentimes: number
  objet: string
}

/** Ce que l'appelant sait du dossier, sans défaut. */
export interface ContexteDeRegularisation {
  modeComptable: ModeComptable
  assujettiTva: boolean
  comptes: ComptesDInventaire
  exercice: ExerciceDeLInventaire
  /** INV-Q3, que le cabinet n'a pas tranchée : l'appelant passe sa réponse, ou la recommandation (A). */
  tvaDesFacturesAttendues: TvaDesFacturesAttendues
}

export type CompositionDeRegularisation =
  | { ok: true; constatation: EcritureDInventaire; extourne: EcritureDInventaire }
  | { ok: false; refus: RefusDInventaire[] }

const estANextourner = (n: NatureDInventaire): n is NatureAExtourner => (NATURES_A_EXTOURNER as readonly string[]).includes(n)

// Le compte de régularisation est-il à sa place ? Pour une nature qui a son rôle, c'est le compte du plan, exactement.
function regularisationAdmise(nature: NatureAExtourner, compte: string, comptes: ComptesDInventaire): boolean {
  if (!FORME_D_UN_COMPTE.test(compte)) return false
  switch (nature) {
    case 'cca': return compte === compteDuRole(comptes, 'charges_constatees_avance')
    case 'pca': return compte === compteDuRole(comptes, 'produits_constates_avance')
    case 'fae': return compte === compteDuRole(comptes, 'factures_a_etablir')
    case 'fnp': return compte === compteDuRole(comptes, 'factures_non_parvenues') || sousLaRacine(compte, RACINES_DES_FNP_HORS_ROLE)
    case 'charge_a_payer': return sousLaRacine(compte, RACINES_DES_CHARGES_A_PAYER)
    case 'produit_a_recevoir': return sousLaRacine(compte, RACINES_DES_PRODUITS_A_RECEVOIR)
  }
}

// Les rôles du plan dont la nature a besoin : sans eux, rien ne s'écrit.
function rolesRequis(nature: NatureAExtourner, avecTva: boolean): RoleDInventaire[] {
  switch (nature) {
    case 'cca': return ['charges_constatees_avance']
    case 'pca': return ['produits_constates_avance']
    case 'fnp': return avecTva ? ['tva_factures_non_parvenues'] : []
    case 'fae': return ['factures_a_etablir', ...(avecTva ? ['tva_factures_a_etablir' as const] : [])]
    default: return []
  }
}

/**
 * Les refus d'une régularisation, dans l'ordre des contrôles de la future `enregistrer_operation_inventaire` : le mode du
 * dossier, l'exercice, la nature, le plan, les comptes, les montants, l'objet. Une liste vide : elle s'écrit.
 */
export function refusDeLaRegularisation(saisie: SaisieDeRegularisation, contexte: ContexteDeRegularisation): RefusDInventaire[] {
  if (contexte.modeComptable !== 'engagement') return [refus('tresorerie', MOTS_DES_REFUS.tresorerie)]
  const exercice = refusDeLExercice(contexte.exercice)
  if (exercice.length > 0) return exercice
  if (saisie.nature === 'provision') return [refus('provisionParSonEvaluation', MOTS_DES_REFUS.provisionParSonEvaluation)]
  if (!estANextourner(saisie.nature)) return [refus('nature', MOTS_DES_REFUS.nature)]
  const nature = saisie.nature
  const liste: RefusDInventaire[] = []
  const tvaLisible = centimesPositifsOuNuls(saisie.tvaCentimes)
  const plan = rolesRequis(nature, tvaLisible && saisie.tvaCentimes > 0).filter((r) => compteDuRole(contexte.comptes, r) === null)
  liste.push(...plan.map(refusDuPlan))
  const charge = DU_COTE_DES_CHARGES.has(nature)
  if (!FORME_D_UN_COMPTE.test(saisie.compteResultat) || !saisie.compteResultat.startsWith(charge ? '6' : '7')) {
    liste.push(refus('compteResultat', charge ? MOTS_DES_REFUS.compteDeCharge : MOTS_DES_REFUS.compteDeProduit))
  }
  if (!regularisationAdmise(nature, saisie.compteRegularisation, contexte.comptes)) {
    liste.push(refus('compteRegularisation', MOTS_DES_REFUS.compteDeRegularisation[nature]))
  }
  if (!centimesPositifs(saisie.montantCentimes)) liste.push(refus('montant', MOTS_DES_REFUS.montant))
  if (!tvaLisible) liste.push(refus('tva', MOTS_DES_REFUS.tvaIllisible))
  else if (saisie.tvaCentimes > 0) {
    if (nature !== 'fnp' && nature !== 'fae') liste.push(refus('tva', MOTS_DES_REFUS.tvaHorsFacture))
    else if (!contexte.assujettiTva) liste.push(refus('tva', MOTS_DES_REFUS.tvaNonAssujetti))
    else if (contexte.tvaDesFacturesAttendues === 'hors_taxes') liste.push(refus('tva', MOTS_DES_REFUS.tvaHorsTaxes))
  }
  if (centimesPositifs(saisie.montantCentimes) && tvaLisible && !Number.isSafeInteger(saisie.montantCentimes + saisie.tvaCentimes)) {
    liste.push(refus('montant', MOTS_DES_REFUS.montant))
  }
  liste.push(...refusDeLObjet(saisie.objet))
  return liste
}

/**
 * La régularisation d'une clôture : la constatation au 31 décembre, au journal OD, une écriture équilibrée, ET son extourne
 * au 1er janvier suivant, composées ensemble (INV-Q1, recommandation (A) : la paire naît, change et se retire ensemble ;
 * sous (B) ou (C), l'extourne serait la même écriture, écrite plus tard — `extourneDe`).
 *
 *   - CCA : 486 au débit, la charge au crédit ; PCA : le produit au débit, 487 au crédit ;
 *   - FNP : la charge (HT) et la TVA d'attente 44586 au débit, le 408 (TTC) au crédit (PCG, art. 1214-40) ;
 *   - FAE : le 418 (TTC) au débit, le produit (HT) et la TVA d'attente 44587 au crédit (art. 1214-41) ;
 *   - charge à payer : la charge au débit, le compte rattaché au crédit ; produit à recevoir : l'inverse.
 */
export function composerRegularisation(
  saisie: SaisieDeRegularisation, contexte: ContexteDeRegularisation,
): CompositionDeRegularisation {
  const liste = refusDeLaRegularisation(saisie, contexte)
  if (liste.length > 0) return { ok: false, refus: liste }
  const nature = saisie.nature as NatureAExtourner
  const { exercice } = contexte.exercice
  const ht = saisie.montantCentimes
  const tva = saisie.tvaCentimes
  const resultat = saisie.compteResultat
  const regul = saisie.compteRegularisation
  let lignes: LigneDInventaire[]
  switch (nature) {
    case 'cca': lignes = [debit(regul, ht), credit(resultat, ht)]; break
    case 'pca': lignes = [debit(resultat, ht), credit(regul, ht)]; break
    case 'charge_a_payer': lignes = [debit(resultat, ht), credit(regul, ht)]; break
    case 'produit_a_recevoir': lignes = [debit(regul, ht), credit(resultat, ht)]; break
    case 'fnp': {
      const compteTva = tva > 0 ? compteDuRole(contexte.comptes, 'tva_factures_non_parvenues')! : ''
      lignes = nonNulles([debit(resultat, ht), debit(compteTva, tva), credit(regul, ht + tva)])
      break
    }
    case 'fae': {
      const compteTva = tva > 0 ? compteDuRole(contexte.comptes, 'tva_factures_a_etablir')! : ''
      lignes = nonNulles([debit(regul, ht + tva), credit(resultat, ht), credit(compteTva, tva)])
      break
    }
  }
  const constatation: EcritureDInventaire = {
    date: cloture(exercice), journal: 'OD',
    libelle: libelleCompose(SIGLES[nature], exercice, saisie.libelleCompteResultat, saisie.objet),
    lignes,
  }
  return { ok: true, constatation, extourne: extourneDe(constatation, exercice) }
}

// ── L'évaluation d'une provision ────────────────────────────────────────────────────────────────────────────────────────

const ROLES_DU_GENRE: Record<GenreDeProvision, { provision: RoleDInventaire; dotation: RoleDInventaire; reprise: RoleDInventaire }> = {
  risque: {
    provision: 'provisions_risques', dotation: 'dotations_provisions_exploitation', reprise: 'reprises_provisions_exploitation',
  },
  depreciation_creance: {
    provision: 'depreciation_clients', dotation: 'dotations_depreciations_actif_circulant',
    reprise: 'reprises_depreciations_actif_circulant',
  },
}

const NOMS_DU_GENRE: Record<GenreDeProvision, string> = {
  risque: 'Provision pour risques', depreciation_creance: 'Dépréciation de créance',
}

export interface SaisieDEvaluation {
  genre: GenreDeProvision
  /** Le compte de la provision, sous le 151 (risque) ou le 491 (dépréciation d'une créance). */
  compteProvision: string
  /** Le montant de la provision au 31 décembre de l'exercice : sa CIBLE, positive ou nulle (nulle : soldée). */
  cibleCentimes: number
  objet: string
}

export interface ContexteDEvaluation {
  modeComptable: ModeComptable
  comptes: ComptesDInventaire
  exercice: ExerciceDeLInventaire
  /** La provision au 31 décembre précédent, LUE EN BASE (jamais celle de l'appelant) ; 0 pour une provision nouvelle, ou la
   *  part des à-nouveaux la première année d'un dossier repris (INV-Q11). */
  ciblePrecedenteCentimes: number
  /** INV-Q4, que le cabinet n'a pas tranchée : l'appelant passe sa réponse, ou la recommandation (A). */
  reajustement: ReajustementDesProvisions
}

export type CompositionDEvaluation =
  | { ok: true; ecart: number; ecriture: EcritureDInventaire | null }
  | { ok: false; refus: RefusDInventaire[] }

export function refusDeLEvaluation(saisie: SaisieDEvaluation, contexte: ContexteDEvaluation): RefusDInventaire[] {
  if (contexte.modeComptable !== 'engagement') return [refus('tresorerie', MOTS_DES_REFUS.tresorerie)]
  const exercice = refusDeLExercice(contexte.exercice)
  if (exercice.length > 0) return exercice
  if (!(GENRES_DE_PROVISION as readonly string[]).includes(saisie.genre)) return [refus('genre', MOTS_DES_REFUS.genre)]
  const roles = ROLES_DU_GENRE[saisie.genre]
  const liste: RefusDInventaire[] = [roles.dotation, roles.reprise]
    .filter((r) => compteDuRole(contexte.comptes, r) === null).map(refusDuPlan)
  const racines = racinesDuRole(roles.provision)
  if (!FORME_D_UN_COMPTE.test(saisie.compteProvision) || !sousLaRacine(saisie.compteProvision, racines)) {
    liste.push(refus('compteProvision', MOTS_DES_REFUS.compteDeProvision[saisie.genre]))
  }
  if (!centimesPositifsOuNuls(saisie.cibleCentimes)) liste.push(refus('cible', MOTS_DES_REFUS.cible))
  if (!centimesPositifsOuNuls(contexte.ciblePrecedenteCentimes)) liste.push(refus('ciblePrecedente', MOTS_DES_REFUS.ciblePrecedente))
  liste.push(...refusDeLObjet(saisie.objet))
  return liste
}

/**
 * L'évaluation d'une provision au 31 décembre, qui ne s'extourne JAMAIS (PCG, art. 1211-15 et 1214-49). `ecart` : la cible
 * moins la provision précédente, au sens de la dotation (positif, une dotation ; négatif, une reprise).
 *   - par différence (INV-Q4 (A)) : un écart positif, la dotation (681x au débit, la provision au crédit) ; négatif, la
 *     reprise (la provision au débit, 781x au crédit) ; nul, AUCUNE écriture (`ecriture: null`) ;
 *   - reprise puis dotation (B) : une écriture qui reprend toute la provision précédente et dote toute la nouvelle ; deux
 *     montants nuls, aucune.
 */
export function composerEvaluation(saisie: SaisieDEvaluation, contexte: ContexteDEvaluation): CompositionDEvaluation {
  const liste = refusDeLEvaluation(saisie, contexte)
  if (liste.length > 0) return { ok: false, refus: liste }
  const roles = ROLES_DU_GENRE[saisie.genre]
  const dotation = compteDuRole(contexte.comptes, roles.dotation)!
  const reprise = compteDuRole(contexte.comptes, roles.reprise)!
  const provision = saisie.compteProvision
  const cible = saisie.cibleCentimes
  const precedente = contexte.ciblePrecedenteCentimes
  const ecart = cible - precedente
  const { exercice } = contexte.exercice
  const lignes = contexte.reajustement === 'par_difference'
    ? nonNulles(ecart >= 0 ? [debit(dotation, ecart), credit(provision, ecart)] : [debit(provision, -ecart), credit(reprise, -ecart)])
    : nonNulles([debit(provision, precedente), credit(reprise, precedente), debit(dotation, cible), credit(provision, cible)])
  if (lignes.length === 0) return { ok: true, ecart, ecriture: null }
  const entete = contexte.reajustement === 'reprise_puis_dotation' ? 'Réajustement' : ecart > 0 ? 'Dotation' : 'Reprise'
  return {
    ok: true, ecart,
    ecriture: {
      date: cloture(exercice), journal: 'OD', libelle: libelleCompose(entete, exercice, NOMS_DU_GENRE[saisie.genre], saisie.objet), lignes,
    },
  }
}

/**
 * INV-Q11 : le solde d'un 151 ou d'un 491 repris d'une balance, ventilé en provisions nommées avant la première clôture —
 * la somme de leurs montants doit faire le solde repris, au centime (`null` : rien à redire). Neutre entre (A) et (B) : une
 * provision unique « reprise » qui porte le solde passe aussi.
 */
export function refusDeLaVentilation(soldeReprisCentimes: number, parts: readonly number[]): RefusDInventaire | null {
  if (!centimesPositifsOuNuls(soldeReprisCentimes) || !parts.every(centimesPositifsOuNuls)) return refus('ventilation', MOTS_DES_REFUS.ventilation)
  const somme = parts.reduce((s, p) => s + p, 0)
  return somme === soldeReprisCentimes ? null : refus('ventilation', MOTS_DES_REFUS.ventilation)
}

// ── Le prorata d'une charge ou d'un produit constaté d'avance (INV-Q6) ──────────────────────────────────────────────────

const FORME_D_UNE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Le rang d'une date civile en jours, sans fuseau (UTC sur ses composantes) ; `null` : une date qui n'existe pas. */
function rangEnJours(date: string): number | null {
  const m = FORME_D_UNE_DATE.exec(date)
  if (!m) return null
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(a, mo - 1, j)
  const d = new Date(t)
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null
  return t / 86_400_000
}

export interface SaisieDuProrata {
  /** Le montant de la pièce pour toute la période, en centimes. */
  montantCentimes: number
  /** Premier et dernier jour de la période couverte, compris, AAAA-MM-JJ. */
  debut: string
  fin: string
  /** L'exercice que la régularisation clôt : la part proposée est celle qui court après son 31 décembre. */
  exercice: number
}

export type Prorata =
  | { ok: true; centimes: number; joursApres: number; joursDeLaPeriode: number; methode: MethodeDuProrata }
  | { ok: false; refus: RefusDInventaire[] }

/**
 * La part d'une pièce qui court APRÈS le 31 décembre de l'exercice, PROPOSÉE et jamais imposée : le montant écrit reste
 * celui que le cabinet confirme (§ 3.1). montant × jours après la clôture ÷ jours de la période, les deux bornes comprises,
 * au demi-centime vers le haut, en entiers. `methode` (INV-Q6, non tranchée) : en jours réels (A, recommandée : un 29
 * février compte), ou en mois de trente jours (B, la convention des amortissements, `rang360` : le 31 compte comme le 30).
 * Les jours rendus s'écrivent sur l'état d'inventaire avec la méthode.
 */
export function prorataApresLaCloture(saisie: SaisieDuProrata, methode: MethodeDuProrata): Prorata {
  const liste: RefusDInventaire[] = []
  if (!centimesPositifs(saisie.montantCentimes)) liste.push(refus('montant', MOTS_DES_REFUS.montant))
  if (!Number.isInteger(saisie.exercice) || saisie.exercice < 2000 || saisie.exercice > 2100) liste.push(refus('exercice', MOTS_DES_REFUS.exercice))
  const debut = rangEnJours(saisie.debut)
  const fin = rangEnJours(saisie.fin)
  if (debut === null || fin === null || debut > fin) liste.push(refus('periode', MOTS_DES_REFUS.periode))
  if (liste.length > 0) return { ok: false, refus: liste }
  const lendemain = lendemainDeLaCloture(saisie.exercice)
  if (saisie.fin < lendemain) return { ok: false, refus: [refus('periodeAvantLaCloture', MOTS_DES_REFUS.periodeAvantLaCloture)] }
  const departApres = saisie.debut > lendemain ? saisie.debut : lendemain
  const rang = methode === 'jours_reels' ? (d: string) => rangEnJours(d)! : rang360
  const joursDeLaPeriode = rang(saisie.fin) - rang(saisie.debut) + 1
  const joursApres = rang(saisie.fin) - rang(departApres) + 1
  const m = BigInt(saisie.montantCentimes)
  const centimes = Number((2n * m * BigInt(joursApres) + BigInt(joursDeLaPeriode)) / (2n * BigInt(joursDeLaPeriode)))
  return { ok: true, centimes, joursApres, joursDeLaPeriode, methode }
}

// ── La base (INV2 ; migration `operations_d_inventaire`, PRÉPARÉE le 12/11/2026, pas appliquée) ──────────────────────────────
// supabase/preparees/20261112190000_operations_d_inventaire.sql : la table `operations_inventaire`, la colonne
// `ecritures_brouillon.operation_inventaire_id`, `enregistrer_operation_inventaire` et `retirer_operation_inventaire`, qui
// redisent les refus de ce module sous les mêmes mots, aux mêmes codes, dans le même ordre (inventaireEnBase.test.ts les
// confronte au texte de la migration), et recomposent en entiers ce que `composerRegularisation` propose. La base tient
// les trois choix ouverts à leur recommandation : la TVA d'attente (INV-Q3 (A) : elle ne dit jamais `tvaHorsTaxes`),
// l'extourne avec la constatation (INV-Q1 (A)), le 467 et le 468 exclus (INV-Q2 (A)). L'appelant lui passe l'exercice
// figé (`valide`) quand il est au plus l'année de la frontière de la validation, et le premier exercice, l'année des
// premiers à-nouveaux du dossier.

/** Les migrations sont-elles en base — `operations_d_inventaire` (INV2) et `provisions` (INV4), qui la suit ? Baissé tant
 *  qu'elles ne sont que préparées : aucun écran n'appelle leurs fonctions, et leurs tables restent hors du plan de sauvegarde
 *  (sauvegarde.ts, `auPlanDeLInventaire`). */
export const INVENTAIRE_PREVU: boolean = false

/** La table des provisions (INV4), sous le même drapeau : restaurée AVANT les opérations d'inventaire, dont les évaluations
 *  la citent (`provision_id`). */
export const TABLES_DES_PROVISIONS = ['provisions'] as const

/** Les tables des deux migrations, dans l'ordre de leur restauration. */
export const TABLES_DE_L_INVENTAIRE = [...TABLES_DES_PROVISIONS, 'operations_inventaire'] as const

/** Les six rôles des régularisations que la migration insère au catalogue (§ 4.4), rangs 360 à 410, leur libellé au plan
 *  comptable général. Ils n'entrent dans `ROLES_COMPTABLES` (lib/planComptable.ts) qu'avec l'écran (INV5) : la base les
 *  porte, la lecture du plan ignore sans conséquence un rôle qu'elle ne connaît pas (`planDeLaReponse`). Les six des
 *  provisions : `ROLES_DES_PROVISIONS` (INV4). */
export const ROLES_DES_REGULARISATIONS: readonly DefinitionRoleComptable[] = [
  { role: 'charges_constatees_avance', racines: ['486'], compteDefaut: '486000', libelleDefaut: "Charges constatées d'avance", prefixeAuxiliaireDefaut: null, ordre: 360 },
  { role: 'produits_constates_avance', racines: ['487'], compteDefaut: '487000', libelleDefaut: "Produits constatés d'avance", prefixeAuxiliaireDefaut: null, ordre: 370 },
  { role: 'factures_non_parvenues', racines: ['408'], compteDefaut: '408100', libelleDefaut: 'Fournisseurs - Factures non parvenues', prefixeAuxiliaireDefaut: null, ordre: 380 },
  { role: 'factures_a_etablir', racines: ['418'], compteDefaut: '418100', libelleDefaut: 'Clients - Factures à établir', prefixeAuxiliaireDefaut: null, ordre: 390 },
  { role: 'tva_factures_non_parvenues', racines: ['44586'], compteDefaut: '445860', libelleDefaut: "Taxes sur le chiffre d'affaires sur factures non parvenues", prefixeAuxiliaireDefaut: null, ordre: 400 },
  { role: 'tva_factures_a_etablir', racines: ['44587'], compteDefaut: '445870', libelleDefaut: "Taxes sur le chiffre d'affaires sur factures à établir", prefixeAuxiliaireDefaut: null, ordre: 410 },
]

/** Les six rôles des provisions que la migration `provisions` (INV4) insère au catalogue (§ 4.4), rangs 420 à 470, leur
 *  libellé au plan comptable général — le 151100 sous le 1511, « Provisions pour litiges ». Comme ceux des régularisations,
 *  ils n'entrent dans `ROLES_COMPTABLES` qu'avec l'écran (INV5). Seuls ceux des dotations et des reprises se lisent pour
 *  écrire une évaluation : le compte d'une provision est le sien, sous la racine de son genre. */
export const ROLES_DES_PROVISIONS: readonly DefinitionRoleComptable[] = [
  { role: 'provisions_risques', racines: ['151'], compteDefaut: '151100', libelleDefaut: 'Provisions pour litiges', prefixeAuxiliaireDefaut: null, ordre: 420 },
  { role: 'depreciation_clients', racines: ['491'], compteDefaut: '491000', libelleDefaut: 'Dépréciations des comptes de clients', prefixeAuxiliaireDefaut: null, ordre: 430 },
  { role: 'dotations_provisions_exploitation', racines: ['6815'], compteDefaut: '681500', libelleDefaut: "Dotations aux provisions d'exploitation", prefixeAuxiliaireDefaut: null, ordre: 440 },
  { role: 'dotations_depreciations_actif_circulant', racines: ['6817'], compteDefaut: '681700', libelleDefaut: 'Dotations aux dépréciations des actifs circulants', prefixeAuxiliaireDefaut: null, ordre: 450 },
  { role: 'reprises_provisions_exploitation', racines: ['7815'], compteDefaut: '781500', libelleDefaut: "Reprises sur provisions d'exploitation", prefixeAuxiliaireDefaut: null, ordre: 460 },
  { role: 'reprises_depreciations_actif_circulant', racines: ['7817'], compteDefaut: '781700', libelleDefaut: 'Reprises sur dépréciations des actifs circulants', prefixeAuxiliaireDefaut: null, ordre: 470 },
]
