import type { CauseDuRefus } from './apercu'
import { cheminDuDossier } from './cheminDuDossier'
import { fichierAMontrer } from './fichiersPiece'
import type { DocumentDivers, Piece } from './types'

// LE CLIENT OUVRE LE FICHIER D'UN DE SES ENVOIS (demande du cabinet du 16/11/2026) : dans « Mes pièces » et « Mes derniers
// envois » de l'accueil, un fichier listé au client s'ouvre, et rien d'autre — ni montant, ni catégorie, ni fournisseur lu,
// ni texte OCR : le fichier seul, que la base lui ouvre déjà (policy `pieces_storage_select` : le premier segment du chemin
// est son dossier). Ce module est PUR : il dit QUEL fichier, et AVEC QUELS MOTS un échec se dit ; le geste (verrou, appel à
// `ouvrirApercu`) vit dans `ouvertureDeMesPiecesGeste.ts`.
//
// Le chemin vient d'une ligne que le client peut écrire, et la base ne le lie pas encore à son dossier (CFCS-Q1) : il se
// juge ici AVANT tout appel (`cheminDuDossier`), et `ouvrirApercu` le rejuge de lui-même. Un chemin nul ou hors du dossier
// rend `null` : le geste dit l'échec sans rien demander au stockage.

/** Ce qu'un envoi listé au client désigne à ouvrir : le seau, le chemin, le dossier qu'il doit porter. */
export interface FichierDUnEnvoi { seau: 'pieces'; chemin: string; dossierId: string }

/** Le fichier d'une pièce : sa version lisible quand elle en a une (une facture reçue en XML), sinon son original. */
export function fichierDeLaPiece(piece: Pick<Piece, 'storage_path' | 'lisible_path' | 'dossier_id'>): FichierDUnEnvoi | null {
  if (!piece.storage_path && !piece.lisible_path) return null
  return fichierDansSonDossier(fichierAMontrer(piece).chemin, piece.dossier_id)
}

/** Le fichier d'un document (relevé, appel de cotisation, attestation) : rangé dans le même seau que les pièces. */
export function fichierDuDocument(document: Pick<DocumentDivers, 'storage_path' | 'dossier_id'>): FichierDUnEnvoi | null {
  return fichierDansSonDossier(document.storage_path, document.dossier_id)
}

function fichierDansSonDossier(chemin: string | null | undefined, dossierId: string): FichierDUnEnvoi | null {
  if (!chemin || !cheminDuDossier(chemin, dossierId)) return null
  return { seau: 'pieces', chemin, dossierId }
}

// ── Les mots du client ──────────────────────────────────────────────────────────────────────────────────────────────
// Au tutoiement, sans jargon (ni « stockage », ni « chemin », ni « URL signée ») : ce qui s'est passé et ce que le client
// peut faire. Jamais le chemin ni le nom du fichier.

/** Le libellé du geste, et son nom accessible (le nom du fichier n'y entre que pour le lecteur d'écran). */
export const LIBELLE_VOIR = 'Voir'
export function nomAccessibleDuGeste(nomFichier: string): string {
  return `Voir le fichier ${nomFichier}`
}

/** Un fichier que l'application ne sait pas désigner (aucun chemin, ou un chemin hors de ton dossier). */
export const FICHIER_INTROUVABLE = 'Ce fichier ne peut pas s’ouvrir d’ici. Préviens ton cabinet : il le vérifiera.'
/** Le lien du fichier n'a pas pu être créé (fichier absent, refus, réseau). */
export const FICHIER_INDISPONIBLE = 'Ce fichier ne s’ouvre pas pour l’instant. Réessaie dans un moment ; s’il ne s’ouvre toujours pas, préviens ton cabinet.'
/** Le navigateur a refusé la nouvelle fenêtre. */
export const OUVERTURE_BLOQUEE = 'Ton navigateur a bloqué l’ouverture du fichier. Autorise les fenêtres pour ce site, puis réessaie : le fichier, lui, est bien là.'

/** La phrase qui dit au client pourquoi le fichier ne s'est pas ouvert, d'après la CAUSE, jamais d'après la phrase du cabinet. */
export function motDuRefus(cause: CauseDuRefus): string {
  switch (cause) {
    case 'chemin': return FICHIER_INTROUVABLE
    case 'bloquee': return OUVERTURE_BLOQUEE
    case 'lien':
    case 'telechargement': return FICHIER_INDISPONIBLE
  }
}

/** Tous les textes que ce module montre au client (gardés par `motsDuCabinet` dans son test). */
export const TEXTES_DE_L_OUVERTURE: readonly string[] = [LIBELLE_VOIR, FICHIER_INTROUVABLE, FICHIER_INDISPONIBLE, OUVERTURE_BLOQUEE]
