import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { ACHATS_DU_CLIENT_PREVUS, type PaiementDeclare, type PieceVue } from './achatsClient'
import type { AchatDuClient } from './achatsClientVue'

// LES ACHATS DU CLIENT, CE QUE LES ÉCRANS LISENT (espace client, ligne 51.5, étape B5 ; le patron :
// lib/documentsEtDemandesLecture.ts). Aucune de ces lectures ne rejette : une requête qui lève ou un refus tombent du côté
// signalé, avec leur motif — jamais une liste vide. Chacune se rend AVEC le dossier qu'elle a lu. Les écrans ne lisent que
// sous `ACHATS_DU_CLIENT_PREVUS` : avant la migration, ces tables et ces colonnes n'existent pas.

const COLONNES_ACHAT = 'id, dossier_id, type_piece, source, nom_fichier, tiers, date_piece, montant_ttc, statut, identite_numero, date_echeance, echeance_fixee_par, echeance_fixee_le, created_at'
const COLONNES_PAIEMENT = 'id, dossier_id, piece_id, date_paiement, moyen, montant, declare_par, declare_le, retire_par, retire_le'
const COLONNES_VUE = 'id, dossier_id, piece_id, utilisateur, vue_le'

const echec = <T>(motif: string): LectureComplete<T> => ({ lignes: [], complete: false, motif })

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas ; une lecture incomplète se rend telle quelle. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return echec(lecture.motif ?? 'une ligne rendue n’est pas de ce dossier')
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
// « MES ACHATS » : LA CASE SE LIT DEUX FOIS — à la connexion (AuthContext), pour la route et l'entrée ; puis à la BASE, dans
// la même vague que les achats (`droits_sur_le_dossier`) : une case retirée entre-temps rendrait les déclarations VIDES,
// sans erreur, et l'écran dirait « rien de déclaré » d'une facture qui l'est. Sans la case, rien de ce qui a été lu n'est
// rendu. Les pièces d'achat, tout accès les lit encore (le resserrement est l'étape B6) ; les déclarations, l'accès
// « Achats » ; les vues, les siennes seulement.
export type MesAchatsLus =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_achats' }
  | {
    dossierId: string; etat: 'lus'
    pieces: LectureComplete<AchatDuClient>; paiements: LectureComplete<PaiementDeclare>; vues: LectureComplete<PieceVue>
  }

export async function lireMesAchats(dossierId: string, moi: string): Promise<MesAchatsLus> {
  // Drapeau baissé, les tables et les colonnes n'existent pas : rien ne se lit (l'écran ne se monte pas non plus).
  if (!ACHATS_DU_CLIENT_PREVUS) return { dossierId, etat: 'echec', motif: 'tes achats ne sont pas encore ouverts' }
  try {
    const [droits, pieces, paiements, vues] = await Promise.all([
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }),
      lireTout<AchatDuClient>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_ACHAT, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('type_piece', 'achat').order('created_at').order('id').range(debut, fin)),
      lireTout<PaiementDeclare>((debut, fin) =>
        supabase.from('paiements_declares').select(COLONNES_PAIEMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('declare_le').order('id').range(debut, fin)),
      lireTout<PieceVue>((debut, fin) =>
        supabase.from('pieces_vues').select(COLONNES_VUE, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('utilisateur', moi).order('vue_le').order('id').range(debut, fin)),
    ])
    if (droits.error) {
      return { dossierId, etat: 'echec', motif: `ton accès à tes achats n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { dossierId, etat: 'echec', motif: 'ton accès à tes achats n’a pas pu être vérifié (droits illisibles)' }
    }
    if ((data as Record<string, unknown>).achats !== true) return { dossierId, etat: 'sans_achats' }
    return {
      dossierId, etat: 'lus',
      pieces: pieces.complete ? duDossier(pieces, dossierId) : pieces,
      paiements: paiements.complete ? duDossier(paiements, dossierId) : paiements,
      vues: vues.complete ? duDossier(vues, dossierId) : vues,
    }
  } catch (erreur) {
    return { dossierId, etat: 'echec', motif: messageErreur(erreur, 'tes achats n’ont pas pu être lus') }
  }
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// La fiche d'une pièce d'achat : son échéance (relue en base : la fiche reçoit une pièce lue avant la migration, sans ses
// colonnes), ses déclarations de paiement, et les accès du dossier — pour dire « par le client » d'une échéance, jamais
// deviné.
export type EcheanceLue = Pick<AchatDuClient, 'id' | 'dossier_id' | 'source' | 'date_echeance' | 'echeance_fixee_par' | 'echeance_fixee_le'>

export interface AchatDeLaPieceLu {
  dossierId: string
  pieceId: string
  echeance: LectureComplete<EcheanceLue>
  paiements: LectureComplete<PaiementDeclare>
  acces: LectureComplete<{ id: string; dossier_id: string; user_id: string | null }>
}

export async function lireLAchatDeLaPiece(dossierId: string, pieceId: string): Promise<AchatDeLaPieceLu> {
  if (!ACHATS_DU_CLIENT_PREVUS) {
    const motif = 'les achats du client ne sont pas encore en base'
    return { dossierId, pieceId, echeance: echec(motif), paiements: echec(motif), acces: echec(motif) }
  }
  try {
    const [echeance, paiements, acces] = await Promise.all([
      lireTout<EcheanceLue>((debut, fin) =>
        supabase.from('pieces').select('id, dossier_id, source, date_echeance, echeance_fixee_par, echeance_fixee_le', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('id', pieceId).order('id').range(debut, fin)),
      lireTout<PaiementDeclare>((debut, fin) =>
        supabase.from('paiements_declares').select(COLONNES_PAIEMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('piece_id', pieceId).order('declare_le').order('id').range(debut, fin)),
      lireTout<{ id: string; dossier_id: string; user_id: string | null }>((debut, fin) =>
        supabase.from('memberships').select('id, dossier_id, user_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    const uneSeule = echeance.complete && echeance.lignes.length !== 1
      ? echec<EcheanceLue>('la pièce n’a pas été relue') : echeance
    return {
      dossierId, pieceId,
      echeance: uneSeule.complete ? duDossier(uneSeule, dossierId) : uneSeule,
      paiements: paiements.complete ? duDossier(paiements, dossierId) : paiements,
      acces: acces.complete ? duDossier(acces, dossierId) : acces,
    }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'lecture refusée')
    return { dossierId, pieceId, echeance: echec(motif), paiements: echec(motif), acces: echec(motif) }
  }
}
