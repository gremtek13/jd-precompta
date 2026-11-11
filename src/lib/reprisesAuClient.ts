import type { ReponseDeLaBase } from './couvertureReleve'
import type { PiecesCitees } from './facturesSources'
import type { RepriseDeLaFacture } from './encaissementsFactures'
import { messageErreur } from './messageErreur'

// LES FACTURES REPRISES, AU CLIENT (ligne 51.5 ; A8C-Q1 et A8Q5-Q2, tranchées par le cabinet le 11/11/2026 ; HISTORIQUE.md,
// « A8C-Q1 ET A8Q5-Q2 : LES FACTURES REPRISES, AU CLIENT »). La migration `reprises_au_client`
// (supabase/preparees/20261111151000_reprises_au_client.sql, PRÉPARÉE) pose deux fonctions de lecture :
//   - `reprise_de_la_facture(dossier, facture)` : d'une facture reprise de l'ancien logiciel, les chiffres que les plafonds
//     d'`enregistrer_encaissement` lisent dans le registre des reprises (`factures_importees`, que le cabinet lit seul) — la
//     date de reprise, la nature, l'encaissé avant la reprise et ce que ses avoirs repris créditent, au total et par taux,
//     en centimes. Au cabinet du dossier et à l'accès « Ventes » (A8C-Q1 : le client enregistre lui-même l'encaissement
//     d'une facture reprise) ; la fenêtre des encaissements, la même dans les deux espaces, juge alors avant le clic comme
//     la base (`RepriseDeLaFacture`, lib/encaissementsFactures.ts) ;
//   - `pieces_citees_de_la_simulation(dossier)` : les pièces qui sont l'original d'une facture reprise (lien actif), leurs
//     seuls identifiants, pour « Ma simulation » d'un client « Banque » (A8Q5-Q2) : en trésorerie, une telle pièce ne compte
//     que ses paiements (A8c4, lib/facturesSources.ts).
//
// CE MODULE EST LA LECTURE, PURE : il n'importe pas `supabase.ts`. L'écran appelle la base et passe la REQUÊTE telle quelle,
// que la lecture attend (le patron de lib/simulationVentesFacturees.ts) ; elle ne rejette jamais : un refus, une valeur d'une
// autre forme ou une requête qui lève rendent une lecture ILLISIBLE, avec son motif — jamais un plafond deviné ni un ensemble
// de pièces vide.
//
// LE DRAPEAU, BAISSÉ tant que la migration n'est pas en production : la fenêtre des encaissements ne lit pas la reprise
// d'une facture reprise (elle la refuse, `REFUS_REPRISE_NON_LUE`, et l'onglet Factures n'offre pas « Encaissements » sur
// elle), et « Ma simulation » ne lit pas les pièces citées (`AUCUNE_PIECE_CITEE`, comme hier). Levé, l'une et l'autre
// appellent leur fonction. Il se lit À CHAQUE APPEL, par `reprisesAuClientPrevues` : les tests jouent ses deux états par un
// accesseur sur l'objet ci-dessous.
export const DRAPEAU_DES_REPRISES_AU_CLIENT = {
  /** Faux tant que la migration `reprises_au_client` n'est pas en production (puis dans l'export). */
  REPRISES_AU_CLIENT_PREVUES: false as boolean,
}

/** Le drapeau, lu à l'appel. */
export function reprisesAuClientPrevues(): boolean {
  return DRAPEAU_DES_REPRISES_AU_CLIENT.REPRISES_AU_CLIENT_PREVUES
}

/** Les deux fonctions de la migration, sous les noms que l'écran passe à la base. */
export const FONCTION_DE_LA_REPRISE = 'reprise_de_la_facture'
export const FONCTION_DES_PIECES_CITEES = 'pieces_citees_de_la_simulation'

/** Les refus des deux fonctions, aux mots de la migration (reprisesAuClient.test.ts les confronte à son texte). */
export const REFUS_DES_REPRISES_AU_CLIENT = {
  acces: 'Accès refusé à ce dossier.',
  introuvable: 'Facture reprise introuvable dans ce dossier.',
} as const

/** Les clés que `reprise_de_la_facture` rend, et elles seules. */
export const CLES_DE_LA_REPRISE = [
  'credite_par_les_repris_centimes', 'credite_par_les_repris_par_taux', 'encaisse_avant_reprise_centimes', 'encaisse_par_taux',
  'nature_operation', 'reprise_le',
] as const

const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const objetSimple = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const entierSur = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const tauxLisible = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100

