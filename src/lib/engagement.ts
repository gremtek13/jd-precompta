import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS,
} from './comptes'
import { cleFournisseur, dateLocaleDe } from './format'
import { compteTvaDe, montantRetenu, tvaVentilee } from './montantRetenu'
import type { CibleComptable, LigneAGenerer } from './ecritures'
import type { CompteNotesDeFrais, Dossier, LigneBancaire, ModeComptable, Piece } from './types'

// LA COMPTABILITÉ D'ENGAGEMENT (BIC, IS) — ligne 31 de la feuille de route, étape 1 (28/09/2026).
//
// Un dossier tenu en TRÉSORERIE (BNC, 2035) compte une pièce à la date de son PAIEMENT
// (lib/rattachement.ts) : sa charge passe au brouillon face à la banque, en une seule écriture. Un
// dossier tenu en ENGAGEMENT la compte à la date de sa FACTURE, qui crée une dette ou une créance ;
// le paiement la solde ensuite, à sa propre date. Deux écritures, et un compte de tiers entre elles :
//
//   facture d'achat, à sa date (journal AC)  : débit 6… charge, débit 445660 TVA, crédit 401000
//   facture d'un bien immobilisé (journal AC) : débit 2… immobilisation, débit 445620 TVA, crédit 404000
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
  // Le compte d'une note de frais payée par le dirigeant, en engagement. En trésorerie il n'y a rien à
  // choisir : ce qu'il a payé de sa poche passe au 108000 de l'exploitant (`compteDuDirigeant`,
  // lib/virementPersonnel.ts ; `ligneContrepartieDirigeant`, lib/ecritures.ts).
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
    + 'commerciaux et de la déclaration 2035. Une note de frais que l’exploitant a payée de sa poche s’écrit au '
    + '108 – Compte de l’exploitant, comme ses virements personnels.',
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
    libelle: '467 – Divers comptes débiteurs et produits à recevoir',
    explication:
      'Pour une personne qui n’est pas associée, ou lorsqu’aucun compte plus spécifique ne convient.',
  },
]

// Les comptes de tiers de l'engagement, et les comptes du dirigeant. En trésorerie, deux écritures portent le
// 108 de l'exploitant : celle d'un virement personnel, qui n'a pas de pièce — aucun contrôle qui lit cette
// liste ne regarde une écriture sans pièce (lib/virementPersonnel.ts) —, et la contrepartie d'une NOTE DE
// FRAIS que le dirigeant a payée de sa poche (`ligneContrepartieDirigeant`, lib/ecritures.ts). Celle-là solde
// la charge de sa pièce exactement comme la ligne de tiers d'une facture d'engagement, et `ecrituresSansObjet`
// l'écarte pour la même raison. Seule une catégorie dont le compte serait l'un d'eux — un achat classé en
// prélèvement personnel au 108 — y porterait la CHARGE d'une pièce, que `ecrituresSansObjet` écarterait aussi :
// aucune n'existe en base (mesuré le 05/10/2026).
export const COMPTES_DE_TIERS: ReadonlySet<string> = new Set([
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_AUTRES_DEBITEURS_CREDITEURS,
])

// Le compte de tiers d'une pièce : 411 pour une vente, le compte du dossier pour une note de frais,
// 404 pour la facture d'un bien IMMOBILISÉ — la dette envers le vendeur d'une immobilisation, que le bilan
// sépare des dettes fournisseurs —, 401 pour tout le reste : un achat, et une pièce « autre », qui passe
// en charge comme en trésorerie. Une note de frais immobilisée reste au compte du dirigeant : c'est lui
// qui a payé. Sans valeur par défaut pour `immobilisation` : l'oublier ferait solder au 401 la facture
// d'un bien écrite au 404.
export function compteDeTiers(
  piece: Pick<Piece, 'type_piece'>, compteNotesDeFrais: CompteNotesDeFrais, immobilisation: boolean,
): string {
  if (piece.type_piece === 'vente') return COMPTE_CLIENTS
  if (piece.type_piece === 'note_frais') return compteNotesDeFrais
  return immobilisation ? COMPTE_FOURNISSEURS_IMMOBILISATIONS : COMPTE_FOURNISSEURS
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
  dossierId: string, piece: Piece, cible: CibleComptable, assujettiTva: boolean, compteNotesDeFrais: CompteNotesDeFrais,
): LigneAGenerer[] {
  const sensPiece: Sens = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const base = {
    dossier_id: dossierId, piece_id: piece.id, statut: 'proposee' as const,
    date: piece.date_piece ?? dateLocaleDe(piece.created_at),
    libelle: piece.tiers ?? piece.nom_fichier,
  }
  const ttc = piece.montant_ttc!
  const tva = tvaVentilee(piece, assujettiTva)
  const lignes = [ligne(base, sensPiece, cible.compte, tva ? montantRetenu(piece, assujettiTva)! : ttc)]
  if (tva) lignes.push(ligne(base, sensPiece, compteTvaDe(piece, cible.immobilisation), tva))
  lignes.push(ligne(base, inverse(sensPiece), compteDeTiers(piece, compteNotesDeFrais, cible.immobilisation), ttc))
  // Une ligne nulle ne s'écrit pas : la base la refuse, et l'insertion d'un seul tenant de la génération emporterait
  // tout le lot avec elle.
  return lignes.filter((l) => l.montant !== 0)
}

