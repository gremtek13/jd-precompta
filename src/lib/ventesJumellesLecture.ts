import { supabase } from './supabase'
import { EXEMPLAIRES_DES_FACTURES_EXPORTES } from './exemplairesDesFactures'
import { facturesSourcesDe, type FacturesSources } from './facturesSources'
import { lireTout } from './lectureComplete'
import type { FactureEmise } from './types'
import {
  COLONNES_DES_PIECES_DU_PONT, COLONNES_DES_PIECES_DU_PONT_ET_DESIGNATION, jumellesDuDossier, type FacturePourJumelle,
  type JumellesDuDossier, type PiecePourJumelle, type TransmissionPourJumelle,
} from './ventesJumelles'

// CE QUE LE PONT DE LA LIGNE 28.6 LIT (lib/ventesJumelles.ts), pour les écrans qui marquent la pièce jumelle : l'onglet
// Justificatifs, qui a déjà ses pièces, l'onglet Banque (le juge de G3, étape VF6d), la fiche d'une pièce (étape VF6c), et
// le bilan d'un import de la plateforme du client, qui relit tout. Les sélections sont celles de la Checklist et de
// Clôture, chaîne pour chaîne : le compilateur confronte chacune au type que le pont lit.
//
// `motif` : non nul quand l'une des lectures est partielle. L'écran se TAIT alors sur les jumelles — une facture non lue
// ferait passer pour la jumelle d'une autre une pièce dont les preuves se contredisent — et dit pourquoi.
//
// LA DÉSIGNATION (étape VF1a) : les pièces se lisent avec `facture_id` seulement le drapeau `EXEMPLAIRES_DES_FACTURES_EXPORTES`
// levé, lu à CHAQUE lecture : baissé, la colonne n'existe pas en base, et la nommer ferait échouer la lecture.
//
// LA SOURCE DE LA VENTE (étape VF6e) : chaque facture se lit avec `source_de_la_vente` — le pont juge par régime, une
// facture source comptant sa vente elle-même (lib/ventesJumelles.ts, `RegimeDuPont`) ; la colonne est en base depuis l'étape
// VF2. La déclaration d'une pièce (`vente_hors_des_factures`) ne se lit pas ici : les écrans qui la jugent — Justificatifs,
// la Checklist — lisent la pièce entière, et le bilan d'un import ne juge que des pièces neuves, qu'aucune déclaration ne
// marque.

/** La facture émise, telle que le pont la lit : avec la source de sa vente. */
export type FactureDuPontLue = FacturePourJumelle & Pick<FactureEmise, 'source_de_la_vente'>

export interface LectureVentesEmises {
  /** Les factures émises VALIDÉES du dossier : seule une facture validée a une jumelle. */
  factures: FactureDuPontLue[]
  transmissions: TransmissionPourJumelle[]
  motif: string | null
}

export async function lireVentesEmises(dossierId: string): Promise<LectureVentesEmises> {
  const lectureFactures = await lireTout<FactureDuPontLue>((debut, fin) =>
    supabase.from('factures_emises').select('id, dossier_id, statut, type, numero, date_emission, emetteur_siret, superpdp_invoice_id, source_de_la_vente', { count: 'exact' })
      .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
  )
  const lectureTransmissions = await lireTout<TransmissionPourJumelle & { id: string }>((debut, fin) =>
    supabase.from('transmissions_factures').select('id, facture_id, canal, hote, flux_id', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  return {
    factures: lectureFactures.lignes,
    transmissions: lectureTransmissions.lignes,
    motif: [lectureFactures, lectureTransmissions].find((l) => !l.complete)?.motif ?? null,
  }
}

/** Les factures sources d'une lecture du pont faite EN ENTIER ; nulles sur une lecture partielle, dont le vide ne prouverait
 *  rien (étape VF6e). */
export function sourcesDuPont(lecture: LectureVentesEmises): FacturesSources | null {
  return lecture.motif === null ? facturesSourcesDe(lecture.factures) : null
}

export interface LectureJumelles {
  factures: FactureDuPontLue[]
  /** Nul quand une lecture est partielle : rien ne se dit des jumelles. */
  jumelles: JumellesDuDossier | null
  /** Les factures sources (étape VF6e), nulles comme les jumelles. */
  sources: FacturesSources | null
  motif: string | null
}

/** Les jumelles du dossier entier : ses factures émises validées, leurs transmissions et TOUTES ses pièces. */
export async function lireJumellesDuDossier(dossierId: string): Promise<LectureJumelles> {
  const ventes = await lireVentesEmises(dossierId)
  const lecturePieces = await lireTout<PiecePourJumelle>((debut, fin) => (EXEMPLAIRES_DES_FACTURES_EXPORTES
    ? supabase.from('pieces').select(COLONNES_DES_PIECES_DU_PONT_ET_DESIGNATION, { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin)
    : supabase.from('pieces').select(COLONNES_DES_PIECES_DU_PONT, { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin)),
  )
  const motif = ventes.motif ?? (lecturePieces.complete ? null : lecturePieces.motif)
  return {
    factures: ventes.factures,
    jumelles: motif === null ? jumellesDuDossier(ventes.factures, ventes.transmissions, lecturePieces.lignes) : null,
    sources: motif === null ? facturesSourcesDe(ventes.factures) : null,
    motif,
  }
}
