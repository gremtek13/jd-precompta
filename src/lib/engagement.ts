import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_FOURNISSEURS, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE,
} from './comptes'
import { cleFournisseur, dateLocaleDe } from './format'
import { montantRetenu, tvaVentilee } from './montantRetenu'
import type { LigneAGenerer } from './ecritures'
import type { CompteNotesDeFrais, Dossier, LigneBancaire, ModeComptable, Piece } from './types'

// LA COMPTABILITÉ D'ENGAGEMENT (BIC, IS) — ligne 31 de la feuille de route, étape 1 (28/09/2026).
//
// Un dossier tenu en TRÉSORERIE (BNC, 2035) compte une pièce à la date de son PAIEMENT
// (lib/rattachement.ts) : sa charge passe au brouillon face à la banque, en une seule écriture. Un
// dossier tenu en ENGAGEMENT la compte à la date de sa FACTURE, qui crée une dette ou une créance ;
// le paiement la solde ensuite, à sa propre date. Deux écritures, et un compte de tiers entre elles :
//
//   facture d'achat, à sa date (journal AC)  : débit 6… charge, débit 445660 TVA, crédit 401000
//   facture de vente, à sa date (journal VE) : crédit 7… produit, crédit 445710 TVA, débit 411000
//   note de frais, à sa date (journal AC)    : débit 6… charge, débit 445660 TVA, crédit 455, 108 ou 467
//   règlement, au mouvement (journal BQ)     : le compte de tiers contre 512000
//
// CHAQUE ÉCRITURE S'ÉQUILIBRE SEULE, et c'est ce qui distingue ce modèle : en trésorerie, un écart
// entre la pièce et le mouvement déséquilibre le groupe ; ici il reste sur le compte de tiers — ce
// que le fournisseur attend encore, ou ce qu'on lui a payé en trop.
//
// Décisions du cabinet (28/09/2026) : le modèle se choisit par dossier, et les dossiers existants
// restent en trésorerie ; un compte COLLECTIF par nature de tiers (401000, 411000), le détail par
// fournisseur ou par client vivant dans le compte AUXILIAIRE du FEC ; les ventes n'entrent que par
// leurs justificatifs, comme en trésorerie ; l'exercice reste l'année civile. Le modèle ne se change
// que tant que le brouillon d'écritures est vide — un déclencheur en base le refuse ensuite.

export interface ModeleComptable {
  mode: ModeComptable
  // Le compte d'une note de frais payée par le dirigeant — sans objet en trésorerie, où elle passe
  // face à la banque comme toute pièce.
  compteNotesDeFrais: CompteNotesDeFrais
}

export function modeleDuDossier(dossier: Pick<Dossier, 'mode_comptable' | 'compte_notes_de_frais'>): ModeleComptable {
  return { mode: dossier.mode_comptable, compteNotesDeFrais: dossier.compte_notes_de_frais }
}

export const LIBELLES_MODE: Readonly<Record<ModeComptable, string>> = {
  tresorerie: 'Trésorerie (BNC, 2035)',
  engagement: 'Engagement (BIC, IS)',
}

export const EXPLICATIONS_MODE: Readonly<Record<ModeComptable, string>> = {
  tresorerie:
    'Une pièce compte à la date de son paiement, sa date de facture à défaut : la règle des bénéfices non '
    + 'commerciaux et de la déclaration 2035.',
  engagement:
    'La facture crée une dette ou une créance à sa date, en 401 Fournisseurs ou en 411 Clients ; le paiement '
    + 'la solde, à sa propre date. La 2035 n’est pas produite pour ce dossier.',
}

