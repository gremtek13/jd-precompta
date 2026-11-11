import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type {
  AccesDuDossier, DemandeDuCabinet, DocumentDuCabinet, LectureDUnDocument, RelanceDeLaDemande, ReponseALaDemande,
} from './documentsEtDemandesVue'

// LES DOCUMENTS ET LES DEMANDES DU CABINET, CE QUE LES ÉCRANS LISENT (espace client, ligne 51.5, étape B3a ; le patron :
// lib/situationsPublieesLecture.ts). Aucune de ces lectures ne rejette : une requête qui lève ou un refus tombent du côté
// signalé, avec leur motif — jamais une liste vide. Chacune se rend AVEC le dossier qu'elle a lu : un écran ne prend pas la
// réponse d'un autre dossier. Les écrans ne se montent que sous `DOCUMENTS_ET_DEMANDES_PREVUS` : avant la migration, ces
// tables n'existent pas.

const COLONNES_DOCUMENT = 'id, dossier_id, titre, nature, exercice, chemin, nom_fichier, sha256, taille, type_mime, publie_par, publie_le, retire_par, retire_le'
const COLONNES_LECTURE = 'id, dossier_id, document_id, lecteur, lu_le'
const COLONNES_DEMANDE = 'id, dossier_id, objet, detail, echeance, attendu, auteur, ouverte_le, close_par, close_le, motif_de_cloture'
const COLONNES_REPONSE = 'id, dossier_id, demande_id, auteur, texte, fichier, piece_id, document_id, fichier_sha256, ecrite_le'
const COLONNES_RELANCE = 'id, dossier_id, demande_id, canal, email_id, relancee_par, relancee_le'

const echec = <T>(motif: string): LectureComplete<T> => ({ lignes: [], complete: false, motif })

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas ; une lecture incomplète se rend telle quelle. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return echec(lecture.motif ?? 'une ligne rendue n’est pas de ce dossier')
}

