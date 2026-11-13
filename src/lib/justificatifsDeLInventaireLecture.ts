import { INVENTAIRE_EXPORTE } from './inventaire'
import type { FactureACiter, JustificatifsDuDossier, PieceACiter } from './justificatifsDeLInventaire'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE L'ONGLET INVENTAIRE LIT POUR CHOISIR UNE PIÈCE (ligne 35, INV5-Q1 ; lib/justificatifsDeLInventaire.ts) : les pièces du
// dossier et ses factures émises validées, EN ENTIER, par `lireTout`, sous un tri total terminé par la clé primaire. À PART de la
// lecture de l'inventaire (lib/inventaireDeLEcranLecture.ts) : une liste de pièces lue en partie ne retire que le CHOIX d'une
// pièce, jamais la saisie ni les gestes de l'inventaire. TOUT OU RIEN : une lecture partielle, refusée, rompue, d'un autre
// dossier ou illisible, et l'état dit « incomplète » avec son motif — l'écran n'offre alors aucun choix. Gardée avec le dossier :
// le résultat se rend avec son identifiant. Ne rejette jamais. Le drapeau baissé (`INVENTAIRE_EXPORTE`), elle ne lit RIEN.

export type LectureDesJustificatifs =
  | { dossierId: string; etat: 'absente' }
  | { dossierId: string; etat: 'incomplete'; motif: string }
  | { dossierId: string; etat: 'lue'; justificatifs: JustificatifsDuDossier }

// Des littéraux d'un seul tenant : le client typé lit le type d'une colonne dans la chaîne.
export const COLONNES_DES_PIECES_A_CITER = 'id, dossier_id, nom_fichier, date_piece, tiers, montant_ttc, type_piece, statut'
export const COLONNES_DES_FACTURES_A_CITER = 'id, dossier_id, numero, statut, type, date_emission, tiers_nom, montant_ttc'

const texte = (v: unknown): v is string => typeof v === 'string'
const texteOuNul = (v: unknown): boolean => v === null || typeof v === 'string'
const montantOuNul = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
const TYPES_DE_PIECE = new Set(['achat', 'vente', 'note_frais', 'autre'])

function pieceCroyable(l: Record<string, unknown>): boolean {
  return texte(l.id) && texte(l.nom_fichier) && texteOuNul(l.date_piece) && texteOuNul(l.tiers) && montantOuNul(l.montant_ttc)
    && texte(l.type_piece) && TYPES_DE_PIECE.has(l.type_piece) && (l.statut === 'a_valider' || l.statut === 'validee')
}

function factureCroyable(l: Record<string, unknown>): boolean {
  return texte(l.id) && texteOuNul(l.numero) && l.statut === 'validee' && (l.type === 'facture' || l.type === 'avoir')
    && texte(l.date_emission) && texte(l.tiers_nom) && typeof l.montant_ttc === 'number' && Number.isFinite(l.montant_ttc)
}

/** Les pièces et les factures validées du dossier, lues en entier ; ou « incomplète », avec le motif. Ne rejette jamais. */
export async function lireLesJustificatifsDuDossier(dossierId: string): Promise<LectureDesJustificatifs> {
  return lireLesJustificatifsDuDossierSelon(dossierId, INVENTAIRE_EXPORTE)
}

/** La même lecture, selon que l'onglet est offert : les deux états du drapeau, que les tests jouent. */
export async function lireLesJustificatifsDuDossierSelon(dossierId: string, offert: boolean): Promise<LectureDesJustificatifs> {
  if (!offert) return { dossierId, etat: 'absente' }
  try {
    const [pieces, factures] = await Promise.all([
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_DES_PIECES_A_CITER, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_DES_FACTURES_A_CITER, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin)),
    ])
    if (!pieces.complete) return { dossierId, etat: 'incomplete', motif: `les pièces : ${pieces.motif ?? 'lecture incomplète'}` }
    if (!factures.complete) return { dossierId, etat: 'incomplete', motif: `les factures émises : ${factures.motif ?? 'lecture incomplète'}` }
    if ([...pieces.lignes, ...factures.lignes].some((l) => l.dossier_id !== dossierId)) {
      return { dossierId, etat: 'incomplete', motif: 'une pièce ou une facture rendue n’est pas de ce dossier' }
    }
    if (!pieces.lignes.every(pieceCroyable) || !factures.lignes.every(factureCroyable)) {
      return { dossierId, etat: 'incomplete', motif: 'une pièce ou une facture lue ne se croit pas' }
    }
    return {
      dossierId, etat: 'lue',
      justificatifs: { pieces: pieces.lignes as unknown as PieceACiter[], factures: factures.lignes as unknown as FactureACiter[] },
    }
  } catch (e) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(e, 'la lecture des pièces du dossier a échoué') }
  }
}
