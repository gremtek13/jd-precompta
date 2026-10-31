import { mouvementJustifieParLeReleve, natureDuCompte, type NatureCompte } from './affectationBanque'
import { posteRattache } from './cases2035'
import {
  POSTE_AMORTISSEMENTS, POSTE_ARRONDIS_TVA_CHARGE, POSTE_ARRONDIS_TVA_PRODUIT, POSTE_COTISATIONS, POSTE_CSG_DEDUCTIBLE,
  POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES,
} from './declaration2035'
import type { CibleComptable } from './ecritures'
import { POSTE_ASSURANCE_EMPRUNT, POSTE_INTERETS_EMPRUNT } from './echeanceEmprunt'
import { justifieSonMouvement } from './encaissementsFactures'
import { sirenValide, siretValide } from './factureCii'
import { dateLocaleDe } from './format'
import type { PlanComptable } from './planComptable'
import { rattachementsTresorerie, type PaiementDePiece } from './rattachement'
import type {
  ANouveau, Categorie, CotisationDeclaree, EcritureBrouillon, EncaissementFacture, FactureEmise, LigneBancaire, MoyenEncaissement,
  OperationCaisse, Piece,
} from './types'

// LES QUATRE CHAMPS DE PLUS DU FEC D'UN BNC EN TRÉSORERIE (ligne 26.6, étape e ; lot FEC22a ; MVP-D5). LPF, art. A47 A-1,
// VIII, 7° : le contribuable BNC qui « tient une comptabilité de trésorerie » doit les vingt-deux premières informations
// du tableau, « dans l'ordre » — les dix-huit d'aujourd'hui, puis « 19. La date de règlement » (DateRglt), « 20. Le mode
// de règlement » (ModeRglt), « 21. La nature de l'opération (à blanc si non utilisé) » (NatOp), « 22. L'identification
// du client (à blanc si non utilisé) » (IdClient). La notice : BOI-CF-IOR-60-40-20, § 280 (« la date à laquelle ont été
// encaissées les recettes et payées les dépenses »), § 290 (le mode, « codifiable avec une table »), § 300 (la nature,
// littérale ou codifiée), § 310 (l'identité déclarée par le client, codifiable sous le secret professionnel).
// Conception : HISTORIQUE.md, « LE FEC D'UN BNC EN TRÉSORERIE : LES VINGT-DEUX CHAMPS, LA CONCEPTION » ; les réponses du
// cabinet, « HUIT RÉPONSES DU CABINET : C6-Q1, FEC22-Q1 À Q6 ET FEC22-E », qui l'emportent sur ses recommandations.
//
// UN MODULE PUR ET NEUTRE : rien ne le lit encore. Le fichier (FEC22c) l'appellera écriture par écriture, la migration
// (FEC22b) figera ce qu'il rend à la validation. Il ne lit ni la base ni l'horloge : l'appelant lui donne ce qu'il a LU.
//
// CE QUI EST TENU ICI :
//   1. UNE VALEUR LUE, JAMAIS DEVINÉE. Chaque champ se tire de la source de l'écriture — la pièce et son paiement, le
//      mouvement et son lien, l'opération de caisse, l'encaissement du registre, la facture, l'échéance payée de la poche
//      de l'exploitant. AUCUN LIBELLÉ n'est lu — ni celui du relevé (« PRLV », « CB », « CHQ » ne disent pas le mode que
//      la banque n'a pas transmis), ni celui d'une pièce, d'une écriture ou d'une catégorie. Ce qui n'a pas de source
//      reste vide (''), comme le § 70 de la notice le veut (« Il ne faut pas remplir avec des « 0 » ou des « espaces » »).
//   2. JAMAIS UN NOM (BOI-BNC-DECLA-10-20, § 280 ; CGI, art. 99 ; code pénal, art. 226-13). IdClient n'est que sur les
//      écritures d'une facture émise, et n'y est que le SIREN de son client ou le numéro de la facture (FEC22-Q4, (D)) ;
//      NatOp n'est que la nature comptable de l'opération et un poste du formulaire, jamais la nature d'un soin (LPF,
//      art. L. 13-0 A ; BOI-CF-IOR-60-10, § 340). Les types lus portent les noms (`tiers`, `tiers_nom`, les libellés,
//      `nom_fichier`, `motif`) pour que l'appelant passe ses lignes telles qu'il les a lues : le test « aucun nom » les y
//      plante, et aucun n'en sort.
//   3. AUCUNE VALEUR PAR DÉFAUT. Chaque entrée est obligatoire ; ce que les sources ne tranchent pas est un CHOIX
//      (`ChoixChampsBnc`, comme `ChoixFrr` pour le fichier de l'e-reporting), que l'expert-comptable fixera (FEC22-E2).
//   4. LA NATURE EST UNE PAR ÉCRITURE, LE POSTE SUIT LA LIGNE (FEC22-Q3, (C)) : NatOp s'écrit ligne par ligne — la nature
//      seule sur la banque, la TVA et les comptes de bilan, la nature et le poste de la 2035 sur une ligne de charge ou de
//      produit (« Dépense — Achats »). Une écriture ventilée sur deux postes porte deux NatOp.