/** Les trois lectures d'une demande — elles-mêmes, leurs réponses, leurs relances —, que les deux espaces font de même. */
async function lireLesDemandes(dossierId: string) {
  const [demandes, reponses, relances] = await Promise.all([
    lireTout<DemandeDuCabinet>((debut, fin) =>
      supabase.from('demandes_cabinet').select(COLONNES_DEMANDE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('ouverte_le').order('id').range(debut, fin)),
    lireTout<ReponseALaDemande>((debut, fin) =>
      supabase.from('demandes_reponses').select(COLONNES_REPONSE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('ecrite_le').order('id').range(debut, fin)),
    lireTout<RelanceDeLaDemande>((debut, fin) =>
      supabase.from('relances_demandes').select(COLONNES_RELANCE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('relancee_le').order('id').range(debut, fin)),
  ])
  return {
    demandes: demandes.complete ? duDossier(demandes, dossierId) : demandes,
    reponses: reponses.complete ? duDossier(reponses, dossierId) : reponses,
    relances: relances.complete ? duDossier(relances, dossierId) : relances,
  }
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Tous les documents du dossier — publiés et retirés —, les premières ouvertures, et les accès du dossier (leur adresse,
// leur case « Documents ») : qui l'a ouvert, et qui le lira.
export interface DocumentsDuCabinetLus {
  dossierId: string
  documents: LectureComplete<DocumentDuCabinet>
  lectures: LectureComplete<LectureDUnDocument>
  acces: LectureComplete<AccesDuDossier>
}

export async function lireLesDocumentsDuCabinet(dossierId: string): Promise<DocumentsDuCabinetLus> {
  try {
    const [documents, lectures, acces] = await Promise.all([
      lireTout<DocumentDuCabinet>((debut, fin) =>
        supabase.from('documents_cabinet').select(COLONNES_DOCUMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('publie_le').order('id').range(debut, fin)),
      lireTout<LectureDUnDocument>((debut, fin) =>
        supabase.from('lectures_documents').select(COLONNES_LECTURE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('lu_le').order('id').range(debut, fin)),
      lireTout<AccesDuDossier & { id: string; dossier_id: string }>((debut, fin) =>
        supabase.from('memberships').select('id, dossier_id, user_id, email, droit_documents', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    return {
      dossierId,
      documents: documents.complete ? duDossier(documents, dossierId) : documents,
      lectures: lectures.complete ? duDossier(lectures, dossierId) : lectures,
      acces: acces.complete ? duDossier(acces, dossierId) : acces,
    }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'lecture refusée')
    return { dossierId, documents: echec(motif), lectures: echec(motif), acces: echec(motif) }
  }
}

/** Un dépôt qu'une réponse cite, tel que le cabinet l'ouvre : son nom et son chemin dans le seau de son genre. */
export interface DepotCite { id: string; dossier_id: string; nom_fichier: string; storage_path: string }

export interface DemandesDuCabinetLues {
  dossierId: string
  demandes: LectureComplete<DemandeDuCabinet>
  reponses: LectureComplete<ReponseALaDemande>
  relances: LectureComplete<RelanceDeLaDemande>
  /** Les pièces et les documents que les réponses citent encore, lus par leurs identifiants. */
  pieces: LectureComplete<DepotCite>
  documentsDivers: LectureComplete<DepotCite>
}

export async function lireLesDemandesDuCabinet(dossierId: string): Promise<DemandesDuCabinetLues> {
  try {
    const { demandes, reponses, relances } = await lireLesDemandes(dossierId)
    const idsDe = (cle: 'piece_id' | 'document_id') =>
      [...new Set(reponses.lignes.map((r) => r[cle]).filter((x): x is string => x !== null))].sort()
    const idsDesPieces = idsDe('piece_id')
    const idsDesDocuments = idsDe('document_id')
    if (!reponses.complete) {
      const motif = 'les réponses ne sont pas lues en entier'
      return { dossierId, demandes, reponses, relances, pieces: echec(motif), documentsDivers: echec(motif) }
    }
    // Une liste vide d'identifiants se lit vide (`in.()`), sans erreur.
    const [piecesLues, documentsLus] = await Promise.all([
      lireTout<DepotCite>((debut, fin) =>
        supabase.from('pieces').select('id, dossier_id, nom_fichier, storage_path', { count: 'exact' })
          .eq('dossier_id', dossierId).in('id', idsDesPieces).order('id').range(debut, fin)),
      lireTout<DepotCite>((debut, fin) =>
        supabase.from('documents_divers').select('id, dossier_id, nom_fichier, storage_path', { count: 'exact' })
          .eq('dossier_id', dossierId).in('id', idsDesDocuments).order('id').range(debut, fin)),
    ])
    const pieces = piecesLues.complete ? duDossier(piecesLues, dossierId) : piecesLues
    const documentsDivers = documentsLus.complete ? duDossier(documentsLus, dossierId) : documentsLus
    return { dossierId, demandes, reponses, relances, pieces, documentsDivers }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'lecture refusée')
    return {
      dossierId, demandes: echec(motif), reponses: echec(motif), relances: echec(motif), pieces: echec(motif), documentsDivers: echec(motif),
    }
  }
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
// « MES DOCUMENTS » : LA CASE SE LIT DEUX FOIS — à la connexion (AuthContext), pour la route et l'entrée ; puis à la BASE,
// dans la même vague que les documents (`droits_sur_le_dossier`) : une case retirée entre-temps rendrait les documents
// VIDES, sans erreur, et l'écran dirait « aucun document » d'un dossier qui en a. Sans la case, rien de ce qui a été lu
// n'est rendu. La RLS ne rend au client que les documents publiés et non retirés, et ses propres ouvertures.
export type MesDocumentsLus =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_documents' }
  | { dossierId: string; etat: 'lus'; documents: LectureComplete<DocumentDuCabinet>; lectures: LectureComplete<LectureDUnDocument> }

export async function lireMesDocuments(dossierId: string): Promise<MesDocumentsLus> {
  try {
    const [droits, documents, lectures] = await Promise.all([
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }),
      lireTout<DocumentDuCabinet>((debut, fin) =>
        supabase.from('documents_cabinet').select(COLONNES_DOCUMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('publie_le').order('id').range(debut, fin)),
      lireTout<LectureDUnDocument>((debut, fin) =>
        supabase.from('lectures_documents').select(COLONNES_LECTURE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('lu_le').order('id').range(debut, fin)),
    ])
    if (droits.error) {
      return { dossierId, etat: 'echec', motif: `ton accès à tes documents n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { dossierId, etat: 'echec', motif: 'ton accès à tes documents n’a pas pu être vérifié (droits illisibles)' }
    }
    if ((data as Record<string, unknown>).documents !== true) return { dossierId, etat: 'sans_documents' }
    return {
      dossierId, etat: 'lus',
      documents: documents.complete ? duDossier(documents, dossierId) : documents,
      lectures: lectures.complete ? duDossier(lectures, dossierId) : lectures,
    }
  } catch (erreur) {
    return { dossierId, etat: 'echec', motif: messageErreur(erreur, 'tes documents n’ont pas pu être lus') }
  }
}

// « MES DEMANDES » : à tout accès du dossier (la RLS les lui ouvre sans case). Avec les demandes, ce qu'il peut joindre à
// une réponse : ses pièces déposées et les documents du dossier — la base juge lesquels, l'écran ne les offre que lus en
// entier.
export interface DepotDuClient { id: string; dossier_id: string; nom_fichier: string; created_at: string; uploaded_by: string | null }

export interface MesDemandesLues {
  dossierId: string
  demandes: LectureComplete<DemandeDuCabinet>
  reponses: LectureComplete<ReponseALaDemande>
  relances: LectureComplete<RelanceDeLaDemande>
  pieces: LectureComplete<DepotDuClient>
  documentsDivers: LectureComplete<DepotDuClient>
}

export async function lireMesDemandes(dossierId: string, moi: string): Promise<MesDemandesLues> {
  try {
    const [lues, pieces, documentsDivers] = await Promise.all([
      lireLesDemandes(dossierId),
      lireTout<DepotDuClient>((debut, fin) =>
        supabase.from('pieces').select('id, dossier_id, nom_fichier, created_at, uploaded_by', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('uploaded_by', moi).order('created_at').order('id').range(debut, fin)),
      lireTout<Omit<DepotDuClient, 'uploaded_by'>>((debut, fin) =>
        supabase.from('documents_divers').select('id, dossier_id, nom_fichier, created_at', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin)),
    ])
    return {
      dossierId,
      ...lues,
      pieces: pieces.complete ? duDossier(pieces, dossierId) : pieces,
      documentsDivers: documentsDivers.complete
        ? duDossier({ ...documentsDivers, lignes: documentsDivers.lignes.map((d) => ({ ...d, uploaded_by: null })) }, dossierId)
        : { ...documentsDivers, lignes: [] },
    }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'tes demandes n’ont pas pu être lues')
    return {
      dossierId, demandes: echec(motif), reponses: echec(motif), relances: echec(motif), pieces: echec(motif), documentsDivers: echec(motif),
    }
  }
}
