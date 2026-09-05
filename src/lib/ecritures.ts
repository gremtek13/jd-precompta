import { supabase } from './supabase'
import type { LigneBancaire, Piece } from './types'

// Comptes PCG standard, fixes — partagés entre Écritures (génération de la ligne charge/produit +
// TVA) et Banque (génération de la contrepartie ci-dessous), pour n'avoir qu'un seul endroit à
// changer si un jour ces comptes deviennent configurables par dossier.
export const COMPTE_TVA_DEDUCTIBLE = '445660'
export const COMPTE_TVA_COLLECTEE = '445710'
export const COMPTE_BANQUE = '512000'

// Suggestions de compte PCG / poste 2035 par catégorie de dépense — un point de départ à
// valider ou ajuster par le cabinet (voir "Comptes manquants" dans Écritures, "Postes manquants"
// dans Clôture), jamais enregistré tout seul : ça ne fait que pré-remplir le champ avant le clic
// explicite sur "Enregistrer". Indexé sur le "code" stable de la catégorie (pas le libellé,
// modifiable) — ne joue donc que pour les catégories globales par défaut (dossier_id null) ; une
// catégorie propre à un dossier reste à renseigner à la main, faute de correspondance connue.
export const SUGGESTIONS_COMPTE_PAR_CODE: Record<string, { compte: string; poste2035: string }> = {
  achats_fournisseurs: { compte: '606100', poste2035: 'Achats' },
  loyer: { compte: '613200', poste2035: 'Loyers et charges locatives' },
  assurance: { compte: '616100', poste2035: "Primes d'assurance" },
  carburant_deplacements: { compte: '625100', poste2035: 'Frais de déplacement' },
  notes_frais: { compte: '625700', poste2035: 'Frais de réception, de représentation' },
  honoraires: { compte: '622600', poste2035: 'Honoraires ne constituant pas des rétrocessions' },
  frais_bancaires: { compte: '627000', poste2035: 'Frais financiers' },
  ventes_prestations: { compte: '706000', poste2035: 'Recettes' },
}

// Une ligne d'écriture brouillon avant insertion (pas encore d'id) — le shape exact attendu par
// `ecritures_brouillon`, hors ligne_bancaire_id (uniquement pertinent pour la contrepartie banque).
export interface LigneAGenerer {
  dossier_id: string
  piece_id: string
  date: string
  libelle: string
  sens: 'debit' | 'credit'
  statut: 'proposee'
  compte: string
  montant: number
}

// Ligne(s) charge/produit (+ TVA séparée le cas échéant) pour une pièce donnée — extrait de
// EcrituresTab pour être appelé aussi bien en génération initiale (une pièce sans encore d'écriture)
// qu'en régénération (une pièce déjà passée en écritures, mais modifiée depuis — voir
// piecesDesynchronisees dans EcrituresTab). Ne couvre jamais la contrepartie banque, gérée séparément
// par synchroniserContrepartieBanque ci-dessous.
export function lignesChargeProduitPourPiece(dossierId: string, piece: Piece, compteComptable: string): LigneAGenerer[] {
  const sens: 'debit' | 'credit' = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const libelle = piece.tiers ?? piece.nom_fichier
  const date = piece.date_piece ?? piece.created_at.slice(0, 10)
  const base = { dossier_id: dossierId, piece_id: piece.id, date, libelle, sens, statut: 'proposee' as const }

  if (piece.montant_tva && piece.montant_tva > 0) {
    const montantHt = piece.montant_ht ?? piece.montant_ttc! - piece.montant_tva
    return [
      { ...base, compte: compteComptable, montant: montantHt },
      { ...base, compte: piece.type_piece === 'vente' ? COMPTE_TVA_COLLECTEE : COMPTE_TVA_DEDUCTIBLE, montant: piece.montant_tva },
    ]
  }
  return [{ ...base, compte: compteComptable, montant: piece.montant_ttc! }]
}

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
