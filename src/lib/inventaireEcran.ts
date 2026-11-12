import { libelleCompteTenu } from './comptes'
import { formatDate, formatMoney } from './format'
import {
  composerEvaluation, composerRegularisation, compteDuRole, MOTS_DES_REFUS, prorataApresLaCloture, refusDeLEvaluation,
  type ComptesDInventaire, type EcritureDInventaire, type ExerciceDeLInventaire, type GenreDeProvision, type MethodeDuProrata,
  type NatureAExtourner, type NatureDInventaire, type ReajustementDesProvisions, type TvaDesFacturesAttendues,
} from './inventaire'
import {
  ciblePrecedente, refusDeLaDeclaration, refusDuRetrait as refusDuRetraitDeLaDeclarationDuModule,
  regularisationAJour, type DeclarationDeLaValidation,
} from './inventaireDeLaValidation'
import type { InventaireDeclare, ModeComptable, OperationInventaire, Provision, EcritureBrouillon } from './types'

// L'ÉCRAN DE L'INVENTAIRE, SA LOGIQUE (ligne 35, lot INV5 ; docs/conceptions/35-inventaire.md, § 5.7). Un module PUR : l'onglet
// (src/pages/dossier/InventaireTab.tsx) appelle, affiche et pose les verrous ; ici se décident ce que la saisie TELLE QU'ELLE
// PART donnerait à la base — le verdict, dit avant le clic, aux mots et dans l'ordre de `lib/inventaire.ts` (INV1) et de
// `lib/inventaireDeLaValidation.ts` (INV3) —, ce que la confirmation NOMME, et les arguments exacts des fonctions de la base
// (`enregistrer_operation_inventaire`, `enregistrer_provision`, `enregistrer_evaluation_provision`, `declarer_inventaire`…).
// Rien ici ne lit « maintenant » ni la base : l'appelant donne le jour de Paris, les exercices validés et ce qu'il a lu.
//
// LES TROIS CHOIX QUE LE CABINET N'A PAS TRANCHÉS (INV-Q3, INV-Q4, INV-Q6) sont ceux de la recommandation du document, et la base
// les tient de même (`inventaireEnBase.test.ts`) : la TVA d'attente de la FNP et de la FAE (A), la provision réajustée par
// différence (A), le prorata en jours réels (A). Un seul endroit les dit (`CHOIX_DU_CABINET`) ; la réponse du cabinet, quand
// elle viendra, ne change que lui — et la base avec elle.

export const CHOIX_DU_CABINET: {
  tvaDesFacturesAttendues: TvaDesFacturesAttendues
  reajustement: ReajustementDesProvisions
  methodeDuProrata: MethodeDuProrata
} = {
  tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
  reajustement: 'par_difference',
  methodeDuProrata: 'jours_reels',
}

// ── Les mots que la base seule dit (aucun module ne les portait) ─────────────────────────────────────────────────────────

/** Les refus des fonctions des provisions et de la déclaration que l'écran redit avant le clic, aux mots de la migration
 *  (`inventaireEcran.test.ts` les confronte à son texte). */
export const MOTS_DES_PROVISIONS_A_L_ECRAN = {
  partRepriseHorsDuPremierExercice: 'Une part reprise s’ouvre au premier exercice du dossier, celui de sa balance reprise.',
  pasEncoreOuverte: 'Cette provision s’ouvre sur un exercice plus récent : elle ne s’évalue pas avant.',
  evalueePlusRecemment: 'Cette provision est évaluée sur un exercice plus récent : seule sa dernière évaluation change.',
  soldee: 'Cette provision est soldée : elle ne s’évalue plus ; un risque nouveau est une provision nouvelle.',
  dejaEvaluee: 'Cette provision est déjà évaluée : elle ne change plus ; retirer d’abord ses évaluations.',
} as const

// ── Ce que l'écran sait du dossier ───────────────────────────────────────────────────────────────────────────────────────

export type LigneDuBrouillonDInventaire = Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant' | 'operation_inventaire_id'>