// LES MOTS SONT CEUX DU CABINET (28/09/2026), repris tels quels et pas reformulés : c'est l'ENTREPRISE,
// depuis son compte bancaire, qui rembourse le dirigeant — jamais « la banque » ; le 108 retrace les
// apports et les prélèvements personnels de l'exploitant, qui peut reprendre de la trésorerie — rien
// n'y dit qu'« il n'est rien remboursé » ; et le 467 n'est jamais présenté comme un compte d'attente.
export const COMPTES_NOTES_DE_FRAIS: readonly { compte: CompteNotesDeFrais; libelle: string; explication: string }[] = [
  {
    compte: '455000',
    libelle: '455 – Compte courant d’associé (recommandé pour une société dont le dirigeant est associé)',
    explication:
      'Société (SARL, SAS, SELARL…) dont le dirigeant est associé. Exemple : 100 € de frais → débit du compte '
      + 'de charge concerné 100 €, crédit 455 100 €. Quand la société rembourse le dirigeant, depuis son compte '
      + 'bancaire : débit 455, crédit 512 Banque.',
  },
  {
    compte: '108000',
    libelle: '108 – Compte de l’exploitant (entreprise individuelle)',
    explication:
      'Le compte approprié lorsque l’exploitant règle personnellement une dépense professionnelle. '
      + 'L’exploitant peut ensuite reprendre de la trésorerie : le compte 108 retrace justement ses apports '
      + 'et ses prélèvements personnels.',
  },
  {
    compte: '467000',
    libelle: '467 – Autres comptes débiteurs ou créditeurs',
    explication:
      'Pour une personne qui n’est pas associée, ou lorsqu’aucun compte plus spécifique ne convient.',
  },
]

// Les comptes de tiers de l'engagement. Aucune écriture d'un dossier en trésorerie ne les mouvemente :
// ce n'est pas une hypothèse dont dépendrait un contrôle, c'est ce que la génération produit.
export const COMPTES_DE_TIERS: ReadonlySet<string> = new Set([
  COMPTE_FOURNISSEURS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT, COMPTE_AUTRES_DEBITEURS_CREDITEURS,
])

// Le compte de tiers d'une pièce : 411 pour une vente, le compte du dossier pour une note de frais,
// 401 pour tout le reste — un achat, et une pièce « autre », qui passe en charge comme en trésorerie.
export function compteDeTiers(piece: Pick<Piece, 'type_piece'>, compteNotesDeFrais: CompteNotesDeFrais): string {
  if (piece.type_piece === 'vente') return COMPTE_CLIENTS
  if (piece.type_piece === 'note_frais') return compteNotesDeFrais
  return COMPTE_FOURNISSEURS
}

type Sens = 'debit' | 'credit'
const inverse = (sens: Sens): Sens => (sens === 'debit' ? 'credit' : 'debit')

// Une ligne à son sens normal, ou au sens INVERSE pour un montant négatif (un avoir) — `montant` reste
// toujours positif, la règle de `lignesChargeProduitPourPiece`, sans laquelle le contrôle débit = crédit
// se fausserait en silence.
function ligne(base: Omit<LigneAGenerer, 'sens' | 'compte' | 'montant'>, sensNormal: Sens, compte: string, montant: number): LigneAGenerer {
  return { ...base, compte, sens: montant >= 0 ? sensNormal : inverse(sensNormal), montant: Math.abs(montant) }
}

// L'écriture de la FACTURE, datée de la facture — le repli sur la date de DÉPÔT n'existe que pour une
// pièce que rien ne date, comme en trésorerie. Le montant de la charge et de la TVA suit la règle de
// l'assujettissement (lib/montantRetenu.ts) ; le compte de tiers porte le TTC, c'est-à-dire ce qui est
// dû. Pour une pièce cohérente la somme est nulle ; sur une pièce dont la TVA ne recoupe pas le TTC,
// l'écriture ne s'équilibre pas, et le contrôle des écritures le dit plutôt que de le masquer.
export function lignesFactureEngagement(
  dossierId: string, piece: Piece, compteComptable: string, assujettiTva: boolean, compteNotesDeFrais: CompteNotesDeFrais,
): LigneAGenerer[] {
  const sensPiece: Sens = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const base = {
    dossier_id: dossierId, piece_id: piece.id, statut: 'proposee' as const,
    date: piece.date_piece ?? dateLocaleDe(piece.created_at),
    libelle: piece.tiers ?? piece.nom_fichier,
  }
  const ttc = piece.montant_ttc!
  const tva = tvaVentilee(piece, assujettiTva)
  const lignes = [ligne(base, sensPiece, compteComptable, tva ? montantRetenu(piece, assujettiTva)! : ttc)]
  if (tva) lignes.push(ligne(base, sensPiece, piece.type_piece === 'vente' ? COMPTE_TVA_COLLECTEE : COMPTE_TVA_DEDUCTIBLE, tva))
  lignes.push(ligne(base, inverse(sensPiece), compteDeTiers(piece, compteNotesDeFrais), ttc))
  return lignes
}

