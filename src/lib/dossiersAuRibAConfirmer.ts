import { avisDuChangement, lireLeChangementDeRib, type AvisDuChangement, type ChangementDeRib } from './changementDeRib'

// LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET (espace client, étape A5b3c ; décision du cabinet du
// 17/10/2026, A5B3-Q5 : le tableau de bord du cabinet dit EN UNE FOIS quels dossiers ont un RIB qui l'attend). Un module
// PUR — il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — que le tableau de bord de l'étape A5b3d lira :
// la valeur que rend la fonction `dossiers_au_rib_a_confirmer`, LUE SANS RIEN DEVINER, et ce qu'un écran en dira.
//
// UNE SEULE RÈGLE. La fonction n'en a pas d'autre que celle de l'étape A5b3a : un dossier figure dans la liste si et
// seulement si son dernier changement du RIB, tel que `dernier_changement_de_rib` le rend, est un RIB PROPOSÉ ; elle rend
// pour chacun l'objet `changement` de cette fonction, tel quel. Ce module ne la recopie pas davantage : chaque changement se
// lit par `lireLeChangementDeRib` (lib/changementDeRib.ts), et se dit par `avisDuChangement`, au cabinet — les mots mêmes de
// l'avis de la Vue d'ensemble du dossier. Le tableau de bord et la Vue d'ensemble ne peuvent pas dire deux choses du même
// dossier.
//
// CE QUE LA FONCTION REND, toujours un objet : `{ dossiers: [...] }` — la liste vide quand aucun dossier n'attend, une
// AFFIRMATION de la base — ; chaque élément, `{ dossier_id, nom, archive, changement }`, le plus ancien changement d'abord,
// puis l'identifiant. Toute autre forme est ILLISIBLE (`null`), jamais « aucun dossier » : une clé de plus ou de moins, un
// identifiant qui n'est pas celui d'un dossier, un dossier deux fois, un changement que `lireLeChangementDeRib` ne lit pas,
// un changement qui n'est pas une proposition, un ordre qui n'est pas le sien. dossiersAuRibAConfirmer.test.ts confronte
// ces listes au texte même de la fonction, quand l'export la porte, et chaque liste que l'essai
// supabase/essais/dossiersAuRibAConfirmer.sql exige de la base, profil par profil, à la règle rejouée sur l'essai.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `dossiers_au_rib_a_confirmer`, présentée au cabinet, a été appliquée sur son accord (A5B3C-Q1), et l'export
// (supabase/schema) la porte. Ce drapeau est donc levé : lib/dossiersAuRibAConfirmerLecture.ts la lit pour le tableau de
// bord de l'étape A5b3d. dossiersAuRibAConfirmer.test.ts le confronte à l'export, et le module au texte même de la
// fonction. Un retour arrière de la migration ne viendrait qu'APRÈS le drapeau rebaissé en ligne : sinon l'écran recevrait
// un refus et le dirait.
export const DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE: boolean = true

// ── Ce que la fonction rend ─────────────────────────────────────────────────────────────────────────────────────────
/** Les clés de la valeur, à chaque niveau, telles que la fonction les écrit (celles du changement : lib/changementDeRib.ts). */
export const CLES_DES_DOSSIERS_AU_RIB = {
  racine: ['dossiers'],
  dossier: ['dossier_id', 'nom', 'archive', 'changement'],
} as const

/** Un dossier dont un RIB proposé attend la confirmation du cabinet. */
export interface DossierAuRibAConfirmer {
  dossierId: string
  nom: string
  /** La colonne `archive` du dossier : la fonction rend les dossiers archivés aussi, marqués (A5B3C-Q2). */
  archive: boolean
  /** Le dernier changement du RIB du dossier, tel que `dernier_changement_de_rib` le rend : toujours une proposition. */
  changement: ChangementDeRib
}

/** La liste lue : vide, c'est la base qui affirme qu'aucun dossier n'attend. */
export interface DossiersAuRibAConfirmerLus {
  dossiers: DossierAuRibAConfirmer[]
}

// Un identifiant de dossier tel que PostgreSQL l'écrit dans un `jsonb` : la forme canonique, en minuscules.
const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Exactement ces clés, ni plus ni moins.
const exactement = (o: Record<string, unknown>, cles: readonly string[]) =>
  Object.keys(o).length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))

/**
 * La valeur rendue par `dossiers_au_rib_a_confirmer`, lue sans rien deviner : une liste vide seulement de l'objet qui la
 * porte ; sinon chaque élément à ses quatre clés, un identifiant canonique et unique, un nom, une marque « archivé », et un
 * changement que `lireLeChangementDeRib` lit et qui est une PROPOSITION ; dans l'ordre de la fonction — le jour du
 * changement, le plus ancien d'abord, puis l'identifiant —, vérifié et jamais refait. Toute autre valeur : `null`
 * (illisible) — jamais « aucun dossier ».
 */
export function lireLesDossiersAuRibAConfirmer(rendu: unknown): DossiersAuRibAConfirmerLus | null {
  if (!estObjet(rendu) || !exactement(rendu, CLES_DES_DOSSIERS_AU_RIB.racine) || !Array.isArray(rendu.dossiers)) return null
  const dossiers: DossierAuRibAConfirmer[] = []
  const vus = new Set<string>()
  for (const e of rendu.dossiers as unknown[]) {
    if (!estObjet(e) || !exactement(e, CLES_DES_DOSSIERS_AU_RIB.dossier)) return null
    const { dossier_id: dossierId, nom, archive } = e
    if (typeof dossierId !== 'string' || !IDENTIFIANT.test(dossierId) || vus.has(dossierId)) return null
    if (typeof nom !== 'string' || typeof archive !== 'boolean') return null
    // La lecture de l'étape A5b3a, et elle seule : la même forme, les mêmes quinze combinaisons.
    const lu = lireLeChangementDeRib({ changement: e.changement })
    if (lu === null || lu.changement === null || lu.changement.etat !== 'propose') return null
    vus.add(dossierId)
    dossiers.push({ dossierId, nom, archive, changement: lu.changement })
  }
  // Un jour (AAAA-MM-JJ) et un identifiant canonique se comparent comme leurs textes : l'ordre des jours, puis celui des
  // octets de l'identifiant — celui de PostgreSQL.
  for (let i = 1; i < dossiers.length; i++) {
    const [a, b] = [dossiers[i - 1], dossiers[i]]
    if (a.changement.jour > b.changement.jour || (a.changement.jour === b.changement.jour && a.dossierId > b.dossierId)) return null
  }
  return { dossiers }
}

