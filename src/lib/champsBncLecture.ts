import { CHAMPS_BNC_EXPORTES, type FactureDuClient } from './champsBncDuFec'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { CotisationDeclaree } from './types'

// CE QUE LE FEC D'UN BNC EN TRÉSORERIE LIT DE PLUS (ligne 26.6, étape e ; lot FEC22c ; le module pur est
// lib/champsBncDuFec.ts, la numérotation lib/fec.ts). Deux collections du dossier, chacune EN ENTIER par `lireTout`, tri
// TOTAL terminé par la clé primaire et compte annoncé :
//   - les factures et avoirs, TOUS — brouillons compris, que le module dit n'identifier personne : le numéro, le statut, le
//     SIRET figé du client (IdClient, FEC22-Q4, (D)) et la source de la vente (l'exemplaire désigné d'une facture qui n'est
//     pas source porte l'identité de sa facture). JAMAIS le nom du client : il n'est pas demandé à la base ;
//   - les échéances de cotisation : la date d'un paiement depuis le compte personnel (`paiement_personnel_le`), DateRglt de
//     son écriture — jamais la date de l'écriture.
// Le reste de ce que les quatre champs lisent, l'onglet Écritures l'a déjà : les paiements des pièces, le registre des
// encaissements d'un dossier qui a basculé (lib/ecrituresVentesFactureesLecture.ts), les ventilations, les biens, le plan.
//
// LE TOUT OU RIEN : une seule lecture partielle, refusée ou rompue, et l'état le dit, avec le motif de la première qui a
// manqué ; l'export du FEC se refuse alors, comme pour la caisse. GARDÉE AVEC LE DOSSIER : chaque ligne rendue est confrontée
// au dossier demandé, et la lecture se rend avec son identifiant. Ce module ne rejette jamais.
//
// LE DRAPEAU BAISSÉ (`CHAMPS_BNC_EXPORTES`), ELLE NE LIT RIEN, ET LE DIT : le FEC d'aujourd'hui n'en a pas besoin, et une
// lecture de plus serait une requête — et un échec — de plus sur l'onglet, pour rien.

/** Les colonnes que le module lit, chaîne pour chaîne : le compilateur confronte chacune à son type. */
export const COLONNES_FACTURES_DU_FEC = 'id, dossier_id, numero, statut, tiers_siret, source_de_la_vente'
export const COLONNES_COTISATIONS_DU_FEC = 'id, dossier_id, paiement_personnel_le'

export type FactureDuFecLue = FactureDuClient & { dossier_id: string }
export type CotisationDuFecLue = Pick<CotisationDeclaree, 'id' | 'dossier_id' | 'paiement_personnel_le'>

export type LectureDesChampsBnc =
  // Le drapeau baissé : rien n'est lu, et rien n'en a besoin.
  | { dossierId: string; etat: 'non_exportes' }
  | { dossierId: string; etat: 'lue'; factures: FactureDuFecLue[]; cotisations: CotisationDuFecLue[] }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
export const NOMS_DES_LECTURES_DU_FEC = ['les factures du dossier', 'les échéances de cotisation'] as const

function horsDuDossier(nom: string, lecture: LectureComplete<{ dossier_id: string }>, dossierId: string): string | null {
  return lecture.lignes.every((l) => l.dossier_id === dossierId) ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/** Ce que le FEC d'un BNC en trésorerie lit de plus, selon le drapeau ; ne rejette jamais. */
export async function lireLesChampsBnc(dossierId: string): Promise<LectureDesChampsBnc> {
  return lireLesChampsBncSelon(dossierId, CHAMPS_BNC_EXPORTES !== null)
}

/** La même lecture, selon que le drapeau est levé : les deux états, que les tests jouent. */
export async function lireLesChampsBncSelon(dossierId: string, exportes: boolean): Promise<LectureDesChampsBnc> {
  if (!exportes) return { dossierId, etat: 'non_exportes' }
  try {
    const [factures, cotisations] = await Promise.all([
      lireTout<FactureDuFecLue>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES_DU_FEC, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDuFecLue>((debut, fin) =>
        supabase.from('cotisations_declarees').select(COLONNES_COTISATIONS_DU_FEC, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    const manque = [factures, cotisations]
      .map((l, i) => (l.complete ? null : `${NOMS_DES_LECTURES_DU_FEC[i]} : ${l.motif ?? 'lecture incomplète'}`))
      .find((m) => m !== null)
    if (manque != null) return { dossierId, etat: 'incomplete', motif: manque }
    const motif = horsDuDossier(NOMS_DES_LECTURES_DU_FEC[0], factures, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_DU_FEC[1], cotisations, dossierId)
    if (motif !== null) return { dossierId, etat: 'incomplete', motif }
    return { dossierId, etat: 'lue', factures: factures.lignes, cotisations: cotisations.lignes }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des factures et des cotisations a échoué') }
  }
}
