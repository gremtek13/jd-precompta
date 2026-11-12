import {
  COUPLES_ADMIS, NOMS_DES_DESTINATIONS, NOMS_DES_ORIGINES, composerLEcritureDAffectation, jugerLAffectation, proposerLAffectation,
  type ComptesDeLAffectation, type ContexteDeLAffectation, type DecisionSaisie, type DestinationDAffectation,
  type EcritureDAffectation, type JugementDeLAffectation, type LigneDAffectation, type OrganeDeLaDecision, type OrigineDAffectation,
  type PropositionDAffectation, type SoldesAvantAffectation,
} from './affectationDuResultat'
import { anneeDe, formatDate, formatMoney } from './format'
import { centimesDeLaSaisie } from './saisies2035'
import { exploitantIndividuel } from './reportDesSoldes'
import type { ModeleComptable } from './engagement'
import type { SensEcriture } from './types'

// L'ÉCRAN DE L'AFFECTATION DU RÉSULTAT, SA LOGIQUE (ligne 45, lot AFF4 ; conception docs/conceptions/45-affectation-et-
// approbation.md, § 5.8). Pur, sans réseau : ce que la carte de l'onglet Clôture LIT (les lignes des écritures et des
// ouvertures, qui disent le résultat de l'exercice et les soldes à la date de la décision), ce qu'elle PROPOSE, juge et
// compose — tout par `lib/affectationDuResultat.ts` (AFF1), jamais recopié : les refus et leurs mots sont les siens, dits AVANT
// le clic sur la saisie TELLE QU'ELLE PART. La lecture des tables est dans `lib/affectationLecture.ts`, la carte dans
// `pages/dossier/AffectationDuResultatCard.tsx`.

// ── Ce que la carte lit ────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne d'ouverture (`soldes_reportes`, `a_nouveaux`) : un compte, un sens, un montant en euros. */
export interface LigneDOuvertureLue {
  date: string
  compte: string
  sens: SensEcriture
  montant: number
}

/** Une ligne du brouillon, telle que la lecture de l'écran la garde : celle d'une décision porte son `affectation_id`. */
export interface LigneDuBrouillonLue extends LigneDOuvertureLue {
  statut: string
  affectationId: string | null
}

export type EtatDUneDecision = 'en_vigueur' | 'remplacee' | 'retiree'

/** Une version d'une décision, avec sa répartition (`affectations_du_resultat`, `lignes_d_affectation`). */
export interface DecisionLue {
  id: string
  version: number
  etat: EtatDUneDecision
  organe: OrganeDeLaDecision
  nombreDAssocies: 'un' | 'plusieurs'
  dateDecision: string
  comptesApprouves: boolean
  dateMiseEnPaiement: string | null
  reservesStatutairesDistribuables: boolean
  lignes: LigneDAffectation[]
  /** Le jour de Paris où la version a pris fin (remplacée ou retirée), sinon nul. */
  finLe: string | null
}

/** Tout ce que la carte juge, lu EN ENTIER pour un dossier et un exercice affecté. */
export interface LueDeLAffectation {
  dossierId: string
  annee: number
  etat: 'lue'
  formeJuridique: string | null
  capitalCentimes: number | null
  /** Les huit comptes du plan du dossier que l'affectation écrit (`plan_du_dossier`). */
  comptes: ComptesDeLAffectation
  /** Les exercices validés du dossier, tous. */
  anneesValidees: number[]
  /** Le brouillon depuis le 1er janvier de l'exercice affecté. */
  brouillon: LigneDuBrouillonLue[]
  reportes: LigneDOuvertureLue[]
  aNouveaux: LigneDOuvertureLue[]
  /** Toutes les versions de l'exercice affecté, de la première à la dernière. */
  decisions: DecisionLue[]
}

export type LectureDeLAffectation = LueDeLAffectation | { dossierId: string; annee: number; etat: 'incomplete'; motif: string }

/** La décision en vigueur de l'exercice, ou nulle. */
export function decisionEnVigueur(lue: LueDeLAffectation): DecisionLue | null {
  return lue.decisions.find((d) => d.etat === 'en_vigueur') ?? null
}

// ── Ce que la base lit à sa place, redit ───────────────────────────────────────────────────────────────────────────────

