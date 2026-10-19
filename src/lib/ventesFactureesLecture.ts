import { supabase } from './supabase'
import type { LigneDeFacture } from './encaissementsFactures'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  ventesFacturees, type EncaissementVendu, type FactureVendue, type PartVendue, type VentesFacturees,
} from './ventesFacturees'

// CE QUE LES MOTEURS LIRONT DES VENTES FACTURÉES D'UN DOSSIER (ligne 28.6, chantier EC-Q3, étape VF3a ; le module pur est
// lib/ventesFacturees.ts). RIEN NE L'APPELLE ENCORE : à l'étape VF3b, Clôture, TVA, Financement, Estimation et Révision la
// liront à côté de leurs autres sources, et passeront ce qu'elle rend à la 2035, à la CA3, à la situation et à
// l'estimation, en paramètre obligatoire.
//
// Quatre collections, chacune EN ENTIER par `lireTout` (compte annoncé, tri total terminé par la clé primaire) :
//   - les factures et avoirs VALIDÉS SOURCES de leur vente — une facture qui n'est pas source a sa vente comptée par sa
//     pièce, et ne se lit pas ici ; un brouillon n'est jamais source (`factures_emises_source_d_une_facture_validee`) ;
//   - leurs lignes, par leur facture (la table n'a pas de dossier ; la jointure filtre en base, et chaque ligne rendue doit
//     être celle d'une facture source lue) : le TTC et la TVA de chaque taux s'en refont ;
//   - le registre ENTIER des encaissements du dossier, retirés et contre-passations compris : c'est le module qui décide
//     de ce qui compte, et une contre-passation se juge sur l'encaissement qu'elle annule ;
//   - leurs parts par taux.
// LE TOUT OU RIEN : une seule lecture partielle, refusée ou rompue, et RIEN NE SE CALCULE — l'état le dit, avec le motif
// de la première qui a manqué. Une vente facturée dont un encaissement manquerait aurait exactement l'air d'une vente juste
// à moitié payée, et la 2035 d'un exercice se tairait sur la moitié de ses recettes.
//
// GARDÉE AVEC LE DOSSIER : l'état porte le dossier pour lequel il a été lu, et chaque ligne rendue est confrontée à ce
// dossier — une ligne d'un autre dossier rend la lecture INCOMPLÈTE, jamais un calcul. `lectureDuDossier` ne rend une
// lecture qu'au dossier qui l'a demandée : la réponse tardive d'un dossier quitté ne s'inscrit pas à la place de celle du
// dossier ouvert (« une lecture plus lente écrit en dernier »).
//
// Ce module ne rejette jamais : un constructeur de requête qui lèverait tombe du côté signalé, comme une lecture refusée.

/** Les colonnes que le module lit, chaîne pour chaîne : le compilateur confronte chacune à son type. */
export const COLONNES_FACTURES =
  'id, dossier_id, statut, type, numero, date_emission, tiers_nom, facture_origine_id, source_de_la_vente, nature_operation, option_debits, date_prestation'
export const COLONNES_LIGNES =
  'id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id, source_de_la_vente)'
export const COLONNES_ENCAISSEMENTS =
  'id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, cree_le, retire_le'
export const COLONNES_PARTS = 'encaissement_id, dossier_id, taux, montant'

/** Une ligne de facture : elle n'a pas de dossier ; c'est sa facture, lue à part, qui le porte. */
type LigneLue = LigneDeFacture & { id: string }

export type LectureVentesFacturees =
  | { dossierId: string; etat: 'lue'; ventes: VentesFacturees }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
export const NOMS_DES_LECTURES = ['les factures sources', 'leurs lignes', 'les encaissements', 'leurs parts par taux'] as const

// Une collection lue en entier ne vaut que si chacune de ses lignes est du dossier ; sinon, le motif qui le dit.
function horsDuDossier<T>(nom: string, lecture: LectureComplete<T>, dossier: (l: T) => string | undefined, dossierId: string): string | null {
  return lecture.lignes.every((l) => dossier(l) === dossierId) ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/**
 * Les ventes facturées du dossier, calculées sur ses quatre collections lues en entier ; ou « incomplète », avec le motif
 * de la première lecture qui a manqué. Ne rejette jamais.
 */
export async function lireLesVentesFacturees(dossierId: string): Promise<LectureVentesFacturees> {
  try {
    const [factures, lignes, encaissements, parts] = await Promise.all([
      lireTout<FactureVendue>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').eq('source_de_la_vente', true)
          .order('id').range(debut, fin),
      ),
      lireTout<LigneLue>((debut, fin) =>
        supabase.from('facture_lignes').select(COLONNES_LIGNES, { count: 'exact' })
          .eq('factures_emises.dossier_id', dossierId).eq('factures_emises.source_de_la_vente', true)
          .order('facture_id').order('ordre').order('id').range(debut, fin),
      ),
      lireTout<EncaissementVendu>((debut, fin) =>
        supabase.from('encaissements_factures').select(COLONNES_ENCAISSEMENTS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<PartVendue>((debut, fin) =>
        supabase.from('encaissements_factures_taux').select(COLONNES_PARTS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
      ),
    ])
    // D'abord le tout ou rien : une seule lecture partielle, refusée ou rompue, et rien ne se calcule.
    const manque = [factures, lignes, encaissements, parts]
      .map((l, i) => (l.complete ? null : `${NOMS_DES_LECTURES[i]} : ${l.motif ?? 'lecture incomplète'}`))
      .find((m) => m !== null)
    if (manque != null) return { dossierId, etat: 'incomplete', motif: manque }
    const sourcesLues = new Set(factures.lignes.map((f) => f.id))
    const motif = horsDuDossier(NOMS_DES_LECTURES[0], factures, (f) => (f.statut === 'validee' && f.source_de_la_vente ? f.dossier_id : undefined), dossierId)
      // Une ligne n'a pas de dossier : elle est du dossier si sa facture est l'une des factures sources lues — celles-là
      // le sont, vérifiées juste au-dessus. Une facture validée entre les deux lectures rend la lecture incomplète.
      ?? horsDuDossier(NOMS_DES_LECTURES[1], lignes, (l) => (sourcesLues.has(l.facture_id) ? dossierId : undefined), dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES[2], encaissements, (e) => e.dossier_id, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES[3], parts, (p) => p.dossier_id, dossierId)
    if (motif !== null) return { dossierId, etat: 'incomplete', motif }
    return {
      dossierId,
      etat: 'lue',
      ventes: ventesFacturees({
        dossierId,
        factures: factures.lignes,
        lignes: lignes.lignes.map(({ facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva }) =>
          ({ facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva })),
        encaissements: encaissements.lignes,
        parts: parts.lignes,
      }),
    }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des ventes facturées a échoué') }
  }
}

/**
 * La lecture qui vaut pour le dossier ouvert : celle qu'il a demandée, ou rien — « en cours » — tant qu'elle n'est pas
 * revenue. Une lecture faite pour un autre dossier ne vaut jamais, quel que soit l'ordre des réponses.
 */
export function lectureDuDossier(
  lecture: LectureVentesFacturees | null, dossierId: string,
): LectureVentesFacturees | null {
  return lecture !== null && lecture.dossierId === dossierId ? lecture : null
}
