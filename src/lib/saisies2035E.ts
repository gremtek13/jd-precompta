import { calculer2035E, cadreMonoEtablissement } from './declaration2035E'
import type { Annexe2035E, Entree2035E, Saisies2035E } from './declaration2035E'

// L'ANNEXE 2035-E : CE QUE SEUL LE CABINET SAIT, SAISI PAR EXERCICE (ligne 48 ; migration `saisies_2035e`, en production
// depuis le 12/11/2026, supabase/schema/20261112134300_saisies_2035e.sql ; 48-Q1 et 48-Q2 tranchées le 17/10/2026). Une
// ligne par dossier et par exercice : EM (la part des loyers qui se déduit), EN, EK, ER, EU, EV en euros entiers, le cadre des
// mono-établissements (AH) et l'effectif (BK). Chaque valeur NULLE tant que le cabinet ne l'a pas dite — « à saisir »,
// jamais un zéro inventé. Ni la date de cessation (MA : 48-Q6, jugée à la main) ni BW (une saisie de la 2035 elle-même).
//
// Deux drapeaux : `SAISIES_2035E_PREVUES` (la table en base : le plan de sauvegarde la lit), levé le 12/11/2026, et
// `SAISIES_2035E_EXPORTEES` (l'écran de Clôture la lit et l'écrit, et l'annexe la reçoit), levé le 13/11/2026 (48S-Q2) quand
// le PDF de l'annexe a su dire « à saisir » dans la case de chaque ligne non dite (gabarit2035E.ts). Baissé, l'annexe supposait
// zéro et le disait : ClotureTab.test.tsx joue encore cet état, par un accesseur sur le drapeau.

/** La migration `saisies_2035e` est en base (12/11/2026) : la table entre au plan de sauvegarde. */
export const SAISIES_2035E_PREVUES: boolean = true
/** L'écran de saisie et l'annexe qui la reçoit, levé le 13/11/2026 : le PDF dit « à saisir », jamais un zéro inventé. */
export const SAISIES_2035E_EXPORTEES: boolean = true

/** Ce que le PDF de l'annexe imprime pour une ligne que le cabinet n'a pas encore dite (« à » est dans l'encodage WinAnsi). */
export const MOTS_A_SAISIR_DU_PDF = 'à saisir'

export const TABLES_DES_SAISIES_2035E = ['saisies_2035e'] as const

/** La saisie d'un exercice, telle que la base la garde : nul, « à saisir ». */
export interface Saisie2035E {
  loyersDeductibles: number | null // EM
  plusValues: number | null // EN
  variationDeStock: number | null // EK, signée
  taxesSurLeChiffreDAffaires: number | null // ER
  dotationsBiensMisADisposition: number | null // EU
  moinsValues: number | null // EV
  monoEtablissement: boolean | null // AH
  effectif: number | null // BK, seulement AH coché
}

export const SAISIE_2035E_VIDE: Saisie2035E = Object.freeze({
  loyersDeductibles: null, plusValues: null, variationDeStock: null, taxesSurLeChiffreDAffaires: null,
  dotationsBiensMisADisposition: null, moinsValues: null, monoEtablissement: null, effectif: null,
})

/** Les montants de la saisie, leur ligne de l'annexe et leur colonne en base, dans l'ordre d'impression. */
export const MONTANTS_SAISIS_2035E = [
  { cle: 'plusValues', code: 'EN', colonne: 'plus_values', signe: false },
  { cle: 'variationDeStock', code: 'EK', colonne: 'variation_de_stock', signe: true },
  { cle: 'loyersDeductibles', code: 'EM', colonne: 'loyers_deductibles', signe: false },
  { cle: 'taxesSurLeChiffreDAffaires', code: 'ER', colonne: 'taxes_sur_le_chiffre_d_affaires', signe: false },
  { cle: 'dotationsBiensMisADisposition', code: 'EU', colonne: 'dotations_biens_mis_a_disposition', signe: false },
  { cle: 'moinsValues', code: 'EV', colonne: 'moins_values', signe: false },
] as const

// Les bornes de la contrainte `saisies_2035e_montants` et `saisies_2035e_effectif`.
export const MONTANT_MAXIMUM_2035E = 999_999_999_999
export const EFFECTIF_MAXIMUM_2035E = 1_000_000

