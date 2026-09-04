import { supabase } from './supabase'
import type { LigneBancaire, Piece } from './types'

// Comptes PCG standard, fixes — partagés entre Écritures (génération de la ligne charge/produit +
// TVA) et Banque (génération de la contrepartie ci-dessous), pour n'avoir qu'un seul endroit à
// changer si un jour ces comptes deviennent configurables par dossier.
export const COMPTE_TVA_DEDUCTIBLE = '445660'
export const COMPTE_TVA_COLLECTEE = '445710'
export const COMPTE_BANQUE = '512000'

// Palier 5+ — vraie partie double. Une écriture générée depuis une pièce (voir EcrituresTab) n'a
// jusqu'ici qu'une moitié : la charge/le produit (+ la TVA le cas échéant), jamais la contrepartie
// banque — donc jamais un débit=crédit exploitable tel quel par un logiciel de comptabilité. Cette
// fonction ajoute cette contrepartie dès qu'on connaît le mouvement bancaire réel (le rapprochement),
// avec le sens opposé à la pièce (une charge déjà débitée est réglée par un crédit banque, et
// inversement) et le montant réel du mouvement (celui de la pièce peut différer d'un centime — frais
// bancaires, arrondi...). Best-effort et idempotente : appelée aussi bien depuis un rapprochement
// (Banque) que depuis une génération d'écritures sur une pièce déjà rapprochée (Écritures) — sans
// jamais dupliquer la ligne si elle existe déjà.
export async function synchroniserContrepartieBanque(dossierId: string, piece: Piece, ligne: LigneBancaire) {
  const { data: existantes } = await supabase
    .from('ecritures_brouillon')
    .select('id, compte')
    .eq('piece_id', piece.id)
  // Rien à faire tant que la pièce n'a pas encore sa ligne de charge/produit (catégorie sans compte
  // comptable, ou "Générer les écritures" pas encore lancé) — la contrepartie viendra d'elle-même au
  // prochain passage.
  if (!existantes || existantes.length === 0) return
  if (existantes.some((e) => e.compte === COMPTE_BANQUE)) return

  await supabase.from('ecritures_brouillon').insert({
    dossier_id: dossierId,
    piece_id: piece.id,
    ligne_bancaire_id: ligne.id,
    date: ligne.date,
    compte: COMPTE_BANQUE,
    libelle: piece.tiers ?? piece.nom_fichier,
    montant: Math.abs(ligne.montant),
    sens: piece.type_piece === 'vente' ? 'debit' : 'credit',
    statut: 'proposee',
  })
}

// Retire la contrepartie banque d'une pièce — appelée quand un rapprochement est annulé, sinon la
// ligne banque resterait affichée comme si le mouvement était toujours rapproché.
export async function retirerContrepartieBanque(pieceId: string) {
  await supabase.from('ecritures_brouillon').delete().eq('piece_id', pieceId).eq('compte', COMPTE_BANQUE)
}
