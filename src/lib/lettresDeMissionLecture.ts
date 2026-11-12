import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { LETTRES_DE_MISSION_PREVUES } from './lettresDeMission'
import { lireLesMissionsParLaFonction, missionsDuClientPrevues } from './missionsDuClient'
import {
  COLONNES_SANS_MONTANT, type ClientDuCabinet, type DocumentDuCabinet, type LectureDesPapiersSignes, type LettreComplete,
  type LectureDesMissions, type LettreSansMontant, type ModeleLu, type Reponse,
} from './lettresDeMissionVue'

// LES LETTRES DE MISSION, LUES ET ÉCRITES POUR L'ÉCRAN (ligne 47, LM5). Rien ne se lit tant que `LETTRES_DE_MISSION_PREVUES`
// est baissé : les tables n'existent pas en production. Chaque lecture se fait EN ENTIER (`lireTout`) ou se dit illisible,
// et ne rejette jamais ; chaque écriture passe par sa fonction SQL seule (`security definer`, l'accès et le dossier du
// cabinet vérifiés avant toute lecture) et rend les mots de la base. Récit : HISTORIQUE.md, « 11/11/2026 — LM5 ».

/** Tout ce que l'écran du dossier du cabinet juge avant le clic, lu en entier. */
export type LectureDesLettres =
  | {
    etat: 'lue'
    dossierId: string
    modeles: ModeleLu[]
    lettres: LettreComplete[]
    documents: DocumentDuCabinet[]
    clients: ClientDuCabinet[]
    identiteDuCabinet: { siret: string | null; adresse: string | null }
  }
  | { etat: 'illisible'; dossierId: string; motif: string }

