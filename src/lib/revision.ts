import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import { calculerBalance } from './ecritures'
import { remplirModele } from './encaissementsFactures'
import { ouvertureDeLExercice } from './reportDesSoldes'
import { controlesParCycle, cycleDuCompte, cyclesDuDossier, type CycleRevision } from './revisionCycles'
import {
  preuveDuCompte, texteJsonb, octetsJsonb, type DocumentPourRevision, type DonneesDesPreuves, type InstantaneDePreuve,
  type PiecePourRevision, type PreuveProposee,
} from './revisionPreuves'
import {
  BLANCS_D_UN_TEXTE, ETATS_DE_DECISION, LONGUEUR_MAX_MOTIF, LONGUEUR_MAX_PRECISION, MOTIF_COMPTE_DE_BILAN,
  PORTEES_DE_DECISION, refusDeLOuverture, soldeDuCompteCentimes, TAILLE_MAX_PREUVE_APPLICATION,
} from './revisionSoldes'
import type {
  ANouveau, Categorie, DocumentDivers, EcritureBrouillon, EtatDecisionRevision, Piece, PorteeDecisionRevision,
  RevisionJustification, RevisionPreuve, SoldeReporte,
} from './types'

// LA RÉVISION D'UN EXERCICE, TELLE QUE L'ÉCRAN LA DIRA (ligne 41, étape R2 ; conception du 09/10/2026, HISTORIQUE.md,
// « LA RÉVISION DES COMPTES : LA CONCEPTION », § 3.4, 3.5, 3.7 et 5.1). Un module PUR : il ne lit rien en base,
// n'appelle personne et ne lit pas l'horloge — l'écran (étape R3) lui donne ce qu'il a lu, et l'année en cours à Paris.
//
// La base des soldes révisés est en production depuis l'étape R1 (migration revision_des_soldes) : une DÉCISION par
// solde de compte de bilan, immuable, qui se remplace par une autre et cite ses pièces par leur empreinte ; seule
// `justifier_solde` l'écrit, après treize refus. Ce module dit, avant le clic :
//   - l'ÉTAT de l'exercice pour la révision — en cours, antérieur à la reprise, en attente de la validation du
//     précédent, ou révisable —, sous les mots de la base (`etatDeLExerciceEnRevision`) ;
//   - les SOLDES de bilan de l'exercice, comptés comme la base les compte (`soldesDeLExercice`, le jumeau en lot de
//     `soldeDuCompteCentimes`) ;
//   - l'ÉTAT DE CHAQUE SOLDE, DÉDUIT et jamais stocké — à justifier, justifié, accepté, en anomalie, à revoir… —, depuis
//     la chaîne de ses décisions, le solde du jour et l'empreinte de chaque source citée (`etatDuSolde`, § 3.5) ;
//   - la PREUVE que l'application propose pour chaque compte (lib/revisionPreuves.ts) ;
//   - ce que `justifier_solde` REFUSERAIT, dans son ordre et sous ses mots (`refusDeJustifierSolde`), confronté au texte
//     de la fonction et rejoué sur l'essai de l'étape R1 ; et ce que `garder_source_citee` refuserait d'une pièce ou
//     d'un document cité (`refusDuRetraitDUneSource`) ;
//   - la MÉMOIRE d'un exercice à l'autre : la justification permanente de l'exercice précédent, proposée — jamais
//     recopiée seule —, son solde et ses empreintes relus (`repriseProposee`, § 3.7) ;
//   - les CYCLES du dossier, leurs comptes et les contrôles existants qui s'y rangent (lib/revisionCycles.ts).
//
// LES HYPOTHÈSES DE L'ÉTAPE R1, que le cabinet n'a pas encore tranchées (questions du 09/10/2026), vivent dans la base ;
// ce module les reprend telles qu'elles y sont, sans en trancher aucune à son tour :
//   - Q3 (un solde s'accepte sans pièce, sur un motif obligatoire) : l'état `accepte` et le refus « Un solde accepté
//     sans pièce se motive. » ;
//   - Q2 (tout membre affecté au dossier prépare) : l'accès est un paramètre, `accesAuDossier`, que l'écran tient de la
//     session ; la revue du chef (étape R4) n'est pas ce refus ;
//   - Q11 (seul un exercice terminé se révise) : l'état « en cours », le refus 3, et chaque solde « en attente » ;
//   - Q8 (une source citée ne se supprime plus et ne change plus de dossier) : `refusDuRetraitDUneSource` dit le refus
//     de la base avant le clic ; une source citée que l'écran ne retrouve pas fait revoir la décision — ce qui vaudrait
//     encore si le cabinet répondait autrement ;
//   - Q7 (la suppression d'un dossier emporte sa révision) : rien ici.
// Rien de ce module ne dépend des questions encore ouvertes : Q1 (la révision bloque-t-elle la validation ?) est
// l'étape R6, et rien ici ne refuse une validation ; Q10 (l'acceptation en lot) n'a pas de fonction — chaque décision se
// compose compte par compte.

// ── L'exercice ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'ouverture de l'exercice demande de lire : la reprise, les soldes reportés, les exercices validés, le brouillon. */
export interface OuvertureLue {
  reprise: readonly ANouveau[]
  reportes: readonly SoldeReporte[]
  anneesValidees: readonly number[]
  // Tout le brouillon du dossier : une écriture d'un exercice antérieur dit qu'une activité le précède.
  ecritures: readonly Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant'>[]
}

// L'EXERCICE, POUR LA RÉVISION, dans l'ordre des refus de la base : hors des bornes (2), pas terminé à Paris (3),
// antérieur à la reprise (6), en attente de la validation du précédent (7). Sinon il se révise — validé ou non : après
// la validation, la révision reste ouverte, et ses décisions le disent (§ 3.9).
export type EtatDeLExerciceEnRevision =
  | { type: 'revisable' }
  | { type: 'invalide' }
  | { type: 'en-cours' }
  | { type: 'anterieur-a-la-reprise' }
  | { type: 'en-attente'; exercice: number }