// L'écriture d'un RÈGLEMENT, datée du mouvement bancaire et portant son identifiant sur ses deux
// lignes : c'est lui qui la range au journal de banque dans le FEC, et qui la retire quand le
// rapprochement est annulé. La banque se lit au SIGNE du mouvement — une entrée d'argent au débit, une
// sortie au crédit —, jamais au type de la pièce, pour la raison écrite dans contrepartieBanque.ts : un
// avoir remboursé va dans l'autre sens que la facture. Le montant est celui du mouvement, pas celui de
// la pièce : un frais bancaire ou un paiement partiel reste lisible sur le compte de tiers.
export function lignesReglementEngagement(
  dossierId: string, piece: Pick<Piece, 'id' | 'type_piece' | 'tiers' | 'nom_fichier'>,
  mouvement: Pick<LigneBancaire, 'id' | 'date' | 'montant'>, compteNotesDeFrais: CompteNotesDeFrais, immobilisation: boolean,
): LigneAGenerer[] {
  if (!mouvement.montant) return []
  const base = {
    dossier_id: dossierId, piece_id: piece.id, statut: 'proposee' as const, date: mouvement.date,
    libelle: piece.tiers ?? piece.nom_fichier, ligne_bancaire_id: mouvement.id,
  }
  const sensBanque: Sens = mouvement.montant > 0 ? 'debit' : 'credit'
  const montant = Math.abs(mouvement.montant)
  return [
    { ...base, compte: compteDeTiers(piece, compteNotesDeFrais, immobilisation), sens: inverse(sensBanque), montant },
    { ...base, compte: COMPTE_BANQUE, sens: sensBanque, montant },
  ]
}

// Tout ce qu'une pièce produit en engagement : sa facture, et un règlement par mouvement rapproché.
// C'est aussi ce que « Régénérer » réécrit en entier — les règlements se déduisent des mouvements, donc
// les reprendre ne perd rien, et c'est ce qui répare un règlement passé sur l'ancien compte de tiers
// d'une pièce dont le type a changé depuis.
export function lignesEngagementPourPiece(
  dossierId: string, piece: Piece, cible: CibleComptable, assujettiTva: boolean,
  compteNotesDeFrais: CompteNotesDeFrais, mouvements: readonly Pick<LigneBancaire, 'id' | 'date' | 'montant'>[],
): LigneAGenerer[] {
  return [
    ...lignesFactureEngagement(dossierId, piece, cible, assujettiTva, compteNotesDeFrais),
    ...[...mouvements]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .flatMap((m) => lignesReglementEngagement(dossierId, piece, m, compteNotesDeFrais, cible.immobilisation)),
  ]
}

export interface CompteAuxiliaire {
  num: string
  lib: string
}

// Le compte AUXILIAIRE d'une ligne de 401, de 404 ou de 411 dans le FEC (CompAuxNum, CompAuxLib). Le
// numéro vient de la CLÉ D'IDENTITÉ du tiers (`cleFournisseur`), jamais de son nom tel que l'OCR l'a lu :
// « Transmedical » et « Transmedical / et redevient » sont le même fournisseur, et deux comptes
// auxiliaires pour lui partageraient son solde en deux moitiés dont aucune ne dirait ce qu'on lui doit.
// Un tiers sans clé (« CARTE BANCAIRE », un nom illisible) va au compte « divers » plutôt que d'en
// recevoir un inventé. Le libellé proposé est le nom lu ; `genererFec` n'en garde qu'un par numéro.
// Le vendeur d'une immobilisation a son auxiliaire à lui (FI…), rattaché au 404 : le même numéro sous le
// 401 et sous le 404 ferait d'un seul compte auxiliaire deux dettes de natures différentes.
const AUXILIAIRES: Readonly<Record<string, { prefixe: string; divers: string }>> = {
  [COMPTE_FOURNISSEURS]: { prefixe: 'F', divers: 'Fournisseurs divers' },
  [COMPTE_FOURNISSEURS_IMMOBILISATIONS]: { prefixe: 'FI', divers: 'Fournisseurs d’immobilisations divers' },
  [COMPTE_CLIENTS]: { prefixe: 'C', divers: 'Clients divers' },
}

export function auxiliaireDuTiers(piece: Pick<Piece, 'tiers'>, compte: string): CompteAuxiliaire | null {
  const auxiliaire = AUXILIAIRES[compte]
  if (!auxiliaire) return null
  const cle = cleFournisseur(piece.tiers)
  if (!cle) return { num: `${auxiliaire.prefixe}DIVERS`, lib: auxiliaire.divers }
  return { num: `${auxiliaire.prefixe}${cle.toUpperCase()}`, lib: piece.tiers!.replace(/\s+/g, ' ').trim() }
}
