import { lireMontantSaisi } from './encaissementsAffichage'

// LES CASES DE LA 2035 QUE LA COMPTABILITÉ NE DONNE PAS, SAISIES PAR LE CABINET (étapes 2035S3 à S5). La table
// `saisies_2035` (migration préparée `saisies_2035`, supabase/preparees/20261107180000_saisies_2035.sql) en porte une ligne
// par dossier, exercice et case ; `enregistrer_saisies_2035` les écrit, tout ou rien, chacune contre la valeur lue qu'elle
// remplace. Le moteur les reçoit en entrée OBLIGATOIRE (`valeursDesCases`, lib/cases2035.ts) ; la carte « Saisies du
// cabinet » de Clôture les offre. Le récit : HISTORIQUE.md, « 07/11/2026 — LA 2035 : LES SAISIES DU CABINET (2035S3 À S5)
// (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// SOURCES. La notice 2035-NOT-SD 2026 (https://www.impots.gouv.fr/sites/default/files/formulaires/2035-sd/2026/
// 2035-sd_5385.pdf) : renvois (17) CC, (21) CL et ses « dont », (24) DE, (25) DB, (26) le revenu brut social. Le
// formulaire 2035-B-SD 2026 (public/formulaires/2035-sd-2026.pdf), ligne 43 : les douze cases « dont » de CL.

// LE DRAPEAU DE LA MIGRATION, BAISSÉ : la production n'a pas la table. Baissé, rien ne la lit — ni Clôture, ni la
// sauvegarde (`auPlanDesSaisies2035`, lib/sauvegarde.ts) —, les douze « dont » de CL ne sont pas au tableau des cases
// (`casesDu2035`), et la 2035 est celle d'hier, au centime et à la clé près (cases2035.test.ts le prouve). Il se lève
// quand la migration est en base et dans l'export, en simulation d'abord, la suite ENTIÈRE ; 2035S-Q1 : quand la 2035 de
// 2025 déposée porte une de ces cases.
export const SAISIES_2035_EXPORTEES = false

/** La forme d'un code que la table accepte (sa contrainte `saisies_2035_code`), dans l'ordre du formulaire. */
export type CodeSaisie2035 =
  | 'CC' | 'CL' | 'CS' | 'CT' | 'AW' | 'CO' | 'CU' | 'CQ' | 'DF' | 'DG' | 'CI' | 'CJ' | 'AX' | 'DH' | 'DE' | 'DB'

export interface CaseSaisie2035 {
  code: CodeSaisie2035
  // Ce que la case contient, tiré de la notice : la phrase sous le champ.
  phrase: string
  // Le renvoi de la notice, pour qui veut la relire.
  renvoi: string
  // La note annexe que la notice demande (renvois 17 et 21) : CC et CL seules, comme la contrainte de la table.
  noteAnnexe: boolean
}

