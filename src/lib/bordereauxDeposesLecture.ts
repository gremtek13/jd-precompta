import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  ciblesDesBordereaux, ordonnerLesBordereaux, PREFILTRE_DES_BORDEREAUX, type BordereauDepose, type RechercheDesBordereaux,
  type TexteLuDUnDepot,
} from './bordereauxDeposes'

// LA RECHERCHE DES BORDEREAUX DE TÉLÉTRANSMISSION DÉJÀ DÉPOSÉS (BOR6T-Q2 (A) ; la règle et la mesure : lib/bordereauxDeposes.ts),
// sur un clic du cabinet. Trois lectures, chacune EN ENTIER (`lireTout`) : les textes que le tri de la base retient, puis la date
// de dépôt des pièces et des documents reconnus. Une seule partielle ou refusée, et la recherche est « incomplete » : jamais
// « aucun bordereau » d'une liste qu'on n'a pas lue en entier.
//
// LE TEXTE NE SORT PAS D'ICI : il est jugé dans ce navigateur, puis oublié ; ni état d'écran, ni journal, ni envoi. Ne rejette
// jamais.

/** Au plus, les identifiants d'une requête `in` : l'adresse de PostgREST reste courte. */
const PAR_REQUETE = 100

type DateDeDepot = { id: string; created_at: string }

type DatesLues = { lignes: DateDeDepot[]; motif: string | null }

// Les dates de dépôt, tranche par tranche ; la première tranche partielle arrête tout et dit son motif. Deux fonctions, chaque
// table nommée en clair : les scanners des lectures (triTotal.test.ts, lecturesSignalees.test.ts) lisent l'expression.
async function datesDesPieces(dossierId: string, ids: readonly string[]): Promise<DatesLues> {
  const lignes: DateDeDepot[] = []
  for (let i = 0; i < ids.length; i += PAR_REQUETE) {
    const tranche = ids.slice(i, i + PAR_REQUETE)
    const lu = await lireTout<DateDeDepot>((debut, fin) =>
      supabase.from('pieces').select('id, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).in('id', tranche).order('id').range(debut, fin),
    )
    if (!lu.complete) return { lignes, motif: lu.motif ?? 'lecture incomplète' }
    lignes.push(...lu.lignes)
  }
  return { lignes, motif: null }
}

async function datesDesDocuments(dossierId: string, ids: readonly string[]): Promise<DatesLues> {
  const lignes: DateDeDepot[] = []
  for (let i = 0; i < ids.length; i += PAR_REQUETE) {
    const tranche = ids.slice(i, i + PAR_REQUETE)
    const lu = await lireTout<DateDeDepot>((debut, fin) =>
      supabase.from('documents_divers').select('id, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).in('id', tranche).order('id').range(debut, fin),
    )
    if (!lu.complete) return { lignes, motif: lu.motif ?? 'lecture incomplète' }
    lignes.push(...lu.lignes)
  }
  return { lignes, motif: null }
}

export async function chercherLesBordereauxDeposes(dossierId: string): Promise<RechercheDesBordereaux> {
  try {
    const textes = await lireTout<TexteLuDUnDepot>((debut, fin) =>
      supabase.from('piece_textes_ocr').select('id, piece_id, document_id, texte', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .or(PREFILTRE_DES_BORDEREAUX)
        .order('id').range(debut, fin),
    )
    if (!textes.complete) return { etat: 'incomplete', dossierId, motif: `les textes lus : ${textes.motif ?? 'lecture incomplète'}` }
    const { pieces, documents } = ciblesDesBordereaux(textes.lignes)
    const [lesPieces, lesDocuments] = await Promise.all([
      datesDesPieces(dossierId, pieces),
      datesDesDocuments(dossierId, documents),
    ])
    if (lesPieces.motif !== null) return { etat: 'incomplete', dossierId, motif: `les pièces : ${lesPieces.motif}` }
    if (lesDocuments.motif !== null) return { etat: 'incomplete', dossierId, motif: `les documents : ${lesDocuments.motif}` }
    // Une pièce reconnue que la seconde lecture ne rend plus est partie entre-temps : elle n'est plus au dossier.
    const bordereaux: BordereauDepose[] = [
      ...lesPieces.lignes.map((l) => ({ type: 'piece' as const, id: l.id, deposeLe: l.created_at })),
      ...lesDocuments.lignes.map((l) => ({ type: 'document' as const, id: l.id, deposeLe: l.created_at })),
    ]
    return { etat: 'trouves', dossierId, bordereaux: ordonnerLesBordereaux(bordereaux) }
  } catch (err) {
    return { etat: 'incomplete', dossierId, motif: messageErreur(err, 'lecture impossible') }
  }
}
