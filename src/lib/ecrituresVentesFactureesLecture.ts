import { supabase } from './supabase'
import type { LigneDeFacture } from './encaissementsFactures'
import type {
  EncaissementDesEcritures, FactureDesEcritures, MouvementDesEcritures, SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { EcritureBrouillon } from './types'
import type { PartVendue } from './ventesFacturees'
import { COLONNES_LIGNES, COLONNES_PARTS } from './ventesFactureesLecture'

// CE QUE L'ONGLET ÉCRITURES LIT DES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (ligne 28.6, chantier EC-Q3, étape VF4c1 ;
// le module pur est lib/ecrituresVentesFactureesEcran.ts). À part de lib/ventesFactureesLecture.ts, qui rend le CALCUL des
// moteurs : ici, les LIGNES elles-mêmes, que la composition (VF4a) et les refus (VF4b) lisent — et davantage :
//   - les factures et avoirs du dossier, TOUS, sources ou non, brouillons compris : les refus disent « introuvable » ou
//     « n'est pas source » d'après elles, et une écriture qui cite une facture se rattache à elle ; leur TTC nomme la
//     source dans la confirmation ;
//   - les lignes des factures sources (la jointure de lib/ventesFactureesLecture.ts) ;
//   - le registre ENTIER des encaissements, retirés et contre-passations compris, AVEC le compte de contrepartie d'une
//     compensation (VF4A-Q2) ;
//   - leurs parts par taux ;
//   - les mouvements du dossier, tous : ceux que les encaissements citent — classés par eux, pas encore classés, ou
//     déclassés (R3) — et ce qui les classe, que les refus jugent. L'onglet ne lit d'ordinaire que les rapprochés : un
//     mouvement cité pas encore classé ne l'est pas, et la composition le dirait « non lu ».
// Chacune EN ENTIER par `lireTout`. LE TOUT OU RIEN : une seule lecture partielle, refusée ou rompue, et rien ne se décide —
// l'état le dit, avec le motif de la première qui a manqué ; l'écran n'offre alors AUCUN geste. GARDÉE AVEC LE DOSSIER :
// chaque ligne rendue est confrontée au dossier demandé. Ce module ne rejette jamais.

/** Les colonnes que le module lit, chaîne pour chaîne : le compilateur confronte chacune à son type. */
export const COLONNES_FACTURES_ECRITURES =
  'id, dossier_id, statut, type, numero, date_emission, tiers_nom, facture_origine_id, source_de_la_vente, nature_operation, option_debits, date_prestation, montant_ttc'
export const COLONNES_ENCAISSEMENTS_ECRITURES =
  'id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, cree_le, retire_le, compte_contrepartie'
export const COLONNES_MOUVEMENTS_ECRITURES =
  'id, dossier_id, date, montant, libelle, source_fichier, encaissements_de_factures, statut, piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, ventilee, reglement_groupe, prelevement_personnel'

type LigneLue = LigneDeFacture & { id: string }

export type LectureSourcesDesEcrituresDeVente =
  | { dossierId: string; etat: 'lue'; sources: SourcesDesEcrituresDeVente }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
export const NOMS_DES_LECTURES_ECRITURES = [
  'les factures du dossier', 'les lignes des factures sources', 'les encaissements', 'leurs parts par taux', 'les mouvements du relevé',
] as const

function horsDuDossier<T>(nom: string, lecture: LectureComplete<T>, dossier: (l: T) => string | undefined, dossierId: string): string | null {
  return lecture.lignes.every((l) => dossier(l) === dossierId) ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/** Les lignes des ventes facturées du dossier, lues en entier ; ou « incomplète », avec le motif. Ne rejette jamais. */
export async function lireLesSourcesDesEcrituresDeVente(dossierId: string): Promise<LectureSourcesDesEcrituresDeVente> {
  try {
    const [factures, lignes, encaissements, parts, mouvements] = await Promise.all([
      lireTout<FactureDesEcritures>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES_ECRITURES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<LigneLue>((debut, fin) =>
        supabase.from('facture_lignes').select(COLONNES_LIGNES, { count: 'exact' })
          .eq('factures_emises.dossier_id', dossierId).eq('factures_emises.source_de_la_vente', true)
          .order('facture_id').order('ordre').order('id').range(debut, fin),
      ),
      lireTout<EncaissementDesEcritures>((debut, fin) =>
        supabase.from('encaissements_factures').select(COLONNES_ENCAISSEMENTS_ECRITURES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<PartVendue>((debut, fin) =>
        supabase.from('encaissements_factures_taux').select(COLONNES_PARTS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
      ),
      lireTout<MouvementDesEcritures>((debut, fin) =>
        supabase.from('lignes_bancaires').select(COLONNES_MOUVEMENTS_ECRITURES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    const manque = [factures, lignes, encaissements, parts, mouvements]
      .map((l, i) => (l.complete ? null : `${NOMS_DES_LECTURES_ECRITURES[i]} : ${l.motif ?? 'lecture incomplète'}`))
      .find((m) => m !== null)
    if (manque != null) return { dossierId, etat: 'incomplete', motif: manque }
    // Une ligne de facture n'a pas de dossier : elle en est si sa facture est une facture SOURCE lue de ce dossier.
    const sourcesLues = new Set(factures.lignes.filter((f) => f.dossier_id === dossierId && f.source_de_la_vente).map((f) => f.id))
    const motif = horsDuDossier(NOMS_DES_LECTURES_ECRITURES[0], factures, (f) => f.dossier_id, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_ECRITURES[1], lignes, (l) => (sourcesLues.has(l.facture_id) ? dossierId : undefined), dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_ECRITURES[2], encaissements, (e) => e.dossier_id, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_ECRITURES[3], parts, (p) => p.dossier_id, dossierId)
      ?? horsDuDossier(NOMS_DES_LECTURES_ECRITURES[4], mouvements, (m) => m.dossier_id, dossierId)
    if (motif !== null) return { dossierId, etat: 'incomplete', motif }
    return {
      dossierId,
      etat: 'lue',
      sources: {
        dossierId,
        factures: factures.lignes,
        lignes: lignes.lignes.map(({ facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva }) =>
          ({ facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva })),
        encaissements: encaissements.lignes,
        parts: parts.lignes,
        mouvements: mouvements.lignes,
      },
    }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des ventes facturées a échoué') }
  }
}

export type LectureDesEcrituresDeVente =
  | { dossierId: string; etat: 'lue'; sources: SourcesDesEcrituresDeVente; brouillon: EcritureBrouillon[] }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/**
 * LES VENTES FACTURÉES ET LE BROUILLON ENTIER DU DOSSIER, lus ENSEMBLE (étape VF4c3) : ce que l'onglet TVA confronte pour
 * savoir si les écritures des ventes facturées d'une période sont à jour avant d'en liquider la TVA
 * (lib/liquidationTva.ts, `refusDesVentesFacturees`). Les deux lectures dans le même appel — deux lectures faites à deux
 * moments diraient « à écrire » une écriture qu'on vient de passer —, tout ou rien, chaque ligne confrontée au dossier.
 * Ne rejette jamais.
 */
export async function lireLesEcrituresDesVentes(dossierId: string): Promise<LectureDesEcrituresDeVente> {
  try {
    const [sources, brouillon] = await Promise.all([
      lireLesSourcesDesEcrituresDeVente(dossierId),
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
    ])
    if (sources.etat === 'incomplete') return sources
    if (!brouillon.complete) return { dossierId, etat: 'incomplete', motif: `le brouillon : ${brouillon.motif ?? 'lecture incomplète'}` }
    const motif = horsDuDossier('le brouillon', brouillon, (e) => e.dossier_id, dossierId)
    if (motif !== null) return { dossierId, etat: 'incomplete', motif }
    return { dossierId, etat: 'lue', sources: sources.sources, brouillon: brouillon.lignes }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des écritures des ventes facturées a échoué') }
  }
}