/** Ce que l'onglet lit, EN ENTIER (lib/inventaireDeLEcranLecture.ts) : les trois tables, les lignes du brouillon que les
 *  régularisations citent, les comptes du plan pour les douze rôles, et l'année des premiers à-nouveaux. */
export interface DonneesDeLInventaire {
  operations: readonly OperationInventaire[]
  provisions: readonly Provision[]
  declarations: readonly InventaireDeclare[]
  lignes: readonly LigneDuBrouillonDInventaire[]
  comptes: ComptesDInventaire
  premierExercice: number | null
}

/** Ce que l'écran sait de l'instant : jamais lu ici. */
export interface ContexteDeLInventaire {
  mode: ModeComptable
  assujettiTva: boolean
  /** L'exercice affiché (l'année du sélecteur de l'en-tête), jamais choisi à la place du cabinet. */
  exercice: number
  anneesValidees: readonly number[]
  /** Le jour à Paris (`aujourdHuiAParis`). */
  aujourdhui: string
}

export function derniereValidee(anneesValidees: readonly number[]): number | null {
  return anneesValidees.length === 0 ? null : Math.max(...anneesValidees)
}

/** L'exercice tel que les juges de `lib/inventaire.ts` le lisent. */
export function exerciceDeLInventaire(ctx: ContexteDeLInventaire, premierExercice: number | null): ExerciceDeLInventaire {
  const derniere = derniereValidee(ctx.anneesValidees)
  return {
    exercice: ctx.exercice,
    valide: derniere !== null && ctx.exercice <= derniere,
    anneeEnCours: Number(ctx.aujourdhui.slice(0, 4)),
    premierExercice,
  }
}

// ── Les libellés ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LIBELLES_DES_NATURES: Readonly<Record<NatureDInventaire, string>> = {
  cca: 'Charge constatée d’avance',
  pca: 'Produit constaté d’avance',
  fnp: 'Facture non parvenue',
  fae: 'Facture à établir',
  charge_a_payer: 'Charge à payer',
  produit_a_recevoir: 'Produit à recevoir',
  provision: 'Provision',
}

export const LIBELLES_DES_GENRES: Readonly<Record<GenreDeProvision, string>> = {
  risque: 'Provision pour risques',
  depreciation_creance: 'Dépréciation de créance',
}

/** Les natures qu'un cabinet saisit comme régularisation (la provision a ses évaluations), dans l'ordre du document. */
export const NATURES_SAISIES: readonly NatureAExtourner[] = ['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir']

/** Les centimes en euros pour l'écran : `formatMoney`, le signe moins typographique d'un solde négatif. */
export const euros = (centimes: number): string => formatMoney(centimes / 100).replace(/^-/, '−')

const SENS = { debit: 'Débit', credit: 'Crédit' } as const

// ── Un montant tapé, en centimes exacts ──────────────────────────────────────────────────────────────────────────────────

/**
 * Un montant saisi en euros, lu EXACTEMENT au centime (jamais par un flottant multiplié) : des chiffres, une virgule ou un
 * point, deux décimales au plus, les espaces et le « € » ignorés. Une saisie illisible rend `NaN` — que le juge du module
 * refuse sous ses mots, à sa place dans l'ordre —, jamais zéro ; une saisie vide ne vaut zéro que si l'appelant le dit (la TVA
 * d'attente), jamais pour un montant ni pour la cible d'une provision (« 0 » s'écrit).
 */
export function centimesDeLaSaisie(texte: string, videVautZero: boolean): number {
  const t = texte.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.')
  if (t === '') return videVautZero ? 0 : Number.NaN
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return Number.NaN
  const centimes = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(centimes) ? centimes : Number.NaN
}

/** Des centimes tels qu'une saisie les relit (« 1200,50 »), pour remplir un formulaire d'une version retenue. */
export function texteDesCentimes(centimes: number): string {
  return `${Math.floor(centimes / 100)},${String(centimes % 100).padStart(2, '0')}`
}