export function etatDeLExerciceEnRevision(annee: number, anneeCourante: number, o: OuvertureLue): EtatDeLExerciceEnRevision {
  if (annee < 2000 || annee > 2100) return { type: 'invalide' }
  if (annee >= anneeCourante) return { type: 'en-cours' }
  const refus = refusDeLOuverture(annee, o)
  if (refus === 'anterieur-a-la-reprise') return { type: 'anterieur-a-la-reprise' }
  if (refus === 'en-attente') return { type: 'en-attente', exercice: annee - 1 }
  return { type: 'revisable' }
}

/** La phrase de la base quand l'exercice ne se révise pas — celle de son refus —, nulle quand il se révise. */
export function messageDeLExercice(annee: number, etat: EtatDeLExerciceEnRevision): string | null {
  switch (etat.type) {
    case 'revisable': return null
    case 'invalide': return modele('exercice_invalide')
    case 'en-cours': return remplirModele(modele('exercice_en_cours'), [String(annee)])
    case 'anterieur-a-la-reprise': return remplirModele(modele('anterieur_a_la_reprise'), [String(annee)])
    case 'en-attente': return remplirModele(modele('ouverture_en_attente'), [String(annee - 1), String(annee)])
  }
}

// ── Les soldes de l'exercice ──────────────────────────────────────────────────────────────────────────────────────

export interface SoldeDeLExercice {
  compte: string
  soldeCentimes: number
}

// LES SOLDES DE TOUS LES COMPTES À LA FIN DE L'EXERCICE, en centimes, débit positif : `soldeDuCompteCentimes` en lot —
// les écritures datées de l'exercice et son ouverture, chaque ligne pour Math.round(montant × 100). Un compte a un solde
// dès qu'une ligne le porte, nul compris : un compte soldé reste dans la liste, et dit « solde nul ».
// `revision.test.ts` confronte chaque solde à `soldeDuCompteCentimes`, que la table relevée sur la base éprouve.
export function soldesDeLExercice(
  annee: number,
  d: Pick<OuvertureLue, 'reprise' | 'reportes' | 'ecritures'>,
): Map<string, number> {
  const debut = `${annee}-01-01`
  const fin = `${annee}-12-31`
  const soldes = new Map<string, number>()
  const porter = (l: { compte: string; sens: string; montant: number }) =>
    soldes.set(l.compte, (soldes.get(l.compte) ?? 0) + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100))
  for (const e of d.ecritures) if (e.date >= debut && e.date <= fin) porter(e)
  for (const a of ouvertureDeLExercice(d.reprise, d.reportes, annee)) porter(a)
  return soldes
}

// ── Les décisions ─────────────────────────────────────────────────────────────────────────────────────────────────

// La base compare un uuid sans la casse ; PostgREST les rend en minuscules, mais une valeur saisie ou recopiée peut
// ne pas l'être.
const minuscules = (id: string) => id.toLowerCase()

// LA CHAÎNE DES DÉCISIONS D'UN COMPTE POUR UN EXERCICE : la première (qui ne remplace rien), puis celle qui la remplace,
// et ainsi de suite ; la COURANTE est celle qu'aucune ne remplace. Aucun horodatage ne départage : la chaîne est l'ordre
// (§ 3.3). La base la garde linéaire — une seule première, une seule suite à chacune, une suite du même compte et du
// même exercice —, mais l'écran ne l'affirme que s'il la relit telle : une chaîne qui ne se suit pas (une lecture
// fautive) n'a pas de courante, et son solde est à revoir.
export interface ChaineDeDecisions {
  // De la plus ancienne à la courante ; dans l'ordre de leur création quand la chaîne ne se lit pas.
  decisions: RevisionJustification[]
  courante: RevisionJustification | null
  lisible: boolean
}

export function chaineDesDecisions(
  toutes: readonly RevisionJustification[],
  annee: number,
  compte: string,
): ChaineDeDecisions {
  const duCompte = toutes.filter((j) => j.annee === annee && j.compte === compte)
  const suites = new Map<string, RevisionJustification[]>()
  for (const j of duCompte) {
    if (j.remplace_id !== null) suites.set(minuscules(j.remplace_id), [...(suites.get(minuscules(j.remplace_id)) ?? []), j])
  }
  // De la première, de suite en suite, jusqu'à une décision déjà vue. La chaîne se lit quand ce chemin passe par chaque
  // décision et s'arrête de lui-même : deux premières, deux suites d'une même décision ou un maillon manquant laissent
  // une décision hors du chemin ; une boucle (une décision lue deux fois) l'empêche de s'arrêter.
  const chaine: RevisionJustification[] = []
  let suivante = duCompte.find((j) => j.remplace_id === null)
  while (suivante !== undefined && !chaine.includes(suivante)) {
    chaine.push(suivante)
    suivante = suites.get(minuscules(suivante.id))?.[0]
  }
  if (chaine.length === duCompte.length && suivante === undefined) {
    return { decisions: chaine, courante: chaine.at(-1) ?? null, lisible: true }
  }
  const parCreation = [...duCompte].sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
  return { decisions: parCreation, courante: null, lisible: false }
}

// ── Les sources citées ────────────────────────────────────────────────────────────────────────────────────────────

// CE QU'UNE CITATION PROUVE ENCORE. La base a recopié l'empreinte de la source au moment de la citation — un SHA-256 en
// minuscules hexadécimales, ou rien (`justifier_solde`) — ; l'écran relit celle du jour sous la même règle :
//   - `intacte` : la source porte encore l'empreinte citée ;
//   - `sans-empreinte` : la source n'en portait pas à la citation — rien ne se vérifie, et l'écran le dit ;
//   - `changee` : elle en porte une autre ;
//   - `disparue` : elle n'en porte plus ;
//   - `introuvable` : la source n'est pas dans ce que l'écran a lu — une lecture qui l'a manquée, ou un fichier du cabinet
//     (étape R8), qui ne se lit pas encore.
export type EtatDeLaCitation = 'intacte' | 'sans-empreinte' | 'changee' | 'disparue' | 'introuvable'

export interface CitationVerifiee {
  preuve: RevisionPreuve
  etat: EtatDeLaCitation
  empreinteDuJour: string | null
}

const empreinteValide = (h: string | null | undefined) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null)