// L'ordre du formulaire : CC (ligne 36), CL (ligne 43) et ses douze « dont » tels qu'imprimés de gauche à droite et de haut
// en bas, puis le cadre 8.
export const CASES_SAISIES_2035: readonly CaseSaisie2035[] = [
  { code: 'CC', renvoi: '(17)', noteAnnexe: true, phrase: 'La quote-part personnelle des dépenses déduites (loyer, chauffage, téléphone…), certains frais de véhicules hors barème, la fraction non déductible de l’amortissement d’un véhicule au-delà des plafonds, l’avantage en nature de son usage personnel, une régularisation de TVA d’un assujetti partiel… Le détail va dans une note annexe.' },
  { code: 'CL', renvoi: '(21)', noteAnnexe: true, phrase: 'Le total de la ligne 43, ses « dont » compris : notamment une plus-value à court terme dont l’imposition est différée, les revenus de brevets taxés à 10 %, les exonérations et les déductions ci-dessous. Le détail va, le cas échéant, dans une note annexe.' },
  { code: 'CS', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération sur le bénéfice « entrepreneur zone franche urbaine – territoire entrepreneur » (CGI, art. 44 octies A). Rendue au revenu brut social.' },
  { code: 'CT', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’abondement sur l’épargne salariale (code du travail, art. L. 3332-27).' },
  { code: 'AW', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération sur le bénéfice « entreprise nouvelle » (CGI, art. 44 sexies ou 44 quindecies). Rendue au revenu brut social.' },
  { code: 'CO', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération « jeunes artistes » : l’abattement de 50 % des jeunes artistes de la création plastique (CGI, art. 93-9). Rendue au revenu brut social.' },
  { code: 'CU', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération « jeunes entreprises innovantes » (CGI, art. 44 sexies-0 A et 44 sexies A). Rendue au revenu brut social.' },
  { code: 'CQ', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont les plus-values à court terme exonérées (CGI, art. 151 septies, 151 septies A et 238 quindecies). Elles reviennent au revenu brut social par DE, pas d’ici.' },
  { code: 'DF', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont, pour un médecin conventionné de secteur I, l’abattement de 2 % des frais de représentation, calculé sur les recettes brutes.' },
  { code: 'DG', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont, pour un médecin conventionné de secteur I, la déduction complémentaire de 3 %. Rendue au revenu brut social.' },
  { code: 'CI', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération des médecins en « zone déficitaire en offre de soins » : la permanence des soins, jusqu’à 60 jours de garde (CGI, art. 151 ter). Rendue au revenu brut social.' },
  { code: 'CJ', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont l’exonération « zone France ruralités revitalisation » (ZFRR). Rendue au revenu brut social.' },
  { code: 'AX', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont les revenus nets de cession, concession et sous-concession de brevets taxables à 10 % (CGI, art. 238). Ils reviennent au revenu brut social par DE, pas d’ici.' },
  { code: 'DH', renvoi: '(21)', noteAnnexe: false, phrase: 'Dont, pour un médecin conventionné de secteur I, l’abattement forfaitaire pour frais du groupe III. Rendu au revenu brut social.' },
  { code: 'DE', renvoi: '(24)', noteAnnexe: false, phrase: 'Les sommes à réintégrer au revenu brut social : les plus-values à court terme exonérées (sauf à la MSA), les revenus de brevets taxables à 10 % déduits en CL, la participation et l’intéressement de l’entrepreneur déduits en charges, les bénéfices non professionnels rattachés à l’activité.' },
  { code: 'DB', renvoi: '(25)', noteAnnexe: false, phrase: 'Ce qui s’ajoute aux indemnités journalières que leur poste porte déjà en DB : les déficits (ou charges) non professionnels rattachés à l’activité. Une indemnité journalière comptée en gains divers se range sous le poste « Indemnités journalières », pas ici.' },
]

export const CASE_SAISIE_PAR_CODE: ReadonlyMap<string, CaseSaisie2035> = new Map(CASES_SAISIES_2035.map((c) => [c.code, c]))

// Les « dont » de CL que le renvoi (26) rend au revenu brut social : six exonérations et deux déductions des médecins de
// secteur I. Pas DF, ni CT ; CQ et AX y reviennent par DE.
export const DONT_DE_CL_RENDUS_AU_REVENU_BRUT_SOCIAL: readonly CodeSaisie2035[] = ['CS', 'AW', 'CU', 'CI', 'DG', 'DH', 'CO', 'CJ']

/** Une saisie telle que le moteur la lit : sa case et son montant en centimes entiers, positifs ou nuls. */
export interface Saisie2035 {
  code: CodeSaisie2035
  centimes: number
  noteAnnexe: string | null
}

/** Aucune saisie : ce que la 2035 reçoit tant que le drapeau est baissé, ou d'un exercice que le cabinet n'a pas complété. */
export const AUCUNE_SAISIE_2035: readonly Saisie2035[] = Object.freeze([])

// Les bornes de la table, redites pour refuser avant le clic : `saisies_2035_centimes`, `saisies_2035_note_annexe`,
// `saisies_2035_cadre_8_depuis_2025` (saisies2035.test.ts les confronte au texte de la migration).
export const CENTIMES_MAX = 999_999_999_999
export const NOTE_ANNEXE_MAX = 2000
export const PREMIER_EXERCICE_DU_CADRE_8 = 2025

/** Une case que le formulaire de cet exercice porte : DE et DB à partir des revenus 2025. */
export function caseSaisissableEn(code: CodeSaisie2035, annee: number): boolean {
  return (code !== 'DE' && code !== 'DB') || annee >= PREMIER_EXERCICE_DU_CADRE_8
}

// UNE LIGNE LUE, JUGÉE AVANT D'ÊTRE CRUE : un code hors de la liste, des centimes qui ne sont pas un entier positif ou nul,
// une note qui n'est pas un texte rendent `null` — l'appelant tient alors la lecture pour INFIDÈLE et n'offre aucun geste.
export function lireSaisie2035(ligne: unknown): (Saisie2035 & { annee: number }) | null {
  if (!ligne || typeof ligne !== 'object') return null
  const l = ligne as Record<string, unknown>
  const code = typeof l.code === 'string' ? CASE_SAISIE_PAR_CODE.get(l.code)?.code : undefined
  const centimes = typeof l.centimes === 'string' && /^\d+$/.test(l.centimes) ? Number(l.centimes) : l.centimes
  if (!code || typeof l.annee !== 'number' || !Number.isInteger(l.annee) || typeof centimes !== 'number'
    || !Number.isSafeInteger(centimes) || centimes < 0 || centimes > CENTIMES_MAX) return null
  if (l.note_annexe !== null && typeof l.note_annexe !== 'string') return null
  return { code, annee: l.annee, centimes, noteAnnexe: l.note_annexe }
}

// UN MONTANT TAPÉ, EN CENTIMES EXACTS : « 1 200,50 », « 1200.5 », « 600 » ; vide vaut zéro (la case vidée). Rien n'est
// arrondi : plus de deux décimales, un signe, une lettre se refusent (null).
export function centimesDeLaSaisie(texte: string): number | null {
  const lu = lireMontantSaisi(texte)
  if (lu === null) return 0
  if (Number.isNaN(lu)) return null
  const net = texte.replace(/[\s  €]/g, '').replace(',', '.')
  const [entiers, decimales = ''] = net.split('.')
  if (decimales.length > 2) return null
  const centimes = Number(entiers) * 100 + Number(decimales.padEnd(2, '0'))
  return Number.isSafeInteger(centimes) && centimes <= CENTIMES_MAX ? centimes : null
}

/** Ce que le formulaire de la carte fait partir pour une case : ses centimes et sa note annexe (nulle hors de CC et CL). */
export interface ValeurSaisie {
  centimes: number
  noteAnnexe: string | null
}

export interface ChangementDeSaisie {
  code: CodeSaisie2035
  avant: ValeurSaisie
  apres: ValeurSaisie
}

const VIDE: ValeurSaisie = { centimes: 0, noteAnnexe: null }

/** La valeur lue d'une case : sa ligne, ou zéro sans note quand elle n'en a pas. */
export function valeurLue(lues: readonly Saisie2035[], code: CodeSaisie2035): ValeurSaisie {
  const l = lues.find((s) => s.code === code)
  return l ? { centimes: l.centimes, noteAnnexe: l.noteAnnexe } : VIDE
}

/** Les cases que l'enregistrement changerait, dans l'ordre du formulaire : celles dont le montant ou la note diffèrent. */
export function changementsDesSaisies(
  lues: readonly Saisie2035[],
  saisies: ReadonlyMap<CodeSaisie2035, ValeurSaisie>,
): ChangementDeSaisie[] {
  const changements: ChangementDeSaisie[] = []
  for (const c of CASES_SAISIES_2035) {
    const apres = saisies.get(c.code)
    if (!apres) continue
    const avant = valeurLue(lues, c.code)
    if (avant.centimes !== apres.centimes || avant.noteAnnexe !== apres.noteAnnexe) changements.push({ code: c.code, avant, apres })
  }
  return changements
}

// LES REFUS DE LA BASE, DITS AVANT LE CLIC, sur la saisie TELLE QU'ELLE PART : un exercice validé (le gel), une case que le
// formulaire de l'exercice ne porte pas, une note hors de CC et CL, sur une case vidée, trop longue, ou bordée d'espaces.
// Rien de plus strict que la base, rien de plus lâche.
export function refusDesSaisies(
  annee: number,
  exerciceFige: boolean,
  changements: readonly ChangementDeSaisie[],
): string | null {
  if (exerciceFige) return `L’exercice ${annee} est validé, ou figé par une validation : ses saisies de la 2035 ne changent plus.`
  for (const { code, apres } of changements) {
    if (!caseSaisissableEn(code, annee)) return `${code} n’existe sur la 2035 qu’à partir des revenus ${PREMIER_EXERCICE_DU_CADRE_8}.`
    if (!Number.isSafeInteger(apres.centimes) || apres.centimes < 0 || apres.centimes > CENTIMES_MAX) return `Le montant de ${code} ne se lit pas.`
    if (apres.noteAnnexe === null) continue
    if (!CASE_SAISIE_PAR_CODE.get(code)?.noteAnnexe) return `Seules CC et CL portent une note annexe.`
    if (apres.centimes === 0) return `La note annexe de ${code} accompagne un montant : la case vidée n’en garde pas.`
    if (apres.noteAnnexe.length === 0 || apres.noteAnnexe !== apres.noteAnnexe.trim()) return `La note annexe de ${code} ne commence ni ne finit par une espace.`
    if ([...apres.noteAnnexe].length > NOTE_ANNEXE_MAX) return `La note annexe de ${code} tient en ${NOTE_ANNEXE_MAX} caractères.`
  }
  return null
}

/** Les paramètres de `enregistrer_saisies_2035` : les cases changées, et pour chacune la valeur lue qu'elle remplace. */
export function parametresDeLEnregistrement(dossierId: string, annee: number, changements: readonly ChangementDeSaisie[]) {
  const objet = (choisir: (c: ChangementDeSaisie) => ValeurSaisie) => Object.fromEntries(changements.map((c) => {
    const v = choisir(c)
    return [c.code, { centimes: v.centimes, note_annexe: v.noteAnnexe }]
  }))
  return { p_dossier_id: dossierId, p_annee: annee, p_lues: objet((c) => c.avant), p_saisies: objet((c) => c.apres) }
}

// CE QUE CLÔTURE A LU DES SAISIES D'UN DOSSIER (lib/saisies2035Lecture.ts) : absentes — le drapeau baissé, la table n'est
// pas en base, rien n'est lu ni ne pouvait l'être, et la 2035 est celle d'hier —, lues en entier et fidèles, ou incomplètes
// — refusées, coupées, ou une ligne que `lireSaisie2035` ne croit pas : la 2035 ne se valide ni ne s'imprime, et la carte
// n'offre aucun geste.
export type LectureDesSaisies2035 =
  | { dossierId: string; etat: 'absentes' }
  | { dossierId: string; etat: 'lues'; saisies: readonly (Saisie2035 & { annee: number })[] }
  | { dossierId: string; etat: 'incompletes'; motif: string }

/** Les saisies d'un exercice, ou null tant qu'elles ne sont pas lues en entier (aucun calcul ne doit s'en servir). */
export function saisiesDeLExercice(lecture: LectureDesSaisies2035 | null, annee: number): readonly Saisie2035[] | null {
  if (lecture === null || lecture.etat === 'incompletes') return null
  if (lecture.etat === 'absentes') return AUCUNE_SAISIE_2035
  return lecture.saisies.filter((s) => s.annee === annee).map(({ code, centimes, noteAnnexe }) => ({ code, centimes, noteAnnexe }))
}

/** Le motif qui suspend la 2035 (son PDF, sa validation), ou null quand les saisies sont absentes ou lues en entier. */
export function motifDesSaisies2035(lecture: LectureDesSaisies2035 | null): string | null {
  if (lecture === null) return 'les saisies du cabinet de la 2035 ne sont pas encore lues'
  return lecture.etat === 'incompletes' ? `les saisies du cabinet de la 2035 : ${lecture.motif}` : null
}
