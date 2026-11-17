import { dateDuCumulRepris, rang360, valeurSaisie } from './amortissements'
import { anneeDe, formatDate, formatMoney } from './format'
import type { Immobilisation } from './types'
import { exerciceQuiFige } from './validationExercice'

// LE CUMUL REPRIS D'UN BIEN, À L'ÉCRAN (EXP58-Q5, décision du cabinet du 17/11/2026, la réponse (A) « le cumul repris saisi
// par bien, le plan continué » ; docs/conceptions/58-reponses-de-l-expert-comptable.md, § 3.1). Pour un bien acquis avant la
// reprise du dossier, le cabinet saisit le cumul des amortissements de l'ancien tableau au 31 décembre qui précède l'année de
// l'ouverture (`dateDuCumulRepris`) ; le plan continue depuis lui (lib/amortissements.ts, `amortissementCumuleCentimes`). Ce
// module porte ce que l'écran en dit avant le clic — les refus des trois contraintes de la base et de sa garde, dans des mots
// qui disent quoi corriger — et ce qu'il écrit. Le calcul vit dans lib/amortissements.ts, que la migration redit en entiers.

/** Le drapeau de la migration `cumul_repris_des_biens` (supabase/preparees/20261117190000_cumul_repris_des_biens.sql), baissé
 *  jusqu'à son application : l'onglet Immobilisations ne montre ni n'écrit le cumul repris — les colonnes n'existent pas
 *  encore, et une écriture qui les nommerait serait refusée en entier. Le moteur, lui, lit le cumul de tout bien qui en porte
 *  un, sans drapeau : sans la migration, aucun n'en porte. Il se lève le jour de l'application, avec la copie de l'assistant
 *  (`agent-comptable`, bloc AMORTISSEMENT) reprise et redéployée. */
export const CUMUL_REPRIS_PREVU = false

/** Le cumul tel que le champ le donne : vide, aucun cumul repris (le plan part de la mise en service) ; sinon le nombre lu,
 *  la virgule française valant le point, NaN s'il ne se lit pas — la lecture de la valeur d'un bien (`valeurSaisie`). */
export function cumulReprisSaisi(texte: string): number | null {
  return texte.trim() ? valeurSaisie(texte) : null
}

/** Ce que l'écran écrit : le cumul au centime et son 31 décembre, ou les deux nuls (champ vide). */
export function champsDuCumulRepris(texte: string, ouverture: string | null): { cumul_repris: number | null; cumul_repris_au: string | null } {
  const cumul = cumulReprisSaisi(texte)
  if (cumul === null || ouverture === null || !Number.isFinite(cumul)) return { cumul_repris: null, cumul_repris_au: null }
  return { cumul_repris: Math.round(cumul * 100) / 100, cumul_repris_au: dateDuCumulRepris(ouverture) }
}

export interface SaisieDuCumulRepris {
  valeur: string
  dateAcquisition: string
  dateMiseEnService: string
  duree: string
  cumulRepris: string
}

/** Ce que les contraintes de la base refuseraient du cumul saisi, dit avant le clic, sur la saisie TELLE QU'ELLE PART (la
 *  valeur, les dates et la durée du formulaire). Les refus d'un bien lui-même (`refusBien`) se disent avant : une valeur ou
 *  une date illisible ne se juge pas ici. */
export function refusCumulRepris(saisie: SaisieDuCumulRepris, ouverture: string | null): string | null {
  const cumul = cumulReprisSaisi(saisie.cumulRepris)
  if (cumul === null) return null
  if (ouverture === null) {
    return 'Un cumul repris se saisit dans un dossier ouvert par une balance reprise (onglet Informations) : ce dossier n’en a pas. Vide le champ.'
  }
  if (!Number.isFinite(cumul) || cumul < 0) return 'Le cumul repris est un montant positif ou nul.'
  if (Math.abs(cumul * 100 - Math.round(cumul * 100)) > 1e-6) return 'Le cumul repris se saisit au centime.'
  const au = dateDuCumulRepris(ouverture)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.dateAcquisition)) return null
  // `immobilisations_cumul_repris_date` : au plus tôt la date d'acquisition.
  if (saisie.dateAcquisition > au) {
    return `Un cumul repris au ${formatDate(au)} est celui d’un bien acquis au plus tard ce jour-là : vide le champ.`
  }
  const valeur = valeurSaisie(saisie.valeur)
  if (!Number.isFinite(valeur)) return null
  const centimes = Math.round(cumul * 100)
  const valeurCentimes = Math.round(valeur * 100)
  // `immobilisations_cumul_repris_borne` : de zéro à la valeur, la base amortissable.
  if (centimes > valeurCentimes) {
    return `Le cumul repris ne dépasse pas la valeur du bien, ${formatMoney(valeur)} : c’est elle qui s’amortit.`
  }
  // `immobilisations_cumul_repris_plan` : un cumul positif suppose le bien en service ce jour-là ; un cumul plus petit que la
  // valeur, un plan qui court encore au moins un jour après lui.
  const service = saisie.dateMiseEnService || saisie.dateAcquisition
  if (centimes > 0 && service > au) {
    return `Le bien est mis en service après le ${formatDate(au)} : rien n’en était amorti ce jour-là. Le cumul repris vaut 0, `
      + 'sinon la mise en service est celle de l’ancien tableau.'
  }
  const duree = Number(saisie.duree)
  if (centimes < valeurCentimes && /^\d+$/.test(saisie.duree.trim()) && duree >= 1 && rang360(service) + 360 * duree < rang360(au) + 2) {
    return `Le plan du registre, ${duree} an${duree > 1 ? 's' : ''} depuis le ${formatDate(service)}, est fini au ${formatDate(au)} : `
      + `le cumul repris vaut alors la valeur du bien, ${formatMoney(valeur)}, sinon la durée et la mise en service sont celles `
      + 'de l’ancien tableau.'
  }
  return null
}

/** Ce que la garde de la base (`garder_cumul_repris`) refuserait : poser, changer ou retirer le cumul repris d'un bien une fois
 *  validé un exercice qui suit sa date — celle d'hier comme celle de demain —, avec les mots de `exercice_fige`. `avant` : le
 *  cumul que le bien porte (nul pour une inscription). Rien quand le cumul ne change pas. */
export function refusDuCumulFige(
  avant: Pick<Immobilisation, 'cumul_repris' | 'cumul_repris_au'> | null,
  apres: { cumul_repris: number | null; cumul_repris_au: string | null },
  anneesValidees: readonly number[],
): string | null {
  const change = avant === null
    || (avant.cumul_repris ?? null) !== apres.cumul_repris || (avant.cumul_repris_au ?? null) !== apres.cumul_repris_au
  if (!change) return null
  for (const au of [avant?.cumul_repris_au ?? null, apres.cumul_repris_au]) {
    if (au == null) continue
    const fige = exerciceQuiFige(anneeDe(au) + 1, anneesValidees)
    if (fige) return `${fige} : le cumul repris d’un bien ne change plus.`
  }
  return null
}

/** Ce que l'écran dit sous le champ. */
export function phraseDuCumulRepris(ouverture: string): string {
  return `Les amortissements cumulés au ${formatDate(dateDuCumulRepris(ouverture))}, ceux de l’ancien tableau : le plan continue `
    + 'depuis eux, la valeur nette restante répartie sur la durée qui reste. Vide, le cumul se recalcule depuis la mise en service.'
}