export function verifierCitation(
  preuve: RevisionPreuve,
  pieces: ReadonlyMap<string, Pick<PiecePourRevision, 'storage_hash'>>,
  documents: ReadonlyMap<string, Pick<DocumentPourRevision, 'storage_hash'>>,
): CitationVerifiee {
  const source = preuve.piece_id !== null ? pieces.get(minuscules(preuve.piece_id))
    : preuve.document_id !== null ? documents.get(minuscules(preuve.document_id)) : undefined
  if (source === undefined) return { preuve, etat: 'introuvable', empreinteDuJour: null }
  const duJour = empreinteValide(source.storage_hash)
  if (preuve.empreinte === null) return { preuve, etat: 'sans-empreinte', empreinteDuJour: duJour }
  if (duJour === null) return { preuve, etat: 'disparue', empreinteDuJour: null }
  return { preuve, etat: duJour === preuve.empreinte ? 'intacte' : 'changee', empreinteDuJour: duJour }
}

// ── L'état d'un solde ─────────────────────────────────────────────────────────────────────────────────────────────

// L'ÉTAT D'UN SOLDE DE BILAN, DÉDUIT DE SA DERNIÈRE DÉCISION ET DU SOLDE DU JOUR, jamais stocké (§ 3.5) :
//   - `en-attente` : l'exercice ne se révise pas — son ouverture attend, il est dans les comptes repris, ou il n'est pas
//     terminé (hypothèse Q11) ;
//   - `solde-nul` : solde nul et aucune décision — rien à justifier ;
//   - `a-justifier` : solde non nul et aucune décision ;
//   - `justifie`, `accepte`, `anomalie` : la décision courante, quand son solde est celui du jour et que chaque source
//     citée porte encore l'empreinte citée ;
//   - `a-revoir` : la décision courante ne tient plus — son solde n'est plus celui du jour (une écriture a changé avant
//     la validation), ou une source citée a changé d'empreinte, n'en a plus, ou ne se retrouve plus ; ou la chaîne ne se
//     lit pas. La règle vaut pour UNE ANOMALIE aussi : « à revoir dès que les deux divergent » (§ 1.9, règle 2), et la
//     ligne « à revoir » du § 3.5 parle de toute décision courante — une anomalie dont le solde a changé a peut-être été
//     corrigée, et le cabinet la regarde de nouveau.
export const ETATS_DU_SOLDE = ['en-attente', 'solde-nul', 'a-justifier', 'justifie', 'accepte', 'anomalie', 'a-revoir'] as const
export type EtatDuSolde = (typeof ETATS_DU_SOLDE)[number]

export type CauseARevoir = 'solde-change' | 'empreinte-changee' | 'empreinte-disparue' | 'source-introuvable' | 'chaine-illisible'

export function etatDuSolde(args: {
  revisable: boolean
  soldeCentimes: number
  chaine: ChaineDeDecisions
  // Les citations de la décision courante, relues.
  citations: readonly CitationVerifiee[]
}): { etat: EtatDuSolde; causes: CauseARevoir[] } {
  if (!args.revisable) return { etat: 'en-attente', causes: [] }
  if (!args.chaine.lisible) return { etat: 'a-revoir', causes: ['chaine-illisible'] }
  const courante = args.chaine.courante
  if (courante === null) return { etat: args.soldeCentimes === 0 ? 'solde-nul' : 'a-justifier', causes: [] }
  const causes: CauseARevoir[] = []
  // La base a écrit le solde au centime (`numeric(16,2)`) : il se relit en centimes.
  if (Math.round(courante.solde * 100) !== args.soldeCentimes) causes.push('solde-change')
  for (const c of args.citations) {
    const cause: CauseARevoir | null = c.etat === 'changee' ? 'empreinte-changee' : c.etat === 'disparue' ? 'empreinte-disparue'
      : c.etat === 'introuvable' ? 'source-introuvable' : null
    if (cause !== null && !causes.includes(cause)) causes.push(cause)
  }
  if (causes.length > 0) return { etat: 'a-revoir', causes }
  return { etat: courante.etat, causes: [] }
}

// UNE DÉCISION PRISE APRÈS LA VALIDATION DE SON EXERCICE : la révision reste ouverte, et la décision le dit (§ 3.5). Les
// deux instants sont les `now()` de leurs transactions, comparés à la milliseconde, comme le reste de l'application
// (lib/transmissionsFactures.ts) : une décision dont la transaction a commencé avant la validation, puis a attendu son
// verrou, se lit « avant » — son solde n'en est pas moins le solde définitif, que le refus 9 a exigé.
export function apresLaValidation(decision: Pick<RevisionJustification, 'cree_le'>, valideLe: string | null): boolean {
  return valideLe !== null && Date.parse(decision.cree_le) > Date.parse(valideLe)
}

// ── Ce que `justifier_solde` refuse, dit avant le clic ────────────────────────────────────────────────────────────

