import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { FactureEmise } from './types'

// CE QUE LA FICHE D'UNE PIÈCE LIT POUR DÉSIGNER L'EXEMPLAIRE D'UNE FACTURE (ligne 28.6, chantier EC-Q3, étape VF1b) : les
// factures émises VALIDÉES du dossier — factures et avoirs —, celles que `designer_exemplaire_facture` accepte et celle
// qu'une pièce désigne déjà (lib/exemplairesDesFactures.ts). Lues EN ENTIER : l'écran propose un choix et nomme la facture
// dans sa confirmation ; une liste lue en partie, refusée ou rompue ne propose aucun geste, et l'écran le dit
// (`LectureComplete.motif`).
//
// Les colonnes de la confirmation (numéro, client, montant TTC, date) s'ajoutent à celles que le pont lit
// (lib/ventesJumellesLecture.ts), qui garde sa sélection : les deux lectures ne sont pas la même.
//
// Ce module ne rejette jamais : un constructeur de requête qui lèverait tombe du côté signalé, comme une lecture refusée.

export type FactureProposee = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'numero' | 'date_emission' | 'tiers_nom' | 'montant_ttc'>

export async function lireLesFacturesProposees(dossierId: string): Promise<LectureComplete<FactureProposee>> {
  try {
    const lecture = await lireTout<FactureProposee>((debut, fin) =>
      supabase.from('factures_emises')
        .select('id, dossier_id, statut, type, numero, date_emission, tiers_nom, montant_ttc', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee')
        .order('date_emission', { ascending: false }).order('id').range(debut, fin),
    )
    return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
  } catch (err) {
    return { lignes: [], complete: false, motif: messageErreur(err, 'lecture impossible') }
  }
}
