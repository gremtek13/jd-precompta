import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'
import { INVENTAIRE_PREVU } from './inventaire'
import {
  INVENTAIRE_DU_PAQUET_SANS_OBJET, piecesCiteesParLExercice, type ExerciceDuPaquet, type InventaireDuPaquet, type OriginalLu, type PieceDuPaquet,
} from './paquetDArchive'

// LA LECTURE DU PAQUET D'ARCHIVE (ligne 44, INAL3a) : tout ce que `fabriquerLePaquet` (lib/paquetDArchive.ts, pur) reçoit,
// hors du FEC, que l'onglet Écritures calcule. Elle ne rejette jamais : une lecture partielle, refusée ou rompue rend un
// motif, et AUCUN paquet ne se fabrique — jamais un paquet partiel.
//
// L'ordre compte : l'empreinte de l'exercice se vérifie D'ABORD (`verifier_exercice_valide`, qui lit ses deux formes). En
// forme 2 elle scelle les empreintes de dépôt des pièces citées : vérifiée, ces empreintes sont celles de la validation, et
// relire chaque original contre elles prouve qu'il n'a pas changé depuis.
//
// LES PIÈCES DE L'INVENTAIRE (ligne 35, INV3-Q1 (A)) : la forme 2 scelle aussi celles que les régularisations d'inventaire et les
// provisions de l'exercice citent ; la lecture les compte avec les autres (`piecesCiteesParLExercice`), régularisations et
// provisions lues EN ENTIER. DERRIÈRE `INVENTAIRE_PREVU` : baissé, les tables ne sont pas en base, rien ne s'en lit, et le paquet
// est celui d'hier, au fichier près.

export type LectureDuPaquet =
  | { etat: 'lue'; exercice: ExerciceDuPaquet; piecesCitees: string[]; originaux: OriginalLu[] }
  | { etat: 'refusee'; motif: string }

const COLONNES_EXERCICE = 'dossier_id, annee, valide_le, empreinte, empreinte_precedente, forme_empreinte, nb_ecritures, nb_lignes, declaration'

export async function lireLePaquet(dossierId: string, annee: number): Promise<LectureDuPaquet> {
  return lireLePaquetSelon(dossierId, annee, INVENTAIRE_PREVU)
}

/** La même lecture, selon que les tables de l'inventaire sont en base : les deux états du drapeau, que les tests jouent. */
export async function lireLePaquetSelon(dossierId: string, annee: number, inventaireEnBase: boolean): Promise<LectureDuPaquet> {
  const refus = (motif: string): LectureDuPaquet => ({ etat: 'refusee', motif })
  try {
    const verification = await supabase.rpc('verifier_exercice_valide', { p_dossier_id: dossierId, p_annee: annee })
    if (verification.error) return refus(messageErreur(verification.error, 'l’empreinte de l’exercice n’a pas pu être vérifiée.'))
    if (verification.data !== true) {
      return refus(`l’empreinte de l’exercice ${annee} ne correspond plus à ce qui a été validé : à signaler sans attendre.`)
    }

    const ligne = await supabase.from('exercices_valides').select(COLONNES_EXERCICE)
      .eq('dossier_id', dossierId).eq('annee', annee).maybeSingle()
    if (ligne.error) return refus(messageErreur(ligne.error, `l’exercice ${annee} n’a pas pu être relu.`))
    if (!ligne.data) return refus(`l’exercice ${annee} n’est pas validé.`)
    const exercice = ligne.data as ExerciceDuPaquet

    const lignes = await lireTout<{ id: string; piece_id: string | null; immobilisation_id: string | null }>((debut, fin) =>
      supabase.from('ecritures_brouillon').select('id, piece_id, immobilisation_id', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee')
        .gte('date', `${annee}-01-01`).lte('date', `${annee}-12-31`)
        .order('id').range(debut, fin))
    if (!lignes.complete) return refus(`les écritures validées de l’exercice sont lues en partie (${lignes.motif}).`)

    const immobilisations = await lireTout<{ id: string; piece_id: string | null }>((debut, fin) =>
      supabase.from('immobilisations').select('id, piece_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    if (!immobilisations.complete) return refus(`les biens du dossier sont lus en partie (${immobilisations.motif}).`)

    let inventaire: InventaireDuPaquet = INVENTAIRE_DU_PAQUET_SANS_OBJET
    if (inventaireEnBase) {
      const operations = await lireTout<{ id: string; dossier_id: string; exercice: number; reprise: boolean; piece_citee_id: string | null; provision_id: string | null }>((debut, fin) =>
        supabase.from('operations_inventaire').select('id, dossier_id, exercice, reprise, piece_citee_id, provision_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin))
      if (!operations.complete) return refus(`les régularisations d’inventaire du dossier sont lues en partie (${operations.motif}).`)
      const provisions = await lireTout<{ id: string; dossier_id: string; piece_citee_id: string | null }>((debut, fin) =>
        supabase.from('provisions').select('id, dossier_id, piece_citee_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin))
      if (!provisions.complete) return refus(`les provisions du dossier sont lues en partie (${provisions.motif}).`)
      if ([...operations.lignes, ...provisions.lignes].some((l) => l.dossier_id !== dossierId)) {
        return refus('une régularisation ou une provision rendue n’est pas de ce dossier.')
      }
      inventaire = { etat: 'lu', annee, operations: operations.lignes, provisions: provisions.lignes }
    }

    const piecesCitees = piecesCiteesParLExercice(lignes.lignes, immobilisations.lignes, inventaire)
    const citees = new Set(piecesCitees)
    // Toutes les pièces du dossier, colonnes légères, puis filtrées : une liste d'identifiants dans l'adresse dépasserait
    // la longueur qu'un mandataire accepte pour une année de pièces. Jamais le nom du fichier.
    const pieces = await lireTout<PieceDuPaquet>((debut, fin) =>
      supabase.from('pieces').select('id, date_piece, created_at, storage_path, storage_hash', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    if (!pieces.complete) return refus(`les pièces du dossier sont lues en partie (${pieces.motif}).`)
    const aLire = pieces.lignes.filter((p) => citees.has(p.id))
    if (aLire.length !== piecesCitees.length) {
      return refus(`${piecesCitees.length - aLire.length} pièce(s) citée(s) par l’exercice sont introuvables.`)
    }

    // Les originaux, l'un après l'autre : le premier qui ne se lit pas arrête tout.
    const originaux: OriginalLu[] = []
    for (const piece of aLire) {
      // Un chemin qu'un client a pu poser hors de ce dossier ne se demande pas aux droits du cabinet (CFCS-Q1) : le paquet
      // s'arrête comme sur un original illisible, sans recopier le chemin.
      if (!cheminDuDossier(piece.storage_path, dossierId)) {
        return refus(`l’original d’une pièce citée n’a pas été lu : ${MOTIF_CHEMIN_HORS_DU_DOSSIER} (${originaux.length} sur ${aLire.length} lus).`)
      }
      const { data, error } = await supabase.storage.from('pieces').download(piece.storage_path)
      if (error || !data) {
        return refus(`l’original d’une pièce citée n’a pas pu être lu (${originaux.length} sur ${aLire.length} lus).`)
      }
      originaux.push({ piece, octets: new Uint8Array(await data.arrayBuffer()) })
    }
    return { etat: 'lue', exercice, piecesCitees, originaux }
  } catch (e) {
    return refus(messageErreur(e, 'la lecture a été interrompue.'))
  }
}
