import { remplirModele } from './encaissementsFactures'
import type { EtatDuSolde, RevisionDeLExercice } from './revision'
import { CYCLES_DE_REVISION, type CycleRevision } from './revisionCycles'
import { octetsJsonb } from './revisionPreuves'
import { BLANCS_D_UN_TEXTE } from './revisionSoldes'
import type {
  AvisRevueRevision, EtatConclusionRevision, NatureNoteRevision, RevisionConclusion, RevisionJustification, RevisionNote,
  RevisionRevue,
} from './types'

// LES CYCLES DE LA RÉVISION : LE PROGRAMME, LA CONCLUSION, LE JOURNAL, LA REVUE (ligne 41, étape R4 ; conception du
// 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA CONCEPTION », § 1.5, 3.3 à 3.5 et 4.4 ; migration
// revision_des_cycles). Un module PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — l'écran lui
// donne ce qu'il a lu, et l'année en cours à Paris. Distinct de la revue analytique (étape R5) : la « revue » est ici
// celle du chef du cabinet sur la conclusion d'un cycle.
//
// On révise par COMPTE pour les soldes de bilan (étapes R1 et R2) et par CYCLE pour le travail et la revue. Le dossier
// de travail contient « un programme de travail adapté » et « une note de synthèse générale » (NP 2300, A9) ; il
// « formalise également les discussions intervenues avec la direction » (A8) ; « La revue de dossier est réalisée par une
// personne ayant la compétence appropriée » (norme de management de la qualité, § 30), et supervision et revue
// « peuvent, en pratique, être réalisées par la même personne » (A30-1). Textes relus sur Légifrance le 10/10/2026.
//
// Ce module dit, avant le clic :
//   - le PROGRAMME de travail PROPOSÉ par cycle (§ 4.4), que le cabinet coche et annote ; la conclusion le garde tel
//     qu'il a été exécuté (`travaux`), relu sans deviner (`lireProgramme`) ;
//   - la CHAÎNE des conclusions d'un cycle, la courante, et les POINTS À SUIVRE que l'exercice précédent a laissés ;
//   - l'ÉTAT DE CHAQUE CYCLE, DÉDUIT et jamais stocké (§ 3.5) — non commencé, en cours, révisé, anomalie, à reprendre,
//     revu, revue périmée —, depuis ses conclusions, sa revue, son journal et l'état de ses soldes (lib/revision.ts) ;
//   - ce que `conclure_cycle`, `noter_revision` et `revoir_cycle` REFUSERAIENT, dans leur ordre et sous leurs mots,
//     confronté au texte des fonctions (`revisionRevue.test.ts`) et rejoué sur l'essai de l'étape
//     (`revisionRevueEssai.test.ts`) ; et les arguments, tels que supabase-js les envoie.
//
// LES HYPOTHÈSES DU CABINET (questions du 09/10/2026, sans réponse), telles que la migration les prend — aucune n'est
// tranchée ici :
//   - Q2, QUI REVOIT : tout membre affecté au dossier prépare (`accesAuDossier`, que l'écran tient de la session) ; seul
//     le chef du cabinet revoit (`chefDuCabinet`, le super-administrateur compris). Le chef peut revoir ce qu'il a
//     préparé, et l'état le dit (`parLAuteur`) ;
//   - Q11 : seul un exercice terminé se révise — ni conclusion, ni note, ni revue sur l'exercice en cours ;
//   - Q6 : figer le dossier de travail est l'étape R9 : aucun refus ici ne la présume ;
//   - Q5 (la mission) : rien ne la présume — la conclusion envisagée d'une attestation, s'il y en a une, est un travail du
//     cycle « ensemble » et s'écrit dans sa conclusion.

// ── Ce que la base admet ──────────────────────────────────────────────────────────────────────────────────────────

export const ETATS_DE_CONCLUSION = ['revise', 'anomalie'] as const satisfies readonly EtatConclusionRevision[]
export const NATURES_DE_NOTE = ['echange_direction', 'consultation', 'travail'] as const satisfies readonly NatureNoteRevision[]
export const AVIS_DE_REVUE = ['approuve', 'a_reprendre'] as const satisfies readonly AvisRevueRevision[]

export const LIBELLE_DE_L_ETAT: Readonly<Record<EtatConclusionRevision, string>> = { revise: 'Révisé', anomalie: 'Anomalie' }
export const LIBELLE_DE_LA_NATURE: Readonly<Record<NatureNoteRevision, string>> = {
  echange_direction: 'Échange avec la direction',
  consultation: 'Consultation',
  travail: 'Travail',
}
export const LIBELLE_DE_L_AVIS: Readonly<Record<AvisRevueRevision, string>> = { approuve: 'Approuvé', a_reprendre: 'À reprendre' }

/** Les longueurs que la base admet, en caractères (et non en unités UTF-16) ; le programme, en octets de son texte JSON. */
export const LONGUEUR_MAX_CONCLUSION = 8000
export const LONGUEUR_MAX_A_SUIVRE = 4000
export const LONGUEUR_MAX_TEXTE_DE_NOTE = 4000
export const LONGUEUR_MAX_OBSERVATION = 4000
export const LONGUEUR_MAX_TRAVAIL = 500
export const LONGUEUR_MAX_NOTE_DE_TRAVAIL = 2000
export const NOMBRE_MAX_DE_TRAVAUX = 100
export const TAILLE_MAX_DU_PROGRAMME = 65536
/** Le code d'un travail proposé : une minuscule, puis 63 minuscules, chiffres ou traits d'union au plus. */
export const MOTIF_CODE_DE_TRAVAIL = /^[a-z][a-z0-9-]{0,63}$/

// Un texte qui ne dit rien : la base en ôte les blancs (`btrim(…, E' \t\n\r')`) et le trouve vide. Ces blancs-là
// seulement — une espace insécable reste un texte (contrôle 46 de l'essai).
const queDesBlancs = (t: string) => [...t].every((c) => BLANCS_D_UN_TEXTE.includes(c))
// Les caractères comme `length` les compte en base : des points de code.
const caracteres = (t: string) => [...t].length
// La base compare un uuid sans la casse.
const minuscules = (id: string) => id.toLowerCase()

// ── Le programme de travail proposé ───────────────────────────────────────────────────────────────────────────────

