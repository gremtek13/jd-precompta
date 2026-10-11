import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import type { EncaissementLu, LigneLue, PartLue, TexteDePiece } from './ereporting'
import type { FactureDeLEcran, PieceDeLEcran, SourcesEreporting } from './ereportingEcran'
import { lireDeclarationsEreporting } from './declarationsEreportingLecture'
import { DEBUT_EREPORTING_PME } from './periodesEreporting'
import { TYPES_DE_PIECE_DECRITS } from './piecesHorsDeFrance'
import { lireFichesHorsDeFrance } from './piecesHorsDeFranceLecture'
import { lireRegimesEtEcarts } from './regimesEreportingLecture'
import type {
  DeclarationEreportingHorsApplication, Piece, PieceEcarteeEreporting, PieceHorsDeFrance, PieceHorsDeFranceTaux,
  RegimeEreporting, SourceDeclarationEreporting,
} from './types'

// TOUT CE QUE LA FENÊTRE DE L'E-REPORTING LIT D'UN DOSSIER (ligne 28.5, étape e5c) : les sources du contenu d'une déclaration
// (lib/ereporting.ts, étape e4) et celles de son état (lib/declarationsEreporting.ts, étape e5b1), chacune EN ENTIER par
// `lireTout` — ou son drapeau baissé, avec son motif. L'écran n'affirme rien et n'offre aucun geste tant qu'une seule
// manque : un contenu bâti sur une partie des factures a exactement l'air d'un contenu juste, et une déclaration qu'on ne
// verrait pas se déclarerait deux fois.
//
// Les lectures qui existaient déjà (les régimes et les écarts, les déclarations et leurs sources, les fiches « hors de
// France ») ne sont pas recopiées : leurs modules les lisent, une fois. Les fiches rendent un motif commun à la fiche et à sa
// ventilation ; il baisse le drapeau des deux.
//
// LES TEXTES lus sur les documents sont ceux des pièces d'achat que le contenu peut juger candidates : de type décrit par une
// fiche, datées du 1er septembre 2027 ou après, ou sans date (aucune autre n'entre dans une période). Un texte pèse des
// kilo-octets : le dossier entier ne se lit pas, et les identifiants partent par lots.

// Ce qu'elle rend est ce que le module d'affichage attend (`SourcesEreporting`), chaque lecture avec son drapeau.
export interface LectureDeLEreporting extends SourcesEreporting {
  /** Non nul quand l'une des lectures est partielle ; la fenêtre dit chacune (`lecturesManquantes`) et n'offre aucun geste. */
  motif: string | null
  regimes: LectureComplete<RegimeEreporting>
  ecarts: LectureComplete<PieceEcarteeEreporting>
  declarations: LectureComplete<DeclarationEreportingHorsApplication>
  sources: LectureComplete<SourceDeclarationEreporting>
  pieces: LectureComplete<PieceDeLEcran>
  fiches: LectureComplete<PieceHorsDeFrance>
  taux: LectureComplete<PieceHorsDeFranceTaux>
  textes: LectureComplete<TexteDePiece>
  factures: LectureComplete<FactureDeLEcran>
  lignes: LectureComplete<LigneLue>
  encaissements: LectureComplete<EncaissementLu>
  parts: LectureComplete<PartLue>
}

/** Les identifiants d'une requête `.in(...)` par lots : l'adresse d'une requête n'est pas illimitée. */
export const TAILLE_DES_LOTS = 100

/** Les pièces dont le texte peut décider d'une candidate : un achat ou une note de frais datée de l'obligation ou sans date. */
export function piecesADeJuger(pieces: readonly Pick<Piece, 'id' | 'type_piece' | 'date_piece'>[]): string[] {
  return pieces
    .filter((p) => TYPES_DE_PIECE_DECRITS.includes(p.type_piece) && (p.date_piece == null || p.date_piece >= DEBUT_EREPORTING_PME))
    .map((p) => p.id)
}

async function lireLesTextes(dossierId: string, pieceIds: readonly string[]): Promise<LectureComplete<TexteDePiece>> {
  const lignes: TexteDePiece[] = []
  let motif: string | null = null
  for (let i = 0; i < pieceIds.length; i += TAILLE_DES_LOTS) {
    const lot = pieceIds.slice(i, i + TAILLE_DES_LOTS)
    // Tri TOTAL : la clé primaire de la table est `id` (le texte d'un document n'a pas de pièce).
    const lecture = await lireTout<TexteDePiece>((debut, fin) =>
      supabase.from('piece_textes_ocr').select('id, piece_id, texte', { count: 'exact' })
        .eq('dossier_id', dossierId).in('piece_id', lot).order('id').range(debut, fin),
    )
    lignes.push(...lecture.lignes)
    if (!lecture.complete && motif === null) motif = lecture.motif ?? 'lecture incomplète'
  }
  return { lignes, complete: motif === null, motif }
}

export async function lireLEreporting(dossierId: string): Promise<LectureDeLEreporting> {
  const [regimesEtEcarts, declarations, fiches, pieces, factures, lignes, encaissements, parts] = await Promise.all([
    lireRegimesEtEcarts(dossierId),
    lireDeclarationsEreporting(dossierId),
    lireFichesHorsDeFrance(dossierId),
    lireTout<PieceDeLEcran>((debut, fin) =>
      supabase.from('pieces')
        .select('id, dossier_id, type_piece, devise, montant_ttc, montant_devise, montant_tva, tiers, date_piece, nom_fichier', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<FactureDeLEcran>((debut, fin) =>
      supabase.from('factures_emises')
        .select('id, dossier_id, statut, type, date_emission, montant_ht, montant_tva, montant_ttc, type_client, nature_operation, option_debits, date_prestation, periode_fin, numero, tiers_nom', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Les lignes de TOUTES les factures du dossier, par leur facture (la table n'a pas de dossier) : le contenu des ventes
    // refait les montants depuis elles.
    lireTout<LigneLue>((debut, fin) =>
      supabase.from('facture_lignes')
        .select('id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id)', { count: 'exact' })
        .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('ordre').order('id').range(debut, fin),
    ),
    // Le registre ENTIER des encaissements, retirés et contre-passations compris : c'est le contenu des paiements qui décide
    // de ce qui compte.
    lireTout<EncaissementLu>((debut, fin) =>
      supabase.from('encaissements_factures')
        .select('id, dossier_id, facture_id, date_encaissement, montant, annule_id, retire_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<PartLue>((debut, fin) =>
      supabase.from('encaissements_factures_taux').select('encaissement_id, dossier_id, taux, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
    ),
  ])
  // Les textes se lisent après les pièces : ce sont elles qui disent lesquels. Des pièces lues en partie ne laissent pas
  // choisir, et la lecture des pièces dit déjà son manque.
  const textes = pieces.complete
    ? await lireLesTextes(dossierId, piecesADeJuger(pieces.lignes))
    : { lignes: [], complete: false, motif: 'les pièces du dossier n’ont pas été lues en entier : on ne sait pas lesquels de leurs textes lire' }
  const motifFiches = fiches.motif
  const motif = [pieces, factures, lignes, encaissements, parts].find((l) => !l.complete)?.motif ?? null
  return {
    motif,
    regimes: regimesEtEcarts.regimes,
    ecarts: regimesEtEcarts.ecarts,
    declarations: declarations.declarations,
    sources: declarations.sources,
    pieces,
    fiches: { lignes: fiches.fiches, complete: motifFiches === null, motif: motifFiches },
    taux: { lignes: fiches.taux, complete: motifFiches === null, motif: motifFiches },
    textes,
    factures,
    lignes,
    encaissements,
    parts,
  }
}
