import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import type { DeclarationLue, EvenementSuperpdpLu, LigneDeFacture, PartLue } from './encaissementsFactures'
import { COLONNES_STATUT_LU, type StatutLu } from './statutsLus'
import type { EncaissementDesVentes, ListesDesVentes } from './tuilesVentes'
import type { FactureEmise, TransmissionFacture } from './types'

// CE QUE L'ONGLET FACTURES LIT D'UN DOSSIER POUR SES PASTILLES, et ce que l'accueil du client compte (espace client, étape
// P4b) : une lecture, écrite une fois. L'onglet l'appelait en ligne ; les tuiles « À encaisser » et « À déclarer » de
// l'accueil disent le NOMBRE de ses pastilles, et une seconde copie des requêtes pourrait diverger d'elles sans un mot.
// Chaque collection par `lireTout`, tri TOTAL terminé par la clé primaire ; chaque motif dit une lecture partielle.

export async function lireLesVentesDuDossier(dossierId: string): Promise<ListesDesVentes> {
  // La suite des factures émises est LÉGALE : elle n'admet ni trou ni doublon, et une liste
  // tronquée ferait croire à un trou là où il n'y en a pas. Tri TOTAL, `date_emission` n'étant
  // pas unique — plusieurs factures partent le même jour.
  const lecture = await lireTout<FactureEmise>((debut, fin) =>
    supabase.from('factures_emises').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('date_emission', { ascending: false }).order('id').range(debut, fin),
  )
  // Tri TOTAL, la clé primaire en dernier : deux envois d'une même seconde se lisent toujours dans le même ordre.
  const envois = await lireTout<TransmissionFacture>((debut, fin) =>
    supabase.from('transmissions_factures')
      .select('id, dossier_id, facture_id, canal, hote, flux_id, sha256, etat, detail, cree_le, maj_le', { count: 'exact' })
      .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
  )
  // Les lignes de TOUTES les factures du dossier — par leur facture, la table n'ayant pas de dossier —, ses
  // encaissements et leurs parts, retirés compris : `resteAEncaisser` décide lui-même de ce qui compte — avec leur moyen,
  // leur auteur et leur enregistrement, que la liste des règlements dit (étape A3) sans relire le registre. Puis les
  // déclarations du dossier, échouées et rejetées comprises, et l'historique de Super PDP de ses factures (par leur
  // facture, comme les lignes) : `pastilleDeclaration` décide lui-même de ce qui est déclaré, et de ce qui ne le sera pas.
  const [lignes, encaisses, parts, declares, evenements, statuts] = await Promise.all([
    lireTout<LigneDeFacture & { id: string }>((debut, fin) =>
      supabase.from('facture_lignes')
        .select('id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id)', { count: 'exact' })
        .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('ordre').order('id').range(debut, fin),
    ),
    lireTout<EncaissementDesVentes>((debut, fin) =>
      supabase.from('encaissements_factures')
        .select('id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, cree_par, cree_le, retire_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<PartLue>((debut, fin) =>
      supabase.from('encaissements_factures_taux').select('encaissement_id, taux, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
    ),
    lireTout<DeclarationLue>((debut, fin) =>
      supabase.from('transmissions_encaissements')
        .select('id, dossier_id, encaissement_id, facture_id, canal, hote, etat', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
    ),
    lireTout<EvenementSuperpdpLu & { id: string }>((debut, fin) =>
      supabase.from('facture_superpdp_events')
        .select('id, facture_id, status_code, factures_emises!inner(dossier_id)', { count: 'exact' })
        .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('occurred_at').order('id').range(debut, fin),
    ),
    // Les statuts lus du dossier, tri TOTAL : `lu_le` n'est pas unique, un relevé en écrit plusieurs à la suite.
    lireTout<StatutLu>((debut, fin) =>
      supabase.from('statuts_factures_recus').select(COLONNES_STATUT_LU, { count: 'exact' })
        .eq('dossier_id', dossierId).order('lu_le').order('id').range(debut, fin),
    ),
  ])
  return {
    factures: lecture.lignes,
    facturesIncompletes: lecture.complete ? null : lecture.motif,
    transmissions: envois.lignes,
    transmissionsIncompletes: envois.complete ? null : envois.motif,
    lignes: lignes.lignes,
    encaissements: encaisses.lignes,
    parts: parts.lignes,
    encaissementsIncomplets:
      !lignes.complete ? lignes.motif : !encaisses.complete ? encaisses.motif : !parts.complete ? parts.motif : null,
    declarations: declares.lignes,
    evenementsSuperpdp: evenements.lignes,
    declarationsIncompletes: !declares.complete ? declares.motif : !evenements.complete ? evenements.motif : null,
    statutsLus: statuts.lignes,
    statutsIncomplets: statuts.complete ? null : statuts.motif,
  }
}