/** Un travail que l'application propose : un code stable, et ce qu'il demande. */
export interface TravailPropose {
  code: string
  travail: string
}

// LE PROGRAMME PROPOSÉ PAR CYCLE (§ 4.4, et § 2.2 pour ce que le § 4.4 ne détaille pas : les dépenses, les tiers, les
// stocks). Une PROPOSITION : le cabinet coche, annote, retire, ajoute ; la conclusion garde le programme tel qu'il a été
// exécuté, sous les mots qu'il portait ce jour-là. Le code reste quand les mots changent : c'est lui qui retrouve un
// travail proposé d'une conclusion à la suivante. Aucun travail ne tranche à la place du cabinet ni ne cite un seuil
// qu'aucune source relue ne donne : le seuil des petits équipements que la conception citait n'a pas été vérifié.
export const PROGRAMME_DES_CYCLES: Readonly<Record<CycleRevision, readonly TravailPropose[]>> = {
  tresorerie: [
    { code: 'tresorerie-releves', travail: 'Obtenir le relevé au 31 décembre de chaque compte bancaire du dossier.' },
    { code: 'tresorerie-rapprochement', travail: 'Rapprocher le solde de chaque compte de banque du relevé au 31 décembre, et expliquer l’écart.' },
    { code: 'tresorerie-mouvements', travail: 'Examiner les mouvements ignorés et ceux qui ne sont pas rapprochés.' },
    { code: 'tresorerie-virements-internes', travail: 'Vérifier que le compte de virements internes est soldé au 31 décembre.' },
    { code: 'tresorerie-especes', travail: 'Demander s’il existe des encaissements ou des paiements en espèces.' },
  ],
  recettes: [
    { code: 'recettes-releve-snir', travail: 'Rapprocher les recettes de l’exercice du relevé SNIR et du total du logiciel du praticien, et expliquer l’écart.' },
    { code: 'recettes-mois', travail: 'Examiner les mois sans recette ou anormaux.' },
    { code: 'recettes-cheques', travail: 'Rechercher les chèques reçus fin décembre et crédités en janvier.' },
    { code: 'recettes-hors-convention', travail: 'Examiner les recettes hors convention.' },
  ],
  depenses: [
    { code: 'depenses-pieces', travail: 'Vérifier que les dépenses significatives ont leur pièce, et examiner celles que seul le relevé justifie.' },
    { code: 'depenses-professionnel', travail: 'Examiner le caractère professionnel des dépenses et la part privée des dépenses mixtes.' },
    { code: 'depenses-vehicule', travail: 'Vérifier les frais de véhicule : le barème ou les frais réels, jamais les deux.' },
    { code: 'depenses-variations', travail: 'Comparer les postes de dépenses à ceux de l’exercice précédent.' },
  ],
  immobilisations: [
    { code: 'immobilisations-registre', travail: 'Rapprocher le registre des immobilisations des comptes d’immobilisations et d’amortissements.' },
    { code: 'immobilisations-factures', travail: 'Vérifier que chaque bien du registre a sa facture.' },
    { code: 'immobilisations-sorties', travail: 'Rechercher les biens cédés, mis au rebut ou sortis de l’activité.' },
    { code: 'immobilisations-charges', travail: 'Examiner les dépenses passées en charges qui relèveraient d’une immobilisation.' },
  ],
  emprunts: [
    { code: 'emprunts-tableau', travail: 'Obtenir le tableau d’amortissement de la banque pour chaque emprunt.' },
    { code: 'emprunts-capital', travail: 'Rapprocher le capital restant dû au 31 décembre du solde des emprunts.' },
    { code: 'emprunts-interets', travail: 'Vérifier les intérêts et l’assurance de l’exercice.' },
  ],
  social: [
    { code: 'social-avis', travail: 'Rapprocher les cotisations de l’exercice des avis de l’année et de la régularisation de l’année précédente.' },
    { code: 'social-csg', travail: 'Vérifier la part de CSG-CRDS non déductible.' },
  ],
  tva: [
    { code: 'tva-declarations', travail: 'Vérifier que chaque période de l’exercice est déclarée, et chaque déclaration payée ou remboursée.' },
    { code: 'tva-soldes', travail: 'Rapprocher les soldes des comptes de TVA au 31 décembre des déclarations.' },
    { code: 'tva-recettes', travail: 'Vérifier la cohérence de la TVA collectée avec les recettes.' },
  ],
  capitaux: [
    { code: 'capitaux-report', travail: 'Vérifier que l’ouverture reprend le report de l’exercice précédent.' },
    { code: 'capitaux-prelevements', travail: 'Examiner les prélèvements et les apports de l’exploitant au regard du résultat.' },
  ],
  tiers: [
    { code: 'tiers-auxiliaires', travail: 'Justifier les soldes des clients et des fournisseurs, compte par compte.' },
    { code: 'tiers-denouement', travail: 'Vérifier le dénouement des créances et des dettes au début de l’exercice suivant.' },
    { code: 'tiers-douteuses', travail: 'Examiner les créances douteuses.' },
  ],
  stocks: [
    { code: 'stocks-inventaire', travail: 'Obtenir l’inventaire au 31 décembre et le rapprocher des comptes de stocks.' },
    { code: 'stocks-variation', travail: 'Vérifier la variation des stocks de l’exercice.' },
  ],
  ensemble: [
    { code: 'ensemble-controles', travail: 'Vérifier que les contrôles de l’application sont levés : la Checklist et les préalables de la validation.' },
    { code: 'ensemble-2035', travail: 'Vérifier que la déclaration concorde avec les écritures.' },
    { code: 'ensemble-variations', travail: 'Comparer l’exercice au précédent et expliquer les variations significatives.' },
    { code: 'ensemble-direction', travail: 'Consigner au journal les échanges avec la direction sur les points qui comptent.' },
    { code: 'ensemble-synthese', travail: 'Rédiger la note de synthèse : les points importants, les anomalies, et leur effet sur les comptes.' },
    { code: 'ensemble-rapport', travail: 'Pour une présentation des comptes, arrêter la conclusion envisagée de l’attestation : sans observation, avec observation(s), ou refus d’attester.' },
  ],
}