// LES REFUS DE `justifier_solde`, DANS L'ORDRE DU TEXTE DE LA FONCTION ET SOUS SES MOTS — le RAISE de PL/pgSQL, chaque
// « % » rempli par sa valeur (`remplirModele`). `revision.test.ts` lit la dernière définition exportée et exige la même
// liste, mot pour mot ; `revisionEssai.test.ts` rejoue chaque appel de supabase/essais/revisionSoldes.sql — l'essai que
// la production a passé, 165 verdicts sur 165 — et exige du module le refus, ou l'absence de refus, que l'essai attend.
// Le refus 4 (un dossier de travail finalisé) attend l'étape R9 : sa place dans l'ordre est gardée en base, et il
// rejoindra cette liste avec elle.
export const REFUS_JUSTIFIER_SOLDE = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: "L'exercice % n'est pas terminé : ses soldes se justifient une fois clos." },
  { cle: 'compte_hors_bilan', refus: 5, modele: 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.' },
  { cle: 'anterieur_a_la_reprise', refus: 6, modele: "L'exercice % précède la reprise du dossier : il est dans les comptes repris." },
  { cle: 'ouverture_en_attente', refus: 7, modele: "L'exercice % n'est pas validé : les soldes de % ne sont pas encore définitifs." },
  { cle: 'etat_invalide', refus: 8, modele: 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.' },
  { cle: 'portee_invalide', refus: 8, modele: "Une décision vaut pour l'exercice, ou de façon permanente." },
  { cle: 'anomalie_sans_motif', refus: 8, modele: 'Une anomalie se motive.' },
  { cle: 'accepte_sans_motif', refus: 8, modele: 'Un solde accepté sans pièce se motive.' },
  { cle: 'motif_blanc', refus: 8, modele: 'Un motif ne se compose pas que de blancs : le laisser vide.' },
  { cle: 'motif_trop_long', refus: 8, modele: 'Un motif tient en 4 000 caractères au plus.' },
  { cle: 'solde_illisible', refus: 9, modele: "Le solde annoncé n'est pas un montant au centime." },
  { cle: 'solde_change', refus: 9, modele: 'Le solde du compte % a changé : au 31/12/%, il %.' },
  { cle: 'remplacement_hors_compte', refus: 10, modele: "La décision à remplacer n'est pas une décision du compte % pour l'exercice %." },
  { cle: 'remplacement_perime', refus: 10, modele: 'Une autre décision a été prise sur ce compte depuis : relire avant de décider.' },
  { cle: 'reprise_hors_compte', refus: 11, modele: "Une reprise vise une décision du compte % pour l'exercice %." },
  { cle: 'reprise_non_permanente', refus: 11, modele: "Seule une justification permanente se reprend d'un exercice à l'autre." },
  { cle: 'reprise_remplacee', refus: 11, modele: 'La décision de % reprise a été remplacée depuis : relire avant de la reprendre.' },
  {
    cle: 'preuves_illisibles', refus: 12,
    modele: 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.',
  },
  { cle: 'precision_blanche', refus: 12, modele: 'Une précision ne se compose pas que de blancs : la laisser vide.' },
  { cle: 'precision_trop_longue', refus: 12, modele: 'Une précision tient en 500 caractères au plus.' },
  { cle: 'source_en_double', refus: 12, modele: 'Une même pièce, ou un même document, est citée deux fois.' },
  { cle: 'source_hors_dossier', refus: 12, modele: "Une pièce ou un document cité n'est pas de ce dossier." },
  {
    cle: 'preuve_application_illisible', refus: 12,
    modele: "La preuve de l'application est illisible : un objet, non vide, de 64 Kio au plus.",
  },
  {
    cle: 'justifie_sans_preuve', refus: 13,
    modele: "Un solde justifié cite au moins une pièce, un document ou la preuve de l'application.",
  },
] as const

export type CleRefusJustification = (typeof REFUS_JUSTIFIER_SOLDE)[number]['cle']

export interface RefusDeJustification {
  cle: CleRefusJustification
  // Le numéro du refus dans l'ordre de la fonction (1 à 13).
  refus: number
  // Le code SQLSTATE que la base lève : 42501 pour l'accès, 22023 pour les autres.
  code: '42501' | '22023'
  message: string
}

function modele(cle: CleRefusJustification): string {
  return (REFUS_JUSTIFIER_SOLDE.find((r) => r.cle === cle) as (typeof REFUS_JUSTIFIER_SOLDE)[number]).modele
}

function refus(cle: CleRefusJustification, ...valeurs: string[]): RefusDeJustification {
  const r = REFUS_JUSTIFIER_SOLDE.find((x) => x.cle === cle) as (typeof REFUS_JUSTIFIER_SOLDE)[number]
  return { cle, refus: r.refus, code: cle === 'acces' ? '42501' : '22023', message: remplirModele(r.modele, valeurs) }
}

// Un montant comme la base l'écrit dans le refus 9 : `replace(to_char(abs(v), 'FM99999999999990.00'), '.', ',')` — au
// centime, sans séparateur de milliers, la virgule décimale ; au-delà de quatorze chiffres avant la virgule, to_char
// n'écrit que des dièses (relevé en production le 10/10/2026 : « ##############,## » à quinze chiffres,
// « 99999999999999,99 » à quatorze).
export function soldeCommeLaBase(c: number): string {
  const a = Math.abs(c)
  const entier = Math.floor(a / 100)
  if (entier >= 100_000_000_000_000) return '##############,##'
  return `${entier},${String(a % 100).padStart(2, '0')}`
}

/** Les arguments de `justifier_solde`, tels que supabase-js les envoie : les onze, toujours, nuls plutôt qu'absents. */
export interface ArgumentsJustifierSolde {
  p_dossier_id: string
  // Un entier : l'exercice de l'en-tête. PostgREST refuserait un nombre décimal avant même d'appeler la fonction.
  p_annee: number | null
  p_compte: string | null
  p_solde: number | null
  p_etat: string | null
  p_motif: string | null
  p_portee: string | null
  // Ce qui part en jsonb : la base en juge la forme (refus 12), donc le module la juge sur la valeur telle qu'envoyée.
  p_preuves: unknown
  p_preuve_application: unknown
  p_remplace_id: string | null
  p_reprise_de: string | null
}

/** Ce que l'écran a lu du dossier pour dire les refus : les décisions et les sources du dossier ouvert, EN ENTIER. */
export interface ContexteDeJustification extends OuvertureLue {
  // L'appelant est-il `admin_du_dossier` du dossier annoncé — un membre du cabinet affecté, ou le chef ? L'écran le
  // tient de la session ; un dossier qui n'existe pas se refuse comme un dossier interdit. Hypothèse Q2 : tout membre
  // affecté PRÉPARE, donc écrit la décision d'un solde ; si le cabinet répondait autrement, c'est ce booléen qui ne
  // suffirait plus, et la base le dirait la première.
  accesAuDossier: boolean
  // L'année en cours à Paris (`aujourdHuiAParis`) : la base la lit ainsi.
  anneeCourante: number
  // Toutes les décisions du dossier, tous exercices : le remplacement lit l'exercice, la reprise le précédent.
  decisions: readonly Pick<RevisionJustification, 'id' | 'annee' | 'compte' | 'portee' | 'remplace_id'>[]
  pieces: readonly Pick<Piece, 'id'>[]
  documents: readonly Pick<DocumentDivers, 'id'>[]
}

// Un texte qui ne dit rien : la base en ôte les blancs (`btrim(…, E' \t\n\r')`) et le trouve vide. Ces blancs-là
// seulement — une espace insécable ou un saut de page restent un texte (relevé en production le 10/10/2026).
const queDesBlancs = (t: string) => [...t].every((c) => BLANCS_D_UN_TEXTE.includes(c))

// Les caractères comme `length` les compte en base : des points de code, pas des unités UTF-16 (« 😀 » en vaut un).
const caracteres = (t: string) => [...t].length

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLES_D_UNE_PREUVE = ['piece_id', 'document_id', 'precision']

// Ce qu'une valeur devient une fois envoyée en jsonb : JSON.stringify — `undefined` disparaît, NaN devient null.
function commeEnvoye(v: unknown): unknown {
  const json = JSON.stringify(v)
  return json === undefined ? null : JSON.parse(json)
}
const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// `->>` rend nul une clé absente comme une valeur JSON null ; toute autre valeur est un texte, qui ne passe la forme
// d'un uuid que si c'est une chaîne qui l'a (relevé en production : 12, true, un objet, une liste rendent leur texte).
const presente = (v: unknown) => v !== undefined && v !== null

// Les centimes d'un solde annoncé, lus sur le décimal que la base reçoit : nul quand ce n'est pas un montant au centime
// de moins de cent mille milliards d'euros — le refus 9 (`p_solde <> round(p_solde, 2)`, `abs(p_solde) < 1e14`). Le
// décimal est celui que JSON.stringify écrit, sans exposant comme la base le lit : 0,1 + 0,2 n'est pas au centime.
export function centimesDuSoldeAnnonce(solde: number | null): number | null {
  if (solde === null || !Number.isFinite(solde) || !(Math.abs(solde) < 1e14)) return null
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texteJsonb(solde) ?? '')
  if (!m) return null
  // JavaScript écrit le plus court décimal qui relit le nombre : aucune fraction ne finit par un zéro, et sa longueur
  // est le nombre de décimales que la base voit.
  const [, moins, entier, fraction = ''] = m
  if (fraction.length > 2) return null
  const c = Number(entier) * 100 + Number(fraction.padEnd(2, '0'))
  return moins ? -c : c
}