// ── Les listes fermées ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les modes de règlement (ModeRglt), en toutes lettres (BOI-CF-IOR-60-40-20, § 290 : « chèque, espèces, virement »,
 * littéral ou codifié ; littéral ici, sans table à fournir). « Banque » : un règlement par le relevé, dont l'instrument
 * n'est pas connu — l'import ne garde du mouvement que sa date, son montant et son libellé (FEC22-Q2, (A)). « Compte
 * personnel » : l'exploitant a payé de sa poche, le moyen exact n'est pas connu. « Sans règlement » : la seconde option de
 * FEC22-Q1, pour une écriture qui n'en est pas un ; jamais écrite sans ce choix.
 */
export const MODES_REGLEMENT = [
  'Banque', 'Espèces', 'Compte personnel', 'Virement', 'Chèque', 'Carte bancaire', 'Prélèvement', 'Effet', 'Compensation',
  'Autre', 'Sans règlement',
] as const
export type ModeRglt = (typeof MODES_REGLEMENT)[number]

/**
 * Le mode d'un moyen du registre des encaissements (`MoyenEncaissement`, huit valeurs). Un `Record` sur l'union : un moyen
 * neuf sans mode ne compile pas. Une compensation est un règlement (§ 290 : les « modalités de paiement »).
 */
export const MODE_DU_MOYEN: Readonly<Record<MoyenEncaissement, ModeRglt>> = {
  virement: 'Virement',
  cheque: 'Chèque',
  carte: 'Carte bancaire',
  prelevement: 'Prélèvement',
  especes: 'Espèces',
  effet: 'Effet',
  compensation: 'Compensation',
  autre: 'Autre',
}

/**
 * Les natures de l'opération (NatOp), une par écriture, tirées de sa SOURCE : la liste de FEC22-Q3, (A), et rien d'autre.
 * Aucune ne dit un soin, une personne ni un texte que le cabinet a tapé.
 */
export const NATURES_OPERATION = [
  'Recette', 'Dépense', 'Recette et dépense', "Acquisition d'immobilisation", "Apport de l'exploitant",
  "Prélèvement de l'exploitant", "Échéance d'emprunt", "Déblocage d'emprunt", 'Cotisation sociale', 'Opération de bilan',
  "Versement d'espèces", 'Paiement de TVA', 'Remboursement de TVA', 'Liquidation de TVA', 'Dotation aux amortissements',
  'Frais de véhicule (barème)', 'À-nouveaux', 'TVA due sur facture', 'Annulation de recette', 'Remise en banque',
] as const
export type NatureOperation = (typeof NATURES_OPERATION)[number]

/** Le séparateur de la nature et du poste dans NatOp, celui de la réponse du cabinet (« Dépense — Achats »). */
export const SEPARATEUR_DU_POSTE = ' — '

// ── Le choix de FEC22-Q1 ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * DateRglt et ModeRglt d'une écriture qui n'est PAS un règlement — une dotation, un forfait kilométrique, une liquidation
 * de TVA, les à-nouveaux, la TVA due d'une facture, une pièce sans paiement. Le VIII, 7° ne les dit pas « à blanc », et
 * Test Compta Demat ne les contrôle plus depuis le 23/01/2015 : la réponse du cabinet (FEC22-Q1, (C)) est « selon ce
 * qu'exige le logiciel de l'expert-comptable », que FEC22-E2 dira. `vides` : les deux à blanc ; `date_de_l_ecriture` :
 * DateRglt la date de l'écriture et ModeRglt « Sans règlement ». SANS VALEUR PAR DÉFAUT.
 */
export const SANS_REGLEMENT = ['vides', 'date_de_l_ecriture'] as const
export type SansReglement = (typeof SANS_REGLEMENT)[number]

export interface ChoixChampsBnc {
  sansReglement: SansReglement
}

