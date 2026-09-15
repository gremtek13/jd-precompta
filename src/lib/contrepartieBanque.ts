import { supabase } from './supabase'
import { COMPTE_BANQUE } from './comptes'
import type { LigneBancaire, Piece } from './types'

// Les deux seules opérations d'écritures qui parlent à Supabase, tenues à l'écart de `ecritures.ts`
// pour que celui-ci reste purement calculatoire. Ce n'est pas qu'une question de rangement : un
// module qui importe le client Supabase lève au chargement quand les variables d'environnement
// manquent, ce qui rendait tout le cœur comptable — soldes, contrôle débit = crédit, balance —
// impossible à exécuter en test. Même raison que pour `comptes.ts` (voir son en-tête).

// Palier 5+ — vraie partie double. Une écriture générée depuis une pièce (voir EcrituresTab) n'a
// jusqu'ici qu'une moitié : la charge/le produit (+ la TVA le cas échéant), jamais la contrepartie
// banque — donc jamais un débit=crédit exploitable tel quel par un logiciel de comptabilité. Cette
// fonction ajoute cette contrepartie dès qu'on connaît le mouvement bancaire réel (le rapprochement),
// avec le montant réel du mouvement (celui de la pièce peut différer d'un centime — frais bancaires,
// arrondi...) et son sens déduit du signe de ce même mouvement — jamais du type de la pièce (achat/
// vente) : un compte banque est un compte d'actif, une entrée d'argent (montant positif) l'augmente
// donc au débit, une sortie (négatif) le diminue au crédit, quel que soit le type de la pièce en face.
// Déduire le sens du type de pièce fonctionne pour le cas normal (une vente encaissée, un achat payé)
// mais se trompe dès que le mouvement réel va dans l'autre sens que prévu (un remboursement, un avoir
// réglé) — dépendre du signe réel évite ce piège. Best-effort et idempotente : appelée aussi bien
// depuis un rapprochement (Banque) que depuis une génération d'écritures sur une pièce déjà
// rapprochée (Écritures) — sans jamais dupliquer la ligne si elle existe déjà.
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
    sens: ligne.montant >= 0 ? 'debit' : 'credit',
    statut: 'proposee',
  })
}

// Retire la contrepartie banque d'une pièce — appelée quand un rapprochement est annulé, sinon la
// ligne banque resterait affichée comme si le mouvement était toujours rapproché.
export async function retirerContrepartieBanque(pieceId: string) {
  await supabase.from('ecritures_brouillon').delete().eq('piece_id', pieceId).eq('compte', COMPTE_BANQUE)
}
