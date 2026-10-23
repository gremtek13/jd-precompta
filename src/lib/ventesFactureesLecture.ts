import { supabase } from './supabase'
import { partsEncaissees, type ExemplaireLu, type LigneDeFacture } from './encaissementsFactures'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { PartEncaissee } from './rattachement'
import {
  ventesFacturees, type EncaissementVendu, type FactureVendue, type PartVendue, type VentesFacturees,
} from './ventesFacturees'

// CE QUE LES MOTEURS LIRONT DES VENTES FACTURÉES D'UN DOSSIER (ligne 28.6, chantier EC-Q3, étape VF3a ; le module pur est
// lib/ventesFacturees.ts). RIEN NE L'APPELLE ENCORE : à l'étape VF3b, Clôture, TVA, Financement, Estimation et Révision la
// liront à côté de leurs autres sources, et passeront ce qu'elle rend à la 2035, à la CA3, à la situation et à
// l'estimation, en paramètre obligatoire.
//
// Cinq collections, chacune EN ENTIER par `lireTout` (compte annoncé, tri total terminé par la clé primaire) :
//   - les factures et avoirs VALIDÉS SOURCES de leur vente — une facture qui n'est pas source a sa vente comptée par sa
//     pièce, et ne se lit pas ici ; un brouillon n'est jamais source (`factures_emises_source_d_une_facture_validee`) ;
//   - leurs lignes, par leur facture (la table n'a pas de dossier ; la jointure filtre en base, et chaque ligne rendue doit
//     être celle d'une facture source lue) : le TTC et la TVA de chaque taux s'en refont ;
//   - le registre ENTIER des encaissements du dossier, retirés et contre-passations compris : c'est le module qui décide
//     de ce qui compte, et une contre-passation se juge sur l'encaissement qu'elle annule ;
//   - leurs parts par taux ;
//   - les pièces DÉSIGNÉES du dossier (`pieces.facture_id`, étape VF1) — le virement mixte (étape VF5h) : l'encaissement
//     d'une facture qui n'est pas source, cité sur un mouvement classé par ses encaissements, est un paiement de
//     l'exemplaire unique et validé de sa facture (lib/rattachement.ts, `paiementsDesPieces`). La lecture en rend ces
//     parts (`encaissees`), tirées du même registre : un moteur qui compte les ventes facturées date aussi ces pièces, et
//     n'a pas d'autre lecture à faire — une pièce qu'un virement mixte paie, datée sans lui, retomberait à sa date de
//     facture, souvent dans l'exercice d'avant. Elles ne se lisent qu'APRÈS les quatre autres, et seulement si une part
//     peut exister : une facture source lue (sans elle, aucun mouvement n'est classé par ses encaissements) et
//     l'encaissement d'une facture qui ne l'est pas, cité sur un mouvement. Sinon il n'y en a aucune, quelle que soit la
//     désignation — et un dossier qui n'a pas basculé, tous aujourd'hui, n'a ni une lecture de plus, ni une raison de
//     plus de se dire incomplet.
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
export const COLONNES_EXEMPLAIRES = 'id, dossier_id, facture_id, statut, type_piece'

/** Une ligne de facture : elle n'a pas de dossier ; c'est sa facture, lue à part, qui le porte. */
type LigneLue = LigneDeFacture & { id: string }

export type LectureVentesFacturees =
  // `encaissees` : ce que les virements mixtes paient de leurs exemplaires (étape VF5h), que `paiementsDesPieces` reçoit.
  | { dossierId: string; etat: 'lue'; ventes: VentesFacturees; encaissees: readonly PartEncaissee[] }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
export const NOMS_DES_LECTURES = [
  'les factures sources', 'leurs lignes', 'les encaissements', 'leurs parts par taux', 'les exemplaires des factures',
] as const

// Une collection lue en entier ne vaut que si chacune de ses lignes est du dossier ; sinon, le motif qui le dit.
function horsDuDossier<T>(nom: string, lecture: LectureComplete<T>, dossier: (l: T) => string | undefined, dossierId: string): string | null {
  return lecture.lignes.every((l) => dossier(l) === dossierId) ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/**
 * Les ventes facturées du dossier, calculées sur ses cinq collections lues en entier, et les parts des virements mixtes ;
 * ou « incomplète », avec le motif de la première lecture qui a manqué. Ne rejette jamais.
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
    // Les exemplaires, seulement si une part de virement mixte peut exister (l'en-tête) ; lus, en entier et du dossier.
    let exemplaires: readonly ExemplaireLu[] = []
    if (factures.lignes.length > 0 && encaissements.lignes.some((e) => e.ligne_bancaire_id != null && !sourcesLues.has(e.facture_id))) {
      const lus = await lireTout<ExemplaireLu>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_EXEMPLAIRES, { count: 'exact' })
          .eq('dossier_id', dossierId).not('facture_id', 'is', null).order('id').range(debut, fin),
      )
      if (!lus.complete) return { dossierId, etat: 'incomplete', motif: `${NOMS_DES_LECTURES[4]} : ${lus.motif ?? 'lecture incomplète'}` }
      const horsDossier = horsDuDossier(NOMS_DES_LECTURES[4], lus, (p) => p.dossier_id, dossierId)
      if (horsDossier !== null) return { dossierId, etat: 'incomplete', motif: horsDossier }
      exemplaires = lus.lignes
    }
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
      // Les factures lues sont les seules sources : celle d'un encaissement qu'elles ne portent pas n'est pas source.
      encaissees: partsEncaissees(dossierId, encaissements.lignes, { factures: factures.lignes }, exemplaires),
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