// ── Ce que le module rend ──────────────────────────────────────────────────────────────────────────────────────────────

/** Les quatre champs d'une écriture. Les mêmes sur toutes ses lignes, NatOp excepté, dont le poste suit la ligne. */
export interface ChampsBnc {
  /** AAAA-MM-JJ, comme les dates de la base (le fichier l'écrit AAAAMMJJ) ; '' sans règlement. */
  dateRglt: string
  modeRglt: ModeRglt | ''
  /** La nature de l'écriture, une seule : ce que la migration (FEC22b) peut figer à part du poste. */
  nature: NatureOperation
  /** NatOp de chaque ligne, par identifiant de ligne : la nature, suivie du poste sur une ligne de charge ou de produit. */
  natOp: ReadonlyMap<string, string>
  /** Le SIREN du client ou le numéro de la facture, sur les seules écritures d'une facture émise ; '' ailleurs. */
  idClient: string
}

// ── Ce que le module lit ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D'où vient le poste d'une ligne, tel que la 2035 le lit. `categorie` : la catégorie de la ligne, LUE (celle de la pièce,
 * du mouvement affecté, de la part ventilée, de la recette de caisse, la « Frais bancaires » des frais d'un mouvement
 * d'encaissements) — nulle quand la lecture ne la rend pas ; seul son `poste_2035` compte, jamais son libellé. `moteur` :
 * un poste que le moteur de la 2035 donne lui-même, sans catégorie (les dotations, les cotisations, le forfait, les
 * intérêts et l'assurance d'un emprunt, les ventes facturées, les arrondis de la liquidation) — une constante importée,
 * que le compilateur ferme. `aucun` : une ligne de bilan, de banque, de TVA.
 */
export type PosteLu =
  | { de: 'categorie'; categorie: Pick<Categorie, 'libelle' | 'poste_2035'> | null }
  | { de: 'moteur'; poste: PosteDuMoteur }
  | { de: 'aucun' }

export type PosteDuMoteur =
  | typeof POSTE_AMORTISSEMENTS | typeof POSTE_COTISATIONS | typeof POSTE_CSG_DEDUCTIBLE | typeof POSTE_INDEMNITES_KM
  | typeof POSTE_VENTES_FACTUREES | typeof POSTE_ARRONDIS_TVA_PRODUIT | typeof POSTE_ARRONDIS_TVA_CHARGE
  | typeof POSTE_INTERETS_EMPRUNT | typeof POSTE_ASSURANCE_EMPRUNT

/** Une ligne de l'écriture : son identifiant, son compte (qui dit si elle est de charge ou de produit) et son poste lu. */
export type LigneACaracteriser = Pick<EcritureBrouillon, 'id' | 'compte' | 'libelle'> & { poste: PosteLu }

/** Une facture émise telle qu'on la lit, son nom compris — que ce module ne lit jamais. */
export type FactureDuClient = Pick<FactureEmise, 'id' | 'numero' | 'statut' | 'tiers_siret' | 'tiers_nom' | 'source_de_la_vente'>

/** Un encaissement du registre (contre-passations comprises), tel qu'on le lit, son motif compris — jamais lu ici. */
export type EncaissementDuRegistre = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'moyen' | 'ligne_bancaire_id' | 'annule_id' | 'retire_le'
  | 'motif'>

/** Une pièce telle qu'on la lit, son tiers et son nom de fichier compris — jamais lus ici. */
export type PieceDuFec = Pick<Piece,
  'id' | 'type_piece' | 'facture_id' | 'date_piece' | 'montant_ttc' | 'created_at' | 'tiers' | 'nom_fichier'>

/** Un mouvement du relevé tel qu'on le lit, ses libellés et son fichier compris — jamais lus ici. */
export type MouvementDuFec = Pick<LigneBancaire,
  'id' | 'date' | 'montant' | 'libelle' | 'libelle_brut' | 'source_fichier' | 'statut' | 'categorie_id' | 'emprunt_id'
  | 'emprunt_echeance' | 'cotisation_id' | 'ventilee' | 'compte_bilan' | 'declaration_tva_id' | 'prelevement_personnel'>

// ── Les briques ────────────────────────────────────────────────────────────────────────────────────────────────────────