/**
 * Ce que `justifier_solde` refuserait de ces arguments, le premier refus dans son ordre, avec son code et ses mots ; nul
 * quand elle écrirait la décision. Les soldes se comptent comme elle les compte (`soldeDuCompteCentimes`), l'ouverture
 * se juge comme elle la juge (`refusDeLOuverture`), la forme des preuves et de l'instantané se lit comme elle la lit
 * (`texteJsonb`). Le refus 1 dépend de la session (`accesAuDossier`) ; aucun autre ne dépend de qui clique.
 */
export function refusDeJustifierSolde(a: ArgumentsJustifierSolde, c: ContexteDeJustification): RefusDeJustification | null {
  // 1. L'accès, sur le dossier annoncé.
  if (!c.accesAuDossier) return refus('acces')
  // 2.
  const annee = a.p_annee
  // Un NaN part en JSON null, comme une année absente.
  if (annee === null || !Number.isFinite(annee) || annee < 2000 || annee > 2100) return refus('exercice_invalide')
  // 3. L'exercice en cours, l'année lue à Paris (hypothèse Q11).
  if (annee >= c.anneeCourante) return refus('exercice_en_cours', String(annee))
  // 5.
  const compte = a.p_compte
  if (compte === null || !MOTIF_COMPTE_DE_BILAN.test(compte)) return refus('compte_hors_bilan')
  // 6. et 7. L'ouverture de l'exercice.
  const ouverture = refusDeLOuverture(annee, c)
  if (ouverture === 'anterieur-a-la-reprise') return refus('anterieur_a_la_reprise', String(annee))
  if (ouverture === 'en-attente') return refus('ouverture_en_attente', String(annee - 1), String(annee))
  // 8. L'état, la portée, le motif (hypothèse Q3 : un solde accepté sans pièce se motive).
  if (a.p_etat === null || !(ETATS_DE_DECISION as readonly string[]).includes(a.p_etat)) return refus('etat_invalide')
  if (a.p_portee === null || !(PORTEES_DE_DECISION as readonly string[]).includes(a.p_portee)) return refus('portee_invalide')
  const motifVide = a.p_motif === null || queDesBlancs(a.p_motif)
  if (a.p_etat === 'anomalie' && motifVide) return refus('anomalie_sans_motif')
  if (a.p_etat === 'accepte' && motifVide) return refus('accepte_sans_motif')
  if (a.p_motif !== null && queDesBlancs(a.p_motif)) return refus('motif_blanc')
  if (a.p_motif !== null && caracteres(a.p_motif) > LONGUEUR_MAX_MOTIF) return refus('motif_trop_long')
  // 9. Le solde annoncé, au centime, puis celui des écritures.
  const annonce = centimesDuSoldeAnnonce(a.p_solde)
  if (annonce === null) return refus('solde_illisible')
  const duJour = soldeDuCompteCentimes(compte, annee, c)
  if (annonce !== duJour) {
    return refus('solde_change', compte, String(annee),
      duJour === 0 ? 'est nul' : `est de ${soldeCommeLaBase(duJour)} € au ${duJour > 0 ? 'débit' : 'crédit'}`)
  }
  // 10. La décision remplacée : une décision du compte pour l'exercice, et la courante — ou rien s'il n'y en a pas.
  const remplacees = new Set(c.decisions.filter((j) => j.remplace_id !== null).map((j) => minuscules(j.remplace_id as string)))
  const duCompte = c.decisions.filter((j) => j.annee === annee && j.compte === compte)
  const courante = duCompte.find((j) => !remplacees.has(minuscules(j.id)))?.id ?? null
  if (a.p_remplace_id !== null && !duCompte.some((j) => minuscules(j.id) === minuscules(a.p_remplace_id as string))) {
    return refus('remplacement_hors_compte', compte, String(annee))
  }
  if ((a.p_remplace_id === null ? null : minuscules(a.p_remplace_id)) !== (courante === null ? null : minuscules(courante))) {
    return refus('remplacement_perime')
  }
  // 11. La reprise : la justification permanente COURANTE du même compte à l'exercice précédent.
  if (a.p_reprise_de !== null) {
    const cible = c.decisions.find((j) => minuscules(j.id) === minuscules(a.p_reprise_de as string)
      && j.compte === compte && j.annee === annee - 1)
    if (!cible) return refus('reprise_hors_compte', compte, String(annee - 1))
    if (cible.portee !== 'permanente') return refus('reprise_non_permanente')
    if (remplacees.has(minuscules(cible.id))) return refus('reprise_remplacee', String(annee - 1))
  }
  // 12. Les preuves, telles que le jsonb les reçoit ; puis l'instantané.
  const preuvesEnvoyees = commeEnvoye(a.p_preuves)
  const preuves = preuvesEnvoyees === null ? [] : preuvesEnvoyees
  if (!Array.isArray(preuves) || !preuves.every((p) => estObjet(p)
    && Object.keys(p).every((cle) => CLES_D_UNE_PREUVE.includes(cle))
    && (p.precision === undefined || p.precision === null || typeof p.precision === 'string')
    && [p.piece_id, p.document_id].filter(presente).length === 1
    && [p.piece_id, p.document_id].some((id) => typeof id === 'string' && FORME_UUID.test(id)))) {
    return refus('preuves_illisibles')
  }
  const lues = preuves as { piece_id?: string | null; document_id?: string | null; precision?: string | null }[]
  if (lues.some((p) => typeof p.precision === 'string' && queDesBlancs(p.precision))) return refus('precision_blanche')
  if (lues.some((p) => typeof p.precision === 'string' && caracteres(p.precision) > LONGUEUR_MAX_PRECISION)) {
    return refus('precision_trop_longue')
  }
  const cles = lues.map((p) => `${minuscules(p.piece_id ?? '')}|${minuscules(p.document_id ?? '')}`)
  if (new Set(cles).size !== cles.length) return refus('source_en_double')
  const pieces = new Set(c.pieces.map((p) => minuscules(p.id)))
  const documents = new Set(c.documents.map((x) => minuscules(x.id)))
  if (!lues.every((p) => (presente(p.piece_id) ? pieces.has(minuscules(p.piece_id as string)) : documents.has(minuscules(p.document_id as string))))) {
    return refus('source_hors_dossier')
  }
  const instantane = commeEnvoye(a.p_preuve_application)
  if (instantane !== null && (!estObjet(instantane) || Object.keys(instantane).length === 0
    || octetsJsonb(instantane) > TAILLE_MAX_PREUVE_APPLICATION)) {
    return refus('preuve_application_illisible')
  }
  // 13.
  if (a.p_etat === 'justifie' && lues.length === 0 && instantane === null) return refus('justifie_sans_preuve')
  return null
}

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────

