import { useEffect, useState } from 'react'
import { COLONNES_DE_LA_PROVENANCE, COLONNES_DU_CONTROLE, type ControleDuSolde, type LigneDeProvenance } from './analyseClient'
import { lireLeDroitCaisse } from './caisseClientLecture'
import { lireLesDroitsVentes } from './espaceVentes'
import { ajouterJours } from './format'
import { debutDeLaFenetre, type CasesDuJournal, type SourcesDuJournal } from './journalDeLEspaceClient'
import { lireLesSourcesDuJournal } from './journalDeLEspaceClientLecture'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { ListesDesVentes } from './tuilesVentes'
import { lireLesVentesDuDossier } from './ventesLecture'

// CE QUE « MON ANALYSE » LIT (espace client, étape B9a) : rien de neuf pour la base, chaque table par la policy qui l'ouvre
// déjà au client — et seulement sous la case qui l'ouvre.
//
// 1. Les cases de la société, telles que la BASE les voit (`droits_sur_le_dossier`), D'ABORD : une lecture que la RLS refuse
//    rend ZÉRO ligne sans erreur, et l'analyse dirait « 0 € » d'un client à qui on a retiré la case depuis sa connexion. Une
//    section ne se lit que si la base ET l'écran (`demande`, les cases qu'AuthContext a lues) l'ouvrent ; illisibles, rien
//    ne se lit.
// 2. « Ventes » : les ventes du dossier par la lecture qu'ouvrent déjà « Mes ventes » et l'accueil (`lireLesVentesDuDossier`
//    — factures, lignes, registre et ses parts), et la PROVENANCE des lignes (étape A7a), lue en entier à part : la lecture
//    partagée ne la demande pas. Policies : `factures_emises_lecture_ventes`, `facture_lignes_lecture_ventes`,
//    `encaissements_factures_lecture_ventes`, `encaissements_factures_taux_lecture_ventes` (migration `ventes_du_client`).
// 3. « Banque » : les relevés contrôlés, comme « Ma banque » (`controles_releves_bancaires_lecture_banque`, migration
//    `banque_du_client`) — le solde s'y LIT, jamais ne s'additionne.
// 4. « Ce qui a bougé » (étape B9c) : les sources du journal que ces cases ouvrent, « Caisse » comprise
//    (lib/journalDeLEspaceClientLecture.ts, `lireLesSourcesDuJournal`, qui nomme la policy de chacune).
//
// La lecture ne rejette jamais : une requête qui lève tombe du côté signalé. Le crochet la GARDE avec la société et les
// cases pour lesquelles elle a été faite, et reste nul tant qu'elle n'est pas revenue.

export type VentesDeLAnalyse =
  | { etat: 'fermee' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lue'; listes: ListesDesVentes; provenance: LectureComplete<LigneDeProvenance> }

export type BanqueDeLAnalyse =
  | { etat: 'fermee' }
  | { etat: 'lue'; controles: LectureComplete<ControleDuSolde> }

/** « Ce qui a bougé » (étape B9c) : les sources du journal que les cases OUVERTES (base ET écran) laissent lire. */
export interface JournalDeLAnalyse { cases: CasesDuJournal; sources: SourcesDuJournal }

export type LectureDeLAnalyse =
  | { etat: 'droits_illisibles'; motif: string }
  | { etat: 'lue'; ventes: VentesDeLAnalyse; banque: BanqueDeLAnalyse; journal: JournalDeLAnalyse }

export interface CasesDemandees { ventes: boolean; banque: boolean; caisse: boolean }

async function lireLesVentes(dossierId: string): Promise<VentesDeLAnalyse> {
  try {
    const [listes, provenance] = await Promise.all([
      lireLesVentesDuDossier(dossierId),
      lireTout<LigneDeProvenance>((debut, fin) =>
        supabase.from('facture_lignes').select(COLONNES_DE_LA_PROVENANCE, { count: 'exact' })
          .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('ordre').order('id').range(debut, fin)),
    ])
    // Une provenance lue en partie ne porte aucune ligne : l'état par article se tait sur son motif (lib/analyseClient.ts).
    return { etat: 'lue', listes, provenance: provenance.complete ? provenance : { ...provenance, lignes: [] } }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'tes ventes n’ont pas pu être lues') }
  }
}