function sansReglement(dateDeLEcriture: string, choix: ChoixChampsBnc): Pick<ChampsBnc, 'dateRglt' | 'modeRglt'> {
  switch (choix.sansReglement) {
    case 'vides': return { dateRglt: '', modeRglt: '' }
    case 'date_de_l_ecriture': return { dateRglt: dateDeLEcriture, modeRglt: 'Sans règlement' }
    default: {
      const inconnu: never = choix.sansReglement
      throw new Error(`Choix inconnu pour une écriture sans règlement : ${String(inconnu)}`)
    }
  }
}

function posteDeLaSource(p: PosteLu): string | null {
  switch (p.de) {
    case 'categorie': return p.categorie === null ? null : p.categorie.poste_2035
    case 'moteur': return p.poste
    case 'aucun': return null
  }
}

/**
 * NatOp d'une ligne : la nature de l'écriture, et — sur une ligne de charge ou de produit (classe 6 ou 7, la nature
 * qu'en donne le compte : `natureDuCompte`) — le poste que la 2035 lui connaît, sous l'orthographe du rattachement des
 * cases (`posteRattache`, lib/cases2035.ts). Un poste inconnu, ou d'une case de l'autre cadre — ceux que la 2035 dit
 * « sans case » —, laisse la nature seule : on n'écrit pas un poste que le formulaire ne range pas.
 */
export function natOpDeLaLigne(nature: NatureOperation, ligne: Pick<LigneACaracteriser, 'compte' | 'poste'>): string {
  const sens = natureDuCompte(ligne.compte)
  if (sens === null) return nature
  const poste = posteDeLaSource(ligne.poste)
  const range = poste === null ? null : posteRattache(poste, sens)
  return range === null ? nature : `${nature}${SEPARATEUR_DU_POSTE}${range}`
}

function natOps(nature: NatureOperation, lignes: readonly LigneACaracteriser[]): ReadonlyMap<string, string> {
  return new Map(lignes.map((l) => [l.id, natOpDeLaLigne(nature, l)]))
}

/**
 * IdClient d'une écriture d'une facture émise (FEC22-Q4, (D)) : le SIREN de son client quand la facture FIGÉE en porte un
 * — les neuf premiers chiffres de `tiers_siret`, s'il n'est fait que de chiffres (quatorze, un SIRET ; neuf, un SIREN
 * saisi seul) et passe la clé de Luhn de l'INSEE, celle du SIREN comprise (`siretValide`, `sirenValide`,
 * lib/factureCii.ts : La Poste et ses établissements compris) —, sinon le numéro de la facture, la « référence à un
 * document annexe » de BOI-BNC-DECLA-10-20, § 280. JAMAIS le nom (`tiers_nom`). Une facture qui n'est pas figée (sans
 * numéro, un brouillon) n'identifie personne : ''. Une entreprise ou un organisme qu'un SIREN désigne n'est couvert par
 * aucun secret médical ; un SIRET mal formé ne se corrige pas (ni espace retiré ni chiffre deviné) : le numéro le remplace.
 */
export function identificationDuClient(facture: FactureDuClient): string {
  if (facture.statut !== 'validee' || facture.numero === null || facture.numero === '') return ''
  const s = facture.tiers_siret
  if (s !== null && /^\d{14}$/.test(s) && siretValide(s) && sirenValide(s.slice(0, 9))) return s.slice(0, 9)
  if (s !== null && /^\d{9}$/.test(s) && sirenValide(s)) return s
  return facture.numero
}

// ── Les sortes d'écriture que `numeroterFec` distingue (lib/fec.ts) ────────────────────────────────────────────────────

/**
 * Chaque préfixe de clé que `numeroterFec` donne à une écriture — et les clés que la composition des ventes facturées
 * donne aux siennes (`cleFec…`, lib/ecrituresVentesFacturees.ts), et les à-nouveaux —, avec la fonction qui en dit les
 * quatre champs. champsBncDuFec.test.ts relit les deux fichiers : une sorte neuve sans règle ici est une faute.
 */
export const REGLES_DES_SORTES = {
  piece: 'champsDUnePiece',
  caisse: 'champsDUneOperationDeCaisse',
  releve: 'champsDUnMouvementDuReleve',
  dotation: 'champsDUneDotation',
  forfait: 'champsDUnForfait',
  liquidation: 'champsDUneLiquidation',
  'paiement-personnel': 'champsDUnPaiementPersonnel',
  facture: 'champsDeLaTvaDUneFacture',
  encaissement: 'champsDUnEncaissement',
  'mouvement-encaissements': 'champsDUnMouvementDesEncaissements',
  'a-nouveaux': 'champsDesANouveaux',
} as const

// ── Une pièce ──