// ── La régularisation ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormulaireDeRegularisation {
  nature: NatureAExtourner
  /** Le compte de charge (classe 6) ou de produit (classe 7) régularisé. */
  compteResultat: string
  /** Le compte de régularisation : proposé depuis le plan pour les natures qui ont leur rôle, libre sous leurs racines sinon. */
  compteRegularisation: string
  /** Le montant de la régularisation (HT pour un assujetti, TTC pour un exonéré). */
  montant: string
  /** La TVA d'attente d'une FNP ou d'une FAE d'un dossier assujetti ; vide : aucune. */
  tva: string
  objet: string
  periodeDebut: string
  periodeFin: string
  /** Le montant de la pièce pour toute sa période : l'entrée du prorata PROPOSÉ, jamais écrit en lui-même. */
  montantDeLaPiece: string
}

/** Le compte de régularisation que le plan du dossier propose pour une nature qui a son rôle ; vide pour les autres. */
export function compteDeRegularisationPropose(nature: NatureAExtourner, comptes: ComptesDInventaire): string {
  switch (nature) {
    case 'cca': return compteDuRole(comptes, 'charges_constatees_avance') ?? ''
    case 'pca': return compteDuRole(comptes, 'produits_constates_avance') ?? ''
    case 'fnp': return compteDuRole(comptes, 'factures_non_parvenues') ?? ''
    case 'fae': return compteDuRole(comptes, 'factures_a_etablir') ?? ''
    default: return ''
  }
}

export function formulaireVide(nature: NatureAExtourner, comptes: ComptesDInventaire): FormulaireDeRegularisation {
  return {
    nature, compteResultat: '', compteRegularisation: compteDeRegularisationPropose(nature, comptes), montant: '', tva: '', objet: '',
    periodeDebut: '', periodeFin: '', montantDeLaPiece: '',
  }
}

/** Le formulaire d'une régularisation existante, pour la REMPLACER : ce que la base porte, tel qu'une saisie le relit. */
export function formulaireDeLOperation(o: OperationInventaire): FormulaireDeRegularisation {
  return {
    nature: o.nature === 'provision' ? 'cca' : o.nature,
    compteResultat: o.compte_resultat, compteRegularisation: o.compte_regularisation,
    montant: texteDesCentimes(o.montant_centimes), tva: o.tva_centimes > 0 ? texteDesCentimes(o.tva_centimes) : '',
    objet: o.objet, periodeDebut: o.periode_debut ?? '', periodeFin: o.periode_fin ?? '', montantDeLaPiece: '',
  }
}

/** Le FNP et la FAE d'un dossier assujetti portent une TVA d'attente (INV-Q3) : le champ ne s'offre qu'à eux. */
export const natureAvecTvaDAttente = (nature: NatureAExtourner, assujettiTva: boolean): boolean =>
  assujettiTva && (nature === 'fnp' || nature === 'fae')

/** Les arguments de `enregistrer_operation_inventaire` : ce que la base recomposera et comparera. */
export interface AppelDeRegularisation {
  operation: Record<string, unknown>
  ecritures: EcritureDInventaire[]
  /** La version que la saisie remplace ; nulle pour une régularisation neuve. */
  versionLue: number | null
}

export type VerdictDeLaRegularisation =
  | { etat: 'permis'; appel: AppelDeRegularisation; constatation: EcritureDInventaire; extourne: EcritureDInventaire; confirmation: string }
  | { etat: 'refuse'; refus: string[] }

const DATE_CIVILE = /^(\d{4})-(\d{2})-(\d{2})$/
function dateCivileValide(date: string): boolean {
  const m = DATE_CIVILE.exec(date)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mo - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j
}

/** La période saisie : les deux dates ou aucune ; le refus, aux mots de la base (`MOTS_DES_REFUS.periode`). */
function periodeDuFormulaire(f: FormulaireDeRegularisation): { debut: string | null; fin: string | null } | { refus: string } {
  const debut = f.periodeDebut.trim()
  const fin = f.periodeFin.trim()
  if (debut === '' && fin === '') return { debut: null, fin: null }
  if (!dateCivileValide(debut) || !dateCivileValide(fin) || debut > fin) return { refus: MOTS_DES_REFUS.periode }
  return { debut, fin }
}