export async function lireLesLettresDuCabinet(dossierId: string): Promise<LectureDesLettres> {
  const illisible = (motif: string): LectureDesLettres => ({ etat: 'illisible', dossierId, motif })
  try {
    const dossier = await supabase.from('dossiers').select('cabinet_id, siret, adresse').eq('id', dossierId).maybeSingle()
    if (dossier.error) return illisible(messageErreur(dossier.error, 'le dossier du cabinet n’a pas pu être lu'))
    const d = dossier.data as { cabinet_id?: unknown; siret?: unknown; adresse?: unknown } | null
    if (!d || typeof d.cabinet_id !== 'string') return illisible('le dossier du cabinet n’a pas été rendu')
    const cabinetId = d.cabinet_id
    const [modeles, lettres, documents, clients] = await Promise.all([
      lireTout<ModeleLu>((debut, fin) => supabase.from('modeles_lettre_de_mission').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<LettreComplete>((debut, fin) => supabase.from('lettres_de_mission').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<DocumentDuCabinet>((debut, fin) => supabase.from('documents_divers')
        .select('id, nom_fichier, storage_hash, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin)),
      lireTout<ClientDuCabinet>((debut, fin) => supabase.from('dossiers').select('id, nom, adresse', { count: 'exact' })
        .eq('cabinet_id', cabinetId).neq('id', dossierId).order('nom').order('id').range(debut, fin)),
    ])
    const partielle = [modeles, lettres, documents, clients].find((l) => !l.complete)
    if (partielle) return illisible(partielle.motif ?? 'une lecture est restée partielle')
    return {
      etat: 'lue', dossierId, modeles: modeles.lignes, lettres: lettres.lignes, documents: documents.lignes, clients: clients.lignes,
      identiteDuCabinet: {
        siret: typeof d.siret === 'string' ? d.siret : null, adresse: typeof d.adresse === 'string' ? d.adresse : null,
      },
    }
  } catch (e) {
    return illisible(messageErreur(e, 'les lettres de mission n’ont pas pu être lues'))
  }
}

/** La lecture gardée AVEC le dossier et le compteur pour lesquels elle a été faite ; `null` avant son retour, ou baissé. */
export function useLettresDuCabinet(dossierId: string, actif: boolean, relecture: number): LectureDesLettres | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDesLettres } | null>(null)
  const cle = `${dossierId}#${relecture}`
  useEffect(() => {
    if (!LETTRES_DE_MISSION_PREVUES || !actif) return
    let annule = false
    void lireLesLettresDuCabinet(dossierId).then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, actif, relecture])
  if (!LETTRES_DE_MISSION_PREVUES || !actif) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}

export type IssueDUnGeste = { ok: true } | { ok: false; message: string }

async function appeler(fonction: string, parametres: Record<string, unknown>, repli: string): Promise<IssueDUnGeste> {
  try {
    const { error } = await supabase.rpc(fonction, parametres)
    if (error) return { ok: false, message: messageErreur(error, repli) }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: messageErreur(e, repli) }
  }
}

export function enregistrerLeModele(dossierId: string, p: {
  titre: string; conditions: string; missions: Record<string, string>; clauses: Record<string, string>; remplaceId: string | null
}): Promise<IssueDUnGeste> {
  return appeler('enregistrer_modele_de_lettre', {
    p_dossier_id: dossierId, p_titre: p.titre, p_conditions_generales: p.conditions, p_missions: p.missions, p_clauses: p.clauses,
    p_remplace_id: p.remplaceId,
  }, 'la base a refusé le modèle')
}

export function retirerLeModele(dossierId: string, modeleId: string): Promise<IssueDUnGeste> {
  return appeler('retirer_modele_de_lettre', { p_dossier_id: dossierId, p_modele_id: modeleId }, 'la base a refusé le retrait du modèle')
}

/** Crée (lettre nulle) ou réécrit un brouillon, à la version lue (`modifieeLe`) : la base refuse une version dépassée. */
export function enregistrerLeBrouillon(
  dossierId: string, lettreId: string | null, contenu: Record<string, unknown>, modifieeLe: string | null,
): Promise<IssueDUnGeste> {
  return appeler('enregistrer_brouillon_de_lettre', {
    p_dossier_id: dossierId, p_lettre_id: lettreId, p_contenu: contenu, p_modifiee_le: modifieeLe,
  }, 'la base a refusé le brouillon')
}

export function proposerLaLettre(dossierId: string, lettreId: string, modifieeLe: string): Promise<IssueDUnGeste> {
  return appeler('proposer_lettre_de_mission', { p_dossier_id: dossierId, p_lettre_id: lettreId, p_modifiee_le: modifieeLe },
    'la base a refusé la proposition')
}

export function enregistrerLaReponse(
  dossierId: string, lettreId: string, reponse: Reponse, documentId: string | null, signeeLe: string | null,
): Promise<IssueDUnGeste> {
  return appeler('enregistrer_reponse_a_la_lettre', {
    p_dossier_id: dossierId, p_lettre_id: lettreId, p_reponse: reponse, p_document_id: documentId, p_signee_le: signeeLe,
  }, 'la base a refusé la réponse')
}

export function retirerLaLettre(dossierId: string, lettreId: string, finAu: string | null): Promise<IssueDUnGeste> {
  return appeler('retirer_lettre_de_mission', { p_dossier_id: dossierId, p_lettre_id: lettreId, p_fin_au: finAu },
    'la base a refusé le retrait')
}

/**
 * Les documents d'un dossier qu'une lettre cite comme papier signé (la clé sans action : leur suppression lève 23503).
 * `null` sans rien lire, le drapeau baissé ; lue en partie, le motif le dit.
 */
export async function lireLesPapiersSignes(dossierId: string): Promise<LectureDesPapiersSignes | null> {
  if (!LETTRES_DE_MISSION_PREVUES) return null
  try {
    const lecture = await lireTout<{ id: string; document_signe_id: string | null }>((debut, fin) =>
      supabase.from('lettres_de_mission').select('id, document_signe_id', { count: 'exact' })
        .eq('dossier_id', dossierId).not('document_signe_id', 'is', null).order('id').range(debut, fin))
    const ids = new Set(lecture.lignes.flatMap((l) => (l.document_signe_id ? [l.document_signe_id] : [])))
    return { ids, motif: lecture.complete ? null : lecture.motif }
  } catch (e) {
    return { ids: new Set(), motif: messageErreur(e, 'les lettres de mission n’ont pas pu être lues') }
  }
}

// `LectureDesMissions` vit dans lib/lettresDeMissionVue.ts (pur) : l'écran du dossier permanent (lib/dossierPermanentEcran.ts)
// la reçoit sans importer ce module, qui lit la base (ecransAvantLecture.test.tsx suit ces imports).
export type { LectureDesMissions }

/**
 * Les missions d'un client, pour la carte de son dossier. `MISSIONS_DU_CLIENT_PREVUES` levé (LM5-Q2) : par la fonction
 * `missions_du_client`, qui s'ouvre à qui lit le dossier du CLIENT au titre du cabinet, sans montant ; baissé : comme hier,
 * par la policy du dossier du cabinet. Ne rejette jamais.
 */
export async function lireLesMissionsDuClient(dossierClientId: string): Promise<LectureDesMissions> {
  if (missionsDuClientPrevues()) return lireLesMissionsParLaBase(dossierClientId)
  const illisible = (motif: string): LectureDesMissions => ({ etat: 'illisible', dossierClientId, motif })
  try {
    const dossier = await supabase.from('dossiers').select('cabinet_id').eq('id', dossierClientId).maybeSingle()
    if (dossier.error) return illisible(messageErreur(dossier.error, 'le dossier n’a pas pu être lu'))
    const cabinetId = (dossier.data as { cabinet_id?: unknown } | null)?.cabinet_id
    if (typeof cabinetId !== 'string') return illisible('le cabinet du dossier n’a pas été rendu')
    const cabinet = await supabase.from('cabinets').select('dossier_du_cabinet').eq('id', cabinetId).maybeSingle()
    if (cabinet.error) return illisible(messageErreur(cabinet.error, 'le cabinet n’a pas pu être lu'))
    if (!cabinet.data) return illisible('le cabinet n’a pas été trouvé')
    const ddc = (cabinet.data as { dossier_du_cabinet?: unknown }).dossier_du_cabinet
    if (ddc === null) return { etat: 'sansDossierDuCabinet', dossierClientId }
    if (typeof ddc !== 'string') return illisible('la désignation du cabinet n’a pas été rendue')
    // La policy des lettres est `admin_du_dossier(dossier_id)` sur le dossier du CABINET : ce compte lit ses lettres si, et
    // seulement si, il lit la ligne de ce dossier (`dossiers_select` : `admin_du_dossier(id)` ou un accès client, que ce
    // dossier ne reçoit jamais).
    const ouvert = await supabase.from('dossiers').select('id').eq('id', ddc).maybeSingle()
    if (ouvert.error) return illisible(messageErreur(ouvert.error, 'le dossier du cabinet n’a pas pu être lu'))
    if (!ouvert.data) return { etat: 'fermee', dossierClientId }
    const lecture = await lireTout<LettreSansMontant>((debut, fin) =>
      supabase.from('lettres_de_mission').select(COLONNES_SANS_MONTANT, { count: 'exact' })
        .eq('dossier_id', ddc).eq('dossier_client_id', dossierClientId).order('id').range(debut, fin))
    if (!lecture.complete) return illisible(lecture.motif ?? 'les lettres n’ont été lues qu’en partie')
    return { etat: 'lue', dossierClientId, lettres: lecture.lignes }
  } catch (e) {
    return illisible(messageErreur(e, 'les missions n’ont pas pu être lues'))
  }
}

/** Par la fonction `missions_du_client` (LM5-Q2) : un refus se dit refusé, une valeur qu'on ne reconnaît pas illisible. */
async function lireLesMissionsParLaBase(dossierClientId: string): Promise<LectureDesMissions> {
  try {
    const lue = await lireLesMissionsParLaFonction(dossierClientId,
      supabase.rpc('missions_du_client', { p_dossier_id: dossierClientId }))
    if (lue.etat === 'refusee') return { etat: 'refusee', dossierClientId, motif: lue.motif }
    if (lue.etat === 'illisible') return { etat: 'illisible', dossierClientId, motif: lue.motif }
    if (!lue.dossierDuCabinetDesigne) return { etat: 'sansDossierDuCabinet', dossierClientId }
    return { etat: 'lue', dossierClientId, lettres: lue.lettres }
  } catch (e) {
    return { etat: 'illisible', dossierClientId, motif: messageErreur(e, 'les missions n’ont pas pu être lues') }
  }
}

export function useMissionsDuClient(dossierClientId: string): LectureDesMissions | null {
  const [lue, setLue] = useState<LectureDesMissions | null>(null)
  useEffect(() => {
    if (!LETTRES_DE_MISSION_PREVUES) return
    let annule = false
    void lireLesMissionsDuClient(dossierClientId).then((l) => { if (!annule) setLue(l) })
    return () => { annule = true }
  }, [dossierClientId])
  if (!LETTRES_DE_MISSION_PREVUES) return null
  return lue !== null && lue.dossierClientId === dossierClientId ? lue : null
}