/**
 * Ce qui règle une écriture d'une pièce, à sa date. `releve` : un mouvement rapproché de la pièce, ou la part d'un
 * règlement groupé (`paiementsDesPieces`, origines `rapprochement` et `groupe`). `virement_mixte` : l'encaissement d'une
 * facture d'avant la bascule cité sur un mouvement classé par ses encaissements (origine `encaissements`, étape VF5h) —
 * l'encaissement du registre qui paie CETTE pièce, nul quand la lecture ne le rend pas. `note_de_frais` : la part que
 * l'exploitant a payée de sa poche, à la date que la 2035 compte. `caisse` : le paiement d'une pièce par la caisse (le
 * genre `paiement`, étape C9, à venir). `aucun` : une part que rien ne règle (`sans_paiement`).
 */
export type ReglementDUnePiece =
  | { par: 'releve'; date: string }
  | { par: 'virement_mixte'; date: string; encaissement: EncaissementDuRegistre | null }
  | { par: 'note_de_frais'; date: string }
  | { par: 'caisse'; date: string }
  | { par: 'aucun' }

const ORDRE_DES_REGLEMENTS: Readonly<Record<ReglementDUnePiece['par'], number>> = {
  releve: 0, virement_mixte: 1, caisse: 2, note_de_frais: 3, aucun: 4,
}

/**
 * Les règlements d'une pièce à une date d'écriture, lus de ses paiements (`paiementsDesPieces`, lib/rattachement.ts) et
 * de ses parts que rien ne paie (`rattachementsTresorerie`, la part sans date reportée au jour du dépôt comme
 * `centimesParDate` la date), un par MODE. Deux règlements à la même date — la banque et la poche de l'exploitant, la
 * banque et un virement mixte d'un autre moyen — font deux écritures : la scission est au fichier (FEC22c), qui en
 * répartit les centimes. Le mode d'un mouvement rapproché est « Banque », même quand un encaissement du registre cite
 * aussi ce mouvement : seul l'encaissement qui paie CETTE pièce dit un moyen. Sans paiement de la caisse avant C9.
 */
export function reglementsDeLaPieceALaDate(
  piece: PieceDuFec,
  // Ceux de CETTE pièce, tirés de `paiementsDesPieces`.
  paiements: readonly PaiementDePiece[],
  date: string,
  // Le registre des encaissements du dossier, lu en entier : l'encaissement d'un virement mixte s'y retrouve.
  registre: readonly EncaissementDuRegistre[],
): ReglementDUnePiece[] {
  const trouves: ReglementDUnePiece[] = []
  const cles = new Set<string>()
  const ajouter = (r: ReglementDUnePiece, cle: string) => {
    if (cles.has(cle)) return
    cles.add(cle)
    trouves.push(r)
  }
  for (const p of paiements) {
    if (p.date !== date) continue
    if (p.origine === 'rapprochement' || p.origine === 'groupe') {
      ajouter({ par: 'releve', date }, 'releve')
      continue
    }
    // L'encaissement de la facture dont la pièce est l'exemplaire, cité sur ce mouvement, vivant et non une contre-passation.
    const encaissement = piece.facture_id === null ? null : registre.find((e) => e.ligne_bancaire_id === p.id
      && e.facture_id === piece.facture_id && e.annule_id === null && e.retire_le === null) ?? null
    ajouter({ par: 'virement_mixte', date, encaissement }, `mixte|${encaissement === null ? '' : MODE_DU_MOYEN[encaissement.moyen]}`)
  }
  for (const r of rattachementsTresorerie(piece, paiements)) {
    if (r.source === 'paiement' || r.source === 'facture') continue
    if ((r.date ?? dateLocaleDe(piece.created_at)) !== date) continue
    if (r.source === 'note_de_frais') ajouter({ par: 'note_de_frais', date }, 'note_de_frais')
    else ajouter({ par: 'aucun' }, 'aucun')
  }
  return trouves.sort((a, b) => ORDRE_DES_REGLEMENTS[a.par] - ORDRE_DES_REGLEMENTS[b.par])
}

export interface EntreesDUnePiece {
  piece: PieceDuFec
  reglement: ReglementDUnePiece
  // La date de l'écriture (EcritureDate) : seule l'option `date_de_l_ecriture` de FEC22-Q1 la recopie, pour une part sans
  // règlement. Un règlement porte la sienne — l'opération découverte après coup (B9) s'écrit au 1er janvier N+1 et se
  // règle en N.
  dateDeLEcriture: string
  cible: Pick<CibleComptable, 'immobilisation'>
  // La facture que la pièce désigne (`pieces.facture_id`), lue ; nulle quand elle n'en désigne aucune.
  exemplaireDe: FactureDuClient | null
  lignes: readonly LigneACaracteriser[]
  choix: ChoixChampsBnc
}