/** Une source citée, telle que l'écran la saisit : une pièce OU un document du dossier, et ce qu'il faut y regarder. */
export interface SourceCitee {
  pieceId: string | null
  documentId: string | null
  precision: string | null
}

/** Une décision telle que l'écran la compose. */
export interface DecisionComposee {
  compte: string
  // Le solde que l'écran montre — celui des écritures, `soldeDuCompteCentimes` — : la base refuse tout autre.
  soldeCentimes: number
  etat: EtatDecisionRevision
  motif: string | null
  portee: PorteeDecisionRevision
  sources: readonly SourceCitee[]
  // L'instantané de la preuve de l'application (`instantaneDeLaPreuve`), quand le cabinet la retient.
  preuveApplication: InstantaneDePreuve | null
  remplaceId: string | null
  repriseDe: string | null
}

/**
 * Les onze arguments de `justifier_solde`, nuls plutôt qu'absents — supabase-js omettrait une clé `undefined`, et la
 * fonction ne se trouverait pas. Un motif ou une précision faits de blancs partent NULS : la base dirait de les laisser
 * vides, et c'est ce qu'ils disent. Le solde part en euros, des centimes divisés par cent : un décimal à deux chiffres
 * au plus, que la base lit au centime.
 */
export function argumentsDeJustifierSolde(dossierId: string, annee: number, d: DecisionComposee): ArgumentsJustifierSolde {
  const texteOuNul = (t: string | null) => (t === null || queDesBlancs(t) ? null : t)
  return {
    p_dossier_id: dossierId,
    p_annee: annee,
    p_compte: d.compte,
    p_solde: d.soldeCentimes / 100,
    p_etat: d.etat,
    p_motif: texteOuNul(d.motif),
    p_portee: d.portee,
    p_preuves: d.sources.map((s) => {
      const precision = texteOuNul(s.precision)
      const source = s.pieceId !== null ? { piece_id: s.pieceId } : { document_id: s.documentId }
      return precision === null ? source : { ...source, precision }
    }),
    p_preuve_application: d.preuveApplication,
    p_remplace_id: d.remplaceId,
    p_reprise_de: d.repriseDe,
  }
}

// ── Une source citée ne se retire plus (hypothèse Q8) ─────────────────────────────────────────────────────────────

// CE QUE `garder_source_citee` REFUSE, DIT AVANT LE CLIC. Une pièce ou un document cité par une décision — même
// remplacée depuis : l'historique garde ses preuves — ne se supprime plus et ne change plus de dossier, sauf avec son
// dossier entier (hypothèse Q8 du cabinet, migration revision_des_soldes). Les écrans qui suppriment (la fiche d'une
// pièce, la suppression groupée des Justificatifs, les Documents) et celui qui transforme un document en pièce le
// diront avant le geste (étape R3), sous les mots de la base : la décision qu'elle nomme est la première par exercice
// puis par compte (`order by j.annee, j.compte`). `revision.test.ts` confronte le message au texte du déclencheur et aux
// contrôles 137 à 140 de l'essai.
export type GesteSurUneSource = 'suppression' | 'changement-de-dossier'

export interface CitationQuiGarde {
  annee: number
  compte: string
}

/** La décision qui garde une pièce ou un document, celle que la base nomme ; nulle quand rien ne le cite. */
export function citationQuiGarde(
  source: { pieceId: string } | { documentId: string },
  decisions: readonly Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[],
  preuves: readonly Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[],
): CitationQuiGarde | null {
  const [colonne, visee] = 'pieceId' in source ? ['piece_id', source.pieceId] as const : ['document_id', source.documentId] as const
  const citantes = new Set(preuves.flatMap((p) => {
    const cite = p[colonne]
    return cite !== null && minuscules(cite) === minuscules(visee) ? [minuscules(p.justification_id)] : []
  }))
  const garde = decisions.filter((j) => citantes.has(minuscules(j.id)))
    .sort((a, b) => a.annee - b.annee || (a.compte < b.compte ? -1 : a.compte > b.compte ? 1 : 0))[0]
  return garde === undefined ? null : { annee: garde.annee, compte: garde.compte }
}