const lignesDite = (e: EcritureDInventaire) => e.lignes.map((l) => `${SENS[l.sens]} ${l.compte} ${euros(l.centimes)}`).join(' ; ')

/** La confirmation d'une régularisation : elle NOMME ce qui part — les deux écritures, leurs dates, leurs comptes et leurs
 *  montants, et le libellé qui ira au FEC. */
export function confirmationDeLaRegularisation(
  constatation: EcritureDInventaire, extourne: EcritureDInventaire, remplace: OperationInventaire | null,
): string {
  return [
    remplace === null ? 'Enregistrer cette régularisation ?' : 'Remplacer cette régularisation ? Ses deux écritures sont réécrites.',
    `Au ${formatDate(constatation.date)} : ${lignesDite(constatation)}.`,
    `Au ${formatDate(extourne.date)} (extourne) : ${lignesDite(extourne)}.`,
    `Libellé, qui part au FEC : « ${constatation.libelle} ».`,
  ].join('\n')
}

/**
 * Le verdict d'une saisie de régularisation, TELLE QU'ELLE PART : le module de l'inventaire la juge (le mode, l'exercice, la
 * nature, le plan, les comptes, les montants, l'objet) et en compose la paire ; la période, que la base juge après l'objet, vient
 * à la suite. `remplace` : la régularisation que la saisie remplace — sa version est retenue, et sa pièce citée gardée (l'écran
 * ne la change pas, une saisie ne l'effacerait pas).
 */
export function verdictDeLaRegularisation(
  f: FormulaireDeRegularisation, ctx: ContexteDeLInventaire, d: Pick<DonneesDeLInventaire, 'comptes' | 'premierExercice'>,
  remplace: OperationInventaire | null,
): VerdictDeLaRegularisation {
  const periode = periodeDuFormulaire(f)
  const tva = natureAvecTvaDAttente(f.nature, ctx.assujettiTva) ? centimesDeLaSaisie(f.tva, true) : 0
  const saisie = {
    nature: f.nature,
    compteResultat: f.compteResultat.trim(),
    libelleCompteResultat: libelleCompteTenu(f.compteResultat.trim()),
    compteRegularisation: f.compteRegularisation.trim(),
    montantCentimes: centimesDeLaSaisie(f.montant, false),
    tvaCentimes: tva,
    objet: f.objet.trim(),
  }
  const composition = composerRegularisation(saisie, {
    modeComptable: ctx.mode, assujettiTva: ctx.assujettiTva, comptes: d.comptes,
    exercice: exerciceDeLInventaire(ctx, d.premierExercice), tvaDesFacturesAttendues: CHOIX_DU_CABINET.tvaDesFacturesAttendues,
  })
  const refus = composition.ok ? [] : composition.refus.map((r) => r.message)
  if ('refus' in periode) refus.push(periode.refus)
  if (!composition.ok || 'refus' in periode) return { etat: 'refuse', refus }
  return {
    etat: 'permis',
    appel: {
      operation: {
        id: remplace?.id ?? null, exercice: ctx.exercice, nature: f.nature, compte_resultat: saisie.compteResultat,
        compte_regularisation: saisie.compteRegularisation, montant_centimes: saisie.montantCentimes, tva_centimes: saisie.tvaCentimes,
        objet: saisie.objet, periode_debut: periode.debut, periode_fin: periode.fin, piece_citee_id: remplace?.piece_citee_id ?? null,
      },
      ecritures: [composition.constatation, composition.extourne],
      versionLue: remplace?.version ?? null,
    },
    constatation: composition.constatation,
    extourne: composition.extourne,
    confirmation: confirmationDeLaRegularisation(composition.constatation, composition.extourne, remplace),
  }
}

/** Le prorata PROPOSÉ d'une pièce qui court après la clôture : nul tant que le montant de la pièce et ses deux dates ne sont pas
 *  tous saisis ; sinon la part en centimes et la phrase qui la justifie, ou le refus du module. Le montant ÉCRIT reste celui que le
 *  cabinet confirme (§ 3.1). */
export type PropositionDuProrata =
  | { etat: 'proposee'; centimes: number; phrase: string }
  | { etat: 'refusee'; message: string }