/**
 * Une écriture d'une pièce (clé `pièce|date`). DateRglt et ModeRglt de son règlement ; NatOp « Recette » pour une pièce
 * de vente, « Dépense » sinon, « Acquisition d'immobilisation » quand sa cible est un bien. IdClient : celui de la
 * facture que la pièce désigne, quand c'est une pièce de VENTE désignée exemplaire d'une facture qui n'est PAS source de
 * sa vente (l'exemplaire d'une facture source ne compte plus, VF3b) — '' sur toute autre pièce : le tiers lu par l'OCR
 * n'est pas « l'identité déclarée par le client » (CGI, art. 99).
 */
export function champsDUnePiece(e: EntreesDUnePiece): ChampsBnc {
  const r = e.reglement
  const reglement: Pick<ChampsBnc, 'dateRglt' | 'modeRglt'> =
    r.par === 'releve' ? { dateRglt: r.date, modeRglt: 'Banque' }
    : r.par === 'virement_mixte' ? { dateRglt: r.date, modeRglt: r.encaissement === null ? '' : MODE_DU_MOYEN[r.encaissement.moyen] }
    : r.par === 'note_de_frais' ? { dateRglt: r.date, modeRglt: 'Compte personnel' }
    : r.par === 'caisse' ? { dateRglt: r.date, modeRglt: 'Espèces' }
    : sansReglement(e.dateDeLEcriture, e.choix)
  const nature: NatureOperation = e.cible.immobilisation ? "Acquisition d'immobilisation"
    : e.piece.type_piece === 'vente' ? 'Recette' : 'Dépense'
  const f = e.exemplaireDe
  const designee = e.piece.type_piece === 'vente' && f !== null && e.piece.facture_id === f.id && !f.source_de_la_vente
  return { ...reglement, nature, natOp: natOps(nature, e.lignes), idClient: designee ? identificationDuClient(f) : '' }
}

// ── Un mouvement justifié par le relevé ──

/**
 * Les liens qui font d'un mouvement une écriture du relevé (`mouvementJustifieParLeReleve`, lib/affectationBanque.ts),
 * chacun avec sa règle ci-dessous. champsBncDuFec.test.ts relit la fonction : un lien neuf sans règle est une faute.
 */
export const LIENS_DU_RELEVE = [
  'categorie_id', 'emprunt_id', 'cotisation_id', 'ventilee', 'compte_bilan', 'declaration_tva_id', 'prelevement_personnel',
] as const

// La nature d'une écriture affectée ou ventilée : celle que la 2035 donne à ses parts, lue au compte de chaque ligne
// (`natureDuCompte` : classe 7 une recette, classe 6 une dépense) ; ventilée sur les deux, « Recette et dépense ». Sans
// ligne de résultat — une catégorie dont le compte n'en est plus un —, l'opération est de bilan.
function natureDesLignes(lignes: readonly LigneACaracteriser[]): NatureOperation {
  const natures = new Set<NatureCompte>(lignes.flatMap((l) => {
    const n = natureDuCompte(l.compte)
    return n === null ? [] : [n]
  }))
  if (natures.has('recette') && natures.has('depense')) return 'Recette et dépense'
  if (natures.has('recette')) return 'Recette'
  if (natures.has('depense')) return 'Dépense'
  return 'Opération de bilan'
}

/**
 * Une écriture d'un mouvement justifié par le relevé (clé `releve|mouvement`) : DateRglt la date du mouvement, ModeRglt
 * « Banque » (FEC22-Q2, (A) : le relevé ne dit pas l'instrument, et son libellé ne se lit pas), IdClient vide — un
 * crédit de l'Assurance maladie paie pour des patients que le relevé ne nomme pas (RGPD.md § 8.7). La nature selon le
 * lien : le signe pour un virement personnel ou une déclaration de TVA ; l'échéance (`emprunt_echeance`) pour un emprunt ;
 * le compte de la caisse du PLAN (jamais le libellé) pour un versement d'espèces. Nul pour un mouvement que le relevé ne
 * justifie pas : ce n'est pas une écriture de cette sorte.
 */
