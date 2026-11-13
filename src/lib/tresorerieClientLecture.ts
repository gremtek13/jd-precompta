import { useEffect, useState } from 'react'
import { COLONNES_DES_COMPTES_DU_CLIENT, type ComptesDuClient, type CompteDuClient } from './banqueClientParCompte'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesDroitsVentes } from './espaceVentes'
import { lireLEcheancier, type LectureEcheancier } from './echeancierClientLecture'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { ControleDeLaTresorerie, CreancesDeLaTresorerie } from './tresorerieClient'
import { lireLesVentesDuDossier } from './ventesLecture'

// CE QUE « MA TRÉSORERIE À 90 JOURS » LIT (ligne 51.5, étape C8) : rien de neuf pour la base, chaque table par la policy qui
// l'ouvre déjà au client, et seulement sous la case qui l'ouvre — les lectures de « Mon analyse » (lib/analyseClientLecture.ts)
// et de « Mon échéancier » (lib/echeancierClientLecture.ts), réutilisées.
//
// 1. Les cases de la société, telles que la BASE les voit (`droits_sur_le_dossier`), D'ABORD : une lecture que la RLS refuse
//    rend ZÉRO ligne sans erreur, et la page dirait « rien à encaisser » d'un client à qui on a retiré la case depuis sa
//    connexion. Sans « Banque » en base, rien d'autre ne se lit : sans solde, rien ne se projette.
// 2. « Banque » : les relevés contrôlés (`controles_releves_bancaires_lecture_banque`), et, quand `COMPTES_BANCAIRES_PREVUS`
//    est levé, les comptes du dossier et le compte de chaque relevé (comme « Ma banque », lot MCB7) ; l'échéancier AVEC ses
//    montants (`lireLEcheancier`, les montants appelés sous « Banque », comme « Mon échéancier »).
// 3. « Ventes », si la base ET l'écran l'ouvrent : les ventes du dossier (`lireLesVentesDuDossier`, la lecture de l'accueil
//    et de « Mon analyse »).
//
// La lecture ne rejette jamais : une requête qui lève tombe du côté signalé. Le crochet la GARDE avec la société, la case
// « Ventes » demandée et le jour pour lesquels elle a été faite, et reste nul tant qu'elle n'est pas revenue.

export type LectureDeLaTresorerie =
  | { etat: 'droits_illisibles'; motif: string }
  | { etat: 'banque_fermee' }
  | {
    etat: 'lue'
    comptes: ComptesDuClient
    controles: LectureComplete<ControleDeLaTresorerie>
    echeancier: LectureEcheancier
    creances: CreancesDeLaTresorerie
  }

async function lireLesComptes(dossierId: string): Promise<ComptesDuClient> {
  if (!COMPTES_BANCAIRES_PREVUS) return { etat: 'sans_objet' }
  try {
    const lecture = await lireTout<CompteDuClient>((debut, fin) =>
      supabase.from('comptes_bancaires').select(COLONNES_DES_COMPTES_DU_CLIENT, { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    return lecture.complete
      ? { etat: 'lus', comptes: lecture.lignes }
      : { etat: 'illisible', motif: lecture.motif ?? 'tes comptes bancaires n’ont pas été lus en entier' }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'tes comptes bancaires n’ont pas pu être lus') }
  }
}

async function lireLesControles(dossierId: string): Promise<LectureComplete<ControleDeLaTresorerie>> {
  try {
    const controles = await lireTout<ControleDeLaTresorerie>((debut, fin) => (COMPTES_BANCAIRES_PREVUS
      ? supabase.from('controles_releves_bancaires').select('id, solde_final, coherent, periode_fin, created_at, compte_bancaire_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin)
      : supabase.from('controles_releves_bancaires').select('id, solde_final, coherent, periode_fin, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin)))
    // Des relevés lus en partie ne portent aucune ligne : le solde se tait sur leur motif, jamais un solde d'avant.
    return controles.complete ? controles : { ...controles, lignes: [] }
  } catch (e) {
    return { lignes: [], complete: false, motif: messageErreur(e, 'tes relevés n’ont pas pu être lus') }
  }
}

async function lireLesCreances(dossierId: string): Promise<CreancesDeLaTresorerie> {
  try {
    return { etat: 'lues', listes: await lireLesVentesDuDossier(dossierId) }
  } catch (e) {
    return { etat: 'illisibles', motif: messageErreur(e, 'tes ventes n’ont pas pu être lues') }
  }
}

/** Lit ce que la trésorerie compose, sous les cases que la base (et, pour « Ventes », l'écran) ouvrent. Ne rejette jamais. */
export async function lireLaTresorerie(dossierId: string, ventesDemandees: boolean): Promise<LectureDeLaTresorerie> {
  let ventes: boolean
  try {
    const droits = await lireLesDroitsVentes(
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles'))
    if (droits.motif !== null) return { etat: 'droits_illisibles', motif: droits.motif }
    if (!droits.droits.banque) return { etat: 'banque_fermee' }
    ventes = ventesDemandees && droits.droits.ventes
  } catch (e) {
    return { etat: 'droits_illisibles', motif: messageErreur(e, 'droits illisibles') }
  }
  const [comptes, controles, echeancier, creances] = await Promise.all([
    lireLesComptes(dossierId),
    lireLesControles(dossierId),
    // Ne rejette jamais (lib/echeancierClientLecture.ts) ; les montants, la case « Banque » relue juste au-dessus.
    lireLEcheancier(dossierId, true),
    ventes ? lireLesCreances(dossierId) : Promise.resolve<CreancesDeLaTresorerie>({ etat: 'fermees' }),
  ])
  return { etat: 'lue', comptes, controles, echeancier, creances }
}

/**
 * La lecture de la trésorerie de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue (et toujours sans société).
 * Gardée avec la société et la case « Ventes » demandée : un client à plusieurs sociétés ne voit jamais la trésorerie de l'une
 * sous l'autre.
 */
export function useTresorerieDuClient(dossierId: string | null, ventesDemandees: boolean): LectureDeLaTresorerie | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDeLaTresorerie } | null>(null)
  const cle = `${dossierId}|${ventesDemandees}`

  useEffect(() => {
    if (!dossierId) return
    let annule = false
    const pour = `${dossierId}|${ventesDemandees}`
    lireLaTresorerie(dossierId, ventesDemandees).then((lecture) => { if (!annule) setLue({ cle: pour, lecture }) })
    return () => { annule = true }
  }, [dossierId, ventesDemandees])

  return lue !== null && lue.cle === cle ? lue.lecture : null
}