const enCentimes = (montant: number): number => Math.round(montant * 100)
const signe = (sens: SensEcriture): number => (sens === 'credit' ? 1 : -1)

/**
 * Le résultat de l'exercice affecté, en centimes : crédit moins débit des lignes VALIDÉES des classes 6 et 7 de l'année —
 * positif un bénéfice, négatif une perte. Le même calcul que `enregistrer_affectation` (AFF2).
 */
export function resultatDeLExercice(brouillon: readonly LigneDuBrouillonLue[], annee: number): number {
  let somme = 0
  for (const l of brouillon) {
    if (l.statut !== 'validee' || !/^[67]/.test(l.compte) || anneeDe(l.date) !== annee) continue
    somme += signe(l.sens) * enCentimes(l.montant)
  }
  return somme
}

/**
 * Les soldes des capitaux propres à la date d'une décision, avant elle (`SoldesAvantAffectation`) : l'ouverture de l'exercice
 * de cette date (soldes reportés, à-nouveaux), puis ce que son brouillon y a écrit jusqu'à elle, la décision qu'on remplace
 * écartée. Créditeurs positifs, sauf les pertes antérieures (119) et les acomptes sur dividendes (1209), leurs soldes débiteurs.
 *
 * Ce que redit `affectation_soldes` (AFF2) : une ligne que ne cite aucune décision est toujours comptée, et seules les lignes
 * de la décision remplacée s'écartent. La fonction l'écrit `(p_exclue is null or e.affectation_id is distinct from p_exclue)`
 * depuis AFF4-Q1 (12/11/2026) : la clause seule écartait toute ligne ordinaire à la première décision d'un exercice
 * (`null is distinct from null` est faux) ; `affectationDuResultat.sql` le rejoue (E37 à E39f, M10 à M13).
 */
export function soldesALaDate(
  sources: { reportes: readonly LigneDOuvertureLue[]; aNouveaux: readonly LigneDOuvertureLue[]; brouillon: readonly LigneDuBrouillonLue[] },
  date: string,
  decisionRemplacee: string | null,
): SoldesAvantAffectation {
  const debut = `${anneeDe(date)}-01-01`
  const mouvements: { compte: string; c: number }[] = []
  for (const s of sources.reportes) if (s.date === debut) mouvements.push({ compte: s.compte, c: signe(s.sens) * enCentimes(s.montant) })
  for (const a of sources.aNouveaux) if (a.date >= debut && a.date <= date) mouvements.push({ compte: a.compte, c: signe(a.sens) * enCentimes(a.montant) })
  for (const e of sources.brouillon) {
    if (e.date < debut || e.date > date) continue
    if (decisionRemplacee !== null && e.affectationId === decisionRemplacee) continue
    mouvements.push({ compte: e.compte, c: signe(e.sens) * enCentimes(e.montant) })
  }
  const total = (garde: (compte: string) => boolean): number => mouvements.reduce((s, m) => (garde(m.compte) ? s + m.c : s), 0)
  const sous = (racine: string) => (compte: string) => compte.startsWith(racine)
  return {
    capitalAuxComptes: total((k) => k.startsWith('101') || k.startsWith('109')),
    primes: total(sous('104')),
    ecartsDeReevaluation: total(sous('105')),
    reserveLegale: total(sous('1061')),
    reservesIndisponibles: total(sous('1062')),
    reservesStatutaires: total(sous('1063')),
    reservesReglementees: total(sous('1064')),
    autresReserves: total((k) => k.startsWith('106') && !['1061', '1062', '1063', '1064'].includes(k.slice(0, 4))),
    reportCrediteur: total(sous('110')),
    pertesAnterieures: -total(sous('119')),
    acomptesSurDividendes: -total(sous('1209')),
  }
}

// ── La saisie ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LigneSaisie {
  origine: OrigineDAffectation
  destination: DestinationDAffectation
  /** Des euros tapés (« 1 200,50 ») : vide ou illisible, la ligne se refuse, jamais zéro deviné. */
  montant: string
}