export function propositionDuProrata(f: FormulaireDeRegularisation, ctx: Pick<ContexteDeLInventaire, 'exercice'>): PropositionDuProrata | null {
  if (f.montantDeLaPiece.trim() === '' || f.periodeDebut.trim() === '' || f.periodeFin.trim() === '') return null
  const prorata = prorataApresLaCloture({
    montantCentimes: centimesDeLaSaisie(f.montantDeLaPiece, false), debut: f.periodeDebut.trim(), fin: f.periodeFin.trim(), exercice: ctx.exercice,
  }, CHOIX_DU_CABINET.methodeDuProrata)
  if (!prorata.ok) return { etat: 'refusee', message: prorata.refus[0].message }
  const methode = prorata.methode === 'jours_reels' ? 'jours réels' : 'mois de trente jours'
  return {
    etat: 'proposee', centimes: prorata.centimes,
    phrase: `${prorata.joursApres} jour(s) sur ${prorata.joursDeLaPeriode} courent après le 31/12/${ctx.exercice} (${methode}) : `
      + `${euros(prorata.centimes)} proposés.`,
  }
}

// ── Le retrait d'une régularisation, ce que la base en dira ──────────────────────────────────────────────────────────────

/** Les opérations d'un exercice, retirées ou remplacées jamais comprises : celles que la base rend, triées pour l'écran. */
export function operationsDeLExercice(operations: readonly OperationInventaire[], exercice: number): OperationInventaire[] {
  const rang = (n: NatureDInventaire) => (['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir', 'provision'] as const).indexOf(n)
  return operations.filter((o) => o.exercice === exercice)
    .sort((a, b) => rang(a.nature) - rang(b.nature) || a.objet.localeCompare(b.objet, 'fr') || (a.id < b.id ? -1 : 1))
}

/** Les régularisations proprement dites (la provision a son tableau) d'un exercice. */
export const regularisationsDeLExercice = (operations: readonly OperationInventaire[], exercice: number): OperationInventaire[] =>
  operationsDeLExercice(operations, exercice).filter((o) => o.nature !== 'provision')

/** Le refus que `retirer_operation_inventaire` lèverait (le mode, le gel), l'accès passé ; nul quand elle retire. Une évaluation de
 *  provision ne se retire que si c'est la dernière de sa provision (`garder_evaluations_de_provision`). */
export function refusDuRetraitDeLOperation(
  o: OperationInventaire, ctx: ContexteDeLInventaire, operations: readonly OperationInventaire[],
): string | null {
  if (ctx.mode !== 'engagement') return MOTS_DES_REFUS.tresorerie
  const derniere = derniereValidee(ctx.anneesValidees)
  if (derniere !== null && o.exercice <= derniere) return MOTS_DES_REFUS.exerciceFige
  if (o.provision_id != null && operations.some((x) => x.provision_id === o.provision_id && x.exercice > o.exercice)) {
    return MOTS_DES_PROVISIONS_A_L_ECRAN.evalueePlusRecemment
  }
  return null
}

export function confirmationDuRetrait(o: OperationInventaire): string {
  return o.nature === 'provision'
    ? `Retirer l’évaluation « ${o.objet} » au 31/12/${o.exercice} (cible ${euros(o.montant_centimes)}) ? Son écriture de dotation ou de reprise est retirée avec elle.`
    : `Retirer la régularisation « ${o.objet} » (${LIBELLES_DES_NATURES[o.nature]}, ${euros(o.montant_centimes)}) ? Ses deux écritures, au 31/12/${o.exercice} `
      + `et au 01/01/${o.exercice + 1}, sont retirées avec elle.`
}

/** La régularisation est-elle à jour ? Les lignes du brouillon qui la citent sont celles qu'elle commande (le même juge que la
 *  validation, `regularisationAJour`) : sinon son enregistrement est à refaire avant la validation. */
export function ecrituresAJour(o: OperationInventaire, d: Pick<DonneesDeLInventaire, 'operations' | 'provisions' | 'lignes'>): boolean {
  const vue = (x: OperationInventaire) => ({ ...x, provision_id: x.provision_id ?? null })
  const cible = ciblePrecedente(vue(o), d.operations.map(vue), d.provisions)
  return regularisationAJour(vue(o), d.lignes, cible)
}

