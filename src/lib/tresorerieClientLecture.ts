import { useEffect, useState } from 'react'
import { ACHATS_DU_CLIENT_PREVUS } from './achatsClient'
import { COLONNES_DES_COMPTES_DU_CLIENT, type ComptesDuClient, type CompteDuClient } from './banqueClientParCompte'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesDroitsVentes } from './espaceVentes'
import { lireLEcheancier, type LectureEcheancier } from './echeancierClientLecture'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import {
  COLONNES_DES_ACHATS_DE_LA_TRESORERIE, COLONNES_DES_DECLARATIONS, COLONNES_DES_PARTS, COLONNES_DU_RELEVE, type AchatsDeLaTresorerie, type ControleDeLaTresorerie, type CreancesDeLaTresorerie, type DeclarationDePaiement, type MouvementDuReleve,
  type PartDeReglement, type PieceDAchatLue,
} from './tresorerieClient'
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
// 4. « Banque » encore : le relevé (date, montant, échéance de cotisation payée, et — derrière `ACHATS_DU_CLIENT_PREVUS` —
//    la pièce qu'un mouvement règle), qui empêche de compter deux fois une échéance déjà prélevée, et dit une facture
//    encaissée depuis le dernier relevé contrôlé.
// 5. « Achats », derrière `ACHATS_DU_CLIENT_PREVUS` (B4 : avant sa migration, ni la colonne ni les tables n'existent) : la case
//    relue à la base PUIS, si elle y est, les factures d'achat du dossier, les paiements déclarés et les parts de règlement
//    groupé. Drapeau baissé : rien ne se lit ; case fermée : rien ne se lit de plus ; dans les deux cas, « non comptés ».
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
    releve: LectureComplete<MouvementDuReleve>
    achats: AchatsDeLaTresorerie
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

// Le relevé EN ENTIER (`lignes_bancaires_lecture_banque`) : sa date, son montant, l'échéance de cotisation que chaque
// mouvement paie. Il dit quelle échéance est déjà dans le solde, et quel encaissement date d'après lui.
async function lireLeReleve(dossierId: string): Promise<LectureComplete<MouvementDuReleve>> {
  try {
    // Deux requêtes littérales (le typage de PostgREST lit la liste de colonnes) : la pièce réglée ne se lit que derrière le
    // drapeau de B4, le relevé d'avant restant celui d'avant.
    const releve = await lireTout<MouvementDuReleve>((debut, fin) => (ACHATS_DU_CLIENT_PREVUS
      ? supabase.from('lignes_bancaires').select('id, date, montant, cotisation_id, piece_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin)
      : supabase.from('lignes_bancaires').select(COLONNES_DU_RELEVE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin)))
    return releve.complete ? releve : { ...releve, lignes: [] }
  } catch (e) {
    return { lignes: [], complete: false, motif: messageErreur(e, 'ton relevé n’a pas pu être lu') }
  }
}

async function lireLesCreances(dossierId: string): Promise<CreancesDeLaTresorerie> {
  try {
    return { etat: 'lues', listes: await lireLesVentesDuDossier(dossierId) }
  } catch (e) {
    return { etat: 'illisibles', motif: messageErreur(e, 'tes ventes n’ont pas pu être lues') }
  }
}

/**
 * Les achats du client. Drapeau de B4 baissé : rien ne se lit, `fermes`. Levé : la case « Achats » se relit à la BASE
 * (`droits_sur_le_dossier`) d'abord — une lecture que la RLS refuse rend ZÉRO ligne sans erreur, et la page dirait « rien à
 * payer » d'un client à qui on a retiré la case ; seul `true` l'accorde, sinon `fermes`, sans autre lecture. Une lecture
 * qui échoue ou lève se rend `illisibles`, avec son motif, jamais une liste vide. Ne rejette jamais.
 */
async function lireLesAchats(dossierId: string): Promise<AchatsDeLaTresorerie> {
  if (!ACHATS_DU_CLIENT_PREVUS) return { etat: 'fermes' }
  try {
    const droits = await supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })
    if (droits.error) return { etat: 'illisibles', motif: `ton accès à tes achats n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { etat: 'illisibles', motif: 'ton accès à tes achats n’a pas pu être vérifié (droits illisibles)' }
    }
    if ((data as Record<string, unknown>).achats !== true) return { etat: 'fermes' }
    const [pieces, declarations, parts] = await Promise.all([
      lireTout<PieceDAchatLue & { dossier_id: string }>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_DES_ACHATS_DE_LA_TRESORERIE, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('type_piece', 'achat').order('id').range(debut, fin)),
      lireTout<DeclarationDePaiement & { dossier_id: string }>((debut, fin) =>
        supabase.from('paiements_declares').select(COLONNES_DES_DECLARATIONS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
      lireTout<PartDeReglement & { dossier_id: string }>((debut, fin) =>
        supabase.from('reglements_groupes').select(COLONNES_DES_PARTS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    return { etat: 'lus', pieces: duDossier(pieces, dossierId), declarations: duDossier(declarations, dossierId), parts: duDossier(parts, dossierId) }
  } catch (e) {
    return { etat: 'illisibles', motif: messageErreur(e, 'tes achats n’ont pas pu être lus') }
  }
}

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas ; une lecture incomplète se rend telle quelle. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return { lignes: [], complete: false, motif: lecture.motif ?? 'une ligne rendue n’est pas de ce dossier' }
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
  const [comptes, controles, echeancier, creances, releve, achats] = await Promise.all([
    lireLesComptes(dossierId),
    lireLesControles(dossierId),
    // Ne rejette jamais (lib/echeancierClientLecture.ts) ; les montants, la case « Banque » relue juste au-dessus.
    lireLEcheancier(dossierId, true),
    ventes ? lireLesCreances(dossierId) : Promise.resolve<CreancesDeLaTresorerie>({ etat: 'fermees' }),
    lireLeReleve(dossierId),
    lireLesAchats(dossierId),
  ])
  return { etat: 'lue', comptes, controles, echeancier, creances, releve, achats }
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