export interface SaisieDeLaCarte {
  organe: OrganeDeLaDecision
  nombreDAssocies: 'un' | 'plusieurs'
  comptesApprouves: boolean
  /** AAAA-MM-JJ, ou vide. */
  dateDecision: string
  dateMiseEnPaiement: string
  /** Ce que disent les statuts des réserves statutaires : AUCUN défaut (AFF1-Q1), l'application ne les lit pas. */
  statuts: 'distribuables' | 'indisponibles' | ''
  lignes: LigneSaisie[]
}

export const ORIGINES_OFFERTES = Object.keys(COUPLES_ADMIS) as OrigineDAffectation[]

/** Les destinations qu'une origine admet (le module les dit), pour que le choix n'offre que des couples admis. */
export function destinationsAdmises(origine: OrigineDAffectation): readonly DestinationDAffectation[] {
  return COUPLES_ADMIS[origine]
}

export function libelleDeLOrigine(o: OrigineDAffectation): string {
  return NOMS_DES_ORIGINES[o].replace(/^./, (x) => x.toUpperCase())
}
export function libelleDeLaDestination(d: DestinationDAffectation): string {
  return NOMS_DES_DESTINATIONS[d].replace(/^./, (x) => x.toUpperCase())
}

export const LIBELLES_DES_ORGANES: Readonly<Record<OrganeDeLaDecision, string>> = {
  assemblee: 'Assemblée générale',
  consultation_ecrite: 'Consultation écrite',
  acte_unanime: 'Acte unanime des associés',
  associe_unique: 'Décision de l’associé unique',
}

/** La saisie d'une décision déjà enregistrée, à remplacer : ses lignes en euros tapés. */
export function saisieDeLaDecision(d: DecisionLue): SaisieDeLaCarte {
  return {
    organe: d.organe,
    nombreDAssocies: d.nombreDAssocies,
    comptesApprouves: d.comptesApprouves,
    dateDecision: d.dateDecision,
    dateMiseEnPaiement: d.dateMiseEnPaiement ?? '',
    statuts: d.reservesStatutairesDistribuables ? 'distribuables' : 'indisponibles',
    lignes: d.lignes.map((l) => ({ origine: l.origine, destination: l.destination, montant: eurosTapes(l.centimes) })),
  }
}

/** Des centimes en euros tapés, que `centimesDeLaSaisie` relit à l'identique : « 1200,50 ». */
export function eurosTapes(centimes: number): string {
  return `${Math.floor(centimes / 100)},${String(centimes % 100).padStart(2, '0')}`
}

/** Une saisie vierge : ni date, ni ligne, ni choix pour les statuts. */
export const SAISIE_VIERGE: SaisieDeLaCarte = {
  organe: 'assemblee', nombreDAssocies: 'plusieurs', comptesApprouves: true, dateDecision: '', dateMiseEnPaiement: '', statuts: '', lignes: [],
}

/**
 * La saisie telle qu'elle PART : ses montants en centimes, un montant illisible en `NaN` — que le module refuse à ses mots
 * (« Un montant n’est pas un nombre entier de centimes… ») au lieu qu'on le devine nul.
 */
export function decisionDeLaSaisie(saisie: SaisieDeLaCarte, annee: number): DecisionSaisie {
  return {
    exerciceAffecte: annee,
    organe: saisie.organe,
    nombreDAssocies: saisie.nombreDAssocies,
    dateDecision: saisie.dateDecision,
    comptesApprouves: saisie.comptesApprouves,
    dateMiseEnPaiement: saisie.dateMiseEnPaiement === '' ? null : saisie.dateMiseEnPaiement,
    lignes: saisie.lignes.map((l) => ({ origine: l.origine, destination: l.destination, centimes: centimesDeLaSaisie(l.montant) ?? Number.NaN })),
  }
}

// ── Le contexte, la proposition, le jugement ───────────────────────────────────────────────────────────────────────────

/** Les exercices validés couvrent-ils l'année de cette date ? La base : l'année de la date au plus celle de la frontière. */
export function exerciceDeLaDateValide(date: string, anneesValidees: readonly number[]): boolean {
  return anneesValidees.length > 0 && /^\d{4}-/.test(date) && anneeDe(date) <= Math.max(...anneesValidees)
}

const estUneDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d)

