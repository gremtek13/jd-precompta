import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { EncaissementLu } from './encaissementsFactures'
import { verdictDuPontDeLaPiece } from './exemplairesDesFactures'
import { jumellesDuDossier, type PiecePourJumelle } from './ventesJumelles'
import { lireVentesEmises } from './ventesJumellesLecture'
import {
  COLONNES_DES_MARQUES, COLONNES_DU_JOURNAL, CONTEXTE_D_UN_DOSSIER_NON_BASCULE, facturesDuVirementMixte,
  type EquipeLue, type LectureDeCeQueLaPieceEst, type LectureDuContexte, type LectureDuJournal, type LigneDuJournal,
  type MarquesDeLaPiece,
} from './marquesDeLaPiece'

// CE QUE LA FICHE D'UNE PIÈCE LIT POUR DIRE CE QU'ELLE EST (chantier EC-Q3, étape VF6c ; le module pur est
// lib/marquesDeLaPiece.ts). Les factures émises du dossier et le gel de la pièce, l'onglet des justificatifs les lit déjà et
// les lui donne (lib/exemplairesDesFacturesLecture.ts, `piecesFigees`) ; le reste se lit ici :
//   - la bascule du dossier (`dossiers.ventes_par_les_factures`) ; puis, dans un dossier basculé SEULEMENT — ailleurs aucune
//     facture n'est source, aucun mouvement n'est classé par ses encaissements, et aucun refus ne lit le pont —, le pont de
//     la pièce sans sa désignation (les factures validées et leurs transmissions, lib/ventesJumellesLecture.ts), ses quatre
//     liens de G4 (rapprochée, réglée, écrite, lettrée), le registre des encaissements et les mouvements classés par leurs
//     encaissements (le virement mixte). TOUT OU RIEN : une lecture partielle, refusée ou rompue, et le contexte est
//     « incomplet », avec le motif de la première qui a manqué — un lien manqué ferait offrir un geste que la base refuse ;
//   - le journal de la pièce, sous la policy de CHAQUE ligne (`admin_du_dossier` de son dossier) : aucun filtre sur le
//     dossier, pour voir les lignes restées dans celui d'où la pièce vient (VF6B-Q1), et le nom de ces dossiers ;
//   - l'équipe que ce compte voit, pour nommer les auteurs — seulement quand le journal de ce dossier a des lignes.
// Chaque collection par `lireTout`, en entier, tri total terminé par la clé. Ce module ne rejette jamais : une requête qui
// lève tombe du côté signalé, comme une lecture refusée.

/** La pièce telle que cette lecture la lit : son identifiant, et ce que le pont regarde (jamais sa désignation). */
export type PieceALire = Omit<PiecePourJumelle, 'facture_id'>

/** Les colonnes du registre que le virement mixte juge. */
const COLONNES_DU_REGISTRE = 'id, dossier_id, facture_id, montant, ligne_bancaire_id, annule_id, retire_le'