/** Un travail tel que la conclusion le garde : son code s'il a été proposé, ce qu'il demandait, s'il a été fait, sa note. */
export interface TravailDuProgramme {
  code: string | null
  travail: string
  fait: boolean
  note: string | null
}

/** Le programme proposé d'un cycle, prêt à cocher : rien n'est fait, aucune note. */
export function programmePropose(cycle: CycleRevision): TravailDuProgramme[] {
  return PROGRAMME_DES_CYCLES[cycle].map((t) => ({ code: t.code, travail: t.travail, fait: false, note: null }))
}

// ── Relire un programme, sans deviner ─────────────────────────────────────────────────────────────────────────────

// Ce qu'une valeur devient une fois envoyée en jsonb, ou relue : JSON.stringify — `undefined` disparaît, NaN devient null.
function commeEnvoye(v: unknown): unknown {
  const json = JSON.stringify(v)
  return json === undefined ? null : JSON.parse(json)
}
const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const CLES_D_UN_TRAVAIL = ['code', 'travail', 'fait', 'note']

// La forme d'un travail, comme `conclure_cycle` la juge (refus 9, « illisible ») : un objet ; ses clés parmi les quatre ;
// un libellé texte ; « fait » un booléen ; une note et un code textes ou nuls, absents compris ; un code au motif. `->>`
// rend le texte de toute valeur : un booléen `true` passerait le motif — d'où le type d'abord (contrôle 62bis).
function travailLisible(v: unknown): boolean {
  if (!estObjet(v)) return false
  if (!Object.keys(v).every((cle) => CLES_D_UN_TRAVAIL.includes(cle))) return false
  if (typeof v.travail !== 'string' || typeof v.fait !== 'boolean') return false
  if (v.note !== undefined && v.note !== null && typeof v.note !== 'string') return false
  if (v.code !== undefined && v.code !== null && (typeof v.code !== 'string' || !MOTIF_CODE_DE_TRAVAIL.test(v.code))) return false
  return true
}

export type LectureDuProgramme = { lisible: true; travaux: TravailDuProgramme[] } | { lisible: false }

/**
 * Le programme d'une conclusion, relu : lisible quand sa forme est celle que `conclure_cycle` exige — sinon l'écran le
 * dit, au lieu d'en montrer une partie. Une conclusion réinsérée par la restauration n'est passée que par la contrainte
 * de la table (une liste, 64 Kio) : sa forme se relit ici.
 */
export function lireProgramme(travaux: unknown): LectureDuProgramme {
  const v = commeEnvoye(travaux)
  if (!Array.isArray(v) || !v.every(travailLisible)) return { lisible: false }
  return {
    lisible: true,
    travaux: (v as Record<string, unknown>[]).map((t) => ({
      code: typeof t.code === 'string' ? t.code : null,
      travail: t.travail as string,
      fait: t.fait as boolean,
      note: typeof t.note === 'string' ? t.note : null,
    })),
  }
}

/**
 * Le programme d'où part une nouvelle conclusion : celui de la conclusion courante, tel qu'il a été exécuté, suivi des
 * travaux proposés depuis qu'elle a été écrite (ceux dont le code n'y figure pas) ; sans conclusion courante, ou si son
 * programme ne se relit pas, le programme proposé — et `repris` le dit.
 */
export function programmeDeDepart(cycle: CycleRevision, courante: Pick<RevisionConclusion, 'travaux'> | null): {
  travaux: TravailDuProgramme[]
  repris: boolean
} {
  const lu = courante === null ? null : lireProgramme(courante.travaux)
  if (lu === null || !lu.lisible) return { travaux: programmePropose(cycle), repris: false }
  const codes = new Set(lu.travaux.map((t) => t.code).filter((c) => c !== null))
  return { travaux: [...lu.travaux, ...programmePropose(cycle).filter((t) => t.code === null || !codes.has(t.code))], repris: true }
}

// ── La chaîne des conclusions d'un cycle ──────────────────────────────────────────────────────────────────────────

// LA CHAÎNE, comme celle des décisions d'un solde (lib/revision.ts) : la première (qui ne remplace rien), puis celle qui
// la remplace, et ainsi de suite ; la COURANTE est celle qu'aucune ne remplace. La base la garde linéaire — une seule
// première par cycle et par exercice, une seule suite à chacune, une suite du même cycle et du même exercice —, mais
// l'écran ne l'affirme que s'il la relit telle : une chaîne qui ne se suit pas n'a pas de courante.
export interface ChaineDeConclusions {
  // De la plus ancienne à la courante ; dans l'ordre de leur création quand la chaîne ne se lit pas.
  conclusions: RevisionConclusion[]
  courante: RevisionConclusion | null
  lisible: boolean
}

export function chaineDesConclusions(toutes: readonly RevisionConclusion[], annee: number, cycle: CycleRevision): ChaineDeConclusions {
  const duCycle = toutes.filter((c) => c.annee === annee && c.cycle === cycle)
  const suites = new Map<string, RevisionConclusion[]>()
  for (const c of duCycle) {
    if (c.remplace_id !== null) suites.set(minuscules(c.remplace_id), [...(suites.get(minuscules(c.remplace_id)) ?? []), c])
  }
  const chaine: RevisionConclusion[] = []
  let suivante = duCycle.find((c) => c.remplace_id === null)
  while (suivante !== undefined && !chaine.includes(suivante)) {
    chaine.push(suivante)
    suivante = suites.get(minuscules(suivante.id))?.[0]
  }
  if (chaine.length === duCycle.length && suivante === undefined) {
    return { conclusions: chaine, courante: chaine.at(-1) ?? null, lisible: true }
  }
  const parCreation = [...duCycle].sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
  return { conclusions: parCreation, courante: null, lisible: false }
}

/** Ce que la conclusion courante du même cycle, l'exercice précédent, a laissé à suivre (§ 3.7) ; nul sinon. */
export function pointsASuivre(
  toutes: readonly RevisionConclusion[],
  annee: number,
  cycle: CycleRevision,
): { annee: number; conclusion: RevisionConclusion; texte: string } | null {
  const precedente = chaineDesConclusions(toutes, annee - 1, cycle).courante
  if (precedente === null || precedente.a_suivre === null) return null
  return { annee: annee - 1, conclusion: precedente, texte: precedente.a_suivre }
}