/**
 * Le contexte que le module juge, à une date de décision : les soldes de cette date (la décision en vigueur écartée, qu'on
 * remplace), le résultat lu, le dossier tel que la carte le connaît. `statuts` vide vaut « indisponibles » ici : le choix
 * non fait se refuse avant (`refusDeLaCarte`), jamais ne s'enregistre.
 */
export function contexteDeLAffectation(
  lue: LueDeLAffectation, modele: ModeleComptable, date: string, statuts: SaisieDeLaCarte['statuts'], aujourdHui: string,
): ContexteDeLAffectation {
  const enVigueur = decisionEnVigueur(lue)
  return {
    dossier: {
      modeComptable: modele.mode,
      exploitantIndividuel: exploitantIndividuel(modele),
      formeJuridique: lue.formeJuridique,
      capitalCentimes: lue.capitalCentimes,
      reservesStatutairesDistribuables: statuts === 'distribuables',
    },
    resultatCentimes: resultatDeLExercice(lue.brouillon, lue.annee),
    // Une date illisible n'a pas de soldes : le module la refuse avant de les lire.
    soldes: soldesALaDate(lue, estUneDate(date) ? date : `${lue.annee + 1}-01-01`, enVigueur?.id ?? null),
    comptes: lue.comptes,
    aujourdHui,
    exerciceDeLaDecisionValide: estUneDate(date) && exerciceDeLaDateValide(date, lue.anneesValidees),
  }
}

/**
 * La proposition du module, à la date saisie quand c'est une date civile après la clôture, sinon au 1er janvier qui suit
 * l'exercice (l'ouverture du suivant), la date que la carte DIT. Nulle hors du champ : le jugement dit pourquoi.
 */
export function propositionDeLAffectation(
  lue: LueDeLAffectation, modele: ModeleComptable, saisie: SaisieDeLaCarte, aujourdHui: string,
): { proposition: PropositionDAffectation | null; auJour: string } {
  const apresLaCloture = estUneDate(saisie.dateDecision) && saisie.dateDecision > `${lue.annee}-12-31`
  const auJour = apresLaCloture ? saisie.dateDecision : `${lue.annee + 1}-01-01`
  const contexte = contexteDeLAffectation(lue, modele, auJour, saisie.statuts, aujourdHui)
  return { proposition: proposerLAffectation(contexte), auJour }
}

/** Ce que la carte dit avant le clic, de la saisie telle qu'elle part. */
export interface JugementDeLaCarte {
  decision: DecisionSaisie
  contexte: ContexteDeLAffectation
  jugement: JugementDeLAffectation
  /** Un refus de la carte seule, que le module ne connaît pas (le choix des statuts), ou nul. */
  refusDeLaCarte: string | null
  /** L'écriture que la base recomposera : nulle quand la décision est refusée, ou n'en compose pas (non approuvés). */
  ecriture: EcritureDAffectation | null
  /** La saisie s'enregistre : aucun refus, du module ni de la carte. */
  enregistrable: boolean
}

export const REFUS_DES_STATUTS =
  'Ce que disent les statuts des réserves statutaires (distribuables ou non) n’est pas choisi : l’application ne lit pas les statuts, la décision le porte.'

export function jugerLaSaisie(
  lue: LueDeLAffectation, modele: ModeleComptable, saisie: SaisieDeLaCarte, aujourdHui: string,
): JugementDeLaCarte {
  const decision = decisionDeLaSaisie(saisie, lue.annee)
  const contexte = contexteDeLAffectation(lue, modele, saisie.dateDecision, saisie.statuts, aujourdHui)
  const jugement = jugerLAffectation(contexte, decision)
  const refusDeLaCarte = saisie.statuts === '' ? REFUS_DES_STATUTS : null
  const enregistrable = jugement.refus.length === 0 && refusDeLaCarte === null
  // On ne compose jamais ce que la base refuserait : le module lève sur une décision refusée.
  const ecriture = enregistrable ? composerLEcritureDAffectation(contexte, decision) : null
  return { decision, contexte, jugement, refusDeLaCarte, ecriture, enregistrable }
}

// ── Les appels de la base ──────────────────────────────────────────────────────────────────────────────────────────────

