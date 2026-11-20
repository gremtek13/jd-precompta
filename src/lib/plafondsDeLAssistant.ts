// LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT (OPT1-Q3 (B), tranchée par le cabinet le 19/11/2026). Le relevé
// du 19/11/2026 sur la réplique : la policy `cabinets_select` ouvre à tout accès client d'un dossier la ligne ENTIÈRE de son
// cabinet, donc `limite_ia_alerte_usd` et `limite_ia_blocage_usd` — ce que le cabinet paie d'assistant, que son client n'a
// pas à lire. La RLS ne cache que des lignes ; une colonne se ferme par les droits de PostgreSQL. La migration
// `plafonds_hors_du_client` (supabase/schema/20261120101707_plafonds_hors_du_client.sql), EN PRODUCTION depuis le 20/11/2026
// (245, par l'outil), retire la lecture de la TABLE aux deux rôles de l'API et leur rend chaque colonne, les deux plafonds
// exceptés ; l'équipe du cabinet et le super-administrateur les lisent par `plafonds_de_l_assistant()` (security definer,
// `admin_du_cabinet` ; OPT1Q3-Q1 (A)). Le récit : HISTORIQUE.md, « 19/11/2026 — OPT1-Q3 : LES PLAFONDS DE L'ASSISTANT HORS DE
// LA LECTURE DU CLIENT », puis « OPT1-Q3 EN PRODUCTION ».
//
// UN RESSERREMENT VIENT EN DERNIER, et il est venu : l'application d'abord — aucune lecture de `cabinets` qu'un connecté fait
// ne demande `*` ni un plafond, `lecturesDesCabinets.test.ts` le garde sur tout le dépôt, sans exception pour l'écran du
// super-administrateur —, puis la migration, puis ce drapeau levé. L'écran du super-administrateur ne lit plus les plafonds que
// par la fonction : la lecture par la table, refusée par la base depuis la migration, est retirée. L'assistant, qui lit les
// plafonds avec la clé du service, n'en voit rien.

/** Vrai depuis le 20/11/2026 : la migration `plafonds_hors_du_client` est en base, et l'écran du super-administrateur lit les
 *  plafonds par `plafonds_de_l_assistant()`, jamais par la table, que les rôles de l'API ne lisent plus sur ces deux colonnes. */
export const PLAFONDS_HORS_DU_CLIENT_PREVUS: boolean = true

/** Les deux colonnes fermées aux rôles de l'API par la migration. */
export const COLONNES_DES_PLAFONDS = ['limite_ia_alerte_usd', 'limite_ia_blocage_usd'] as const

/** Une ligne rendue par `plafonds_de_l_assistant()`. PostgREST rend un `numeric` en nombre JSON ; une chaîne se relit. */
export interface LignePlafonds {
  cabinet_id: string
  limite_ia_alerte_usd: number | string | null
  limite_ia_blocage_usd: number | string | null
}

/** Les plafonds d'un cabinet, LUS : `null` y veut dire « aucun plafond », jamais « pas lu ». */
export interface PlafondsLus {
  limite_ia_alerte_usd: number | null
  limite_ia_blocage_usd: number | null
}

function montant(valeur: number | string | null): number | null | 'illisible' {
  if (valeur === null) return null
  const n = typeof valeur === 'number' ? valeur : Number(valeur)
  return Number.isFinite(n) && n >= 0 ? n : 'illisible'
}

/** Les plafonds de chaque cabinet, par identifiant. Un cabinet ABSENT de la carte n'a pas été lu : l'écran le dit
 *  « illisible » et n'offre aucune modification — un formulaire prérempli de vide effacerait un plafond (un plafond nul
 *  n'en est pas un). Une ligne en double ou une valeur illisible rend le cabinet illisible, jamais une des deux valeurs. */
export function plafondsParCabinet(lignes: readonly LignePlafonds[]): Map<string, PlafondsLus> {
  const vues = new Map<string, number>()
  for (const l of lignes) vues.set(l.cabinet_id, (vues.get(l.cabinet_id) ?? 0) + 1)
  const carte = new Map<string, PlafondsLus>()
  for (const l of lignes) {
    if (vues.get(l.cabinet_id) !== 1) continue
    const alerte = montant(l.limite_ia_alerte_usd)
    const blocage = montant(l.limite_ia_blocage_usd)
    if (alerte === 'illisible' || blocage === 'illisible') continue
    carte.set(l.cabinet_id, { limite_ia_alerte_usd: alerte, limite_ia_blocage_usd: blocage })
  }
  return carte
}