// ── L'exercice, pour les cycles ───────────────────────────────────────────────────────────────────────────────────

// UN CYCLE SE CONCLUT, SE NOTE ET SE REVOIT sur un exercice terminé (hypothèse Q11), dans les bornes de la base — sans
// attendre l'ouverture définitive que les SOLDES attendent (étape R1, refus 6 et 7) : la conception ne donne aux cycles
// que les refus 1 à 4. Un cycle dont les soldes attendent se lit « en cours » : sa conclusion ne les rend pas décidés.
export type ExercicePourLesCycles = 'ouvert' | 'invalide' | 'en-cours'

export function exercicePourLesCycles(annee: number, anneeCourante: number): ExercicePourLesCycles {
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) return 'invalide'
  return annee >= anneeCourante ? 'en-cours' : 'ouvert'
}

// ── Ce que les trois fonctions refusent, dit avant le clic ────────────────────────────────────────────────────────

// LES REFUS, DANS L'ORDRE DU TEXTE DE CHAQUE FONCTION ET SOUS SES MOTS — le RAISE de PL/pgSQL, chaque « % » rempli par
// sa valeur (`remplirModele`). `revisionRevue.test.ts` lit la dernière définition exportée de chaque fonction et exige la
// même liste, mot pour mot, avec ses codes et ses numéros ; `revisionRevueEssai.test.ts` rejoue chaque appel de
// supabase/essais/revisionCycles.sql et exige du module le refus, ou l'absence de refus, que la base a rendu. Le refus 4
// (un dossier de travail figé) attend l'étape R9 : sa place est gardée dans l'ordre.
const MESSAGE_EN_COURS = "L'exercice % n'est pas terminé : sa révision s'ouvre une fois clos."
const MESSAGE_CYCLE = "Le cycle annoncé n'est pas un cycle de la révision."

export const REFUS_CONCLURE_CYCLE = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: MESSAGE_EN_COURS },
  { cle: 'cycle_inconnu', refus: 5, modele: MESSAGE_CYCLE },
  { cle: 'etat_invalide', refus: 6, modele: 'Une conclusion dit un cycle révisé, ou en anomalie.' },
  { cle: 'conclusion_vide', refus: 7, modele: 'Une conclusion se rédige : elle ne peut pas être vide.' },
  { cle: 'conclusion_trop_longue', refus: 7, modele: 'Une conclusion tient en 8 000 caractères au plus.' },
  { cle: 'a_suivre_blanc', refus: 8, modele: 'Les points à suivre ne se composent pas que de blancs : les laisser vides.' },
  { cle: 'a_suivre_trop_long', refus: 8, modele: 'Les points à suivre tiennent en 4 000 caractères au plus.' },
  {
    cle: 'programme_illisible', refus: 9,
    modele: "Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s'il est fait.",
  },
  { cle: 'programme_trop_long', refus: 9, modele: 'Le programme de travail tient en cent travaux et 64 Kio au plus.' },
  { cle: 'travail_vide', refus: 9, modele: 'Un travail du programme se décrit : son libellé ne peut pas être vide.' },
  { cle: 'travail_trop_long', refus: 9, modele: 'Un travail du programme tient en 500 caractères au plus.' },
  { cle: 'note_de_travail_blanche', refus: 9, modele: "La note d'un travail ne se compose pas que de blancs : la laisser vide." },
  { cle: 'note_de_travail_trop_longue', refus: 9, modele: "La note d'un travail tient en 2 000 caractères au plus." },
  { cle: 'travail_en_double', refus: 9, modele: 'Le programme cite deux fois le même travail proposé.' },
  { cle: 'remplacement_hors_cycle', refus: 10, modele: "La conclusion à remplacer n'est pas une conclusion de ce cycle pour l'exercice %." },
  { cle: 'remplacement_perime', refus: 10, modele: 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.' },
] as const

export const REFUS_NOTER_REVISION = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: MESSAGE_EN_COURS },
  { cle: 'cycle_inconnu', refus: 5, modele: MESSAGE_CYCLE },
  { cle: 'nature_invalide', refus: 6, modele: 'Une note du journal est un échange avec la direction, une consultation ou un travail.' },
  { cle: 'texte_vide', refus: 7, modele: 'Une note se rédige : elle ne peut pas être vide.' },
  { cle: 'texte_trop_long', refus: 7, modele: 'Une note tient en 4 000 caractères au plus.' },
] as const

