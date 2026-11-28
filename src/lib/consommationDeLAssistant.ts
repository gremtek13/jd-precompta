// LE JOURNAL DE CONSOMMATION DE L'ASSISTANT, QUE LA FONCTION `agent-comptable` ÉCRIT SEULE (ASSIST-Q1 (A), tranchée par le
// cabinet le 27/11/2026). Le constat de la relecture adverse de sécurité des Edge Functions du 27/11/2026 : le plafond mensuel de
// l'assistant se comptait sur les lignes `agent_conversations` que CET écran écrit après la réponse (AssistantTab,
// `enregistrer`), avec les tokens qu'elle lui rend, et que tout le cabinet du dossier réécrit ou retire ; un appel direct de la
// fonction, une réponse en erreur après le modèle, n'en écrivaient aucune. La migration préparée `consommations_de_l_assistant`
// (supabase/preparees/20261127232000_…) pose le journal : une ligne par appel au modèle, écrite et lue sous la clé du service,
// aucun droit aux rôles de l'API ; le super-administrateur en lit les sommes par `consommation_de_l_assistant(p_depuis)`. Le récit :
// HISTORIQUE.md, « 27/11/2026 — ASSIST-Q1 : LE JOURNAL DE CONSOMMATION DE L'ASSISTANT (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// LE DRAPEAU, JUMEAU DE LA CONSTANTE DE LA FONCTION (agentComptableConsommation.test.ts les veut égaux). Baissé : l'application
// d'hier — l'assistant écrit les tokens de sa réponse dans `agent_conversations`, l'écran des comptes les y somme. Levé, dans le
// commit qui range la migration dans l'export, la fonction déployée depuis ce commit AVANT sa fusion : l'assistant n'écrit plus de
// tokens (les colonnes d'`agent_conversations` restent, pour l'historique d'avant) ; l'écran des comptes lit le journal par sa
// fonction ; la table entre au plan de sauvegarde, une table du cabinet, hors de l'export d'un dossier.

/** Faux tant que la migration `consommations_de_l_assistant` n'est pas en base (le jumeau de la constante de la fonction). */
export const CONSOMMATION_TENUE_PAR_LA_FONCTION: boolean = false

/** La table du journal, au plan de sauvegarde derrière le drapeau. */
export const TABLES_DES_CONSOMMATIONS = ['consommations_de_l_assistant'] as const

/** La lecture des sommes, au super-administrateur seul. */
export const LECTURE_DES_CONSOMMATIONS = 'consommation_de_l_assistant' as const

/** Les bornes que la table pose sur les tokens d'un appel (ses contraintes ; la fonction note à ces bornes). */
export const BORNE_DES_TOKENS_D_ENTREE = 10_000_000
export const BORNE_DES_TOKENS_DE_SORTIE = 1_000_000

/** Ce que l'assistant dit quand la fonction n'a pas pu noter la consommation de la réponse qu'elle rend (`consommation_non_notee`). */
export const AVERTISSEMENT_CONSOMMATION_NON_NOTEE =
  'La consommation de cette réponse n’a pas pu être notée par le serveur : le plafond d’usage du cabinet ne la compte pas. '
  + 'Si cela se répète, préviens l’administrateur de la plateforme (Comptes master).'

/** Une ligne rendue par `consommation_de_l_assistant(p_depuis)`. PostgREST rend un `bigint` en nombre JSON ; une chaîne se relit. */
export interface LigneConsommation {
  cabinet_id: string
  tokens_entree: number | string | null
  tokens_sortie: number | string | null
  tokens_entree_depuis: number | string | null
  tokens_sortie_depuis: number | string | null
}

/** La consommation d'un cabinet, LUE : depuis toujours, et depuis le premier instant du mois. */
export interface ConsommationLue {
  tokensEntree: number
  tokensSortie: number
  tokensEntreeDuMois: number
  tokensSortieDuMois: number
}

function entier(valeur: number | string | null): number | null {
  const n = typeof valeur === 'number' ? valeur : typeof valeur === 'string' && /^\d+$/.test(valeur) ? Number(valeur) : NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * La consommation de chaque cabinet, par identifiant, et les cabinets dont une ligne ne se lit pas. Un cabinet ABSENT de la
 * carte n'a rien consommé (la fonction ne rend que les cabinets qui ont une ligne) — sauf s'il est nommé parmi les
 * illisibles : une ligne en double, une somme qui n'est pas un entier positif, un mois plus grand que le total. L'écran dit
 * alors la lecture partielle, jamais un zéro deviné.
 */
export function consommationsParCabinet(lignes: readonly LigneConsommation[]): { carte: Map<string, ConsommationLue>; illisibles: string[] } {
  const vues = new Map<string, number>()
  for (const l of lignes) vues.set(l.cabinet_id, (vues.get(l.cabinet_id) ?? 0) + 1)
  const carte = new Map<string, ConsommationLue>()
  const illisibles = new Set<string>()
  for (const l of lignes) {
    const valeurs = [l.tokens_entree, l.tokens_sortie, l.tokens_entree_depuis, l.tokens_sortie_depuis].map(entier)
    const [e, s, em, sm] = valeurs
    if (vues.get(l.cabinet_id) !== 1 || e === null || s === null || em === null || sm === null || em > e || sm > s) {
      illisibles.add(l.cabinet_id)
      continue
    }
    carte.set(l.cabinet_id, { tokensEntree: e, tokensSortie: s, tokensEntreeDuMois: em, tokensSortieDuMois: sm })
  }
  return { carte, illisibles: [...illisibles].sort() }
}

/** Le premier instant du mois calendaire UTC de `maintenant` — la frontière que la fonction compare au plafond. */
export function debutDuMoisUtc(maintenant: Date): string {
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1)).toISOString()
}