async function lireLaBanque(dossierId: string): Promise<BanqueDeLAnalyse> {
  try {
    const controles = await lireTout<ControleDuSolde>((debut, fin) =>
      supabase.from('controles_releves_bancaires').select(COLONNES_DU_CONTROLE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    // Des relevés lus en partie ne portent aucune ligne : le solde se tait sur leur motif, jamais un solde d'avant.
    return { etat: 'lue', controles: controles.complete ? controles : { ...controles, lignes: [] } }
  } catch (e) {
    return { etat: 'lue', controles: { lignes: [], complete: false, motif: messageErreur(e, 'tes relevés n’ont pas pu être lus') } }
  }
}

/**
 * Lit ce que l'analyse compose, sous les cases que la base ET l'écran ouvrent, et le journal de la fenêtre qui finit au jour
 * de Paris `aujourdhui`. Ne rejette jamais.
 */
export async function lireLAnalyse(dossierId: string, demande: CasesDemandees, aujourdhui: string): Promise<LectureDeLAnalyse> {
  let ouvertes: CasesDuJournal
  try {
    // « Ventes » et « Banque », puis « Caisse » (lib/caisseClientLecture.ts), chacune par la lecture qui la juge ; l'une
    // ou l'autre illisible, rien ne se lit.
    const [droits, caisse] = await Promise.all([
      lireLesDroitsVentes(
        supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles')),
      lireLeDroitCaisse(supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })),
    ])
    if (droits.motif !== null) return { etat: 'droits_illisibles', motif: droits.motif }
    if (caisse.motif !== null) return { etat: 'droits_illisibles', motif: caisse.motif }
    ouvertes = {
      ventes: demande.ventes && droits.droits.ventes,
      banque: demande.banque && droits.droits.banque,
      caisse: demande.caisse && caisse.caisse,
    }
  } catch (e) {
    return { etat: 'droits_illisibles', motif: messageErreur(e, 'droits illisibles') }
  }
  const borne = ajouterJours(debutDeLaFenetre(aujourdhui), -1)
  const [ventes, banque, sources] = await Promise.all([
    ouvertes.ventes ? lireLesVentes(dossierId) : Promise.resolve<VentesDeLAnalyse>({ etat: 'fermee' }),
    ouvertes.banque ? lireLaBanque(dossierId) : Promise.resolve<BanqueDeLAnalyse>({ etat: 'fermee' }),
    // Ne rejette jamais : chaque source rattrape sa propre panne.
    lireLesSourcesDuJournal(dossierId, borne, ouvertes),
  ])
  return { etat: 'lue', ventes, banque, journal: { cases: ouvertes, sources } }
}

/**
 * La lecture de l'analyse de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue (et toujours sans société).
 * Gardée avec la société ET les cases demandées : un client à plusieurs sociétés ne voit jamais l'analyse de l'une sous
 * l'autre.
 */
export function useAnalyseDuClient(
  dossierId: string | null, demande: CasesDemandees, aujourdhui: string,
): LectureDeLAnalyse | null {
  const { ventes, banque, caisse } = demande
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDeLAnalyse } | null>(null)
  const cle = `${dossierId}|${ventes}|${banque}|${caisse}|${aujourdhui}`

  useEffect(() => {
    if (!dossierId) return
    let annule = false
    const pour = `${dossierId}|${ventes}|${banque}|${caisse}|${aujourdhui}`
    lireLAnalyse(dossierId, { ventes, banque, caisse }, aujourdhui).then((lecture) => { if (!annule) setLue({ cle: pour, lecture }) })
    return () => { annule = true }
  }, [dossierId, ventes, banque, caisse, aujourdhui])

  return lue !== null && lue.cle === cle ? lue.lecture : null
}
