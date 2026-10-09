import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { releverStatutsDesFactures, type ReleveStatuts } from './receptionPlateforme'
import { refusDuReleve } from './statutsLus'

// LE RELEVÉ DES STATUTS DES FACTURES ÉMISES, TEL QUE LES ÉCRANS LE LANCENT (ligne 28.5, étape d7, phase C) : l'appel à
// `plateforme-agreee` (action `relever`), puis la lecture du numéro des factures qu'il a touchées — la fonction rend des
// identifiants, et une fenêtre ne connaît que sa facture. L'onglet Factures, la fenêtre des encaissements et celle de la
// plateforme du client l'appellent SUR UN CLIC, sous LEUR verrou, et relisent ce qu'ils montrent avant de le relâcher.

export interface ResultatReleve {
  releve: ReleveStatuts
  /** Le numéro de chaque facture dont un statut a été gardé ; null quand il n'a pas pu être lu. */
  numeros: Map<string, string | null>
  /** Pourquoi ces numéros n'ont pas tous été lus : le bilan le dit, et ne nomme pas ce qu'il n'a pas lu. */
  numerosIncomplets: string | null
}

/**
 * Relève les statuts, puis lit le numéro des factures qu'ils désignent, dans le dossier seulement. Un refus de la
 * fonction rend sa phrase, complétée quand la plateforme refuse l'identité du cabinet (`refusDuReleve`).
 */
export async function releverEtNommer(
  dossierId: string, depuisLeDebut: boolean,
): Promise<{ resultat: ResultatReleve; erreur: null } | { resultat: null; erreur: string }> {
  const r = await releverStatutsDesFactures(dossierId, depuisLeDebut)
  if (r.erreur !== null) return { resultat: null, erreur: refusDuReleve(r.erreur, r.drapeaux) }
  const ids = [...new Set(r.donnees.issues.flatMap((i) => (i.issue === 'garde' ? [i.facture_id] : [])))]
  const numeros = new Map<string, string | null>(ids.map((id) => [id, null]))
  let numerosIncomplets: string | null = null
  if (ids.length > 0) {
    // Lue en partie, une facture reste « sans numéro lu » dans le bilan — qui ne commande aucune écriture.
    const lecture = await lireTout<{ id: string; numero: string | null }>((debut, fin) =>
      supabase.from('factures_emises').select('id, numero', { count: 'exact' })
        .eq('dossier_id', dossierId).in('id', ids).order('id').range(debut, fin),
    )
    for (const f of lecture.lignes) numeros.set(f.id, f.numero)
    if (!lecture.complete) numerosIncomplets = lecture.motif ?? 'lecture incomplète'
  }
  return { resultat: { releve: r.donnees, numeros, numerosIncomplets }, erreur: null }
}
