import { supabase } from './supabase'
import { COMPTE_BANQUE } from './comptes'
import { lignesReglementEngagement, type ModeleComptable } from './engagement'
import { dateLocaleDe } from './format'
import { partsDesPaiements } from './rattachement'
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
//
// Les deux fonctions lèvent si la base refuse l'écriture, plutôt que de rendre la main comme si de
// rien n'était. Ce sont des écritures comptables : leur absence ne se voit qu'indirectement, une
// pièce comptée « en attente de rapprochement bancaire » dans la Checklist sans qu'on sache que
// l'écriture a en réalité été refusée. BanqueTab vérifiait déjà l'erreur du rapprochement lui-même
// avant d'enchaîner ici (voir son commentaire) ; le contrôle s'arrêtait à cette frontière.
//
// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT de la pièce : le compte de
// tiers contre la banque, à la date du mouvement. Rien n'y est redaté — la facture reste à sa date,
// c'est tout l'objet de ce modèle. Sans valeur par défaut pour le modèle : appelée en trésorerie sur un
// dossier en engagement, elle redaterait sa facture au paiement.
export async function synchroniserContrepartieBanque(
  dossierId: string, piece: Piece, ligne: LigneBancaire, modele: ModeleComptable,
) {
  const { data: existantes, error: lectureError } = await supabase
    .from('ecritures_brouillon')
    .select('id, compte, ligne_bancaire_id')
    .eq('piece_id', piece.id)
  if (lectureError) throw lectureError
  if (modele.mode === 'engagement') {
    // Même garde qu'en trésorerie : rien tant que la facture n'est pas générée — la génération écrira
    // la facture ET ses règlements. Et idempotente PAR MOUVEMENT, non par pièce : une pièce payée en
    // plusieurs fois reçoit un règlement par paiement, et un second passage n'en double aucun.
    if (!existantes || !existantes.some((e) => !e.ligne_bancaire_id)) return
    if (existantes.some((e) => e.ligne_bancaire_id === ligne.id)) return
    const reglement = lignesReglementEngagement(dossierId, piece, ligne, modele.compteNotesDeFrais)
    if (reglement.length === 0) return
    const { error } = await supabase.from('ecritures_brouillon').insert(reglement)
    if (error) throw error
    return
  }
  // Rien à faire tant que la pièce n'a pas encore sa ligne de charge/produit (catégorie sans compte
  // comptable, ou "Générer les écritures" pas encore lancé) — la contrepartie viendra d'elle-même au
  // prochain passage. À distinguer d'une lecture en échec, ci-dessus : sans ce contrôle, une lecture
  // refusée rendait `existantes` nul et ressemblait à « pas encore d'écriture », donc à un abandon
  // silencieux et légitime.
  if (!existantes || existantes.length === 0) return
  if (existantes.some((e) => e.compte === COMPTE_BANQUE)) return

  // L'ÉCRITURE PASSE À LA DATE DU PAIEMENT, comme la 2035 compte la pièce (lib/rattachement.ts) :
  // générée avant le rapprochement, elle portait la date de facture, et une facture de décembre
  // réglée en janvier aurait gardé sa charge dans l'exercice d'avant. Seulement quand ce paiement
  // RÈGLE la pièce : un paiement partiel laisse les lignes où elles sont, et le contrôle des écritures
  // demande alors « Régénérer », qui les répartit entre le paiement et la facture.
  //
  // AVANT la contrepartie, et c'est l'ordre qui garde les messages vrais : si la date échoue, rien
  // n'est écrit ; si la contrepartie échoue ensuite, l'écriture est à la bonne date et l'appelant dit
  // bien que la contrepartie n'a pas été créée.
  if (partsDesPaiements(piece, [ligne]).reste === 0) {
    const { error: dateError } = await supabase.from('ecritures_brouillon')
      .update({ date: ligne.date }).eq('piece_id', piece.id).neq('compte', COMPTE_BANQUE)
    if (dateError) throw dateError
  }

  const { error } = await supabase.from('ecritures_brouillon').insert({
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
  if (error) throw error
}

// Retire la contrepartie banque d'une pièce — appelée quand un rapprochement est annulé, sinon la
// ligne banque resterait affichée comme si le mouvement était toujours rapproché.
//
// Et l'écriture RETOURNE À LA DATE DE SA FACTURE : plus rien ne la date au paiement, donc elle compte
// de nouveau là où la 2035 la compte (lib/rattachement.ts). `piece` nul — une pièce que l'écran n'a
// pas sous la main — laisse la date telle quelle, et le contrôle des écritures la signalera.
//
// EN ENGAGEMENT, elle retire le RÈGLEMENT de CE mouvement, ses deux lignes, et rien d'autre : la
// facture reste à sa date, et les règlements des autres paiements de la pièce restent en place.
export async function retirerContrepartieBanque(
  ligneId: string, pieceId: string, piece: Pick<Piece, 'date_piece' | 'created_at'> | null, modele: ModeleComptable,
) {
  if (modele.mode === 'engagement') {
    const { error } = await supabase.from('ecritures_brouillon').delete().eq('ligne_bancaire_id', ligneId)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('ecritures_brouillon').delete().eq('piece_id', pieceId).eq('compte', COMPTE_BANQUE)
  if (error) throw error
  if (!piece) return
  const { error: dateError } = await supabase.from('ecritures_brouillon')
    .update({ date: piece.date_piece ?? dateLocaleDe(piece.created_at) }).eq('piece_id', pieceId)
  if (dateError) throw dateError
}