// ── Les provisions ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormulaireDeProvision {
  genre: GenreDeProvision
  compte: string
  objet: string
  /** Sa part du solde repris de son compte (INV-Q11), au premier exercice du dossier seulement ; vide : née dans l'application. */
  reprise: string
}

/** Le compte que le plan du dossier propose pour un genre de provision. */
export function compteDeProvisionPropose(genre: GenreDeProvision, comptes: ComptesDInventaire): string {
  return (genre === 'risque' ? compteDuRole(comptes, 'provisions_risques') : compteDuRole(comptes, 'depreciation_clients')) ?? ''
}

export const formulaireDeProvisionVide = (genre: GenreDeProvision, comptes: ComptesDInventaire): FormulaireDeProvision =>
  ({ genre, compte: compteDeProvisionPropose(genre, comptes), objet: '', reprise: '' })

export type VerdictDeLaProvision =
  | { etat: 'permis'; provision: Record<string, unknown>; confirmation: string }
  | { etat: 'refuse'; refus: string[] }

/** Le verdict de l'ouverture d'une provision, sur l'exercice affiché (`ouverte_en`) : les refus de `enregistrer_provision`, dans
 *  l'ordre du module (le mode, l'exercice, le genre, le compte, l'objet), puis ceux que la base seule dit (la part reprise). La
 *  facture ou la pièce qu'elle cite ne se choisissent pas encore d'ici : une provision s'ouvre sans. */
export function verdictDeLaProvision(
  f: FormulaireDeProvision, ctx: ContexteDeLInventaire, d: Pick<DonneesDeLInventaire, 'comptes' | 'premierExercice'>,
): VerdictDeLaProvision {
  const compte = f.compte.trim()
  const objet = f.objet.trim()
  // Le plan des dotations et des reprises se juge à l'évaluation, jamais à l'ouverture : la base ne le lit qu'alors.
  const refus = refusDeLEvaluation(
    { genre: f.genre, compteProvision: compte, cibleCentimes: 0, objet },
    {
      modeComptable: ctx.mode, comptes: d.comptes, exercice: exerciceDeLInventaire(ctx, d.premierExercice),
      ciblePrecedenteCentimes: 0, reajustement: CHOIX_DU_CABINET.reajustement,
    },
  ).filter((r) => !r.cle.startsWith('plan:')).map((r) => r.message)
  let reprise: number | null = null
  if (f.reprise.trim() !== '') {
    reprise = centimesDeLaSaisie(f.reprise, false)
    if (Number.isNaN(reprise)) refus.push(MOTS_DES_REFUS.ciblePrecedente)
    else if (d.premierExercice === null || ctx.exercice !== d.premierExercice) refus.push(MOTS_DES_PROVISIONS_A_L_ECRAN.partRepriseHorsDuPremierExercice)
  }
  if (refus.length > 0) return { etat: 'refuse', refus }
  return {
    etat: 'permis',
    provision: {
      id: null, genre: f.genre, compte_provision: compte, objet, ouverte_en: ctx.exercice, facture_id: null, piece_citee_id: null,
      reprise_centimes: reprise,
    },
    confirmation: [
      'Ouvrir cette provision ?',
      `${LIBELLES_DES_GENRES[f.genre]} « ${objet} », au compte ${compte}, ouverte sur l’exercice ${ctx.exercice}`
        + `${reprise === null ? '' : `, pour ${euros(reprise)} du solde repris`}.`,
      'Aucune écriture ne part : une provision s’écrit par son évaluation au 31 décembre.',
    ].join('\n'),
  }
}

/** L'évaluation d'une provision sur un exercice, si elle existe. */
export const evaluationDeLExercice = (p: Provision, operations: readonly OperationInventaire[], exercice: number): OperationInventaire | null =>
  operations.find((o) => o.provision_id === p.id && o.exercice === exercice) ?? null

