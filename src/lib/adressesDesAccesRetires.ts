import type { LectureComplete } from './lectureComplete'
import type { AdresseDUnAccesRetire } from './types'

// L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE DES DROITS (espace client, ligne 51.5 ; décision du cabinet du 11/11/2026,
// P1T-E2, contre la recommandation : « Garder l'adresse dans l'historique »). La migration `adresse_des_acces_retires`
// (PRÉPARÉE, pas appliquée : supabase/preparees/20261111173000_adresse_des_acces_retires.sql) pose la table
// `adresses_des_acces_retires` — le dossier, l'accès parti, l'adresse qu'il portait et l'instant du départ —, écrite par un
// déclencheur sur `memberships` au départ d'un accès que la trace nomme, immuable, partie avec son dossier, lue par le cabinet
// du dossier seul. Le récit : HISTORIQUE.md, « 11/11/2026 — P1T-E2 » ; les essais : supabase/essais/adresseDesAccesRetires.sql
// et, sur une réplique seulement, adresseDesAccesRetiresSuppression.sql ; le registre : RGPD.md.
//
// Ce module est PUR : le drapeau, la table au plan de sauvegarde, et la règle qui juge une lecture. La lecture est dans
// traceDesDroitsLecture.ts, l'écran dans pages/dossier/TraceDesDroitsDesAcces.tsx (lib/traceDesDroitsVue.ts, `groupesDeLaTrace`).
//
// LE DRAPEAU, baissé tant que la migration n'est pas dans l'export (adressesDesAccesRetires.test.ts le lie au fichier) : ni
// lecture ni table au plan de sauvegarde — la lire avant sa migration ferait échouer toute sauvegarde, et l'onglet Accès
// dirait « lue en partie » d'une table qui n'existe pas. Levé, l'onglet nomme un accès retiré par l'adresse qu'il portait à
// son départ, et la sauvegarde l'emporte.
export const ADRESSES_DES_ACCES_RETIRES_PREVUES = false

/** La table, au plan de sauvegarde derrière le drapeau (src/lib/sauvegarde.ts, `auPlanDesAdressesDesAccesRetires`). */
export const TABLES_DES_ADRESSES_DES_ACCES_RETIRES: readonly string[] = ['adresses_des_acces_retires']

/** L'adresse retenue d'un accès parti : la plus récente, quand il est parti plus d'une fois. */
export interface AdresseRetenue {
  adresse: string
  /** L'instant du départ (`retire_le`). */
  retireLe: string
}

/** Les adresses lues, par accès ; `motif` NON NUL dès que la lecture n'est pas entière ou qu'une ligne ne se lit pas. */
export interface AdressesRetenues {
  parAcces: ReadonlyMap<string, AdresseRetenue>
  motif: string | null
}

/** Une ligne telle que la base la rend, jugée : une adresse non blanche, un instant valide, un accès nommé. */
function adresseLisible(brute: AdresseDUnAccesRetire): AdresseRetenue | null {
  if (typeof brute.acces_id !== 'string' || brute.acces_id === '') return null
  if (typeof brute.adresse !== 'string' || brute.adresse.trim() === '') return null
  if (typeof brute.retire_le !== 'string' || Number.isNaN(Date.parse(brute.retire_le))) return null
  return { adresse: brute.adresse, retireLe: brute.retire_le }
}

/**
 * La lecture jugée. Chaque accès garde son départ le plus récent (un accès revenu puis reparti — un geste du service, jamais de
 * l'écran). Une lecture partielle ou une ligne illisible rendent un `motif` : les adresses lues restent vraies, mais un accès
 * absent d'ici n'est pas prouvé sans adresse.
 */
export function adressesDeLaLecture(
  lecture: Pick<LectureComplete<AdresseDUnAccesRetire>, 'lignes' | 'complete' | 'motif'>,
): AdressesRetenues {
  const parAcces = new Map<string, AdresseRetenue>()
  let ecartees = 0
  for (const brute of lecture.lignes) {
    const lue = adresseLisible(brute)
    if (lue === null) { ecartees += 1; continue }
    const deja = parAcces.get(brute.acces_id)
    if (deja === undefined || Date.parse(lue.retireLe) > Date.parse(deja.retireLe)) parAcces.set(brute.acces_id, lue)
  }
  const motifs: string[] = []
  if (!lecture.complete) motifs.push(lecture.motif ?? 'lecture incomplète')
  if (ecartees > 0) motifs.push(`${ecartees} ligne(s) portent une adresse ou une date que cet écran ne lit pas`)
  return { parAcces, motif: motifs.length === 0 ? null : motifs.join(' ; ') }
}