// ── Ce qu'un écran en dira ──────────────────────────────────────────────────────────────────────────────────────────
// Au cabinet, vouvoyé, comme l'avis de la Vue d'ensemble. Le compte, puis une ligne par dossier : son nom, la marque
// « archivé » s'il l'est, et l'avis de son dernier changement, au caractère près (`avisDuChangement`, destinataire
// « cabinet » : « Un accès client a proposé un nouveau RIB pour les factures le … : il attend votre confirmation. », ce que
// les factures porteront, le conseil de la vue des paramètres). Aucun écran n'est écrit ici (le tableau de bord : étape
// A5b3d) ; aucun IBAN ni aucune personne : la fonction n'en rend pas.

/** La liste vide, lue en entier : la base AFFIRME qu'aucun dossier n'attend. */
export const AUCUN_RIB_A_CONFIRMER = 'Aucun RIB proposé n’attend votre confirmation.'
/** La marque d'une ligne dont le dossier est archivé. */
export const MENTION_DOSSIER_ARCHIVE = 'Dossier archivé'
/** Quand la liste n'a pas pu être lue : une ligne DISCRÈTE, jamais le silence qu'on prendrait pour « aucun », et où regarder. */
export const LECTURE_MANQUEE_DE_LA_LISTE =
  'La liste des RIB proposés qui attendent votre confirmation n’a pas pu être lue pour l’instant : la Vue d’ensemble de chaque dossier le dit.'

/** Le compte : combien de dossiers ont un RIB proposé qui attend, et, parmi eux, combien sont archivés. */
export function phraseDuCompte(lu: DossiersAuRibAConfirmerLus): string {
  const n = lu.dossiers.length
  const archives = lu.dossiers.filter((d) => d.archive).length
  if (n === 0) return AUCUN_RIB_A_CONFIRMER
  if (n === 1) {
    return archives === 1
      ? 'Un dossier archivé a un RIB proposé qui attend votre confirmation.'
      : 'Un dossier a un RIB proposé qui attend votre confirmation.'
  }
  if (archives === n) return `${n} dossiers archivés ont un RIB proposé qui attend votre confirmation.`
  const dont = archives === 0 ? '' : archives === 1 ? ', dont un archivé' : `, dont ${archives} archivés`
  return `${n} dossiers ont un RIB proposé qui attend votre confirmation${dont}.`
}

/** Une ligne du tableau de bord : le dossier, et l'avis de son dernier changement tel que la Vue d'ensemble le dit. */
export interface LigneDuDossierAuRib {
  dossierId: string
  nom: string
  archive: boolean
  /** Le jour du changement (AAAA-MM-JJ), pour qui voudrait ranger ou dater autrement que l'avis. */
  jour: string
  avis: AvisDuChangement
}

/** Les lignes, dans l'ordre de la fonction : le plus ancien changement d'abord, puis l'identifiant. */
export function lignesDesDossiers(lu: DossiersAuRibAConfirmerLus): LigneDuDossierAuRib[] {
  return lu.dossiers.map((d) => ({
    dossierId: d.dossierId, nom: d.nom, archive: d.archive, jour: d.changement.jour, avis: avisDuChangement(d.changement, 'cabinet'),
  }))
}

/** Une lecture de la liste, telle que `lib/dossiersAuRibAConfirmerLecture.ts` la rend. */
export type LectureDesDossiersAuRib =
  | { etat: 'en_cours' }
  | { etat: 'lue'; lu: DossiersAuRibAConfirmerLus }
  | { etat: 'illisible' }
  | { etat: 'refusee'; motif: string }

/** Ce qu'un écran dit de la lecture. */
export type CeQueDitLaListe =
  | { genre: 'rien' }
  | { genre: 'aucun'; phrase: string }
  | { genre: 'liste'; phrase: string; lignes: LigneDuDossierAuRib[] }
  | { genre: 'lecture_manquee'; phrase: string; motif: string | null }

/**
 * Ce qu'un écran dit de la liste. `null` — drapeau baissé, ou rien à lire — et `en_cours` : RIEN (aucune affirmation avant
 * la lecture). `lue` : « aucun » sur une liste vide, l'affirmation de la base ; sinon le compte et les lignes. `illisible` et
 * `refusee` : la ligne discrète, `refusee` portant son motif — jamais « aucun ».
 */
export function ceQueDitLaListe(lecture: LectureDesDossiersAuRib | null): CeQueDitLaListe {
  if (lecture === null || lecture.etat === 'en_cours') return { genre: 'rien' }
  if (lecture.etat === 'lue') {
    return lecture.lu.dossiers.length === 0
      ? { genre: 'aucun', phrase: AUCUN_RIB_A_CONFIRMER }
      : { genre: 'liste', phrase: phraseDuCompte(lecture.lu), lignes: lignesDesDossiers(lecture.lu) }
  }
  return { genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_DE_LA_LISTE, motif: lecture.etat === 'refusee' ? lecture.motif : null }
}