/** Les provisions qu'un exercice porte : ouvertes sur lui ou avant. */
export const provisionsDeLExercice = (provisions: readonly Provision[], exercice: number): Provision[] =>
  provisions.filter((p) => p.ouverte_en <= exercice).sort((a, b) => a.ouverte_en - b.ouverte_en || (a.id < b.id ? -1 : 1))

export type VerdictDeLEvaluation =
  | {
    etat: 'permis'
    /** La provision au 31 décembre précédent, telle que la base la lira. */
    precedente: number
    /** La cible moins la précédente : positif, une dotation ; négatif, une reprise ; nul, aucune écriture. */
    ecart: number
    ecriture: EcritureDInventaire | null
    appel: { evaluation: Record<string, unknown>; ecritures: EcritureDInventaire[]; versionLue: number | null }
    confirmation: string
  }
  | { etat: 'refuse'; refus: string[] }

/**
 * Le verdict de l'évaluation d'une provision au 31 décembre de l'exercice affiché, sa cible telle que saisie : les refus de
 * `enregistrer_evaluation_provision` dans l'ordre du module (le mode, l'exercice, le plan, la cible), puis ceux que la base seule
 * dit (la provision pas encore ouverte, une évaluation plus récente, la provision soldée). L'écart se calcule sur la provision
 * précédente LUE (`ciblePrecedente`), jamais celle de l'appelant ; l'écriture, par différence, ne s'extourne jamais.
 */
export function verdictDeLEvaluation(
  p: Provision, cible: string, ctx: ContexteDeLInventaire, d: DonneesDeLInventaire,
): VerdictDeLEvaluation {
  const vue = (x: OperationInventaire) => ({ ...x, provision_id: x.provision_id ?? null })
  const precedenteLue = ciblePrecedente({ exercice: ctx.exercice, provision_id: p.id }, d.operations.map(vue), d.provisions)
  const saisie = { genre: p.genre, compteProvision: p.compte_provision, cibleCentimes: centimesDeLaSaisie(cible, false), objet: p.objet }
  const contexte = {
    modeComptable: ctx.mode, comptes: d.comptes, exercice: exerciceDeLInventaire(ctx, d.premierExercice),
    ciblePrecedenteCentimes: precedenteLue ?? 0, reajustement: CHOIX_DU_CABINET.reajustement,
  }
  const composition = composerEvaluation(saisie, contexte)
  const refus = composition.ok ? [] : composition.refus.map((r) => r.message)
  if (precedenteLue === null) {
    refus.push('La provision évaluée n’est pas une provision de ce dossier.')
  } else if (ctx.exercice < p.ouverte_en) {
    refus.push(MOTS_DES_PROVISIONS_A_L_ECRAN.pasEncoreOuverte)
  } else if (d.operations.some((o) => o.provision_id === p.id && o.exercice > ctx.exercice)) {
    refus.push(MOTS_DES_PROVISIONS_A_L_ECRAN.evalueePlusRecemment)
  } else if (d.operations.filter((o) => o.provision_id === p.id && o.exercice < ctx.exercice).sort((a, b) => b.exercice - a.exercice)[0]?.montant_centimes === 0) {
    refus.push(MOTS_DES_PROVISIONS_A_L_ECRAN.soldee)
  }
  if (refus.length > 0 || !composition.ok || precedenteLue === null) return { etat: 'refuse', refus }
  const existante = evaluationDeLExercice(p, d.operations, ctx.exercice)
  const cibleCentimes = saisie.cibleCentimes
  const quoi = composition.ecriture === null
    ? 'Aucune écriture : la cible est celle de l’exercice précédent.'
    : `${composition.ecart > 0 ? 'Dotation' : 'Reprise'} au ${formatDate(composition.ecriture.date)} : ${lignesDite(composition.ecriture)}.`
  return {
    etat: 'permis', precedente: precedenteLue, ecart: composition.ecart, ecriture: composition.ecriture,
    appel: {
      evaluation: { provision_id: p.id, exercice: ctx.exercice, cible_centimes: cibleCentimes },
      ecritures: composition.ecriture === null ? [] : [composition.ecriture],
      versionLue: existante?.version ?? null,
    },
    confirmation: [
      existante === null ? 'Évaluer cette provision ?' : 'Remplacer l’évaluation de cette provision ? Son écriture est réécrite.',
      `${LIBELLES_DES_GENRES[p.genre]} « ${p.objet} » : ${euros(cibleCentimes)} au 31/12/${ctx.exercice}, contre ${euros(precedenteLue)} au 31/12/${ctx.exercice - 1}.`,
      quoi,
      composition.ecriture === null ? 'Rien ne s’écrit.' : `Libellé, qui part au FEC : « ${composition.ecriture.libelle} ».`,
    ].join('\n'),
  }
}

