import { porteLaFormeDUnBordereau } from './bordereauDeTeletransmission'
import { formatDate } from './format'

// LES BORDEREAUX DE TÉLÉTRANSMISSION DÉJÀ DÉPOSÉS AU DOSSIER (BOR6T-Q2 (A), réponse du cabinet du 27/11/2026 ; conception 59,
// § 17.1 « les pièces DÉJÀ au dossier »). Le refus au dépôt (BOR6, trois parties) arrête ce qui arrive ; ce qui est arrivé
// AVANT lui reste — une pièce ou un document dont le texte lu (`piece_textes_ocr`) a la forme d'un bordereau, donc des noms de
// patients au dossier, qui n'est pas hébergé pour des données de santé (RGPD.md § 8.7).
//
// UNE ATTENTION DE LA VUE D'ENSEMBLE, CÔTÉ CABINET SEULEMENT, JAMAIS UN PRÉALABLE DE LA VALIDATION. Elle nomme chaque pièce ou
// document par sa DATE DE DÉPÔT et rien d'autre : ni le nom du fichier (il peut porter un nom de patient), ni un tiers, ni un
// extrait du texte. Elle renvoie à sa fiche, où la suppression reste le geste existant, confirmé, au clic du cabinet : rien
// n'est jamais supprimé d'ici.
//
// UN MODULE PUR : le jugement est `porteLaFormeDUnBordereau` (BOR1, la règle du dépôt), jamais recopié, sur les lignes du
// texte telles qu'`extract-piece` les a jointes (`lignes.join("\n")`). Le texte n'entre que dans ce jugement : rien de lui ne
// sort d'ici, que des identifiants.
//
// À LA DEMANDE, ET PAS À CHAQUE OUVERTURE (mesure du 27/11/2026, un dossier fictif de 1 500 pièces) : sans tri par la base,
// les 1 500 textes pèsent 7,5 Mo à rapatrier et 312 ms à juger dans le navigateur ; avec le tri de la base (`PREFILTRE`), les
// seuls candidats — 20 bordereaux fictifs de 200 lignes, 363 Ko — se jugent en 15 ms, mais la base parcourt encore chaque
// texte du dossier, et ce sont les noms des patients qui voyagent jusqu'au navigateur. La Vue d'ensemble s'ouvre plusieurs
// fois par jour : la recherche part d'un clic (« Chercher les bordereaux déjà déposés »).
//
// HORS DU MODULE « PAIEMENTS DE L'ASSURANCE MALADIE » ET DE LA RÈGLE DE LA SECTION (lib/sectionAssuranceMaladie.ts), à la
// différence de NOE6 : le refus au dépôt vaut pour tout dossier, quel que soit son code NAF et ses modules, et un bordereau
// déjà en base porte les mêmes noms dans un dossier que la section n'offre pas (« une règle d'affichage ne cache jamais des
// données déjà en base », NOE4Q1-Q2 (A)). Question au cabinet : BOR6TQ2-Q1.

/**
 * Le tri que la BASE fait avant d'envoyer un texte (PostgREST, `or`) : un texte qui porte « bordereau » (le titre) ou
 * « naissance » (l'en-tête des colonnes), sans égard à la casse. Un SUR-ensemble de ce que `porteLaFormeDUnBordereau`
 * reconnaît — le titre normalisé contient « bordereau », l'en-tête « naissance », et la normalisation n'ôte que des accents
 * et des espaces que ces deux mots n'ont pas — ; le navigateur juge ensuite chaque candidat. Une remise de chèques, un
 * bordereau de l'Urssaf passent le tri et ne se reconnaissent pas.
 */
export const PREFILTRE_DES_BORDEREAUX = 'texte.ilike.*bordereau*,texte.ilike.*naissance*'

/** Un texte lu, tel que la base le rend : celui d'une pièce ou d'un document (l'un des deux, CHECK de la table). */
export interface TexteLuDUnDepot {
  piece_id: string | null
  document_id: string | null
  texte: string | null
}

/** Les pièces et les documents dont le texte lu a la forme d'un bordereau. Rend des identifiants, jamais un texte. */
export function ciblesDesBordereaux(textes: readonly TexteLuDUnDepot[]): { pieces: string[]; documents: string[] } {
  const pieces = new Set<string>()
  const documents = new Set<string>()
  for (const { piece_id, document_id, texte } of textes) {
    if (!texte || !porteLaFormeDUnBordereau([{ lignes: texte.split('\n') }])) continue
    if (piece_id) pieces.add(piece_id)
    else if (document_id) documents.add(document_id)
  }
  return { pieces: [...pieces], documents: [...documents] }
}