export type LectureDesSaisies2035E =
  | { dossierId: string; etat: 'absentes' }
  | { dossierId: string; etat: 'incompletes'; motif: string }
  | { dossierId: string; etat: 'lues'; saisies: (Saisie2035E & { annee: number })[] }

const entierOuNul = (v: unknown, signe: boolean, max: number): number | null | undefined => {
  if (v === null) return null
  if (typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= max && (signe || v >= 0)) return v
  // PostgREST rend un bigint en nombre ; une chaîne d'entier se lit aussi.
  if (typeof v === 'string' && /^-?\d{1,13}$/.test(v)) return entierOuNul(Number(v), signe, max)
  return undefined
}

/** Une ligne lue de `saisies_2035e`, vérifiée comme la base la contraint ; `null` si elle ne se croit pas. */
export function lireSaisie2035E(ligne: Record<string, unknown>): (Saisie2035E & { annee: number }) | null {
  const annee = ligne.annee
  if (typeof annee !== 'number' || !Number.isInteger(annee)) return null
  const s: Record<string, number | boolean | null> = {}
  for (const m of MONTANTS_SAISIS_2035E) {
    const v = entierOuNul(ligne[m.colonne], m.signe, MONTANT_MAXIMUM_2035E)
    if (v === undefined) return null
    s[m.cle] = v
  }
  const mono = ligne.mono_etablissement
  if (mono !== null && typeof mono !== 'boolean') return null
  const effectif = entierOuNul(ligne.effectif, false, EFFECTIF_MAXIMUM_2035E)
  if (effectif === undefined || (effectif !== null && mono !== true)) return null
  return { annee, ...(s as unknown as Omit<Saisie2035E, 'monoEtablissement' | 'effectif'>), monoEtablissement: mono, effectif }
}

/** La saisie de l'exercice, sur une lecture faite en entier ; `null` tant qu'elle ne l'est pas (aucun geste alors). */
export function saisie2035EDeLExercice(lecture: LectureDesSaisies2035E | null, annee: number): Saisie2035E | null {
  if (lecture === null || lecture.etat !== 'lues') return null
  const trouvee = lecture.saisies.find((s) => s.annee === annee)
  if (!trouvee) return SAISIE_2035E_VIDE
  const { annee: _annee, ...saisie } = trouvee
  void _annee
  return saisie
}

/** Ce que la base refuserait, dit avant le clic, dans l'ordre de ses contrôles ; `null` si rien. */
export function refusDeLaSaisie2035E(saisie: Saisie2035E, fige: boolean, annee: number): string | null {
  if (fige) return `L’exercice ${annee} est figé : ses saisies de l’annexe 2035-E ne changent plus.`
  for (const m of MONTANTS_SAISIS_2035E) {
    const v = saisie[m.cle]
    if (v === null) continue
    if (!Number.isSafeInteger(v)) return `${m.code} se saisit en euros entiers, comme le formulaire le porte.`
    if (!m.signe && v < 0) return `${m.code} ne peut pas être négative : seule la variation de stock (EK) l’est.`
    if (Math.abs(v) > MONTANT_MAXIMUM_2035E) return `${m.code} dépasse ce que la base garde.`
  }
  if (saisie.effectif !== null) {
    if (saisie.monoEtablissement !== true) return 'L’effectif (BK) ne se saisit que si le cadre des mono-établissements est coché.'
    if (!Number.isSafeInteger(saisie.effectif) || saisie.effectif < 0 || saisie.effectif > EFFECTIF_MAXIMUM_2035E) {
      return 'L’effectif (BK) est un nombre entier de salariés.'
    }
  }
  return null
}

/** La saisie telle que `enregistrer_saisies_2035e` la reçoit : exactement ses huit clés. */
export function versLaBase(s: Saisie2035E): Record<string, number | boolean | null> {
  return {
    loyers_deductibles: s.loyersDeductibles, plus_values: s.plusValues, variation_de_stock: s.variationDeStock,
    taxes_sur_le_chiffre_d_affaires: s.taxesSurLeChiffreDAffaires,
    dotations_biens_mis_a_disposition: s.dotationsBiensMisADisposition, moins_values: s.moinsValues,
    mono_etablissement: s.monoEtablissement, effectif: s.effectif,
  }
}

