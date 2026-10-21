import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { COMPTES_LETTRABLES } from './lettrage'
import { messageErreur } from './messageErreur'
import type { EcritureBrouillon, LettrageManuel } from './types'
import type { EncaissementDesExports, FactureDesExports, FacturesDesLignes } from './ventesFactureesDesExports'

// LES LETTRAGES FAITS À LA MAIN ET CE QUI LES REVÉRIFIE, lus pour un écran qui ne lit pas le brouillon : l'onglet Banque.
// En engagement, une facture qu'un lettrage qui tient solde avec son avoir n'attend plus de mouvement bancaire, et ne doit
// plus s'y dire « sans mouvement » ni « montant introuvable » — une alerte en erreur qu'aucun paiement ne viendrait
// éteindre. Ce n'est pas d'avoir été lettrée qui compte, c'est que le lettrage tienne encore : `etatsDesLettragesManuels`
// (lib/lettrage.ts) le revérifie sur les lignes du brouillon, comme la Checklist et la carte des comptes de tiers.
//
// Il ne lit que les lignes des COMPTES DE TIERS, les seules que `etatsDesLettragesManuels` regarde — le résultat est le
// même que sur le brouillon entier —, et seulement s'il existe un lettrage : sans lettrage, il n'y a rien à revérifier, et
// le brouillon n'est pas relu à chaque ouverture de l'onglet pour rien.
//
// `motif` : non nul quand l'une des deux lectures est partielle. Une pièce qu'un lettrage solde peut alors paraître sans
// mouvement bancaire, et l'écran le dit plutôt que de laisser croire l'alerte juste.
export interface LectureLettragesManuels {
  lettrages: LettrageManuel[]
  ecritures: EcritureBrouillon[]
  motif: string | null
}

export const AUCUN_LETTRAGE_MANUEL: LectureLettragesManuels = { lettrages: [], ecritures: [], motif: null }

export async function lireLettragesManuels(dossierId: string): Promise<LectureLettragesManuels> {
  const lectureLettrages = await lireTout<LettrageManuel>((debut, fin) =>
    supabase.from('lettrages_manuels').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  if (lectureLettrages.lignes.length === 0) return { lettrages: [], ecritures: [], motif: lectureLettrages.motif }
  const lectureEcritures = await lireTout<EcritureBrouillon>((debut, fin) =>
    supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).in('compte', [...COMPTES_LETTRABLES]).order('id').range(debut, fin),
  )
  return {
    lettrages: lectureLettrages.lignes,
    ecritures: lectureEcritures.lignes,
    motif: [lectureLettrages, lectureEcritures].find((l) => !l.complete)?.motif ?? null,
  }
}

// LES FACTURES D'OÙ VIENNENT LES LIGNES D'UNE VENTE FACTURÉE (ligne 28.6, chantier EC-Q3, étape VF4c2), lues pour la carte
// des comptes de tiers (Balance des comptes), qui ne lit pas les ventes facturées : `comptesDeTiers` (lib/lettrage.ts) range
// ces lignes sous leur facture, chez son client — il lui faut la facture qu'un avoir corrige, celle qu'un encaissement
// règle, et le nom du client. Les factures et le registre des encaissements du dossier, chacun EN ENTIER ; l'un lu en
// partie, rien n'est rendu et le motif le dit — une ligne sans sa facture retomberait parmi les « écritures sans pièce ».
// GARDÉE AVEC LE DOSSIER. Ce module ne rejette jamais.
export const COLONNES_FACTURES_DES_LIGNES =
  'id, dossier_id, type, numero, tiers_nom, date_emission, montant_ttc, facture_origine_id, source_de_la_vente'
export const COLONNES_ENCAISSEMENTS_DES_LIGNES =
  'id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id'

export type LectureFacturesDesLignes =
  | { etat: 'lue'; ventes: FacturesDesLignes }
  | { etat: 'incomplete'; motif: string }

export async function lireLesFacturesDesLignes(dossierId: string): Promise<LectureFacturesDesLignes> {
  try {
    const [factures, encaissements] = await Promise.all([
      lireTout<FactureDesExports>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES_DES_LIGNES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<EncaissementDesExports>((debut, fin) =>
        supabase.from('encaissements_factures').select(COLONNES_ENCAISSEMENTS_DES_LIGNES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    if (!factures.complete) return { etat: 'incomplete', motif: `les factures : ${factures.motif ?? 'lecture incomplète'}` }
    if (!encaissements.complete) return { etat: 'incomplete', motif: `les encaissements : ${encaissements.motif ?? 'lecture incomplète'}` }
    if ([...factures.lignes, ...encaissements.lignes].some((l) => l.dossier_id !== dossierId)) {
      return { etat: 'incomplete', motif: 'une ligne rendue n’est pas de ce dossier' }
    }
    return { etat: 'lue', ventes: { factures: factures.lignes, encaissements: encaissements.lignes } }
  } catch (erreur) {
    return { etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des factures a échoué') }
  }
}