export function champsDUnMouvementDuReleve(
  mouvement: MouvementDuFec,
  lignes: readonly LigneACaracteriser[],
  plan: Pick<PlanComptable, 'caisse'>,
): ChampsBnc | null {
  if (!mouvementJustifieParLeReleve(mouvement)) return null
  const m = mouvement
  const nature: NatureOperation =
    m.prelevement_personnel ? (m.montant < 0 ? "Prélèvement de l'exploitant" : "Apport de l'exploitant")
    : m.emprunt_id ? (m.emprunt_echeance === null ? "Déblocage d'emprunt" : "Échéance d'emprunt")
    : m.cotisation_id ? 'Cotisation sociale'
    : m.declaration_tva_id ? (m.montant < 0 ? 'Paiement de TVA' : 'Remboursement de TVA')
    : m.compte_bilan ? (m.compte_bilan === plan.caisse ? "Versement d'espèces" : 'Opération de bilan')
    : natureDesLignes(lignes)
  return { dateRglt: m.date, modeRglt: 'Banque', nature, natOp: natOps(nature, lignes), idClient: '' }
}

// ── Une opération de caisse ──

const NATURE_DU_GENRE: Readonly<Record<OperationCaisse['genre'], NatureOperation | null>> = {
  recette: 'Recette',
  apport: "Apport de l'exploitant",
  prelevement: "Prélèvement de l'exploitant",
  // Le paiement d'une pièce par la caisse n'est pas une écriture à lui : ses lignes vont à l'écriture de la pièce (C9).
  paiement: null,
}

/**
 * Une écriture d'une opération de caisse (clé `caisse|opération|date`) : DateRglt sa date, ModeRglt « Espèces », la
 * nature de son genre — une recette, et des espèces rendues, « Recette » —, IdClient vide : un total de jour ne nomme
 * personne (BOI-BNC-DECLA-10-20, § 70). Nul pour le paiement d'une pièce, qui n'est pas de cette sorte.
 */
export function champsDUneOperationDeCaisse(
  operation: Pick<OperationCaisse, 'id' | 'genre' | 'date' | 'montant'>,
  lignes: readonly LigneACaracteriser[],
): ChampsBnc | null {
  const nature = NATURE_DU_GENRE[operation.genre]
  if (nature === null) return null
  return { dateRglt: operation.date, modeRglt: 'Espèces', nature, natOp: natOps(nature, lignes), idClient: '' }
}

// ── Les opérations diverses qui ne sont pas un règlement ──

function sansReglementDe(
  nature: NatureOperation, dateDeLEcriture: string, lignes: readonly LigneACaracteriser[], choix: ChoixChampsBnc,
): ChampsBnc {
  return { ...sansReglement(dateDeLEcriture, choix), nature, natOp: natOps(nature, lignes), idClient: '' }
}

/** Une dotation aux amortissements (clé `dotation|bien|date`, au 31 décembre) : rien n'est payé ce jour-là (FEC22-Q1). */
export function champsDUneDotation(dateDeLEcriture: string, lignes: readonly LigneACaracteriser[], choix: ChoixChampsBnc): ChampsBnc {
  return sansReglementDe('Dotation aux amortissements', dateDeLEcriture, lignes, choix)
}

/** Un forfait kilométrique (clé `forfait|véhicule|date`) : le barème tient lieu de frais réels, rien n'est payé ce jour-là. */
export function champsDUnForfait(dateDeLEcriture: string, lignes: readonly LigneACaracteriser[], choix: ChoixChampsBnc): ChampsBnc {
  return sansReglementDe('Frais de véhicule (barème)', dateDeLEcriture, lignes, choix)
}

/** La liquidation d'une déclaration de TVA (clé `liquidation|déclaration|date`) : la CA3 arrêtée, son paiement est au relevé. */
export function champsDUneLiquidation(dateDeLEcriture: string, lignes: readonly LigneACaracteriser[], choix: ChoixChampsBnc): ChampsBnc {
  return sansReglementDe('Liquidation de TVA', dateDeLEcriture, lignes, choix)
}

/**
 * Les à-nouveaux (journal AN, une écriture) : des soldes repris, aucun règlement. NatOp « À-nouveaux » sur chaque ligne,
 * jamais un poste — l'ouverture ne porte que des comptes de bilan, et un poste n'y dirait rien de vrai.
 */
export function champsDesANouveaux(
  aNouveaux: readonly Pick<ANouveau, 'id' | 'compte' | 'libelle'>[], dateDeLEcriture: string, choix: ChoixChampsBnc,
): ChampsBnc {
  const nature: NatureOperation = 'À-nouveaux'
  return { ...sansReglement(dateDeLEcriture, choix), nature, natOp: new Map(aNouveaux.map((a) => [a.id, nature])), idClient: '' }
}