// L'écriture d'un RÈGLEMENT, datée du mouvement bancaire et portant son identifiant sur ses deux
// lignes : c'est lui qui la range au journal de banque dans le FEC, et qui la retire quand le
// rapprochement est annulé. La banque se lit au SIGNE du mouvement — une entrée d'argent au débit, une
// sortie au crédit —, jamais au type de la pièce, pour la raison écrite dans contrepartieBanque.ts : un
// avoir remboursé va dans l'autre sens que la facture. Le montant est celui du mouvement, pas celui de
// la pièce : un frais bancaire ou un paiement partiel reste lisible sur le compte de tiers.
export function lignesReglementEngagement(
  dossierId: string, piece: Pick<Piece, 'id' | 'type_piece' | 'tiers' | 'nom_fichier'>,
  mouvement: Pick<LigneBancaire, 'id' | 'date' | 'montant'>, compteNotesDeFrais: CompteNotesDeFrais,
): LigneAGenerer[] {
  if (!mouvement.montant) return []
  const base = {
    dossier_id: dossierId, piece_id: piece.id, statut: 'proposee' as const, date: mouvement.date,
    libelle: piece.tiers ?? piece.nom_fichier, ligne_bancaire_id: mouvement.id,
  }
  const sensBanque: Sens = mouvement.montant > 0 ? 'debit' : 'credit'
  const montant = Math.abs(mouvement.montant)
  return [
    { ...base, compte: compteDeTiers(piece, compteNotesDeFrais), sens: inverse(sensBanque), montant },
    { ...base, compte: COMPTE_BANQUE, sens: sensBanque, montant },
  ]
}

// Tout ce qu'une pièce produit en engagement : sa facture, et un règlement par mouvement rapproché.
// C'est aussi ce que « Régénérer » réécrit en entier — les règlements se déduisent des mouvements, donc
// les reprendre ne perd rien, et c'est ce qui répare un règlement passé sur l'ancien compte de tiers
// d'une pièce dont le type a changé depuis.
export function lignesEngagementPourPiece(
  dossierId: string, piece: Piece, compteComptable: string, assujettiTva: boolean,
  compteNotesDeFrais: CompteNotesDeFrais, mouvements: readonly Pick<LigneBancaire, 'id' | 'date' | 'montant'>[],
): LigneAGenerer[] {
  return [
    ...lignesFactureEngagement(dossierId, piece, compteComptable, assujettiTva, compteNotesDeFrais),
    ...[...mouvements]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .flatMap((m) => lignesReglementEngagement(dossierId, piece, m, compteNotesDeFrais)),
  ]
}

export interface CompteAuxiliaire {
  num: string
  lib: string
}

// Le compte AUXILIAIRE d'une ligne de 401 ou de 411 dans le FEC (CompAuxNum, CompAuxLib). Le numéro
// vient de la CLÉ D'IDENTITÉ du tiers (`cleFournisseur`), jamais de son nom tel que l'OCR l'a lu :
// « Transmedical » et « Transmedical / et redevient » sont le même fournisseur, et deux comptes
// auxiliaires pour lui partageraient son solde en deux moitiés dont aucune ne dirait ce qu'on lui doit.
// Un tiers sans clé (« CARTE BANCAIRE », un nom illisible) va au compte « divers » plutôt que d'en
// recevoir un inventé. Le libellé proposé est le nom lu ; `genererFec` n'en garde qu'un par numéro.
export function auxiliaireDuTiers(piece: Pick<Piece, 'tiers'>, compte: string): CompteAuxiliaire | null {
  if (compte !== COMPTE_FOURNISSEURS && compte !== COMPTE_CLIENTS) return null
  const fournisseur = compte === COMPTE_FOURNISSEURS
  const prefixe = fournisseur ? 'F' : 'C'
  const cle = cleFournisseur(piece.tiers)
  if (!cle) return { num: `${prefixe}DIVERS`, lib: fournisseur ? 'Fournisseurs divers' : 'Clients divers' }
  return { num: `${prefixe}${cle.toUpperCase()}`, lib: piece.tiers!.replace(/\s+/g, ' ').trim() }
}