/** Le refus de la base, mot pour mot, pour ce geste sur cette source ; nul quand rien ne la cite. */
export function refusDuRetraitDUneSource(
  source: { pieceId: string } | { documentId: string },
  geste: GesteSurUneSource,
  decisions: readonly Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[],
  preuves: readonly Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[],
): string | null {
  const garde = citationQuiGarde(source, decisions, preuves)
  if (garde === null) return null
  const piece = 'pieceId' in source
  const consequence = geste === 'suppression'
    ? (piece ? 'elle ne se supprime plus' : 'il ne se supprime plus')
    : (piece ? 'elle ne change plus de dossier' : 'il ne change plus de dossier')
  return `${piece ? 'Cette pièce est citée' : 'Ce document est cité'} par la révision du solde du compte ${garde.compte} `
    + `(exercice ${garde.annee}) : ${consequence}, sauf avec son dossier.`
}

// ── La mémoire d'un exercice à l'autre ────────────────────────────────────────────────────────────────────────────

// UNE JUSTIFICATION PERMANENTE SE PROPOSE, ELLE NE SE RECOPIE PAS SEULE (§ 3.7). Quand la décision courante d'un compte
// à l'exercice précédent vaut de façon permanente — un bail, un contrat de prêt, un tableau d'amortissement — et que le
// compte n'a encore aucune décision cet exercice, l'écran propose « Reprendre la justification de N−1 » : un clic crée
// une décision qui la reprend (`reprise_de`) et cite les mêmes sources, leurs empreintes relues. Ce qui a bougé se dit :
// le solde (un emprunt qui s'amortit — l'écran demande quelle ligne du tableau justifie le nouveau), une empreinte. Rien
// pour un solde nul : seuls les soldes non nuls demandent une décision (§ 5.4).
export interface RepriseProposee {
  compte: string
  decision: RevisionJustification
  citations: CitationVerifiee[]
  soldePrecedentCentimes: number
  soldeChange: boolean
  // Les citations dont l'empreinte ne tient plus : changée, disparue, ou la source introuvable.
  empreintesQuiNeTiennentPlus: number
}

export function repriseProposee(
  annee: number,
  compte: string,
  soldeCentimes: number,
  decisions: readonly RevisionJustification[],
  preuves: readonly RevisionPreuve[],
  pieces: ReadonlyMap<string, Pick<PiecePourRevision, 'storage_hash'>>,
  documents: ReadonlyMap<string, Pick<DocumentPourRevision, 'storage_hash'>>,
): RepriseProposee | null {
  if (soldeCentimes === 0) return null
  if (chaineDesDecisions(decisions, annee, compte).decisions.length > 0) return null
  const precedente = chaineDesDecisions(decisions, annee - 1, compte).courante
  if (precedente === null || precedente.portee !== 'permanente') return null
  const citations = preuves.filter((p) => minuscules(p.justification_id) === minuscules(precedente.id))
    .map((p) => verifierCitation(p, pieces, documents))
  const soldePrecedentCentimes = Math.round(precedente.solde * 100)
  return {
    compte, decision: precedente, citations, soldePrecedentCentimes, soldeChange: soldePrecedentCentimes !== soldeCentimes,
    empreintesQuiNeTiennentPlus: citations.filter((x) => x.etat === 'changee' || x.etat === 'disparue' || x.etat === 'introuvable').length,
  }
}

/**
 * La décision que la reprise composerait : l'état, le motif et les sources de la décision reprise, au solde du jour,
 * permanente à son tour — l'exercice suivant pourra la reprendre de nouveau. L'écran la montre AVANT le clic, et le
 * cabinet la change s'il le faut : rien n'est validé ni importé automatiquement. Un fichier du cabinet (étape R8) ne se
 * recite pas d'ici : la base ne l'accepterait pas encore.
 */
export function decisionDeLaReprise(r: RepriseProposee, soldeCentimes: number, preuveApplication: InstantaneDePreuve | null): DecisionComposee {
  return {
    compte: r.compte,
    soldeCentimes,
    etat: r.decision.etat,
    motif: r.decision.motif,
    portee: 'permanente',
    sources: r.citations
      .filter((x) => x.preuve.piece_id !== null || x.preuve.document_id !== null)
      .map((x) => ({ pieceId: x.preuve.piece_id, documentId: x.preuve.document_id, precision: x.preuve.precision })),
    preuveApplication,
    remplaceId: null,
    repriseDe: r.decision.id,
  }
}

// ── La révision d'un exercice ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Tout ce que l'écran lit pour réviser un exercice, EN ENTIER (`lireTout`) : le brouillon, les sources, les décisions
 * et leurs preuves de TOUT le dossier — l'ouverture lit les exercices d'avant, la reprise l'exercice précédent, une
 * citation sa source quel que soit son exercice. Sur une lecture partielle, l'écran passe son motif, et le module
 * n'affirme alors rien — une décision est une écriture, et un état déduit d'une liste tronquée mentirait (§ 4.2).
 */
export interface DonneesDeLaRevision extends DonneesDesPreuves {
  lectureIncomplete: string | null
  categories: readonly Categorie[]
  decisions: readonly RevisionJustification[]
  preuves: readonly RevisionPreuve[]
}

export interface CompteEnRevision {
  compte: string
  libelle: string
  cycle: CycleRevision
  soldeCentimes: number
  etat: EtatDuSolde
  causes: CauseARevoir[]
  chaine: ChaineDeDecisions
  // Les citations de la décision courante, relues.
  citations: CitationVerifiee[]
  // La décision courante a été prise après la validation de l'exercice ; elle reprend celle de l'exercice précédent.
  apresLaValidation: boolean
  repriseDeLExercicePrecedent: boolean
  preuve: PreuveProposee
  reprise: RepriseProposee | null
}

export interface CycleEnRevision<C> {
  cycle: CycleRevision
  // Les comptes de bilan de l'exercice qui s'y rangent, dans l'ordre des comptes.
  comptes: string[]
  // L'état de ses soldes, compté (les tuiles de la carte).
  avancement: Record<EtatDuSolde, number>
  // Les contrôles existants qui s'y rangent, dans l'ordre où l'écran les a donnés.
  controles: C[]
}