/**
 * Le paiement d'une échéance de cotisation DEPUIS LE COMPTE PERSONNEL (clé `paiement-personnel|échéance|date`) : DateRglt
 * la date du paiement saisie (`paiement_personnel_le`), '' si la lecture ne la rend pas ; ModeRglt « Compte personnel ».
 */
export function champsDUnPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'id' | 'paiement_personnel_le'>,
  lignes: readonly LigneACaracteriser[],
): ChampsBnc {
  const nature: NatureOperation = 'Cotisation sociale'
  return {
    dateRglt: cotisation.paiement_personnel_le ?? '', modeRglt: 'Compte personnel', nature, natOp: natOps(nature, lignes), idClient: '',
  }
}

// ── Les écritures d'une vente facturée (lib/ecrituresVentesFacturees.ts) ──

/**
 * La facture ou l'avoir (clé `facture|document|date`) : en trésorerie, la seule TVA due avant l'encaissement, le 411 face
 * au 44571 — aucun règlement (FEC22-Q1). IdClient : celui du DOCUMENT, la facture ou l'avoir qui porte cette TVA — son
 * numéro est la PieceRef de l'écriture, et son client figé est celui de sa facture.
 */
export function champsDeLaTvaDUneFacture(
  document: FactureDuClient, dateDeLEcriture: string, lignes: readonly LigneACaracteriser[], choix: ChoixChampsBnc,
): ChampsBnc {
  const nature: NatureOperation = 'TVA due sur facture'
  return { ...sansReglement(dateDeLEcriture, choix), nature, natOp: natOps(nature, lignes), idClient: identificationDuClient(document) }
}

/**
 * Un encaissement ou une contre-passation du registre (clé `encaissement|encaissement|date`) : DateRglt sa
 * `date_encaissement` (« la remise d'un chèque, pas son crédit » ; la contre-passation, le décaissement), ModeRglt son
 * moyen au registre, NatOp « Recette » ou « Annulation de recette », IdClient celui de la facture qu'il règle — '' quand
 * la facture lue n'est pas la sienne.
 */
export function champsDUnEncaissement(
  encaissement: EncaissementDuRegistre, facture: FactureDuClient, lignes: readonly LigneACaracteriser[],
): ChampsBnc {
  const nature: NatureOperation = encaissement.annule_id === null ? 'Recette' : 'Annulation de recette'
  return {
    dateRglt: encaissement.date_encaissement, modeRglt: MODE_DU_MOYEN[encaissement.moyen], nature, natOp: natOps(nature, lignes),
    idClient: facture.id === encaissement.facture_id ? identificationDuClient(facture) : '',
  }
}

/**
 * Le mouvement que ses encaissements classent (clé `mouvement-encaissements|mouvement`) : DateRglt la date du mouvement ;
 * ModeRglt le moyen des encaissements qui le justifient quand ils n'en ont qu'un (une remise de chèques : « Chèque »),
 * sinon « Banque » ; IdClient vide — un bordereau porte plusieurs clients (BOI-BNC-DECLA-10-20, § 80). Justifient le
 * mouvement, comme la composition les lit : ceux qui le citent, vivants, qu'aucune contre-passation vivante SANS
 * mouvement n'annule (`justifieSonMouvement`) — une contre-passation qui cite un débit compris. NatOp « Remise en
 * banque » pour un crédit ; pour un débit — l'impayé, la somme rendue, que ses contre-passations classent —, « Annulation
 * de recette ».
 */
export function champsDUnMouvementDesEncaissements(
  mouvement: Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'libelle' | 'libelle_brut' | 'source_fichier'>,
  registre: readonly EncaissementDuRegistre[],
  lignes: readonly LigneACaracteriser[],
): ChampsBnc {
  const justifient = registre.filter((e) => e.ligne_bancaire_id === mouvement.id && e.retire_le === null
    && justifieSonMouvement(e, registre))
  const modes = new Set(justifient.map((e) => MODE_DU_MOYEN[e.moyen]))
  const nature: NatureOperation = mouvement.montant < 0 ? 'Annulation de recette' : 'Remise en banque'
  return {
    dateRglt: mouvement.date, modeRglt: modes.size === 1 ? [...modes][0] : 'Banque', nature, natOp: natOps(nature, lignes),
    idClient: '',
  }
}