/** Les paramètres de `enregistrer_affectation` : la décision, ses lignes dans l'ordre de la saisie, et l'écriture composée. */
export function parametresDeLEnregistrement(
  dossierId: string, annee: number, versionLue: number | null, j: JugementDeLaCarte,
): { p_dossier_id: string; p_exercice: number; p_version_lue: number | null; p_decision: Record<string, unknown>; p_lignes: Record<string, unknown>[]; p_ecriture: EcritureDAffectation | null } {
  const d = j.decision
  return {
    p_dossier_id: dossierId,
    p_exercice: annee,
    p_version_lue: versionLue,
    p_decision: {
      organe: d.organe,
      nombre_d_associes: d.nombreDAssocies,
      date_decision: d.dateDecision,
      comptes_approuves: d.comptesApprouves,
      date_mise_en_paiement: d.dateMiseEnPaiement,
      reserves_statutaires_distribuables: j.contexte.dossier.reservesStatutairesDistribuables,
    },
    p_lignes: d.lignes.map((l) => ({ origine: l.origine, destination: l.destination, centimes: l.centimes })),
    p_ecriture: j.ecriture,
  }
}

/**
 * Le refus de RETIRER une décision, avant le clic, aux mots de `retirer_affectation` : l'exercice de sa date validé, ou une
 * ligne de son écriture qui n'est plus proposée. Nul : le retrait est offert.
 */
export function refusDuRetrait(lue: LueDeLAffectation, decision: DecisionLue): string | null {
  const figee = exerciceDeLaDateValide(decision.dateDecision, lue.anneesValidees)
    || lue.brouillon.some((e) => e.affectationId === decision.id && e.statut !== 'proposee')
  return figee ? `L’exercice qui contient le ${formatDate(decision.dateDecision)} est validé : une écriture n’y entre plus.` : null
}

// ── Les mots de la confirmation ────────────────────────────────────────────────────────────────────────────────────────

const phraseDeLaLigne = (l: LigneDAffectation): string =>
  `${libelleDeLOrigine(l.origine)} → ${NOMS_DES_DESTINATIONS[l.destination]} : ${formatMoney(l.centimes / 100)}`

/** La confirmation d'un enregistrement : nomme l'exercice, la décision, la répartition, l'écriture et la version remplacée. */
export function confirmationDeLEnregistrement(annee: number, j: JugementDeLaCarte, remplacee: DecisionLue | null): string {
  const d = j.decision
  const tete = `${remplacee ? 'Remplacer' : 'Enregistrer'} la décision du ${formatDate(d.dateDecision)} sur l’exercice ${annee} ?`
  const organe = `${LIBELLES_DES_ORGANES[d.organe]} — ${d.comptesApprouves ? 'comptes approuvés' : 'comptes non approuvés : aucune affectation, aucune écriture'}.`
  const lignes = d.lignes.map(phraseDeLaLigne)
  const e = j.ecriture
  const ecriture = e === null ? [] : [
    `Écriture au journal ${e.journal}, datée du ${formatDate(e.date)}, dans l’exercice ${anneeDe(e.date)} :`,
    ...e.lignes.map((l) => `${l.sens === 'debit' ? 'Débit' : 'Crédit'} ${l.compte} : ${formatMoney(l.centimes / 100)}`),
  ]
  const remplace = remplacee
    ? [`Remplace la version ${remplacee.version} (décision du ${formatDate(remplacee.dateDecision)}) et réécrit son écriture ; elle reste lisible, remplacée.`]
    : []
  return [tete, organe, ...lignes, ...ecriture, ...remplace].join('\n')
}

/** La confirmation d'un retrait : nomme la décision et ce qui s'en va avec elle. */
export function confirmationDuRetrait(annee: number, d: DecisionLue): string {
  const ecriture = d.comptesApprouves && d.lignes.length > 0
    ? `Son écriture du ${formatDate(d.dateDecision)} (journal OD) est retirée des Écritures.` : 'Elle n’a pas d’écriture.'
  return `Retirer la décision du ${formatDate(d.dateDecision)} (version ${d.version}) de l’exercice ${annee} ?\n${ecriture}\n`
    + 'La décision reste lisible, retirée : l’exercice peut recevoir une décision nouvelle.'
}