export interface RevisionDeLExercice<C> {
  annee: number
  lectureIncomplete: string | null
  // Nul quand la lecture est partielle : rien ne s'en affirme.
  exercice: EtatDeLExerciceEnRevision | null
  // La phrase de la base quand l'exercice ne se révise pas.
  message: string | null
  comptes: CompteEnRevision[]
  // Les comptes qui portent un solde sans être ni de bilan au sens de la base (classes 1 à 5, trois chiffres au moins) ni
  // de résultat : aucun ne se justifie, et la validation les refuse déjà (`report-hors-classes`).
  horsDuMotif: SoldeDeLExercice[]
  cycles: CycleEnRevision<C>[]
  // Les contrôles hors cycle par décision (`CONTROLES_HORS_CYCLE`), et ceux que le rangement ne connaît pas : l'écran
  // les montre à part, jamais ne les tait.
  controlesHorsCycle: C[]
  controlesInconnus: C[]
  avancement: Record<EtatDuSolde, number>
  // Une décision peut-elle se prendre ? Seulement sur une lecture entière d'un exercice qui se révise.
  peutDecider: boolean
}

const avancementVide = () => Object.fromEntries(ETATS_DU_SOLDE.map((e) => [e, 0])) as Record<EtatDuSolde, number>

/**
 * La révision d'un exercice. `controles` : les contrôles existants — points de la Checklist, préalables de la
 * validation — qui ont QUELQUE CHOSE À DIRE sur cet exercice ; l'écran les compose, le module les range (§ 4.2). Sans
 * valeur par défaut : une liste oubliée rangerait les cartes sans leurs contrôles, et pourrait en cacher une.
 */
export function revisionDeLExercice<C extends { id: string }>(d: DonneesDeLaRevision, controles: readonly C[]): RevisionDeLExercice<C> {
  if (d.lectureIncomplete !== null) {
    return {
      annee: d.annee, lectureIncomplete: d.lectureIncomplete, exercice: null, message: null, comptes: [], horsDuMotif: [],
      cycles: [], controlesHorsCycle: [], controlesInconnus: [], avancement: avancementVide(), peutDecider: false,
    }
  }
  const anneesValidees = d.exercicesValides.map((e) => e.annee)
  const ouverture: OuvertureLue = { reprise: d.reprise, reportes: d.reportes, anneesValidees, ecritures: d.ecritures }
  const exercice = etatDeLExerciceEnRevision(d.annee, d.anneeCourante, ouverture)
  const revisable = exercice.type === 'revisable'
  const soldes = soldesDeLExercice(d.annee, ouverture)

  // Les libellés, tels que la balance de l'exercice les donne (lib/ecritures.ts) — le même compte, le même nom.
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  const ouvertureDeLAnnee = ouvertureDeLExercice(d.reprise, d.reportes, d.annee)
  const libelles = new Map(calculerBalance(d.ecritures.filter((e) => e.date >= debut && e.date <= fin), [...d.categories], ouvertureDeLAnnee)
    .map((l) => [l.compte, l.libelle]))

  const comptesDeBilan = new Set([...soldes.keys()].filter((compte) => MOTIF_COMPTE_DE_BILAN.test(compte)))
  for (const j of d.decisions) if (j.annee === d.annee) comptesDeBilan.add(j.compte)
  const pieces = new Map(d.pieces.map((p) => [minuscules(p.id), p]))
  const documents = new Map(d.documents.map((x) => [minuscules(x.id), x]))
  const valideLe = d.exercicesValides.find((e) => e.annee === d.annee)?.valide_le ?? null

  const avancement = avancementVide()
  const comptes: CompteEnRevision[] = [...comptesDeBilan].sort().map((compte) => {
    const soldeCentimes = soldes.get(compte) ?? 0
    const chaine = chaineDesDecisions(d.decisions, d.annee, compte)
    const courante = chaine.courante
    const citations = courante === null ? []
      : d.preuves.filter((p) => minuscules(p.justification_id) === minuscules(courante.id)).map((p) => verifierCitation(p, pieces, documents))
    const { etat, causes } = etatDuSolde({ revisable, soldeCentimes, chaine, citations })
    avancement[etat]++
    return {
      compte,
      libelle: libelles.get(compte) ?? libelleCompteTenu(compte) ?? libelleDuPlanComptable(compte) ?? '—',
      // Un compte de bilan est des classes 1 à 5 : il a toujours un cycle (`revisionCycles.test.ts`).
      cycle: cycleDuCompte(compte) as CycleRevision,
      soldeCentimes,
      etat,
      causes,
      chaine,
      citations,
      apresLaValidation: courante !== null && apresLaValidation(courante, valideLe),
      repriseDeLExercicePrecedent: courante !== null && courante.reprise_de !== null,
      preuve: preuveDuCompte(compte, soldeCentimes, d),
      reprise: revisable ? repriseProposee(d.annee, compte, soldeCentimes, d.decisions, d.preuves, pieces, documents) : null,
    }
  })

  const horsDuMotif = [...soldes].filter(([compte, s]) => s !== 0 && !MOTIF_COMPTE_DE_BILAN.test(compte) && !/^[67]/.test(compte))
    .map(([compte, soldeCentimes]) => ({ compte, soldeCentimes }))
    .sort((a, b) => (a.compte < b.compte ? -1 : a.compte > b.compte ? 1 : 0))
  const ranges = controlesParCycle(controles, d.modele.mode)
  const cycles = cyclesDuDossier({
    mode: d.modele.mode, assujettiTva: d.assujettiTva, nbBiens: d.immobilisations.length, nbEmprunts: d.emprunts.length,
    comptesDeBilan: [...comptesDeBilan], cyclesDesControles: [...ranges.parCycle.keys()],
  }).map((cycle) => {
    const sesComptes = comptes.filter((c) => c.cycle === cycle)
    const sonAvancement = avancementVide()
    for (const c of sesComptes) sonAvancement[c.etat]++
    return { cycle, comptes: sesComptes.map((c) => c.compte), avancement: sonAvancement, controles: ranges.parCycle.get(cycle) ?? [] }
  })

  return {
    annee: d.annee, lectureIncomplete: null, exercice, message: messageDeLExercice(d.annee, exercice), comptes, horsDuMotif,
    cycles, controlesHorsCycle: ranges.horsCycle, controlesInconnus: ranges.inconnus, avancement, peutDecider: revisable,
  }
}
