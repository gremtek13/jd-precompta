import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { COMPTES_LETTRABLES } from './lettrage'
import type { EcritureBrouillon, LettrageManuel } from './types'

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
