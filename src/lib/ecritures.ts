import { supabase } from './supabase'
import type { EcritureBrouillon, LigneBancaire, Piece } from './types'

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
  const sensPiece: 'debit' | 'credit' = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const libelle = piece.tiers ?? piece.nom_fichier
  const date = piece.date_piece ?? piece.created_at.slice(0, 10)
  const base = { dossier_id: dossierId, piece_id: piece.id, date, libelle, statut: 'proposee' as const }

  // Un montant de pièce négatif (avoir, remboursement — ça arrive, une pièce validée existante en a
  // un) inverse le sens réel de l'écriture : une "charge" négative est en réalité un crédit, jamais un
  // débit avec un montant négatif. `montant` reste toujours une grandeur positive, sinon le contrôle
  // débit = crédit (voir analyserEcritures) se fausse silencieusement — un solde qui semble équilibré
  // à zéro montant près pourrait en réalité être doublé dans le mauvais sens.
  function ligne(compte: string, montant: number): LigneAGenerer {
    const sens = montant >= 0 ? sensPiece : (sensPiece === 'debit' ? 'credit' : 'debit')
    return { ...base, compte, sens, montant: Math.abs(montant) }
  }

  if (piece.montant_tva) {
    const montantHt = piece.montant_ht ?? piece.montant_ttc! - piece.montant_tva
    return [
      ligne(compteComptable, montantHt),
      ligne(piece.type_piece === 'vente' ? COMPTE_TVA_COLLECTEE : COMPTE_TVA_DEDUCTIBLE, piece.montant_tva),
    ]
  }
  return [ligne(compteComptable, piece.montant_ttc!)]
}

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

// Solde d'un compte sur un ensemble d'écritures, dans le sens comptable normal de ce compte (débiteur
// pour une charge ou la TVA déductible, créditeur pour un produit ou la TVA collectée). Jamais une
// simple somme des montants (qui ignorerait le sens) : dès qu'une ligne au sens inverse apparaît — un
// avoir, un remboursement, voir lignesChargeProduitPourPiece — une somme aveugle additionnerait cette
// ligne au lieu de la soustraire, faussant silencieusement le total.
export function soldeCompte(ecritures: EcritureBrouillon[], compte: string, sensNormal: 'debit' | 'credit'): number {
  const lignes = ecritures.filter((e) => e.compte === compte)
  const debit = lignes.filter((e) => e.sens === 'debit').reduce((sum, e) => sum + e.montant, 0)
  const credit = lignes.filter((e) => e.sens === 'credit').reduce((sum, e) => sum + e.montant, 0)
  return sensNormal === 'debit' ? debit - credit : credit - debit
}

// Tolérance de 2 centimes pour l'arrondi flottant — un écart réel (frais bancaires, paiement
// partiel, pièce modifiée après génération...) est en général bien plus grand, donc quasiment jamais
// absorbé par cette marge.
const EPSILON_EQUILIBRE = 0.02

export interface GroupeDesequilibre {
  pieceId: string
  solde: number
}

export interface AnalyseEcritures {
  // Écriture encore à moitié générée (charge/produit sans sa contrepartie banque) — pas forcément un
  // défaut, la pièce n'est peut-être pas encore rapprochée dans Banque.
  nbSansContrepartie: number
  // Écriture complète (contrepartie présente) dont le total débit ne correspond pas au total crédit.
  groupesDesequilibres: GroupeDesequilibre[]
  // Pièce modifiée (montant, TVA...) depuis que son écriture a été générée — l'écriture enregistrée
  // ne correspond plus au montant TTC actuel de la pièce.
  piecesDesynchronisees: Piece[]
}

// TVA nette (collectée - déductible) du brouillon sur une période donnée — comparée à la TVA
// réellement déclarée (voir DeclarationTva, EcrituresTab) pour un cross-check comptable vs déclaré.
// Bornes incluses ; comparaison de chaînes ISO (YYYY-MM-DD), valide tant que les dates le sont.
export function tvaNettePourPeriode(ecritures: EcritureBrouillon[], periodeDebut: string, periodeFin: string): number {
  const dansPeriode = ecritures.filter((e) => e.date >= periodeDebut && e.date <= periodeFin)
  return soldeCompte(dansPeriode, COMPTE_TVA_COLLECTEE, 'credit') - soldeCompte(dansPeriode, COMPTE_TVA_DEDUCTIBLE, 'debit')
}

// Trois contrôles d'intégrité sur le brouillon d'écritures, partagés entre EcrituresTab (où ils
// bloquent/alertent dans le détail) et ChecklistTab (vue d'ensemble du dossier) — un seul endroit où
// ces règles vivent. `piecesEligibles` : pièces validées dont la catégorie a un compte comptable
// associé (seules concernées par une génération d'écriture).
export function analyserEcritures(ecritures: EcritureBrouillon[], piecesEligibles: Piece[]): AnalyseEcritures {
  const piecesParGroupe = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.piece_id) continue
    piecesParGroupe.set(e.piece_id, [...(piecesParGroupe.get(e.piece_id) ?? []), e])
  }
  const nbSansContrepartie = [...piecesParGroupe.values()].filter((rows) => !rows.some((r) => r.compte === COMPTE_BANQUE)).length

  const groupesDesequilibres = [...piecesParGroupe.entries()]
    .filter(([, rows]) => rows.some((r) => r.compte === COMPTE_BANQUE))
    .map(([pieceId, rows]) => ({
      pieceId,
      solde: rows.reduce((sum, r) => sum + (r.sens === 'debit' ? r.montant : -r.montant), 0),
    }))
    .filter((g) => Math.abs(g.solde) > EPSILON_EQUILIBRE)

  const piecesDesynchronisees = piecesEligibles.filter((p) => {
    const lignes = ecritures.filter((e) => e.piece_id === p.id && e.compte !== COMPTE_BANQUE)
    if (lignes.length === 0) return false // pas encore générée — pas une désynchronisation
    // Signé par rapport au sens naturel de la pièce (achat = débit, vente = crédit) : une simple somme
    // des montants (toujours positifs) donnerait un faux "désynchronisée" sur une pièce à montant
    // négatif (avoir, remboursement), dont les lignes sont correctement enregistrées au sens inverse
    // par lignesChargeProduitPourPiece — pas en écart, juste du signe attendu pour ce cas-là.
    const sensPiece: 'debit' | 'credit' = p.type_piece === 'vente' ? 'credit' : 'debit'
    const total = lignes.reduce((sum, e) => sum + (e.sens === sensPiece ? e.montant : -e.montant), 0)
    return Math.abs(total - p.montant_ttc!) > EPSILON_EQUILIBRE
  })

  return { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees }
}