/** Les paramètres de l'appel : la saisie entière contre celle qui a été lue. */
export function parametresDeLEnregistrement2035E(dossierId: string, annee: number, lue: Saisie2035E, saisie: Saisie2035E) {
  return { p_dossier_id: dossierId, p_annee: annee, p_lue: versLaBase(lue), p_saisie: versLaBase(saisie) }
}

/** Ce qui change, dit en mots pour la confirmation : une ligne par valeur. */
export function changementsDeLaSaisie2035E(lue: Saisie2035E, saisie: Saisie2035E): string[] {
  const dire = (v: number | boolean | null) => v === null ? 'à saisir' : v === true ? 'oui' : v === false ? 'non' : `${v} €`
  const lignes: string[] = []
  for (const m of MONTANTS_SAISIS_2035E) {
    if (lue[m.cle] !== saisie[m.cle]) lignes.push(`${m.code} : ${dire(lue[m.cle])} → ${dire(saisie[m.cle])}`)
  }
  if (lue.monoEtablissement !== saisie.monoEtablissement) {
    lignes.push(`AH (mono-établissement) : ${dire(lue.monoEtablissement)} → ${dire(saisie.monoEtablissement)}`)
  }
  if (lue.effectif !== saisie.effectif) {
    const eff = (v: number | null) => v === null ? 'à saisir' : String(v)
    lignes.push(`BK (effectif) : ${eff(lue.effectif)} → ${eff(saisie.effectif)}`)
  }
  return lignes
}

/** Le cadre des mono-établissements, tel que la saisie le dit : à dire, non coché, ou coché avec ce qu'il porte. */
export type CadreMonoSaisi =
  | { etat: 'a_dire' }
  | { etat: 'non' }
  | { etat: 'coche'; chiffreDeReference: number; du: string; au: string; effectif: number | null }

/** L'annexe et ce qui reste à saisir. Les lignes qu'une saisie manquante alimente, et les totaux qui en dépendent, valent
 *  `null` (« à saisir ») ; l'obligation et le chiffre d'affaires ne dépendent d'aucune saisie et se disent toujours. */
export interface Annexe2035ESaisie {
  annexe: Annexe2035E
  lignes: Map<string, number | null>
  aSaisir: string[]
  cadre: CadreMonoSaisi
}

/** L'ANNEXE AVEC LA SAISIE DE L'EXERCICE, en paramètre OBLIGATOIRE : jamais un zéro à la place d'une valeur non dite. */
export function annexe2035EAvecSaisie(entree: Omit<Entree2035E, 'saisies'>, saisie: Saisie2035E): Annexe2035ESaisie {
  const saisies: Saisies2035E = {
    loyersDeductibles: saisie.loyersDeductibles ?? 0, plusValues: saisie.plusValues ?? 0,
    variationDeStock: saisie.variationDeStock ?? 0, taxesSurLeChiffreDAffaires: saisie.taxesSurLeChiffreDAffaires ?? 0,
    dotationsBiensMisADisposition: saisie.dotationsBiensMisADisposition ?? 0, moinsValues: saisie.moinsValues ?? 0,
  }
  const annexe = calculer2035E({ ...entree, saisies })
  const aSaisir: string[] = MONTANTS_SAISIS_2035E.filter((m) => saisie[m.cle] === null).map((m) => m.code)
  const lignes = new Map<string, number | null>(annexe.lignes)
  for (const code of aSaisir) lignes.set(code, null)
  const manque = (codes: string[]) => codes.some((c) => aSaisir.includes(c))
  if (manque(['EN'])) lignes.set('EI', null)
  if (manque(['EK', 'EM', 'ER', 'EU', 'EV'])) lignes.set('EW', null)
  if (lignes.get('EI') === null || lignes.get('EW') === null) { lignes.set('EX', null); lignes.set('JU', null) }
  const c = cadreMonoEtablissement(annexe)
  const cadre: CadreMonoSaisi = saisie.monoEtablissement === null ? { etat: 'a_dire' }
    : saisie.monoEtablissement === false ? { etat: 'non' }
    : { etat: 'coche', chiffreDeReference: c.chiffreDeReference, du: c.du, au: c.au, effectif: saisie.effectif }
  if (cadre.etat === 'a_dire') aSaisir.push('AH')
  if (cadre.etat === 'coche' && cadre.effectif === null) aSaisir.push('BK')
  return { annexe, lignes, aSaisir, cadre }
}

