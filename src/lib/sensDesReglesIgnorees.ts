import type { SensMouvementBancaire } from './types'

// LE SENS DES RÈGLES « TOUJOURS IGNORER », ET LA COTISATION D'UN MOUVEMENT IGNORÉ — CE QUE LA BASE EN DIRA AVANT LE CLIC
// (REGLES-Q1, tranchée par le cabinet le 02/11/2026 : « La migration (le sens retenu par la règle) »). La conception :
// HISTORIQUE.md, « 31/10/2026 — LES LOTS DU RELEVÉ : LE SENS, LA FENÊTRE DU JUSTIFICATIF, « TOUJOURS IGNORER » ET LE
// MOUVEMENT TRAITÉ AILLEURS », défauts 9 et 11c ; la base : la migration `sens_des_regles_ignorees`, préparée le 02/11/2026,
// collée en production par le cabinet le 03/11/2026 (supabase/schema/20261103114023_sens_des_regles_ignorees.sql).
//
// PUR, et SANS AUTRE IMPORT QU'UN TYPE : lib/reglesIgnorees.ts (le jugement de l'import), lib/cotisationRapprochee.ts (le
// refus d'avant le clic) et l'onglet Banque le lisent ; un accesseur de test (`get SENS_DES_REGLES_IGNOREES_EXPORTE()`)
// joue le drapeau dans ses deux états chez eux. Les fonctions d'ici prennent le drapeau en paramètre (`…Selon`) : lu ici,
// il serait la constante du module, que l'accesseur ne remplace pas.
//
// CE QUE LA MIGRATION POSE, ET QUE CE MODULE REDIT (`sensDesReglesIgnorees.test.ts` le confronte à son texte et à son essai,
// supabase/essais/sensDesReglesIgnorees.sql) :
//   - `regles_bancaires_ignorees.sens` : « encaissement » ou « decaissement » (les mots de `regles_affectation_bancaire`),
//     ou nul — LES DEUX SENS, ce que vaut toute règle d'avant, et ce que vaut toute règle tant que la colonne n'est pas lue ;
//   - la clé `regles_bancaires_ignorees_unique` (dossier, motif, sens ; deux nuls égaux) à la place de la clé d'hier sur le
//     motif seul : la même règle — même motif, même sens — se refuse (23505) ; deux sens d'un motif, non ;
//   - le refus neuf de `rapprocher_cotisation` : un mouvement ignoré (22023), après celui d'un mouvement classé (un
//     virement personnel, « ignoré » lui aussi, garde ces mots-là) et avant celui d'un mouvement de zéro euro.
//
// LE DRAPEAU. `SENS_DES_REGLES_IGNOREES_EXPORTE`, LEVÉ le 03/11/2026 (la migration dans l'export). Baissé, l'onglet
// Banque écrit une règle sans sens, l'import juge chaque règle sur le motif seul, les phrases et la liste sont celles
// d'hier, et la fiche d'un mouvement ne refuse rien de plus — au caractère près. Levé, le jour de l'application (le fichier
// dans l'export, sous la version de sa ligne d'historique), une règle née d'un débit ne fait ignorer que les débits, et
// l'écran dit le sens. Levé AVANT la migration, la création d'une règle se refuserait (une colonne inconnue) : le drapeau
// suit le fichier (`sensDesReglesIgnorees.test.ts`).
export const SENS_DES_REGLES_IGNOREES_EXPORTE = true

// ── Les mots de la base ───────────────────────────────────────────────────────────────────────────────────────────────

/** Le refus neuf de `rapprocher_cotisation`, son code et ses mots (l'apostrophe de l'écran ; la base porte la droite). */
export const REFUS_MOUVEMENT_IGNORE = { code: '22023', message: 'Ce mouvement est ignoré : remets-le d’abord à traiter.' } as const

/** Les deux contraintes que la migration pose sur la table, et la clé qu'elle retire. */
export const CONTRAINTE_DU_SENS = 'regles_bancaires_ignorees_sens'
export const CLE_DES_REGLES = 'regles_bancaires_ignorees_unique'
export const CLE_D_HIER = 'regles_bancaires_ignorees_dossier_id_motif_key'

