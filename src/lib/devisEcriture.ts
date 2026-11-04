import { supabase } from './supabase'
import type { EcritureDevis } from './devis'

// LES DEUX GESTES D'UN BROUILLON DE DEVIS, PAR LA BASE SEULE (espace client, étape P6a1 ; modèle : lib/contactsEcriture.ts).
// Aucune policy n'écrit `devis` (hors la restauration du super-administrateur) : `enregistrer_devis` crée, réécrit et émet un
// brouillon, `supprimer_brouillon_devis` le supprime, chacune avec son accès (le cabinet du dossier ou le client « Ventes »)
// vérifié avant toute lecture. Chacune rend ce qu'elle a écrit : on vérifie ici qu'elle a bien rendu le devis visé — émis
// avec un numéro quand on l'émettait. Un refus se lève sous les mots de la base (que `messageErreur` rend tel quel).

/** Ce que la base a rendu d'une écriture : le devis, et son numéro s'il est émis. */
export interface DevisEcrit {
  devisId: string
  numero: string | null
}

/**
 * Crée le brouillon (`devisId` nul), le réécrit, et l'émet si `ecriture.emettre` : `enregistrer_devis` seule. Rend le devis
 * écrit ; lève le refus de la base, ou une réponse qui ne dit pas le devis visé.
 */
export async function enregistrerDevis(dossierId: string, devisId: string | null, ecriture: EcritureDevis): Promise<DevisEcrit> {
  const { data, error } = await supabase.rpc('enregistrer_devis', {
    p_dossier_id: dossierId, p_devis_id: devisId, p_devis: ecriture.devis, p_lignes: ecriture.lignes, p_emettre: ecriture.emettre,
  })
  if (error) throw new Error(error.message)
  // `returns table (devis_id, numero)` : une ligne, rendue en liste.
  const ligne = (Array.isArray(data) ? data[0] : data) as { devis_id?: unknown; numero?: unknown } | null | undefined
  if (ligne == null || typeof ligne.devis_id !== 'string' || (devisId != null && ligne.devis_id !== devisId)
    || (ecriture.emettre ? typeof ligne.numero !== 'string' : ligne.numero != null)) {
    throw new Error('La base n’a pas rendu le devis écrit : relis la liste avant de recommencer.')
  }
  return { devisId: ligne.devis_id, numero: typeof ligne.numero === 'string' ? ligne.numero : null }
}

/** Supprime un brouillon : `supprimer_brouillon_devis` seule, qui rend l'identifiant supprimé. Lève le refus de la base. */
export async function supprimerBrouillonDevis(dossierId: string, devisId: string): Promise<void> {
  const { data, error } = await supabase.rpc('supprimer_brouillon_devis', { p_dossier_id: dossierId, p_devis_id: devisId })
  if (error) throw new Error(error.message)
  if (data !== devisId) throw new Error('La base n’a pas rendu le brouillon supprimé : relis la liste avant de recommencer.')
}
