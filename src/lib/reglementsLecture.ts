import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { lireLesVentesDuDossier } from './ventesLecture'
import type { MouvementDuReglement, MouvementsDesReglements } from './reglements'
import type { ListesDesVentes } from './tuilesVentes'

// CE QUE LA LISTE DES RÈGLEMENTS LIT (espace client, étape A3) : les ventes du dossier par la lecture que l'onglet Factures
// et l'accueil du client partagent déjà (`lireLesVentesDuDossier`, ventesLecture.ts) — le registre des encaissements y est
// lu une fois, avec ce que la liste dit en plus —, et le relevé, comme la fenêtre des encaissements le lit : la même
// table, sous le même filtre et le même tri TOTAL, et seulement avec le droit « Banque ».
//
// SANS « BANQUE », LE RELEVÉ N'EST PAS DEMANDÉ : la base le refuse au client, et une lecture que la RLS refuse rend ZÉRO
// ligne, sans erreur — « aucun mouvement » serait une affirmation fausse. La liste dit alors le mouvement qu'un
// encaissement désigne sous les mots de la fenêtre, sans le nommer.

export interface LectureDesReglements {
  ventes: ListesDesVentes
  mouvements: MouvementsDesReglements
}

/** Le relevé du dossier, pour nommer le mouvement de chaque encaissement : lu en entier, ou son motif. */
export async function lireLesMouvementsDesReglements(dossierId: string, gereLaBanque: boolean): Promise<MouvementsDesReglements> {
  if (!gereLaBanque) return { etat: 'hors_acces' }
  const releve = await lireTout<MouvementDuReglement>((debut, fin) =>
    supabase.from('lignes_bancaires').select('id, date, libelle', { count: 'exact' })
      .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
  )
  return { etat: 'lus', lignes: releve.lignes, complete: releve.complete, motif: releve.motif }
}

/** Les ventes et le relevé, lus ensemble. Une requête qui lève rejette : l'écran le dit, sans rien montrer. */
export async function lireLesReglements(dossierId: string, gereLaBanque: boolean): Promise<LectureDesReglements> {
  const [ventes, mouvements] = await Promise.all([
    lireLesVentesDuDossier(dossierId),
    lireLesMouvementsDesReglements(dossierId, gereLaBanque),
  ])
  return { ventes, mouvements }
}
