import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { JustificatifsDesVentes } from './pisteAudit'

// LES PREUVES DES FACTURES QUE LA PISTE D'AUDIT CITE (ligne 28.6, chantier EC-Q3, étape VF4c2 ; lib/pisteAudit.ts,
// `JustificatifsDesVentes`) : les pièces désignées EXEMPLAIRES d'une facture ou d'un avoir (`pieces.facture_id`, quel que
// soit leur statut — l'original revenu de la plateforme, ou le PDF), leur nom et leur empreinte ; et les TRANSMISSIONS des
// factures (`transmissions_factures`), l'empreinte du CII déposé et la plateforme qui l'a reçu. Lues sur le clic de
// l'export, comme le relevé : rien d'autre dans l'onglet n'en a besoin.
//
// Chacune EN ENTIER par `lireTout`. LE TOUT OU RIEN : une lecture partielle, refusée ou rompue, et l'export se refuse — une
// piste qui tairait l'empreinte d'un exemplaire qu'elle n'a pas lu la laisserait croire absente. GARDÉE AVEC LE DOSSIER :
// chaque ligne rendue est confrontée au dossier demandé. Ce module ne rejette jamais.

export const COLONNES_EXEMPLAIRES = 'id, dossier_id, facture_id, nom_fichier, storage_hash'
export const COLONNES_TRANSMISSIONS = 'id, dossier_id, facture_id, etat, sha256, hote'

type Exemplaire = JustificatifsDesVentes['exemplaires'][number] & { dossier_id: string }
type Transmission = JustificatifsDesVentes['transmissions'][number] & { dossier_id: string }

export type LectureDesJustificatifsDesVentes =
  | { etat: 'lue'; exemplaires: Exemplaire[]; transmissions: Transmission[] }
  | { etat: 'incomplete'; motif: string }

export async function lireLesJustificatifsDesVentes(dossierId: string): Promise<LectureDesJustificatifsDesVentes> {
  try {
    const [exemplaires, transmissions] = await Promise.all([
      lireTout<Exemplaire>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_EXEMPLAIRES, { count: 'exact' })
          .eq('dossier_id', dossierId).not('facture_id', 'is', null).order('id').range(debut, fin),
      ),
      lireTout<Transmission>((debut, fin) =>
        supabase.from('transmissions_factures').select(COLONNES_TRANSMISSIONS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    if (!exemplaires.complete) return { etat: 'incomplete', motif: `les exemplaires des factures : ${exemplaires.motif ?? 'lecture incomplète'}` }
    if (!transmissions.complete) return { etat: 'incomplete', motif: `les transmissions des factures : ${transmissions.motif ?? 'lecture incomplète'}` }
    if (exemplaires.lignes.some((p) => p.dossier_id !== dossierId || p.facture_id == null)) {
      return { etat: 'incomplete', motif: 'les exemplaires des factures : une ligne rendue n’est pas un exemplaire de ce dossier' }
    }
    if (transmissions.lignes.some((t) => t.dossier_id !== dossierId)) {
      return { etat: 'incomplete', motif: 'les transmissions des factures : une ligne rendue n’est pas de ce dossier' }
    }
    return { etat: 'lue', exemplaires: exemplaires.lignes, transmissions: transmissions.lignes }
  } catch (erreur) {
    return { etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des preuves des factures a échoué') }
  }
}