export const REFUS_REVOIR_CYCLE = [
  { cle: 'chef', refus: 1, modele: 'Seul le chef du cabinet revoit un cycle.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: MESSAGE_EN_COURS },
  { cle: 'avis_invalide', refus: 5, modele: 'Une revue approuve le cycle, ou le renvoie à reprendre.' },
  { cle: 'a_reprendre_sans_observation', refus: 6, modele: 'Un cycle renvoyé à reprendre se motive.' },
  { cle: 'observation_blanche', refus: 6, modele: 'Une observation ne se compose pas que de blancs : la laisser vide.' },
  { cle: 'observation_trop_longue', refus: 6, modele: 'Une observation tient en 4 000 caractères au plus.' },
  { cle: 'conclusion_hors_exercice', refus: 7, modele: "La conclusion à revoir n'est pas une conclusion de l'exercice % dans ce dossier." },
  { cle: 'conclusion_remplacee', refus: 8, modele: 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.' },
  { cle: 'deja_revue', refus: 9, modele: 'Cette conclusion a déjà été revue : revoir de nouveau suppose une nouvelle conclusion.' },
] as const

export type CleRefusConclure = (typeof REFUS_CONCLURE_CYCLE)[number]['cle']
export type CleRefusNoter = (typeof REFUS_NOTER_REVISION)[number]['cle']
export type CleRefusRevoir = (typeof REFUS_REVOIR_CYCLE)[number]['cle']

export interface RefusDuCycle<K extends string> {
  cle: K
  // Le numéro du refus dans l'ordre de sa fonction.
  refus: number
  // Le code SQLSTATE que la base lève : 42501 pour l'accès, 22023 pour les autres.
  code: '42501' | '22023'
  message: string
}

function fabrique<K extends string>(liste: readonly { cle: K; refus: number; modele: string }[]) {
  return (cle: K, ...valeurs: string[]): RefusDuCycle<K> => {
    const r = liste.find((x) => x.cle === cle) as { cle: K; refus: number; modele: string }
    return { cle, refus: r.refus, code: r.refus === 1 ? '42501' : '22023', message: remplirModele(r.modele, valeurs) }
  }
}
const refusConclure = fabrique<CleRefusConclure>(REFUS_CONCLURE_CYCLE)
const refusNoter = fabrique<CleRefusNoter>(REFUS_NOTER_REVISION)
const refusRevoir = fabrique<CleRefusRevoir>(REFUS_REVOIR_CYCLE)

/** Ce que l'écran a lu pour dire les refus : la session, l'année à Paris, les conclusions et les revues du dossier. */
export interface ContexteDesCycles {
  // L'appelant est-il `admin_du_dossier` du dossier annoncé — un membre affecté, le chef, le super-administrateur ?
  // Hypothèse Q2 : tout membre affecté PRÉPARE ; c'est ce booléen qui ne suffirait plus si le cabinet répondait autrement.
  accesAuDossier: boolean
  // Est-il le chef du cabinet du dossier — ou le super-administrateur (`est_chef_du_cabinet`) ? Hypothèse Q2 : seul le
  // chef REVOIT.
  chefDuCabinet: boolean
  // L'année en cours à Paris : la base la lit ainsi.
  anneeCourante: number
  // Toutes les conclusions du dossier, tous exercices, et toutes ses revues : le remplacement et la revue les lisent.
  conclusions: readonly Pick<RevisionConclusion, 'id' | 'annee' | 'cycle' | 'remplace_id'>[]
  revues: readonly Pick<RevisionRevue, 'conclusion_id'>[]
}

// Les refus 2 et 3, communs aux trois fonctions, et les valeurs de leur message : l'exercice en cours se nomme, un
// exercice invalide non. Un NaN part en JSON null, comme une année absente.
function refusDeLExercice(
  annee: number | null,
  anneeCourante: number,
): ['exercice_invalide'] | ['exercice_en_cours', string] | null {
  if (annee === null || !Number.isFinite(annee) || annee < 2000 || annee > 2100) return ['exercice_invalide']
  return annee >= anneeCourante ? ['exercice_en_cours', String(annee)] : null
}

const estUnCycle = (c: string | null): c is CycleRevision => c !== null && (CYCLES_DE_REVISION as readonly string[]).includes(c)

/** Les arguments de `conclure_cycle`, tels que supabase-js les envoie : les huit, toujours, nuls plutôt qu'absents. */
export interface ArgumentsConclureCycle {
  p_dossier_id: string
  p_annee: number | null
  p_cycle: string | null
  p_etat: string | null
  // Ce qui part en jsonb : la base en juge la forme (refus 9), donc le module la juge sur la valeur telle qu'envoyée.
  p_travaux: unknown
  p_conclusion: string | null
  p_a_suivre: string | null
  p_remplace_id: string | null
}

// LE PROGRAMME, JUGÉ COMME LA BASE LE JUGE (refus 9), dans son ordre : la forme ; le nombre et la taille ; un libellé
// vide ; un libellé trop long ; une note de blancs ; une note trop longue ; un travail proposé cité deux fois.
function refusDuProgramme(travaux: unknown): CleRefusConclure | null {
  const envoye = commeEnvoye(travaux)
  // Le JSON `null` ne se distingue pas d'une absence : aucun travail.
  const v = envoye === null ? [] : envoye
  if (!Array.isArray(v) || !v.every(travailLisible)) return 'programme_illisible'
  if (v.length > NOMBRE_MAX_DE_TRAVAUX || octetsJsonb(v) > TAILLE_MAX_DU_PROGRAMME) return 'programme_trop_long'
  const lus = v as { code?: string | null; travail: string; note?: string | null }[]
  if (lus.some((t) => queDesBlancs(t.travail))) return 'travail_vide'
  if (lus.some((t) => caracteres(t.travail) > LONGUEUR_MAX_TRAVAIL)) return 'travail_trop_long'
  if (lus.some((t) => typeof t.note === 'string' && queDesBlancs(t.note))) return 'note_de_travail_blanche'
  if (lus.some((t) => typeof t.note === 'string' && caracteres(t.note) > LONGUEUR_MAX_NOTE_DE_TRAVAIL)) return 'note_de_travail_trop_longue'
  const codes = lus.map((t) => t.code).filter((c): c is string => typeof c === 'string')
  if (new Set(codes).size !== codes.length) return 'travail_en_double'
  return null
}

/**
 * Ce que `conclure_cycle` refuserait de ces arguments, le premier refus dans son ordre, avec son code et ses mots ; nul
 * quand elle écrirait la conclusion. Le refus 1 dépend de la session (`accesAuDossier`) ; aucun autre ne dépend de qui
 * clique.
 */
export function refusDeConclureCycle(a: ArgumentsConclureCycle, c: ContexteDesCycles): RefusDuCycle<CleRefusConclure> | null {
  // 1. L'accès (hypothèse Q2 : tout membre affecté prépare).
  if (!c.accesAuDossier) return refusConclure('acces')
  // 2. et 3. (hypothèse Q11).
  const exercice = refusDeLExercice(a.p_annee, c.anneeCourante)
  if (exercice !== null) {
    const [cle, ...valeurs] = exercice
    return refusConclure(cle, ...valeurs)
  }
  const annee = a.p_annee as number
  // 5.
  if (!estUnCycle(a.p_cycle)) return refusConclure('cycle_inconnu')
  const cycle = a.p_cycle
  // 6.
  if (a.p_etat === null || !(ETATS_DE_CONCLUSION as readonly string[]).includes(a.p_etat)) return refusConclure('etat_invalide')
  // 7.
  if (a.p_conclusion === null || queDesBlancs(a.p_conclusion)) return refusConclure('conclusion_vide')
  if (caracteres(a.p_conclusion) > LONGUEUR_MAX_CONCLUSION) return refusConclure('conclusion_trop_longue')
  // 8.
  if (a.p_a_suivre !== null && queDesBlancs(a.p_a_suivre)) return refusConclure('a_suivre_blanc')
  if (a.p_a_suivre !== null && caracteres(a.p_a_suivre) > LONGUEUR_MAX_A_SUIVRE) return refusConclure('a_suivre_trop_long')
  // 9.
  const programme = refusDuProgramme(a.p_travaux)
  if (programme !== null) return refusConclure(programme)
  // 10. La conclusion courante est celle qu'aucune autre ne remplace : on remplace celle-là, ou rien s'il n'y en a pas.
  const remplacees = new Set(c.conclusions.filter((x) => x.remplace_id !== null).map((x) => minuscules(x.remplace_id as string)))
  const duCycle = c.conclusions.filter((x) => x.annee === annee && x.cycle === cycle)
  const courante = duCycle.find((x) => !remplacees.has(minuscules(x.id)))?.id ?? null
  if (a.p_remplace_id !== null && !duCycle.some((x) => minuscules(x.id) === minuscules(a.p_remplace_id as string))) {
    return refusConclure('remplacement_hors_cycle', String(annee))
  }
  if ((a.p_remplace_id === null ? null : minuscules(a.p_remplace_id)) !== (courante === null ? null : minuscules(courante))) {
    return refusConclure('remplacement_perime')
  }
  return null
}

/** Les arguments de `noter_revision` : les cinq, nuls plutôt qu'absents. */
export interface ArgumentsNoterRevision {
  p_dossier_id: string
  p_annee: number | null
  p_cycle: string | null
  p_nature: string | null
  p_texte: string | null
}

/** Ce que `noter_revision` refuserait, le premier refus dans son ordre ; nul quand elle écrirait la note. */
export function refusDeNoterRevision(
  a: ArgumentsNoterRevision,
  c: Pick<ContexteDesCycles, 'accesAuDossier' | 'anneeCourante'>,
): RefusDuCycle<CleRefusNoter> | null {
  // 1.
  if (!c.accesAuDossier) return refusNoter('acces')
  // 2. et 3.
  const exercice = refusDeLExercice(a.p_annee, c.anneeCourante)
  if (exercice !== null) {
    const [cle, ...valeurs] = exercice
    return refusNoter(cle, ...valeurs)
  }
  // 5.
  if (!estUnCycle(a.p_cycle)) return refusNoter('cycle_inconnu')
  // 6.
  if (a.p_nature === null || !(NATURES_DE_NOTE as readonly string[]).includes(a.p_nature)) return refusNoter('nature_invalide')
  // 7.
  if (a.p_texte === null || queDesBlancs(a.p_texte)) return refusNoter('texte_vide')
  if (caracteres(a.p_texte) > LONGUEUR_MAX_TEXTE_DE_NOTE) return refusNoter('texte_trop_long')
  return null
}

/** Les arguments de `revoir_cycle` : les cinq, nuls plutôt qu'absents. */
export interface ArgumentsRevoirCycle {
  p_dossier_id: string
  p_annee: number | null
  p_conclusion_id: string | null
  p_avis: string | null
  p_observation: string | null
}

/**
 * Ce que `revoir_cycle` refuserait, le premier refus dans son ordre ; nul quand elle écrirait la revue. Le refus 1
 * dépend de la session (`chefDuCabinet`, hypothèse Q2).
 */
export function refusDeRevoirCycle(a: ArgumentsRevoirCycle, c: ContexteDesCycles): RefusDuCycle<CleRefusRevoir> | null {
  // 1. Seul le chef du cabinet revoit (hypothèse Q2).
  if (!c.chefDuCabinet) return refusRevoir('chef')
  // 2. et 3.
  const exercice = refusDeLExercice(a.p_annee, c.anneeCourante)
  if (exercice !== null) {
    const [cle, ...valeurs] = exercice
    return refusRevoir(cle, ...valeurs)
  }
  const annee = a.p_annee as number
  // 5.
  if (a.p_avis === null || !(AVIS_DE_REVUE as readonly string[]).includes(a.p_avis)) return refusRevoir('avis_invalide')
  // 6.
  if (a.p_avis === 'a_reprendre' && (a.p_observation === null || queDesBlancs(a.p_observation))) {
    return refusRevoir('a_reprendre_sans_observation')
  }
  if (a.p_observation !== null && queDesBlancs(a.p_observation)) return refusRevoir('observation_blanche')
  if (a.p_observation !== null && caracteres(a.p_observation) > LONGUEUR_MAX_OBSERVATION) return refusRevoir('observation_trop_longue')
  // 7. Une conclusion de l'exercice, dans ce dossier (le contexte ne porte que le dossier ouvert).
  const visee = a.p_conclusion_id === null ? undefined
    : c.conclusions.find((x) => minuscules(x.id) === minuscules(a.p_conclusion_id as string) && x.annee === annee)
  if (visee === undefined) return refusRevoir('conclusion_hors_exercice', String(annee))
  // 8. La courante de son cycle.
  if (c.conclusions.some((x) => x.remplace_id !== null && minuscules(x.remplace_id) === minuscules(visee.id))) {
    return refusRevoir('conclusion_remplacee')
  }
  // 9. Une revue par conclusion.
  if (c.revues.some((r) => minuscules(r.conclusion_id) === minuscules(visee.id))) return refusRevoir('deja_revue')
  return null
}

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────

/** Une conclusion telle que l'écran la compose. */
export interface ConclusionComposee {
  cycle: CycleRevision
  etat: EtatConclusionRevision
  travaux: readonly TravailDuProgramme[]
  conclusion: string
  aSuivre: string | null
  // La conclusion courante du cycle, que celle-ci remplace ; nulle pour la première.
  remplaceId: string | null
}

const texteOuNul = (t: string | null) => (t === null || queDesBlancs(t) ? null : t)

/**
 * Les huit arguments de `conclure_cycle`, nuls plutôt qu'absents — supabase-js omettrait une clé `undefined`, et la
 * fonction ne se trouverait pas. Des points à suivre ou une note de travail faits de blancs partent NULS : la base dirait
 * de les laisser vides, et c'est ce qu'ils disent. Un travail ne porte son code et sa note que s'il en a.
 */
export function argumentsDeConclureCycle(dossierId: string, annee: number, d: ConclusionComposee): ArgumentsConclureCycle {
  return {
    p_dossier_id: dossierId,
    p_annee: annee,
    p_cycle: d.cycle,
    p_etat: d.etat,
    p_travaux: d.travaux.map((t) => {
      const note = texteOuNul(t.note)
      return { ...(t.code === null ? {} : { code: t.code }), travail: t.travail, fait: t.fait, ...(note === null ? {} : { note }) }
    }),
    p_conclusion: d.conclusion,
    p_a_suivre: texteOuNul(d.aSuivre),
    p_remplace_id: d.remplaceId,
  }
}

/** Les cinq arguments de `noter_revision`. */
export function argumentsDeNoterRevision(
  dossierId: string,
  annee: number,
  cycle: CycleRevision,
  nature: NatureNoteRevision,
  texte: string,
): ArgumentsNoterRevision {
  return { p_dossier_id: dossierId, p_annee: annee, p_cycle: cycle, p_nature: nature, p_texte: texte }
}

/** Les cinq arguments de `revoir_cycle` ; une observation faite de blancs part NULLE. */
export function argumentsDeRevoirCycle(
  dossierId: string,
  annee: number,
  conclusionId: string,
  avis: AvisRevueRevision,
  observation: string | null,
): ArgumentsRevoirCycle {
  return { p_dossier_id: dossierId, p_annee: annee, p_conclusion_id: conclusionId, p_avis: avis, p_observation: texteOuNul(observation) }
}

// ── L'état d'un cycle, déduit ─────────────────────────────────────────────────────────────────────────────────────

// L'ÉTAT D'UN CYCLE (§ 3.5), DÉDUIT et jamais stocké :
//   - `en-attente` : l'exercice n'est pas terminé (hypothèse Q11), ou hors des bornes — rien ne s'y conclut ;
//   - `non-commence` : aucune conclusion, aucune note, aucune décision sur un solde du cycle ;
//   - `en-cours` : quelque chose est fait, et rien n'est conclu ; ou la conclusion courante dit « révisé » quand ce
//     qu'elle couvre n'est pas réglé — un solde du cycle à justifier, à revoir, en anomalie ou en attente, ou, pour le
//     cycle « ensemble », un autre cycle qui n'est ni révisé, ni en anomalie, ni revu (`causes`) ;
//   - `revise` : la conclusion courante dit « révisé », et tout ce qu'elle couvre est réglé ;
//   - `anomalie` : la conclusion courante dit « anomalie » ;
//   - `a-reprendre` : le chef a renvoyé la conclusion courante à reprendre ;
//   - `revu` : le chef a approuvé la conclusion courante, après toute décision, conclusion et note du cycle, et le cycle
//     est révisé ou en anomalie ;
//   - `revue-perimee` : il l'a approuvée, mais une décision, une conclusion ou une note du cycle l'a suivie depuis ;
//   - `a-revoir` : la chaîne des conclusions ne se relit pas.
// Une revue n'est jamais périmée par une revue : seuls les actes de préparation la suivent.
export const ETATS_DU_CYCLE = [
  'en-attente', 'non-commence', 'en-cours', 'revise', 'anomalie', 'a-reprendre', 'revu', 'revue-perimee', 'a-revoir',
] as const
export type EtatDuCycle = (typeof ETATS_DU_CYCLE)[number]

export type CauseDuCycle =
  | 'soldes-a-justifier' | 'soldes-a-revoir' | 'soldes-en-anomalie' | 'soldes-en-attente' | 'cycles-ouverts'
  | 'activite-posterieure' | 'chaine-illisible'

// Les états d'un solde (lib/revision.ts) qui laissent son cycle ouvert, et la cause que chacun donne.
const SOLDE_OUVERT: Partial<Record<EtatDuSolde, CauseDuCycle>> = {
  'a-justifier': 'soldes-a-justifier', 'a-revoir': 'soldes-a-revoir', anomalie: 'soldes-en-anomalie', 'en-attente': 'soldes-en-attente',
}
// Les états d'un cycle qui le disent réglé pour la synthèse du cycle « ensemble ».
const CYCLE_REGLE: readonly EtatDuCycle[] = ['revise', 'anomalie', 'revu', 'revue-perimee']

/** La revue de la conclusion courante d'un cycle, telle que l'écran la dit. */
export interface RevueDuCycle {
  revue: RevisionRevue
  // Une décision, une conclusion ou une note du cycle l'a suivie.
  perimee: boolean
  // Celui qui revoit a écrit la conclusion revue (A30-1 l'admet, la trace le dit).
  parLAuteur: boolean
}

export interface CycleRevu {
  cycle: CycleRevision
  etat: EtatDuCycle
  causes: CauseDuCycle[]
  chaine: ChaineDeConclusions
  // Le programme de la conclusion courante, relu ; nul sans conclusion courante.
  programme: LectureDuProgramme | null
  // Les travaux du programme courant qui ne sont pas faits — un constat, jamais un refus.
  travauxNonFaits: number
  revue: RevueDuCycle | null
  // Toutes les revues des conclusions du cycle, de la plus ancienne à la plus récente : l'historique.
  revues: RevisionRevue[]
  // Le journal du cycle (`revision_notes`), du plus ancien au plus récent.
  journal: RevisionNote[]
  // Ce que l'exercice précédent a laissé à suivre dans ce cycle.
  pointsASuivre: { annee: number; texte: string } | null
}

/**
 * Ce que l'écran a lu, EN ENTIER, pour dire les cycles d'un exercice : les tables de l'étape R4, et les décisions. Les
 * lignes de `revision_notes` s'appellent ici le `journal` : dans les sources, une clé ou une lecture nommée `notes` est
 * comptée comme l'une des anciennes colonnes des notes internes (notesInternesEcritures.test.ts, règles K et L).
 */
export interface DonneesDesCycles {
  conclusions: readonly RevisionConclusion[]
  journal: readonly RevisionNote[]
  revues: readonly RevisionRevue[]
  // Les décisions de l'étape R1 : leur instant compte pour la revue d'un cycle.
  decisions: readonly Pick<RevisionJustification, 'annee' | 'compte' | 'cree_le'>[]
}

export interface CyclesDeLExercice {
  annee: number
  lectureIncomplete: string | null
  exercice: ExercicePourLesCycles | null
  cycles: CycleRevu[]
  avancement: Record<EtatDuCycle, number>
}

const instant = (t: string) => Date.parse(t)
const avancementVide = () => Object.fromEntries(ETATS_DU_CYCLE.map((e) => [e, 0])) as Record<EtatDuCycle, number>

/**
 * Les cycles d'un exercice, dans l'ordre de l'écran : ceux que la révision des soldes a retenus pour le dossier
 * (`revisionDeLExercice`), plus ceux qu'une conclusion ou une note nomme — rien d'écrit ne se cache. `revision` donne
 * l'état de chaque solde et sa lecture ; une lecture partielle de l'une ou de l'autre n'affirme rien.
 */
export function cyclesDeLExercice<C>(
  revision: RevisionDeLExercice<C>,
  d: DonneesDesCycles,
  lectureIncomplete: string | null,
  anneeCourante: number,
): CyclesDeLExercice {
  const annee = revision.annee
  const incomplete = revision.lectureIncomplete ?? lectureIncomplete
  if (incomplete !== null) return { annee, lectureIncomplete: incomplete, exercice: null, cycles: [], avancement: avancementVide() }
  const exercice = exercicePourLesCycles(annee, anneeCourante)
  const nommes = new Set<string>([...d.conclusions, ...d.journal].filter((x) => x.annee === annee).map((x) => x.cycle))
  const retenus = CYCLES_DE_REVISION.filter((c) => revision.cycles.some((x) => x.cycle === c) || nommes.has(c))
  const etats = new Map<CycleRevision, EtatDuCycle>()
  const cycles: CycleRevu[] = []
  // « ensemble » en dernier : sa synthèse lit l'état des autres.
  for (const cycle of [...retenus.filter((c) => c !== 'ensemble'), ...retenus.filter((c) => c === 'ensemble')]) {
    const revu = cycleRevu(cycle, annee, exercice, revision, d, etats)
    etats.set(cycle, revu.etat)
    cycles.push(revu)
  }
  cycles.sort((a, b) => CYCLES_DE_REVISION.indexOf(a.cycle) - CYCLES_DE_REVISION.indexOf(b.cycle))
  const avancement = avancementVide()
  for (const c of cycles) avancement[c.etat]++
  return { annee, lectureIncomplete: null, exercice, cycles, avancement }
}

function cycleRevu<C>(
  cycle: CycleRevision,
  annee: number,
  exercice: ExercicePourLesCycles,
  revision: RevisionDeLExercice<C>,
  d: DonneesDesCycles,
  autres: ReadonlyMap<CycleRevision, EtatDuCycle>,
): CycleRevu {
  const chaine = chaineDesConclusions(d.conclusions, annee, cycle)
  const courante = chaine.courante
  const ids = new Set(chaine.conclusions.map((c) => minuscules(c.id)))
  const revues = d.revues.filter((r) => ids.has(minuscules(r.conclusion_id)))
    .sort((a, b) => instant(a.revu_le) - instant(b.revu_le) || a.id.localeCompare(b.id))
  const journal = d.journal.filter((n) => n.annee === annee && n.cycle === cycle)
    .sort((a, b) => instant(a.cree_le) - instant(b.cree_le) || a.id.localeCompare(b.id))
  const soldes = revision.comptes.filter((c) => c.cycle === cycle)
  const decisions = d.decisions.filter((j) => j.annee === annee && soldes.some((c) => c.compte === j.compte))
  const programme = courante === null ? null : lireProgramme(courante.travaux)
  const suivre = pointsASuivre(d.conclusions, annee, cycle)
  const commun = {
    cycle, chaine, programme, revues, journal,
    travauxNonFaits: programme !== null && programme.lisible ? programme.travaux.filter((t) => !t.fait).length : 0,
    pointsASuivre: suivre === null ? null : { annee: suivre.annee, texte: suivre.texte },
  }
  const revueCourante = courante === null ? undefined : revues.find((r) => minuscules(r.conclusion_id) === minuscules(courante.id))

  // Ce qui a été fait APRÈS la revue : une décision sur un solde du cycle, une conclusion, une note — de tout l'exercice
  // pour le cycle « ensemble », dont la synthèse couvre les autres.
  const activite = cycle === 'ensemble'
    ? [...d.decisions.filter((j) => j.annee === annee), ...d.conclusions.filter((c) => c.annee === annee),
      ...d.journal.filter((n) => n.annee === annee)].map((x) => instant(x.cree_le))
    : [...decisions, ...chaine.conclusions, ...journal].map((x) => instant(x.cree_le))
  const revue: RevueDuCycle | null = revueCourante === undefined || courante === null ? null : {
    revue: revueCourante,
    perimee: activite.some((t) => t >= instant(revueCourante.revu_le)),
    parLAuteur: minuscules(revueCourante.revu_par) === minuscules(courante.auteur),
  }

  if (exercice !== 'ouvert') return { ...commun, etat: 'en-attente', causes: [], revue }
  if (!chaine.lisible) return { ...commun, etat: 'a-revoir', causes: ['chaine-illisible'], revue }
  if (courante === null) {
    const commence = chaine.conclusions.length > 0 || journal.length > 0 || decisions.length > 0
    return { ...commun, etat: commence ? 'en-cours' : 'non-commence', causes: [], revue }
  }
  // Ce que la conclusion couvre et qui reste ouvert.
  const causes: CauseDuCycle[] = []
  for (const s of soldes) {
    const cause = SOLDE_OUVERT[s.etat]
    if (cause !== undefined && !causes.includes(cause)) causes.push(cause)
  }
  if (cycle === 'ensemble' && [...autres.values()].some((e) => !CYCLE_REGLE.includes(e))) causes.push('cycles-ouverts')
  const preparation: EtatDuCycle = courante.etat === 'anomalie' ? 'anomalie' : causes.length === 0 ? 'revise' : 'en-cours'
  if (revue !== null && revue.revue.avis === 'a_reprendre') return { ...commun, etat: 'a-reprendre', causes, revue }
  if (revue !== null && preparation !== 'en-cours') {
    return revue.perimee ? { ...commun, etat: 'revue-perimee', causes: ['activite-posterieure'], revue }
      : { ...commun, etat: 'revu', causes: [], revue }
  }
  return { ...commun, etat: preparation, causes: preparation === 'en-cours' ? causes : [], revue }
}