// LE PDF MARQUE CHAQUE LIGNE DE `aSaisir` (gabarit2035E.ts) : les montants (EN, EK, EM, ER, EU, EV) par « à saisir » dans leur
// case, AH à côté de sa case à cocher (vingt points de large : les mots n'y tiennent pas) quand le cadre n'est pas dit, BK
// dans sa case quand il est coché sans effectif. Les totaux qui en dépendent (EI, EW, EX, JU) portent aussi « à saisir » sans
// être nommés : ils ne se saisissent pas, ils suivent. Le cadre COCHÉ ne s'imprime toujours pas (ni la croix, ni AJ, ni BK,
// ni la période : 48-Q6 laisse les dates d'activité à la main) : la mention et l'écran le disent.

/** La lecture des saisies de l'annexe retient le PDF d'une annexe due tant qu'elle n'est pas revenue entière : sans elle,
 *  l'annexe retomberait sur des zéros supposés, sans « à saisir ». Drapeau baissé (`ouvert` faux), rien ne retient. */
export function motifDesSaisies2035E(lecture: LectureDesSaisies2035E | null, ouvert: boolean): string | null {
  if (!ouvert) return null
  if (lecture === null) return 'les saisies de l’annexe 2035-E ne sont pas encore lues'
  if (lecture.etat === 'incompletes') return `les saisies de l’annexe 2035-E : ${lecture.motif}`
  if (lecture.etat === 'absentes') return 'les saisies de l’annexe 2035-E ne sont pas lues'
  return null
}

/** CE QUE L'ÉCRAN DIT AVANT LE TÉLÉCHARGEMENT, sous le bouton : combien de lignes le PDF portera « à saisir », et le cadre
 *  coché qu'il n'imprime pas. Rien quand l'annexe est complète et le cadre non coché. */
export function avisAvantLeTelechargement2035E(annexe: Annexe2035ESaisie): string[] {
  const avis: string[] = []
  const n = annexe.aSaisir.length
  if (n > 0) {
    avis.push(`Annexe 2035-E : ${n} ${n > 1 ? 'lignes' : 'ligne'} à saisir (${annexe.aSaisir.join(', ')}). Le PDF `
      + `${n > 1 ? 'les' : 'la'} porte « à saisir », comme les totaux qui en dépendent : à ne pas déposer tel quel.`)
  }
  if (annexe.cadre.etat === 'coche') {
    avis.push('Le cadre des mono-établissements, coché, ne s’imprime pas sur le PDF : AH, AJ, BK et la période sont à y reporter à la main.')
  }
  return avis
}

/** CE QUI S'ÉCRIT EN ROUGE, EN TÊTE DE LA PAGE DE L'ANNEXE (même place et même forme que la mention d'un millésime absent,
 *  `mentionDuPdf`) : les lignes encore à saisir, et le cadre coché que le PDF ne remplit pas. Lignes courtes, sans caractère
 *  hors de l'encodage WinAnsi des polices PDF standard. Rien quand il ne reste rien : le PDF d'avant, à l'octet près. */
export function mentionDeLAnnexe2035E(aSaisir: readonly string[], cadreCoche: boolean): string[] {
  const mention: string[] = []
  if (aSaisir.length > 0) {
    mention.push(
      `ATTENTION - annexe 2035-E incomplète : lignes encore à saisir par le cabinet : ${aSaisir.join(', ')}.`,
      'Leurs cases portent "à saisir", comme les totaux qui en dépendent : ne pas déposer tel quel.',
    )
  }
  if (cadreCoche) {
    mention.push('Cadre des mono-établissements coché par le cabinet : non imprimé, AH, AJ, BK et la période à reporter à la main.')
  }
  return mention
}