/** Un bordereau déjà déposé : sa sorte, son identifiant et l'instant de son dépôt (`created_at`), rien d'autre. */
export interface BordereauDepose {
  readonly type: 'piece' | 'document'
  readonly id: string
  readonly deposeLe: string
}

/** Ce que rend la recherche. `incomplete` : un texte ou une ligne n'a pas pu être lu en entier — rien ne se conclut. */
export type RechercheDesBordereaux =
  | { readonly etat: 'trouves'; readonly dossierId: string; readonly bordereaux: readonly BordereauDepose[] }
  | { readonly etat: 'incomplete'; readonly dossierId: string; readonly motif: string }

/** Les bordereaux dans l'ordre de leur dépôt, le plus ancien d'abord ; à égalité, par identifiant. */
export function ordonnerLesBordereaux(bordereaux: readonly BordereauDepose[]): BordereauDepose[] {
  return [...bordereaux].sort((a, b) => (a.deposeLe < b.deposeLe ? -1 : a.deposeLe > b.deposeLe ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** « Pièce déposée le 12/03/2026 », « Document déposé le 12/03/2026 » : la date de dépôt, jamais le nom du fichier. */
export function nomDuBordereau(b: Pick<BordereauDepose, 'type' | 'deposeLe'>): string {
  return b.type === 'piece' ? `Pièce déposée le ${formatDate(b.deposeLe)}` : `Document déposé le ${formatDate(b.deposeLe)}`
}

export const LIBELLE_BORDEREAUX_DEPOSES = 'pièce(s) ou document(s) déjà au dossier dont le texte lu a la forme d’un bordereau '
  + 'de télétransmission — des noms de patients, que le dossier n’a pas à garder'

export const DETAIL_DES_BORDEREAUX_DEPOSES = 'La carte « Bordereaux de télétransmission déjà déposés » les nomme par leur date '
  + 'de dépôt et ouvre la fiche de chacun : la suppression s’y fait, confirmée. Leurs totaux s’importent dans la section '
  + '« Facturé à l’assurance maladie » de l’onglet Banque, depuis le PDF du logiciel de télétransmission.'

/** Le nombre du point : les bordereaux trouvés par une recherche finie, pour ce dossier ; zéro sinon (pas cherché, ou muette). */
export function nombreDeBordereauxDeposes(recherche: RechercheDesBordereaux | null): number {
  return recherche?.etat === 'trouves' ? recherche.bordereaux.length : 0
}

/** Où mène le point : Justificatifs dès qu'une pièce en est, Documents administratifs sinon. */
export function cibleDesBordereaux(recherche: RechercheDesBordereaux | null): 'pieces' | 'documents' {
  if (recherche?.etat !== 'trouves') return 'pieces'
  return recherche.bordereaux.some((b) => b.type === 'piece') || recherche.bordereaux.length === 0 ? 'pieces' : 'documents'
}

// ── Les mots de la carte ─────────────────────────────────────────────────────────────────────────────────────────────────

export const TITRE_DE_LA_CARTE_DES_BORDEREAUX = 'Bordereaux de télétransmission déjà déposés'

export const PRESENTATION_DE_LA_RECHERCHE = 'Un bordereau de télétransmission porte des noms de patients : il ne se dépose plus, '
  + 'mais un bordereau déposé avant ce refus reste au dossier. La recherche lit le texte des pièces et des documents du dossier, '
  + 'sur cet ordinateur, et ne garde que ceux qui ont la forme d’un bordereau ; rien n’est supprimé sans toi.'

export const BOUTON_CHERCHER_LES_BORDEREAUX = 'Chercher les bordereaux déjà déposés'

/** Ce que la recherche ne voit pas, dit à chaque issue : elle ne juge que des textes lus. */
export const CE_QUE_LA_RECHERCHE_NE_VOIT_PAS = 'Une pièce ou un document dont aucun texte n’a été lu (déposé avant que le texte '
  + 'ne soit gardé, ou illisible) ne se juge pas.'

/** La phrase d'une recherche finie. */
export function phraseDeLaRecherche(recherche: RechercheDesBordereaux): string {
  if (recherche.etat === 'incomplete') {
    return `La recherche n’a pas pu tout lire (${recherche.motif}) : rien ne se conclut, ni qu’il y a des bordereaux au `
      + 'dossier, ni qu’il n’y en a pas. Cherche de nouveau.'
  }
  const n = recherche.bordereaux.length
  if (n === 0) return 'Aucune pièce ni aucun document lu du dossier n’a la forme d’un bordereau de télétransmission.'
  return n === 1
    ? 'Celui-ci a la forme d’un bordereau de télétransmission : ouvre sa fiche pour le supprimer, après confirmation.'
    : `Ces ${n} ont la forme d’un bordereau de télétransmission : ouvre la fiche de chacun pour le supprimer, après confirmation.`
}