async function lireLeContexte(dossierId: string, piece: PieceALire | null): Promise<LectureDuContexte> {
  try {
    const { data, error } = await supabase.from('dossiers').select('ventes_par_les_factures').eq('id', dossierId).maybeSingle()
    if (error) return { etat: 'incomplet', motif: `le dossier : ${messageErreur(error, 'lecture refusée')}` }
    if (!data) return { etat: 'incomplet', motif: 'le dossier : introuvable' }
    if (data.ventes_par_les_factures !== true) return { etat: 'lu', contexte: CONTEXTE_D_UN_DOSSIER_NON_BASCULE }
    // Une pièce en cours de création : seule la bascule compte (G3, « une pièce de vente naît à valider »).
    if (piece === null) return { etat: 'lu', contexte: { ...CONTEXTE_D_UN_DOSSIER_NON_BASCULE, dossierBascule: true } }

    // Ce qui lie la pièce au relevé et au brouillon (G4) : quatre tables qui citent `piece_id`, lues sur la pièce seule, comme
    // la base les cherche, sans filtre sur le dossier.
    const [ventes, rapprochements, parts, ecritures, lettrages, registre, classes] = await Promise.all([
      lireVentesEmises(dossierId),
      lireTout<{ id: string }>((debut, fin) =>
        supabase.from('lignes_bancaires').select('id', { count: 'exact' }).eq('piece_id', piece.id).order('id').range(debut, fin),
      ),
      lireTout<{ id: string }>((debut, fin) =>
        supabase.from('reglements_groupes').select('id', { count: 'exact' }).eq('piece_id', piece.id).order('id').range(debut, fin),
      ),
      lireTout<{ id: string }>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('id', { count: 'exact' }).eq('piece_id', piece.id).order('id').range(debut, fin),
      ),
      lireTout<{ id: string }>((debut, fin) =>
        supabase.from('lettrages_manuels').select('id', { count: 'exact' }).eq('piece_id', piece.id).order('id').range(debut, fin),
      ),
      lireTout<EncaissementLu>((debut, fin) =>
        supabase.from('encaissements_factures').select(COLONNES_DU_REGISTRE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<{ id: string }>((debut, fin) =>
        supabase.from('lignes_bancaires').select('id', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('encaissements_de_factures', true).order('id').range(debut, fin),
      ),
    ])
    if (ventes.motif !== null) return { etat: 'incomplet', motif: `les factures émises et leurs transmissions : ${ventes.motif}` }
    // Dans l'ordre des rangs 10 à 13 de `designer_exemplaire_facture` : le premier lien qui manque se nomme.
    const manque = (nom: string, motif: string | null): LectureDuContexte =>
      ({ etat: 'incomplet', motif: `${nom} : ${motif ?? 'lecture incomplète'}` })
    if (!rapprochements.complete) return manque('le rapprochement', rapprochements.motif)
    if (!parts.complete) return manque('les parts des virements groupés', parts.motif)
    if (!ecritures.complete) return manque('les écritures', ecritures.motif)
    if (!lettrages.complete) return manque('les lettrages', lettrages.motif)
    if (!registre.complete) return { etat: 'incomplet', motif: `les encaissements : ${registre.motif ?? 'lecture incomplète'}` }
    if (!classes.complete) {
      return { etat: 'incomplet', motif: `les mouvements classés par leurs encaissements : ${classes.motif ?? 'lecture incomplète'}` }
    }
    // Le pont sans la désignation : celui que `factures_du_pont` calcule en base (ventesJumellesJumeau.test.ts).
    const pont = verdictDuPontDeLaPiece(jumellesDuDossier(ventes.factures, ventes.transmissions, [piece]), piece.id)
    return {
      etat: 'lu',
      contexte: {
        dossierBascule: true,
        pont,
        liens: {
          rapprochee: rapprochements.lignes.length > 0, reglee: parts.lignes.length > 0,
          ecrite: ecritures.lignes.length > 0, lettree: lettrages.lignes.length > 0,
        },
        facturesDuVirementMixte: facturesDuVirementMixte(dossierId, registre.lignes, new Set(classes.lignes.map((m) => m.id))),
      },
    }
  } catch (err) {
    return { etat: 'incomplet', motif: messageErreur(err, 'lecture impossible') }
  }
}

async function lireLeJournal(dossierId: string, pieceId: string): Promise<LectureDuJournal> {
  try {
    const lecture = await lireTout<LigneDuJournal>((debut, fin) =>
      supabase.from('designations_des_pieces').select(COLONNES_DU_JOURNAL, { count: 'exact' })
        .eq('piece_id', pieceId).order('fait_le').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'incomplet', motif: lecture.motif ?? 'lecture incomplète' }
    const autres = [...new Set(lecture.lignes.map((l) => l.dossier_id).filter((d) => d !== dossierId))].sort()
    if (autres.length === 0) return { etat: 'lu', lignes: lecture.lignes, nomsDesAutresDossiers: new Map() }
    // Le nom des dossiers d'où la pièce vient : lus en entier, ou pas du tout — « un autre dossier » n'invente rien.
    const noms = await lireTout<{ id: string; nom: string }>((debut, fin) =>
      supabase.from('dossiers').select('id, nom', { count: 'exact' }).in('id', autres).order('id').range(debut, fin),
    )
    return {
      etat: 'lu',
      lignes: lecture.lignes,
      nomsDesAutresDossiers: noms.complete ? new Map(noms.lignes.map((d) => [d.id, d.nom])) : null,
    }
  } catch (err) {
    return { etat: 'incomplet', motif: messageErreur(err, 'lecture impossible') }
  }
}

async function lireLEquipe(): Promise<EquipeLue> {
  try {
    const lecture = await lireTout<{ user_id: string; email: string | null }>((debut, fin) =>
      supabase.from('cabinet_admins').select('user_id, email', { count: 'exact' }).order('user_id').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'incomplete', motif: lecture.motif ?? 'lecture incomplète' }
    return {
      etat: 'lue',
      courriels: new Map(lecture.lignes.filter((m) => m.email !== null).map((m) => [m.user_id, m.email as string])),
    }
  } catch (err) {
    return { etat: 'incomplete', motif: messageErreur(err, 'lecture impossible') }
  }
}

/**
 * Ce que la pièce est, pour sa fiche : le contexte des gestes, le journal et l'équipe qui en nomme les auteurs. `piece` nulle :
 * une pièce en cours de création — la bascule seule. Ne rejette jamais.
 */
export async function lireCeQueLaPieceEst(dossierId: string, piece: PieceALire | null): Promise<LectureDeCeQueLaPieceEst> {
  const [contexte, journal] = await Promise.all([
    lireLeContexte(dossierId, piece),
    piece === null ? Promise.resolve(null) : lireLeJournal(dossierId, piece.id),
  ])
  const aNommer = journal !== null && journal.etat === 'lu' && journal.lignes.some((l) => l.dossier_id === dossierId)
  return { pour: piece?.id ?? null, contexte, journal, equipe: aNommer ? await lireLEquipe() : null }
}

/**
 * La marque de LA pièce, relue après un geste de sa fiche : ce que la base a retenu (la désignation, la déclaration, le
 * statut). Le motif d'un échec, sinon. Ne rejette jamais.
 */
export async function relireLesMarquesDeLaPiece(
  dossierId: string, pieceId: string,
): Promise<{ marques: MarquesDeLaPiece } | { motif: string }> {
  try {
    const { data, error } = await supabase.from('pieces').select(COLONNES_DES_MARQUES)
      .eq('id', pieceId).eq('dossier_id', dossierId).maybeSingle()
    if (error) return { motif: messageErreur(error, 'lecture refusée par la base') }
    if (!data) return { motif: 'la pièce n’est plus dans ce dossier' }
    return { marques: data }
  } catch (err) {
    return { motif: messageErreur(err, 'lecture impossible') }
  }
}
