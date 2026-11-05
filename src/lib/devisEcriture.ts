import { supabase } from './supabase'
import type { EcritureDevis } from './devis'
import type { DemandeAcompte } from './acompteDevis'
import type { ReponseDevis } from './types'

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

// LES DEUX GESTES D'UN DEVIS ÉMIS (étape P6a2) : répondre (`decider_devis`), puis tirer la facture d'un devis accepté
// (`facturer_devis`) — chacune avec son accès (`gere_les_ventes`) vérifié avant toute lecture, ses refus dans l'ordre que
// lib/devis.ts redit avant le clic.

/**
 * Enregistre la réponse : `decider_devis` seule, qui rend le devis tel qu'elle l'a écrit. `horsValidite` : vrai pour une
 * acceptation datée après la validité, que l'écran a fait confirmer (`acceptationHorsValidite`), faux sinon.
 */
export async function deciderDevis(
  dossierId: string, devisId: string, reponse: ReponseDevis, date: string, horsValidite: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc('decider_devis', {
    p_dossier_id: dossierId, p_devis_id: devisId, p_reponse: reponse, p_date: date, p_hors_validite: horsValidite,
  })
  if (error) throw new Error(error.message)
  // `returns public.devis` : une ligne, rendue en objet (ou en liste d'une ligne).
  const ligne = (Array.isArray(data) ? data[0] : data) as { id?: unknown; reponse?: unknown; date_reponse?: unknown } | null | undefined
  if (ligne == null || ligne.id !== devisId || ligne.reponse !== reponse || ligne.date_reponse !== date) {
    throw new Error('La base n’a pas rendu la réponse enregistrée : relis la liste avant de recommencer.')
  }
}

/** Tire un brouillon de facture d'un devis accepté : `facturer_devis` seule, qui rend l'identifiant de la facture. */
export async function facturerDevis(dossierId: string, devisId: string): Promise<string> {
  const { data, error } = await supabase.rpc('facturer_devis', { p_dossier_id: dossierId, p_devis_id: devisId })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string' || data === '') {
    throw new Error('La base n’a pas rendu la facture tirée du devis : relis la liste avant de recommencer.')
  }
  return data
}

// LE GESTE DE L'ACOMPTE (étape P5b5a), derrière `ACOMPTES_PREVUS` : `facturer_acompte_devis` seule (migration
// `acomptes_des_devis`, préparée), avec son accès (`gere_les_ventes`) vérifié avant toute lecture et ses refus dans l'ordre
// que lib/acomptesDuDevis.ts redit avant le clic. La facture finale reste `facturer_devis` (`facturerDevis`), remplacée par
// la même migration pour reprendre les acomptes en vigueur.

/**
 * Tire un brouillon de facture d'acompte d'un devis accepté : `facturer_acompte_devis` seule, qui rend l'identifiant de la
 * facture. `demande` : la `DemandeAcompte` du module, telle que l'écran l'a jugée ; `dateVersement` : nulle si elle n'est
 * pas donnée (P5B2-Q1).
 */
export async function facturerAcompteDevis(
  dossierId: string, devisId: string, demande: DemandeAcompte, dateVersement: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('facturer_acompte_devis', {
    p_dossier_id: dossierId, p_devis_id: devisId, p_demande: demande, p_date_versement: dateVersement,
  })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string' || data === '') {
    throw new Error('La base n’a pas rendu la facture d’acompte tirée du devis : relis la liste avant de recommencer.')
  }
  return data
}