/** Les deux sens qu'une règle retient — les mots de `regles_affectation_bancaire.sens`, dans l'ordre de sa contrainte. */
export const SENS_D_UNE_REGLE = ['encaissement', 'decaissement'] as const satisfies readonly SensMouvementBancaire[]

// ── Le sens d'une règle ───────────────────────────────────────────────────────────────────────────────────────────────

/** Une règle telle que l'onglet la lit : `sens` absent tant que la colonne n'existe pas, nul pour une règle d'avant. */
export interface RegleDeSens {
  motif: string
  sens?: SensMouvementBancaire | null
}

/**
 * Le sens d'une règle : celui que la base porte, le drapeau levé ; nul — les deux sens — sinon, et pour une règle d'avant.
 * Baissé, rien de lu ne compte : chaque règle juge sur son motif seul, comme hier, au caractère près.
 */
export function sensDeLaRegleSelon(parSens: boolean, regle: Pick<RegleDeSens, 'sens'>): SensMouvementBancaire | null {
  return parSens ? regle.sens ?? null : null
}

/**
 * Une règle de ce sens vaut-elle pour un mouvement de celui-là ? Nulle, pour tout mouvement ; d'un sens, pour ce sens seul —
 * un mouvement de zéro euro, qui n'en a aucun, n'est reconnu que par une règle des deux sens.
 */
export function vautPourLeSens(sensDeLaRegle: SensMouvementBancaire | null, sensDuMouvement: SensMouvementBancaire | null): boolean {
  return sensDeLaRegle === null || sensDeLaRegle === sensDuMouvement
}

/** Les mots du sens d'une règle, ceux que l'onglet dit déjà d'une règle d'affectation. */
export function motsDuSens(sens: SensMouvementBancaire | null): string {
  return sens === 'encaissement' ? 'encaissements' : sens === 'decaissement' ? 'paiements' : 'les deux sens'
}

/** Le nom d'une règle dans une phrase : son motif, et, le drapeau levé, son sens. Baissé, le nom d'hier. */
export function nomDeLaRegleSelon(parSens: boolean, regle: RegleDeSens): string {
  return parSens ? `« ${regle.motif} » (${motsDuSens(sensDeLaRegleSelon(true, regle))})` : `« ${regle.motif} »`
}

// ── La règle qu'on crée ───────────────────────────────────────────────────────────────────────────────────────────────

/** Une règle ne naît pas d'un mouvement sans sens : elle retient celui du mouvement qui la crée (le drapeau levé). */
export const REFUS_REGLE_SANS_SENS =
  'Un mouvement de zéro euro n’a pas de sens, et une règle « toujours ignorer » retient le sens du mouvement qui la crée : '
  + 'crée-la depuis un paiement ou un encaissement de ce tiers.'

/**
 * Pourquoi la règle née de ce mouvement, sous ce motif (normalisé), ne s'enregistrerait pas, dit AVANT d'écrire — le
 * drapeau levé seulement : baissé, la création d'hier, inchangée (la base refuse alors le même motif, sous ses mots). Levé :
 * un mouvement de zéro euro n'a pas de sens à retenir ; la même règle — même motif, même sens — existe déjà : la clé
 * `regles_bancaires_ignorees_unique` la refuserait (23505). Une règle des deux sens du même motif n'empêche pas celle d'un
 * sens : c'est le chemin qui la remplace (créer celle-ci, puis retirer celle-là).
 */
export function refusDeLaRegleNeuveSelon(
  parSens: boolean,
  sensDuMouvement: SensMouvementBancaire | null,
  motif: string,
  regles: readonly RegleDeSens[],
): string | null {
  if (!parSens) return null
  if (sensDuMouvement === null) return REFUS_REGLE_SANS_SENS
  const meme = regles.find((r) => r.motif === motif && sensDeLaRegleSelon(true, r) === sensDuMouvement)
  return meme ? `La règle ${nomDeLaRegleSelon(true, meme)} existe déjà.` : null
}