/** Le refus que `retirer_provision` lèverait (le mode, le gel, une évaluation qui la cite), l'accès passé ; nul quand elle se retire. */
export function refusDuRetraitDeLaProvision(p: Provision, ctx: ContexteDeLInventaire, operations: readonly OperationInventaire[]): string | null {
  if (ctx.mode !== 'engagement') return MOTS_DES_REFUS.tresorerie
  const derniere = derniereValidee(ctx.anneesValidees)
  if (derniere !== null && p.ouverte_en <= derniere) return MOTS_DES_REFUS.exerciceFige
  if (operations.some((o) => o.provision_id === p.id)) return MOTS_DES_PROVISIONS_A_L_ECRAN.dejaEvaluee
  return null
}

export const confirmationDuRetraitDeLaProvision = (p: Provision): string =>
  `Retirer la provision « ${p.objet} » (${LIBELLES_DES_GENRES[p.genre]}, au compte ${p.compte_provision}) ? Aucune écriture ne part avec elle : elle n'en a pas.`

// ── La déclaration de l'inventaire ───────────────────────────────────────────────────────────────────────────────────────

const declarationsDe = (declarations: readonly InventaireDeclare[]): DeclarationDeLaValidation[] =>
  declarations.map((x) => ({ id: x.id, exercice: x.exercice, retire_le: x.retire_le }))

/** La déclaration en vigueur de l'exercice (non retirée), s'il y en a une. */
export const declarationEnVigueur = (declarations: readonly InventaireDeclare[], exercice: number): InventaireDeclare | null =>
  declarations.find((x) => x.exercice === exercice && x.retire_le === null) ?? null

/** Le refus que `declarer_inventaire` lèverait, l'accès passé, aux mots de la base ; nul quand elle déclare. */
export function refusDeLaDeclarationALEcran(ctx: ContexteDeLInventaire, d: Pick<DonneesDeLInventaire, 'declarations' | 'premierExercice'>): string | null {
  return refusDeLaDeclaration({
    mode: ctx.mode, exercice: ctx.exercice, derniereValidee: derniereValidee(ctx.anneesValidees),
    anneeEnCours: Number(ctx.aujourdhui.slice(0, 4)), premierExercice: d.premierExercice, declarations: declarationsDe(d.declarations),
  })?.message ?? null
}

/** Le refus que `retirer_declaration_inventaire` lèverait, l'accès passé ; nul quand elle retire. */
export function refusDuRetraitDeLaDeclarationALEcran(x: InventaireDeclare, ctx: ContexteDeLInventaire): string | null {
  return refusDuRetraitDeLaDeclarationDuModule({ id: x.id, exercice: x.exercice, retire_le: x.retire_le }, derniereValidee(ctx.anneesValidees))?.message ?? null
}

export const confirmationDeLaDeclaration = (exercice: number, nbRegularisations: number, nbProvisions: number): string =>
  `Déclarer l’inventaire de l’exercice ${exercice} fait ?\n`
  + `Il porte ${nbRegularisations} régularisation(s) et ${nbProvisions} provision(s) ouverte(s) : aucune régularisation oubliée. `
  + 'La déclaration se retire tant que l’exercice n’est pas validé ; la validation de l’exercice l’attend.'

export const confirmationDuRetraitDeLaDeclaration = (exercice: number): string =>
  `Retirer la déclaration de l’inventaire de l’exercice ${exercice} ? Sa trace reste, et l’exercice ne se valide plus sans une nouvelle déclaration.`

