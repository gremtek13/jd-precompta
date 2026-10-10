import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import type { LectureFichesHorsDeFrance } from './propositionsHorsDeFrance'
import type { PieceHorsDeFrance, PieceHorsDeFranceTaux } from './types'

// LES FICHES « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UN DOSSIER (ligne 28.5, e-reporting, étape e3), lues EN ENTIER :
// toutes les versions, retirées comprises, et leur ventilation. Le dossier entier et non la seule pièce : la base refuse
// une facture déjà décrite sur une autre pièce (refus 20, G1.42 transposée à l'acheteur), et l'écran le dit avant le
// clic ; la suppression d'une sélection de pièces nomme aussi les fiches qu'elle emporte.
//
// `motif` : non nul quand l'une des deux lectures est partielle — l'écran ne montre alors aucune fiche et n'en offre
// aucune écriture (une lecture partielle ne commande aucune écriture), et la confirmation d'une suppression dit qu'elle
// ne sait pas ce qu'elle emporte.
export async function lireFichesHorsDeFrance(dossierId: string): Promise<LectureFichesHorsDeFrance> {
  const [lectureFiches, lectureTaux] = await Promise.all([
    lireTout<PieceHorsDeFrance>((debut, fin) =>
      supabase.from('pieces_hors_de_france').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Clé primaire (fiche, code, taux) : le tri qui la termine est total.
    lireTout<PieceHorsDeFranceTaux>((debut, fin) =>
      supabase.from('pieces_hors_de_france_taux').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('fiche_id').order('code_tva').order('taux').range(debut, fin),
    ),
  ])
  return {
    fiches: lectureFiches.lignes,
    taux: lectureTaux.lignes,
    motif: [lectureFiches, lectureTaux].find((l) => !l.complete)?.motif ?? null,
  }
}
