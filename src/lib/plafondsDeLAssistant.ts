// LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT (OPT1-Q3 (B), tranchée par le cabinet le 19/11/2026). Le relevé
// du 19/11/2026 sur la réplique : la policy `cabinets_select` ouvre à tout accès client d'un dossier la ligne ENTIÈRE de son
// cabinet, donc `limite_ia_alerte_usd` et `limite_ia_blocage_usd` — ce que le cabinet paie d'assistant, que son client n'a
// pas à lire. La RLS ne cache que des lignes ; une colonne se ferme par les droits de PostgreSQL. La migration préparée
// `plafonds_hors_du_client` (supabase/preparees/20261119150000_plafonds_hors_du_client.sql) retire la lecture de la TABLE aux
// deux rôles de l'API et leur rend chaque colonne, les deux plafonds exceptés ; l'équipe du cabinet et le super-administrateur
// les lisent par `plafonds_de_l_assistant()` (security definer, `admin_du_cabinet`). Le récit : HISTORIQUE.md, « 19/11/2026 —
// OPT1-Q3 : LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT ».
//
// UN RESSERREMENT VIENT EN DERNIER. D'abord l'application : aucune lecture de `cabinets` qu'un connecté fait ne demande plus
// `*` ni un plafond — `lecturesDesCabinets.test.ts` le garde, sur tout le dépôt —, l'écran du super-administrateur excepté,
// qui lit les plafonds de la table tant que ce drapeau est baissé et par la fonction quand il est levé. Puis la migration,
// puis ce drapeau levé dans le même commit que le fichier de la migration posé dans l'export. Entre les deux, l'écran du
// super-administrateur dit sa lecture refusée (aucun plafond n'est offert à la modification sur une lecture ratée) ;
// l'assistant, qui lit les plafonds avec la clé du service, n'en voit rien.

/** Vrai quand la migration `plafonds_hors_du_client` est en base : l'écran du super-administrateur lit alors les plafonds par
 *  `plafonds_de_l_assistant()`, jamais par la table, que les rôles de l'API ne lisent plus sur ces deux colonnes. */
export const PLAFONDS_HORS_DU_CLIENT_PREVUS: boolean = false

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
