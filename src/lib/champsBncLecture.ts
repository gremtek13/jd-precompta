import { CHAMPS_BNC_EXPORTES, type FactureDuClient } from './champsBncDuFec'
import { CODES_DES_CLIENTS_PREVUS, codeDuClientDeLaFacture, codesDesFiches, type FicheDuCode } from './codesDesClients'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { CotisationDeclaree } from './types'

// CE QUE LE FEC D'UN BNC EN TRÉSORERIE LIT DE PLUS (ligne 26.6, étape e ; lot FEC22c ; le module pur est
// lib/champsBncDuFec.ts, la numérotation lib/fec.ts). Deux collections du dossier, chacune EN ENTIER par `lireTout`, tri
// TOTAL terminé par la clé primaire et compte annoncé :
//   - les factures et avoirs, TOUS — brouillons compris, que le module dit n'identifier personne : le numéro, le statut, le
//     SIRET figé du client (IdClient, FEC22-Q4, (D)), la source de la vente (l'exemplaire désigné d'une facture qui n'est
//     pas source porte l'identité de sa facture) et la fiche d'où vient le client (`contact_id`, EXP58-Q2). JAMAIS le nom du
//     client : il n'est pas demandé à la base ;
//   - le drapeau d'EXP58-Q2 levé (`CODES_DES_CLIENTS_PREVUS`, lib/codesDesClients.ts), les fiches du dossier, leur identifiant
//     et leur CODE seuls — ni leur nom ni leur identité —, d'où chaque facture reçoit le code de sa fiche (`codeDuClient`) ;
//     baissé, rien n'en est lu et ce code est nul pour toutes : IdClient reste celui d'hier ;
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
export const COLONNES_FACTURES_DU_FEC = 'id, dossier_id, numero, statut, tiers_siret, source_de_la_vente, contact_id'
export const COLONNES_COTISATIONS_DU_FEC = 'id, dossier_id, paiement_personnel_le'
export const COLONNES_FICHES_DU_FEC = 'id, dossier_id, code_client'

export type FactureDuFecLue = FactureDuClient & { dossier_id: string }
/** Une facture telle que la base la rend, avant que sa fiche lui donne son code. */
type FactureLueEnBase = Omit<FactureDuFecLue, 'codeDuClient'> & { contact_id: string | null }
export type CotisationDuFecLue = Pick<CotisationDeclaree, 'id' | 'dossier_id' | 'paiement_personnel_le'>

export type LectureDesChampsBnc =
  // Le drapeau baissé : rien n'est lu, et rien n'en a besoin.
  | { dossierId: string; etat: 'non_exportes' }
  | { dossierId: string; etat: 'lue'; factures: FactureDuFecLue[]; cotisations: CotisationDuFecLue[] }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
export const NOMS_DES_LECTURES_DU_FEC = ['les factures du dossier', 'les échéances de cotisation', 'les codes des fiches clients'] as const

function horsDuDossier(nom: string, lecture: LectureComplete<{ dossier_id: string }>, dossierId: string): string | null {
  return lecture.lignes.every((l) => l.dossier_id === dossierId) ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/** Ce que le FEC d'un BNC en trésorerie lit de plus, selon les drapeaux ; ne rejette jamais. */
export async function lireLesChampsBnc(dossierId: string): Promise<LectureDesChampsBnc> {
  return lireLesChampsBncSelon(dossierId, CHAMPS_BNC_EXPORTES !== null, CODES_DES_CLIENTS_PREVUS)
}

// Les fiches ne se lisent que le drapeau d'EXP58-Q2 levé : leur code n'existe pas avant la migration.
const AUCUNE_FICHE: LectureComplete<FicheDuCode> = { lignes: [], complete: true, motif: null }

/** La même lecture, selon que les drapeaux sont levés (les quatre champs ; les codes des fiches) : les états que les tests
 *  jouent. */
export async function lireLesChampsBncSelon(dossierId: string, exportes: boolean, codes: boolean): Promise<LectureDesChampsBnc> {
  if (!exportes) return { dossierId, etat: 'non_exportes' }
  try {
    const [factures, cotisations, fiches] = await Promise.all([
      lireTout<FactureLueEnBase>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES_DU_FEC, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDuFecLue>((debut, fin) =>
        supabase.from('cotisations_declarees').select(COLONNES_COTISATIONS_DU_FEC, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      codes
        ? lireTout<FicheDuCode>((debut, fin) =>
          supabase.from('contacts').select(COLONNES_FICHES_DU_FEC, { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        )
        : Promise.resolve(AUCUNE_FICHE),
    ])
    const manque = [factures, cotisations, fiches]
      .map((l, i) => (l.complete ? null : `${NOMS_DES_LECTURES_DU_FEC[i]} : ${l.motif ?? 'lecture incomplète'}`))
      .find((m) => m !== null)
    if (manque != null) return { dossierId, etat: 'incomplete', motif: manque }
    const motif = horsDuDossier(NOMS_DES_LECTURES_DU_FEC[0], factures, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_DU_FEC[1], cotisations, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_DU_FEC[2], fiches, dossierId)
    if (motif !== null) return { dossierId, etat: 'incomplete', motif }
    const parFiche = codesDesFiches(fiches.lignes, dossierId)
    const lues: FactureDuFecLue[] = factures.lignes.map(({ contact_id, ...f }) => ({
      ...f, codeDuClient: codeDuClientDeLaFacture({ contact_id }, parFiche),
    }))
    return { dossierId, etat: 'lue', factures: lues, cotisations: cotisations.lignes }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des factures et des cotisations a échoué') }
  }
}