function dateCivile(v: string): boolean {
  const m = DATE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

// Une liste de {taux, <clé du montant>} : deux clés exactement, un taux lisible et jamais répété, des centimes entiers (non
// négatifs quand `positifs`). Null pour toute autre forme.
function parTauxLu(v: unknown, cle: string, positifs: boolean): { taux: number; centimes: number }[] | null {
  if (!Array.isArray(v)) return null
  const attendues = [cle, 'taux'].sort(ordreC)
  const lus: { taux: number; centimes: number }[] = []
  for (const element of v) {
    if (!objetSimple(element)) return null
    const cles = Object.keys(element).sort(ordreC)
    if (cles.length !== 2 || cles[0] !== attendues[0] || cles[1] !== attendues[1]) return null
    const taux = element.taux
    const centimes = element[cle]
    if (!tauxLisible(taux) || !entierSur(centimes) || (positifs && centimes < 0)) return null
    if (lus.some((l) => l.taux === taux)) return null
    lus.push({ taux, centimes })
  }
  return lus
}

/**
 * La valeur que rend `reprise_de_la_facture`, pour la facture demandée : un objet aux six clés de `CLES_DE_LA_REPRISE`, et
 * elles seules. Toute autre forme rend `null` : une valeur qu'on ne sait pas lire ne passe jamais pour un plafond.
 */
export function repriseDeLaFactureRendue(rendu: unknown, factureId: string): RepriseDeLaFacture | null {
  if (!objetSimple(rendu)) return null
  const cles = Object.keys(rendu).sort(ordreC)
  if (cles.length !== CLES_DE_LA_REPRISE.length || cles.some((c, i) => c !== CLES_DE_LA_REPRISE[i])) return null
  const repriseLe = rendu.reprise_le
  if (repriseLe !== null && (typeof repriseLe !== 'string' || !dateCivile(repriseLe))) return null
  const nature = rendu.nature_operation
  if (nature !== null && typeof nature !== 'string') return null
  const avant = rendu.encaisse_avant_reprise_centimes
  const credite = rendu.credite_par_les_repris_centimes
  if (!entierSur(avant) || avant < 0 || !entierSur(credite)) return null
  const avantParTaux = parTauxLu(rendu.encaisse_par_taux, 'encaisse_centimes', true)
  const crediteParTaux = parTauxLu(rendu.credite_par_les_repris_par_taux, 'ttc_centimes', false)
  if (!avantParTaux || !crediteParTaux) return null
  return {
    factureId,
    repriseLe,
    natureOperation: nature,
    encaisseAvantRepriseCentimes: avant,
    encaisseParTaux: avantParTaux.map((t) => ({ taux: t.taux, encaisseCentimes: t.centimes })),
    crediteParLesReprisCentimes: credite,
    crediteParLesReprisParTaux: crediteParTaux.map((t) => ({ taux: t.taux, ttcCentimes: t.centimes })),
  }
}

/** Ce que la fenêtre a lu de la reprise d'une facture : ce qu'elle porte, ou le motif de son manque. */
export type LectureDeLaReprise =
  | { factureId: string; etat: 'lue'; reprise: RepriseDeLaFacture }
  | { factureId: string; etat: 'illisible'; motif: string }

/** La réponse de la base, attendue, en lecture. */
export function lectureDeLaReprise(factureId: string, reponse: ReponseDeLaBase): LectureDeLaReprise {
  if (reponse.error) return { factureId, etat: 'illisible', motif: messageErreur(reponse.error, 'lecture refusée') }
  const reprise = repriseDeLaFactureRendue(reponse.data, factureId)
  return reprise ? { factureId, etat: 'lue', reprise } : { factureId, etat: 'illisible', motif: 'valeur illisible' }
}

/**
 * La lecture telle que la fenêtre la fait : `lireLaRepriseDeLaFacture(factureId,
 * supabase.rpc('reprise_de_la_facture', { p_dossier_id, p_facture_id }))`. La requête est ATTENDUE ici et son erreur lue ;
 * une requête qui lève tombe du côté signalé. Ne rejette jamais.
 */
export async function lireLaRepriseDeLaFacture(factureId: string, requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDeLaReprise> {
  try {
    return lectureDeLaReprise(factureId, await requete)
  } catch (erreur) {
    return lectureDeLaReprise(factureId, { data: null, error: erreur })
  }
}

/**
 * La valeur que rend `pieces_citees_de_la_simulation` : un tableau d'identifiants, sans doublon. Toute autre forme rend
 * `null` : jamais un ensemble vide deviné.
 */
export function piecesCiteesRendues(rendu: unknown): PiecesCitees | null {
  if (!Array.isArray(rendu)) return null
  const lues = new Set<string>()
  for (const id of rendu) {
    if (typeof id !== 'string' || !IDENTIFIANT.test(id) || lues.has(id)) return null
    lues.add(id)
  }
  return lues
}

/** Ce que « Ma simulation » a lu des pièces citées : l'ensemble, ou le motif de son manque. */
export type LectureDesPiecesCitees = { etat: 'lues'; piecesCitees: PiecesCitees } | { etat: 'illisibles'; motif: string }

/**
 * La lecture telle que « Ma simulation » la fait : `lireLesPiecesCiteesDeLaSimulation(supabase.rpc(
 * 'pieces_citees_de_la_simulation', { p_dossier_id }))`. Attendue, son erreur lue ; ne rejette jamais.
 */
export async function lireLesPiecesCiteesDeLaSimulation(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDesPiecesCitees> {
  let reponse: ReponseDeLaBase
  try {
    reponse = await requete
  } catch (erreur) {
    reponse = { data: null, error: erreur }
  }
  if (reponse.error) return { etat: 'illisibles', motif: `pièces citées refusées : ${messageErreur(reponse.error, 'raison inconnue')}` }
  const piecesCitees = piecesCiteesRendues(reponse.data)
  return piecesCitees ? { etat: 'lues', piecesCitees } : { etat: 'illisibles', motif: 'pièces citées illisibles' }
}
