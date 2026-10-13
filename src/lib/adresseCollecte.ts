import { poids, TAILLE_MAX_PIECE, TYPES_DES_FICHIERS_DE_PIECE } from './bornesStockage'
import type { ReponseDeLaBase } from './couvertureReleve'
import { messageErreur } from './messageErreur'

// L'ADRESSE DE COLLECTE PAR E-MAIL D'UN DOSSIER, EN UN SEUL ENDROIT (ligne 22.93 ; décision du cabinet du 13/10/2026,
// S228B-Q5 : « Mes pièces » dit au client l'adresse à laquelle renvoyer une pièce jointe que la réception a écartée, et
// aucun écran du client ne la montrait). Le cabinet la lit dans l'onglet Accès, le client dans « Mes pièces » : la même
// composition, `<code du dossier>@<domaine>`, ne s'écrit qu'ici.
//
// LE DOMAINE est dédié à la réception (Resend), distinct du domaine principal pour ne pas toucher à la messagerie
// personnelle existante : le client configure un simple transfert automatique de ses e-mails vers cette adresse, sans
// jamais donner accès à sa boîte. Il s'écrit aussi dans deux Edge Functions, auto-portées (`receive-email` ne le nomme que
// dans un commentaire ; `send-email` en fait son domaine d'ENVOI, `DOMAINE_ENVOI`) : ni l'une ni l'autre ne compose
// l'adresse de collecte, et aucune copie gardée n'est écrite ici (voir le rapport de S230).
//
// CE QUE LE CLIENT LIT. La ligne de son dossier (`dossiers`) lui est déjà ouverte par la policy de lecture, `code_email`
// comprise : rien à ouvrir en base. Module PUR : il n'importe pas `supabase.ts`. L'écran passe la REQUÊTE telle quelle à
// `lireLAdresseDeCollecte`, qui l'attend par `await` (un constructeur de requête n'est pas une promesse : voir
// src/lib/couvertureReleve.ts).

export const DOMAINE_COLLECTE_EMAIL = 'precompta.jdarnis.fr'

/**
 * L'adresse de collecte d'un dossier, ou null quand son code n'est pas (encore) là : la composition du côté cabinet, telle
 * que l'onglet Accès l'a toujours faite — un code vide n'est pas un code.
 */
export function adresseDeCollecte(codeEmail: string | null | undefined): string | null {
  return codeEmail ? `${codeEmail}@${DOMAINE_COLLECTE_EMAIL}` : null
}

/**
 * Ce que la lecture du client rend : l'adresse, ou rien — et, quand rien, POURQUOI (`motif` nul : le dossier n'a pas de
 * code, l'écran n'a rien à dire ; non nul : la lecture a échoué, l'écran le dit). Jamais une adresse devinée.
 */
export interface LectureAdresseCollecte {
  adresse: string | null
  motif: string | null
}

// Ce que `generate_code_email` écrit : des lettres, des chiffres et des tirets — un tiret en tête quand le nom du dossier
// commence par un signe. Un code d'une autre forme (un blanc, un « @ », une barre) composerait une adresse que la réception
// ne reconnaîtrait pas : il ne passe pas pour une adresse.
const FORME_D_UN_CODE = /^[A-Za-z0-9._+-]+$/

/**
 * L'adresse de collecte telle que la base la rend : la ligne `{ code_email }` du dossier affiché. Une erreur, une ligne
 * absente (la RLS ne rend rien sans le dire), un code d'une autre forme qu'un texte ou d'une forme qu'aucun code n'a :
 * rien, avec le motif ; un code NUL ou vide : rien, sans motif (le dossier n'en a pas, et l'écran ne l'invente pas).
 */
export function lectureDeLAdresseDeCollecte(reponse: ReponseDeLaBase): LectureAdresseCollecte {
  if (reponse.error) {
    return { adresse: null, motif: `lecture refusée : ${messageErreur(reponse.error, 'raison inconnue')}` }
  }
  const ligne = reponse.data
  if (ligne === null || ligne === undefined) return { adresse: null, motif: 'dossier introuvable' }
  if (typeof ligne !== 'object' || Array.isArray(ligne)) return { adresse: null, motif: 'réponse illisible' }
  const code = (ligne as Record<string, unknown>).code_email
  if (code === null || code === '') return { adresse: null, motif: null }
  if (typeof code !== 'string' || !FORME_D_UN_CODE.test(code)) return { adresse: null, motif: 'réponse illisible' }
  return { adresse: adresseDeCollecte(code), motif: null }
}

/**
 * La lecture telle que l'écran la fait :
 * `lireLAdresseDeCollecte(supabase.from('dossiers').select('code_email').eq('id', dossierId).maybeSingle())`. La requête
 * est ATTENDUE ici et son erreur lue ; une requête qui lève tombe du côté signalé, comme un refus — jamais une adresse.
 */
export async function lireLAdresseDeCollecte(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureAdresseCollecte> {
  try {
    return lectureDeLAdresseDeCollecte(await requete)
  } catch (erreur) {
    return { adresse: null, motif: `lecture impossible : ${messageErreur(erreur, 'raison inconnue')}` }
  }
}

// ── Les mots du client ─────────────────────────────────────────────────────────────────────────────────────────────────
// Tutoiement, aucun onglet, jamais « le client » pour le titulaire (src/lib/espaceVentes.ts, `MOTS_DU_CABINET`).

/** Dans « Déposer des fichiers », au-dessus de l'adresse. */
export const ENVOI_PAR_EMAIL = 'Tu peux aussi envoyer tes pièces par e-mail, en pièces jointes, à l’adresse de ton dossier :'

/** Le bouton qui copie l'adresse, et ce qu'il dit une fois la copie faite. */
export const COPIER_L_ADRESSE = 'Copier l’adresse'
export const ADRESSE_COPIEE = 'Adresse copiée ✓'

/** Ce que dit l'écran quand le navigateur refuse le presse-papiers : l'adresse reste affichée, à copier à la main. */
export const COPIE_REFUSEE = 'Ton navigateur a refusé la copie : sélectionne l’adresse pour la copier.'

/** Ce que dit l'écran quand la lecture a échoué : l'adresse ne s'affiche pas, et il ne la devine pas. */
export const ADRESSE_ILLISIBLE = 'L’adresse e-mail de ton dossier n’a pas pu être lue : recharge la page pour l’afficher.'

// Le nom de chaque format, dit comme le client le connaît. Fermé sur la liste des types qu'une pièce admet : un format de
// plus dans `bornesStockage.ts` sans son nom ici ne compile pas.
const NOM_DES_FORMATS: Record<(typeof TYPES_DES_FICHIERS_DE_PIECE)[number], string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'text/csv': 'CSV',
}

/**
 * Ce que l'adresse accepte : les formats et le poids d'une pièce, tirés de `bornesStockage.ts` (la borne que `receive-email`
 * applique, copiée de la même source) — « PDF, JPEG, PNG ou CSV » et « 20 Mo », aucune valeur recopiée. Une pièce jointe
 * d'un autre format ou plus lourde est écartée, et « Mes pièces » le dit alors (ligne 22.9).
 */
export function ceQueAccepteLAdresse(): string {
  const noms = TYPES_DES_FICHIERS_DE_PIECE.map((type) => NOM_DES_FORMATS[type])
  const formats = `${noms.slice(0, -1).join(', ')} ou ${noms[noms.length - 1]}`
  return `Elle accepte les pièces jointes en ${formats}, de ${poids(TAILLE_MAX_PIECE)} au plus chacune.`
}
