import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { reglageDuDossier, type ReglageDuDossier } from './droitsAcces'

// CE QUE L'ONGLET ACCÈS LIT POUR JUGER LA CASE « VENTES » (chantier EC-Q3, étape VF8d ; le module pur est
// lib/droitsAcces.ts, `reglageDuDossier` et `gesteDeLaCase`) : le réglage du dossier, `dossiers.ventes_par_les_factures`, une
// ligne lue par sa clé — donc en entier. Ce module ne rejette jamais : un refus, une ligne absente ou une requête qui lève
// rendent un réglage ILLISIBLE, avec son motif, et la case « Ventes » ne s'offre alors ni à cocher ni à décocher. La
// réponse porte le dossier lu : un écran qui en a changé entre-temps ne la prend pas pour la sienne.

export interface LectureDuReglage {
  /** Le dossier dont le réglage a été lu. */
  dossierId: string
  reglage: ReglageDuDossier
}

export async function lireLeReglageDuDossier(dossierId: string): Promise<LectureDuReglage> {
  try {
    const { data, error } = await supabase.from('dossiers').select('ventes_par_les_factures').eq('id', dossierId).maybeSingle()
    if (error) return { dossierId, reglage: { etat: 'illisible', motif: messageErreur(error, 'lecture refusée') } }
    return { dossierId, reglage: reglageDuDossier(data) }
  } catch (erreur) {
    return { dossierId, reglage: { etat: 'illisible', motif: messageErreur(erreur, 'lecture interrompue') } }
  }
}
