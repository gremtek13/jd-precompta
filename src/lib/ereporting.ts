import { centimesExacts, euroCommeLaBase, remplirModele, tauxCommeLaBase } from './encaissementsFactures'
import { cadreDeFacturation, montantsDuDocument, numeroTvaFrancais, sirenDe, sirenValide } from './factureCii'
import { ajouterJours, formatDate } from './format'
import type { LectureComplete } from './lectureComplete'
import {
  DEBUT_EREPORTING_PME, dansLObligation, libelleFrequence, obligationsEreporting, periodeDe, transmissionAttendue,
  type EtatObligation, type FrequenceProposee, type ObjetEreporting, type PeriodeEreporting,
} from './periodesEreporting'
import { ficheCourante, refusFicheHorsDeFrance, TYPES_DE_PIECE_DECRITS } from './piecesHorsDeFrance'
import { saisieDeLaFiche, signauxHorsDeFrance, ventilationDe } from './propositionsHorsDeFrance'
import type {
  CodeTvaHorsDeFrance, Dossier, EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureLigne,
  NatureAchatHorsDeFrance, Piece, PieceHorsDeFrance, PieceHorsDeFranceTaux, SchemaIdentifiantFournisseur, StatutTva,
} from './types'

// LE CONTENU DES DÉCLARATIONS D'E-REPORTING D'UNE PÉRIODE, POUR UN DOSSIER (ligne 28.5, étape e, quatrième temps e4 ;
// conception du 09/10/2026, HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION », § 2.3, § 4.2, § 4.3, § 4.5, § 4.6, § 6.1).
//
// Une période d'un dossier porte jusqu'à TROIS déclarations, qui ne se mêlent pas : un fichier ne porte qu'un rôle de
// déclarant, et des transactions OU des paiements (spécifications externes de la DGFiP v3.2, dossier général, § 3.7.7 et
// sa note 127 ; annexe 7 « Règles de gestion » v1.9, G6.29 et G7.52 ; annexe 6 v1.10, onglet « Flux 10 », TT-15).
//   - SES ACHATS à un fournisseur établi hors de France (`declarationDesAchats`) : le dossier déclare en ACHETEUR (BY),
//     une facture par fiche, sans les lignes de la facture (bloc 10.1 ; CGI, art. 290, I-3° ; BOI-TVA-DECLA-20-30-50-10,
//     § 60 ; BOI-TVA-DECLA-20-30-50-20, § 70 et sa remarque). Les fiches sont celles d'e2, telles que la base les garde :
//     la version COURANTE de chaque pièce, une fiche retirée n'y entrant pas.
//   - SES VENTES facturées à un particulier (`declarationDesVentes`) : en VENDEUR (SE), agrégées par jour, catégorie et
//     taux (bloc 10.3 ; dossier général, § 3.7.5 ; BOI-TVA-DECLA-20-30-50-20, § 50 et § 60) — les factures émises.
//   - SES PAIEMENTS de ces ventes, quand la TVA en est due à l'encaissement (`declarationDesPaiements`) : en VENDEUR,
//     agrégés par jour et par taux (bloc 10.4 ; dossier général, § 3.7.6 et sa note 119 ; BOI-TVA-DECLA-20-30-60, § 1,
//     § 20, § 30 et § 150) — le registre des encaissements de d1, NET des retraits et des contre-passations.
// Ce que les fichiers porteront en tête (l'émetteur, l'identifiant de la transmission, son horodatage) est l'affaire
// d'e6 ; ce qui a été déclaré, et sa rectification, celle d'e5.
//
// CHAQUE DÉCLARATION A UN ÉTAT (`EtatDeclarationEreporting`) — rien à déclarer, à déclarer, incomplète faute d'une donnée,
// hors du champ du dossier — et ses REFUS (`REFUS_EREPORTING`), chacun par sa raison, dans un ORDRE FIXÉ : le premier est
// ce que la déclaration hors application (e5) et le fichier (e6) diront avant le clic. « Rien à déclarer » ne se dit que
// d'une période dont toutes les sources sont lues EN ENTIER et où aucune pièce candidate n'attend sa fiche : le vide est
// une affirmation (conception, § 4.2) ; et rien ne se déclare à blanc (BOI-TVA-DECLA-20-30-50-30, § 80 ; e1).
//
// LA PÉRIODE ET SON ÉCHÉANCE VIENNENT D'E1 (lib/periodesEreporting.ts), jamais recalculées ici : la fréquence de chaque
// objet par `obligationsEreporting`, les bornes et l'échéance par `periodeDe`. LE STATUT DE TVA DU DOSSIER DÉCIDE DE CE
// QUI ENTRE (lib/statutTva.ts) : les opérations exonérées par les art. 261 à 261 E du CGI sortent de l'e-reporting
// (art. 290, I ; BOI-TVA-DECLA-20-30-50-10, § 20), un dossier exonéré déclare donc ses achats à l'étranger et pas ses
// soins ; un franchisé déclare ses ventes sans TVA. Au 01/01/2027, le CIBS reprend ces règles (art. L. 216-55 et
// L. 216-56) ; l'art. 290 reste en vigueur jusqu'aux mesures réglementaires qui le reprendront. AUCUN ARTICLE N'EST CITÉ
// DANS LES MESSAGES : ils disent la règle, et ne vieillissent pas avec la numérotation.
//
// UN MODULE PUR : il ne lit ni la base ni l'horloge. L'appelant lui passe ce qu'il a lu par `lireTout` — avec son drapeau
// `complete`, sans lequel rien ne se déclare (une lecture partielle ne commande aucune écriture, et ne dit pas le vide) —,
// le dossier, les bornes de la période et le jour à Paris. Toutes les entrées sont OBLIGATOIRES : une valeur par défaut
// serait une réponse qu'on n'a pas lue. Les montants sont en centimes entiers ; les dates, civiles (AAAA-MM-JJ).
//
// CE QUE LA BASE NE GARDE PAS, ET QUE LE CONTENU DEMANDE (points d'arrêt, pour e5 ou pour le cabinet) :
//   - le régime d'e-reporting CONFIRMÉ par le cabinet (Q4) : `regimeConfirme`, sans lequel la déclaration se refuse ;
//   - l'HISTOIRE du statut de TVA : la base ne garde que celui d'aujourd'hui. Une période d'un autre régime se refuse
//     (`periode_hors_regime`), et une facture que le régime passé contredit aussi (`taux_positif`, `zero_sans_article`) —
//     jamais une période calculée sous un régime qu'elle n'avait pas ;
//   - la pièce candidate que le cabinet a VÉRIFIÉE et écartée (elle ressemble à un achat à l'étranger et n'en est pas
//     un, ou il a tranché de ne pas la déclarer) : `piecesEcartees`. Sans ce moyen, une candidate ne se résout que par
//     une fiche — et une pièce qui porte une TVA n'en reçoit pas (hypothèse Q7 d'e2).

// ── Les hypothèses, nommées ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * LA DATE QUI RANGE UNE OPÉRATION DANS UNE PÉRIODE (point 6 de la conception, NON VÉRIFIÉ). Le dossier général v3.2
 * (§ 3.7.7, note 125) : « Le fait générateur de la transmission des données de transaction est la date de réalisation
 * de l'opération » ; l'annexe 6 (TT-77) : la date « à laquelle les transactions ont été comptabilisées » ; la fiche
 * « Données de transaction » d'impots.gouv.fr (août 2026) : la date « de la livraison de biens ou de la fin d'exécution de
 * la prestation de services », quand elle diffère de celle de la facture.
 *   - `date_de_realisation` : la date de la livraison ou de la prestation quand la facture la dit, la fin de la période
 *     qu'elle couvre sinon, sa date d'émission à défaut — la recommandation de la conception ;
 *   - `date_de_la_facture` : la date d'émission, toujours.
 * Un AVOIR se range à sa propre date dans les deux cas : il reprend en base la date de prestation de la facture qu'il
 * corrige, et le ranger avec elle rouvrirait une période peut-être déclarée.
 */
export type Rangement = 'date_de_realisation' | 'date_de_la_facture'

/**
 * OÙ SE RANGE UNE CONTRE-PASSATION (d4) d'un encaissement (point 9 de la conception, NON VÉRIFIÉ) : dans la période de SA
 * date, celle du décaissement, en montant négatif — la recommandation (§ 4.6) ; ou dans celle de l'encaissement qu'elle
 * annule, qui se rectifie alors (§ 2.4).
 */
export type RangementContrePassation = 'date_du_decaissement' | 'date_de_l_encaissement_annule'

/** Ce que la conception recommande aux questions encore ouvertes : l'appelant le passe EXPLICITEMENT, par son nom, et une
 * réponse du cabinet ne change que ceci. */
export const HYPOTHESES_DE_LA_CONCEPTION: { readonly rangement: Rangement; readonly contrePassation: RangementContrePassation } = {
  rangement: 'date_de_realisation',
  contrePassation: 'date_du_decaissement',
}

// ── Ce que l'appelant lit ───────────────────────────────────────────────────────────────────────────────────────────

/** Le dossier, tel que la déclaration le lit : son identité (le SIREN du déclarant, G6.26) et son régime de TVA
 * d'AUJOURD'HUI — la base n'en garde pas d'autre. */
export type DossierEreporting = Pick<Dossier,
  'id' | 'siret' | 'statut_tva' | 'article_exoneration' | 'numero_tva_attribue' | 'tva_periodicite' | 'tva_sur_debits'>

/** Une lecture par `lireTout` : ses lignes, et si elle est revenue entière. */
export type Lecture<T> = Pick<LectureComplete<T>, 'lignes' | 'complete' | 'motif'>

export type PieceLue = Pick<Piece,
  'id' | 'dossier_id' | 'type_piece' | 'devise' | 'montant_ttc' | 'montant_devise' | 'montant_tva' | 'tiers' | 'date_piece'>

/** Un texte lu sur un document (`piece_textes_ocr`) : celui d'une pièce, ou d'un document (piece_id nul). */
export interface TexteDePiece {
  piece_id: string | null
  texte: string
}

export type FactureLue = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'date_emission' | 'montant_ht' | 'montant_tva' | 'montant_ttc' | 'type_client'
  | 'nature_operation' | 'option_debits' | 'date_prestation' | 'periode_fin'>

export type LigneLue = Pick<FactureLigne, 'facture_id' | 'ordre' | 'designation' | 'quantite' | 'prix_unitaire_ht' | 'taux_tva'>

export type EncaissementLu = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'annule_id' | 'retire_le'>

export type PartLue = Pick<EncaissementFactureTaux, 'encaissement_id' | 'dossier_id' | 'taux' | 'montant'>

/** Ce que les trois déclarations partagent. */
export interface ContexteDeclaration {
  /** Les bornes de la période demandée, AAAA-MM-JJ : celles d'une période d'e1 (`calendrierEreporting`). */
  periode: { debut: string; fin: string }
  dossier: DossierEreporting
  /** Le rythme d'e-reporting que l'application propose, confirmé par le cabinet tel que le dossier l'a déclaré à sa
   * plateforme (Q4 ; impots.gouv.fr, 22/09/2026) — la base ne garde pas encore cette confirmation. */
  regimeConfirme: boolean
  /** Aujourd'hui À PARIS (`aujourdHuiAParis`) : une période ne se déclare qu'une fois finie (G7.43). */
  aujourdHui: string
}

export interface SourcesDesAchats {
  /** Les pièces du DOSSIER. */
  pieces: Lecture<PieceLue>
  /** Toutes les versions des fiches du dossier, retirées comprises. */
  fiches: Lecture<PieceHorsDeFrance>
  taux: Lecture<PieceHorsDeFranceTaux>
  /** Les textes lus sur les documents du dossier : au moins ceux des pièces d'achat sans fiche que la période peut
   * concerner (datées de la période, ou sans date). Un texte absent est un texte que la pièce n'a pas. */
  textes: Lecture<TexteDePiece>
}

export interface ChoixDesAchats {
  rangement: Rangement
  /** Les pièces que le cabinet a vérifiées et écartées — la base ne garde pas encore ce geste : un ensemble vide. */
  piecesEcartees: ReadonlySet<string>
}

export interface SourcesDesVentes {
  factures: Lecture<FactureLue>
  lignes: Lecture<LigneLue>
}

export interface SourcesDesPaiements {
  factures: Lecture<FactureLue>
  /** Le registre ENTIER du dossier : retirés et contre-passations compris — c'est ici qu'ils comptent, ou non. */
  encaissements: Lecture<EncaissementLu>
  parts: Lecture<PartLue>
}

// ── Ce que le module rend ───────────────────────────────────────────────────────────────────────────────────────────

/** Rien à déclarer ; à déclarer ; incomplète faute d'une donnée ; hors du champ du dossier pour cette période. */
export type EtatDeclarationEreporting = 'rien_a_declarer' | 'a_declarer' | 'incomplete' | 'hors_du_champ'

/** Ce qu'un refus ou une opération écartée vise. `lecture` : une source lue en partie (son nom). */
export interface SourceEreporting {
  genre: 'piece' | 'fiche' | 'facture' | 'encaissement' | 'lecture'
  id: string
}

export interface RefusEreporting {
  cle: CleRefusEreporting
  message: string
  /** Ce qu'il vise ; vide pour un refus de la période ou du dossier. */
  sources: readonly SourceEreporting[]
}

export type RaisonEcartee =
  | 'avant_l_obligation' | 'operation_exoneree' | 'part_exoneree' | 'livraison_de_biens' | 'option_debits'
  | 'ecartee_par_le_cabinet'

/** Ce qui a été vu dans la période et n'entre pas dans la déclaration, ou pas en entier — l'écran le dit. */
export interface OperationEcartee {
  source: SourceEreporting
  raison: RaisonEcartee
}

export const RAISONS_ECARTEES: Readonly<Record<RaisonEcartee, string>> = {
  avant_l_obligation: 'Facture antérieure au 1er septembre 2027 : l’obligation d’une PME ou d’une micro-entreprise vise les factures émises à partir de ce jour.',
  operation_exoneree: 'Opération exonérée : elle sort de l’e-reporting.',
  part_exoneree: 'Sa part à 0 % est celle d’opérations exonérées : elle n’y entre pas, le reste si.',
  livraison_de_biens: 'Livraison de biens : la TVA en est due à la livraison, pas à l’encaissement ; son paiement ne se déclare pas.',
  option_debits: 'Option pour la TVA sur les débits : la TVA en est due à la facture ; son paiement ne se déclare pas.',
  ecartee_par_le_cabinet: 'Écartée par le cabinet après vérification.',
}

export interface DeclarationEreporting<C> {
  objet: ObjetEreporting
  /** Ce qu'e1 dit de l'obligation du dossier pour cet objet (due, le cas échéant…). */
  obligation: EtatObligation
  /** La fréquence qu'e1 propose, avec sa certitude ; nulle tant que le statut de TVA est à préciser. */
  frequence: FrequenceProposee | null
  /** La période d'e1 — bornes, échéance, prudence, libellé ; nulle quand le régime du dossier ne la donne pas. */
  periode: PeriodeEreporting | null
  etat: EtatDeclarationEreporting
  /** Dans l'ordre de `REFUS_EREPORTING` ; vide : la déclaration peut se faire. */
  refus: RefusEreporting[]
  /** Nul quand rien ne s'en peut dire : statut à préciser, période d'un autre régime, hors du champ, lecture partielle. */
  contenu: C | null
  ecartees: OperationEcartee[]
}

/** Une ligne de la ventilation d'un achat, dans la devise de sa facture (TG-23 : TT-56, TT-57, TT-54, TT-55, TT-59,
 * TT-58). */
export interface LigneAchatDeclaree {
  code: CodeTvaHorsDeFrance
  taux: number
  baseCentimes: number
  tvaCentimes: number
  motifCode: string | null
  motifTexte: string | null
}

/** Un achat déclaré (bloc 10.1, rôle acheteur) : ce que la fiche courante dit de la facture du fournisseur. */
export interface AchatDeclare {
  ficheId: string
  pieceId: string
  /** La date qui l'a rangé dans la période (`Rangement`). */
  date: string
  numero: string // TT-19
  dateFacture: string // TT-20
  typeDocument: '380' | '381' // TT-21
  /** La facture qu'un avoir corrige (TG-11). */
  origine: { numero: string; date: string } | null
  devise: string // TT-22
  pays: string // TT-35
  schema: SchemaIdentifiantFournisseur // TT-33-1
  identifiant: string // TT-33 (et TT-34 dans l'Union)
  nature: NatureAchatHorsDeFrance
  /** Le cadre de facturation (TT-28, G1.02) : B1, S1 ou M1 selon la nature. */
  cadre: string
  autoliquidation: boolean
  dateOperation: string | null // TT-41
  periodeDebut: string | null // TT-42
  periodeFin: string | null // TT-43
  lignes: LigneAchatDeclaree[]
  /** TT-51, dans la devise de la facture : la somme des bases. */
  htCentimes: number
  /** TT-52, en EUROS (G6.23) : nul tant qu'un achat facturé avec une TVA est mis de côté (Q7). */
  tvaEurosCentimes: number
}

export interface ContenuAchats {
  role: 'BY'
  /** L'acheteur (TG-14) : le SIREN du dossier (0002) et son numéro de TVA, « systématiquement complété » (G2.33) ; nuls
   * quand le dossier n'en a pas — la déclaration se refuse alors. */
  siren: string | null
  numeroTva: string | null
  achats: AchatDeclare[]
  nombreOperations: number
  /** Le hors-taxe net par devise — un avoir en moins —, pour la phrase qui confirme la déclaration. */
  totauxParDevise: { devise: string; htCentimes: number }[]
}

export type CategorieTransactions = 'TLB1' | 'TPS1'

/** Les ventes d'un jour à des particuliers, pour une catégorie (bloc 10.3 : TT-77, TT-78, TT-80, TT-81, TT-82, TT-83 ;
 * TG-32 : TT-86, TT-87, TT-88), en euros. */
export interface TransactionsDuJour {
  date: string
  devise: 'EUR'
  categorie: CategorieTransactions
  /** TT-80 : l'option pour la TVA sur les débits, que la facture a figée — jamais sur des biens (G1.43, G1.67). */
  optionDebits: boolean
  htCentimes: number
  tvaCentimes: number
  parTaux: { taux: number; baseCentimes: number; tvaCentimes: number }[]
  /** Les factures et avoirs qui le composent. */
  factures: string[]
}

export interface ContenuVentes {
  role: 'SE'
  siren: string | null
  transactions: TransactionsDuJour[]
  nombreOperations: number
  htCentimes: number
  tvaCentimes: number
}

/** Les encaissements d'un jour sur des ventes à des particuliers (bloc 10.4 : TT-96 ; TG-39 : TT-97, TT-99), en euros. */
export interface PaiementsDuJour {
  date: string
  montantCentimes: number
  parTaux: { taux: number; montantCentimes: number }[]
  encaissements: string[]
}

export interface ContenuPaiements {
  role: 'SE'
  siren: string | null
  paiements: PaiementsDuJour[]
  nombreOperations: number
  montantCentimes: number
}

// ── Les refus, dans leur ordre ──────────────────────────────────────────────────────────────────────────────────────
//
// L'ORDRE DIT CE QUI EMPÊCHE D'ABORD : le statut de TVA inconnu, puis ce que le dossier ne doit pas (des paiements sur
// option pour les débits : e1 ne leur donne aucune fréquence), puis la période elle-même — des bornes d'un autre régime,
// une fin avant l'obligation —, puis une lecture partielle ; dans ces cas rien d'autre ne se juge. Viennent ensuite ce
// qui empêche de la déclarer aujourd'hui (pas finie, régime à confirmer), l'identité du déclarant, et ce que chaque
// opération laisse sans réponse ; enfin l'absence d'opération. Dans une même opération, le premier refus de cet ordre est le sien ; un
// motif CERTAIN de l'écarter (une facture antérieure à l'obligation, une opération exonérée, une livraison de biens)
// l'emporte sur une donnée inconnue — l'ordre d'`obligationEncaissee` (d2). e5 et e6 diront ces refus avant le clic ; la
// fonction de base d'e5 se confrontera à ceux qu'elle jugera elle-même.
export const REFUS_EREPORTING = [
  {
    cle: 'statut_a_preciser',
    modele: 'Le statut de TVA du dossier est à préciser (onglet TVA) : le rythme de ses déclarations et ce qui y entre en dépendent.',
  },
  {
    cle: 'paiements_sur_debits',
    modele: 'Sur option pour les débits, la TVA de ses prestations est due à la facture : le dossier n’a pas de données de '
      + 'paiement à transmettre.',
  },
  {
    cle: 'periode_hors_regime',
    modele: 'Du % au % n’est pas une période de ses déclarations : sous son régime de TVA d’aujourd’hui, elles se font %. '
      + 'Une période se déclare sous le régime qu’elle avait, que l’application ne garde pas encore.',
  },
  {
    cle: 'avant_l_obligation',
    modele: 'La période finit le %, avant le 1er septembre 2027 : l’e-reporting d’une PME ou d’une micro-entreprise commence '
      + 'avec les factures de ce jour.',
  },
  {
    cle: 'lecture_incomplete',
    modele: 'La lecture % n’est pas revenue entière (%) : rien ne se déclare, ni ne se dit vide, sur une lecture partielle.',
  },
  { cle: 'periode_en_cours', modele: 'La période n’est pas finie : elle se déclare à partir du %, au plus tard le %.' },
  {
    cle: 'regime_a_confirmer',
    modele: 'Le rythme de ses déclarations — % — est proposé par l’application : le cabinet le confirme, tel que le dossier '
      + 'l’a déclaré à sa plateforme, avant toute déclaration.',
  },
  {
    cle: 'siren_invalide',
    modele: 'Le SIRET du dossier ne donne pas un SIREN valide (neuf chiffres et leur clé) : une déclaration se fait au SIREN '
      + 'du dossier.',
  },
  {
    cle: 'numero_tva_absent',
    modele: 'Le dossier n’a pas de numéro de TVA : un assujetti qui achète un service à un prestataire établi hors de France '
      + 'en demande un au service des impôts pour autoliquider la TVA ; cochez ensuite la case de l’onglet TVA.',
  },
  { cle: 'lectures_discordantes', modele: 'Ce qui a été lu ne concorde pas — % sans % : relisez.' },
  {
    cle: 'fiche_a_revoir',
    modele: 'Telle qu’enregistrée, la fiche « fournisseur établi hors de France » d’une pièce ne passerait plus les contrôles '
      + 'de la base : % Corrigez-la avant de déclarer.',
  },
  {
    cle: 'achat_a_verifier',
    modele: 'Une pièce d’achat sans fiche ressemble à un achat à un fournisseur établi hors de France. % Sa fiche est à '
      + 'saisir, ou la pièce à écarter.',
  },
  {
    cle: 'achat_avec_tva',
    modele: 'Une pièce d’achat qui ressemble à un achat à l’étranger porte une TVA de % € : un achat à un fournisseur établi '
      + 'hors de France facturé avec une TVA est mis de côté, à trancher par le cabinet.',
  },
  {
    cle: 'destinataire_inconnu',
    modele: 'Une facture ne dit pas à qui elle est adressée — une entreprise, un particulier, un client établi hors de France : '
      + 'l’e-reporting en dépend, et validée, elle ne se complète plus.',
  },
  {
    cle: 'facture_internationale',
    modele: 'Une facture à un client établi hors de France ne porte ni son pays, ni son numéro de TVA, ni le régime de '
      + 'l’opération, que l’e-reporting demande : l’application ne les saisit pas encore.',
  },
  {
    cle: 'nature_inconnue',
    modele: 'Une facture à un particulier ne dit pas si elle porte sur des biens ou des services : la catégorie de '
      + 'l’opération en dépend, et validée, elle ne se complète plus.',
  },
  {
    cle: 'facture_mixte',
    modele: 'Une facture à un particulier mêle biens et services : l’e-reporting les déclare à part, et ses lignes ne disent '
      + 'pas lesquelles sont des biens.',
  },
  {
    cle: 'option_inconnue',
    modele: 'Une facture de services ne dit pas si le dossier avait opté pour la TVA sur les débits : ce qui s’en déclare en '
      + 'dépend, et validée, elle ne se complète plus.',
  },
  {
    cle: 'montants_incoherents',
    modele: 'Les montants enregistrés d’une facture ne se retrouvent pas dans ses lignes : ce qu’elle déclare ne se dit pas.',
  },
  {
    cle: 'taux_positif',
    modele: 'Une facture d’un dossier % porte une ligne à % %% : un dossier qui ne facture pas de TVA la doit dès qu’il la '
      + 'mentionne. La facture se corrige par un avoir, ou le statut de TVA du dossier est à revoir.',
  },
  {
    cle: 'zero_sans_article',
    modele: 'Une ligne à 0 %% d’un dossier redevable demande l’article de son exonération (onglet TVA) : sans lui, on ne sait '
      + 'pas si elle se déclare.',
  },
  // Le message est celui d'e1 (`transmissionAttendue`) : « à confirmer » pour des paiements.
  { cle: 'rien_a_declarer', modele: '%' },
] as const

export type CleRefusEreporting = (typeof REFUS_EREPORTING)[number]['cle']

function refusDe(cle: CleRefusEreporting, valeurs: readonly string[], sources: readonly SourceEreporting[]): RefusEreporting {
  const { modele } = REFUS_EREPORTING.find((r) => r.cle === cle) as (typeof REFUS_EREPORTING)[number]
  return { cle, message: remplirModele(modele, valeurs), sources }
}

const rang = (cle: CleRefusEreporting) => REFUS_EREPORTING.findIndex((r) => r.cle === cle)

// Le tri est stable : dans une même clé, les opérations gardent l'ordre où elles ont été jugées (leur date, puis leur
// identifiant).
const dansLOrdre = (refus: RefusEreporting[]) => refus.sort((a, b) => rang(a.cle) - rang(b.cle))

// ── La période, le dossier, les lectures ────────────────────────────────────────────────────────────────────────────

const centimes = (euros: number) => Math.round(euros * 100)
const dansLaPeriode = (date: string, p: PeriodeEreporting) => date >= p.debut && date <= p.fin
const parDateEtId = <T extends { date: string; id: string }>(a: T, b: T) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

type Jugement =
  | { arret: true; declaration: DeclarationEreporting<never> }
  | { arret: false; periode: PeriodeEreporting; frequence: FrequenceProposee; obligation: EtatObligation; refus: RefusEreporting[] }

/**
 * Ce qui se juge de la période seule, et des lectures : la période d'e1 sous le régime du dossier, ou pourquoi il n'y en
 * a pas — le statut à préciser, des paiements sur option pour les débits (hors du champ), des bornes d'un autre régime —,
 * une période finie avant l'obligation (hors du champ), une lecture partielle — autant d'arrêts —, puis ce qui empêche
 * seulement de la déclarer aujourd'hui (pas finie, régime à confirmer).
 */
function jugerLaPeriode(objet: ObjetEreporting, c: ContexteDeclaration, lectures: Record<string, Lecture<unknown>>): Jugement {
  const d = c.dossier
  const obligation = obligationsEreporting(d.statut_tva, d.article_exoneration, d.tva_periodicite, d.tva_sur_debits)[objet]
  const arret = (etat: EtatDeclarationEreporting, refus: RefusEreporting[], frequence: FrequenceProposee | null,
    periode: PeriodeEreporting | null): Jugement => ({
    arret: true,
    declaration: { objet, obligation: obligation.etat, frequence, periode, etat, refus, contenu: null, ecartees: [] },
  })

  if (d.statut_tva == null) return arret('incomplete', [refusDe('statut_a_preciser', [], [])], null, null)
  // Rien n'est dû : e1 ne propose alors aucune fréquence, et aucune période n'est à juger.
  if (obligation.etat === 'non_due') return arret('hors_du_champ', [refusDe('paiements_sur_debits', [], [])], null, null)
  // Un statut connu et une obligation due, en partie ou le cas échéant : e1 propose toujours une fréquence.
  const frequence = obligation.frequence as FrequenceProposee
  const periode = periodeDe(c.periode.debut, frequence.frequence)
  if (periode == null || periode.debut !== c.periode.debut || periode.fin !== c.periode.fin) {
    return arret('incomplete', [refusDe('periode_hors_regime',
      [formatDate(c.periode.debut), formatDate(c.periode.fin), libelleFrequence(frequence, false)], [])], frequence, null)
  }
  if (periode.fin < DEBUT_EREPORTING_PME) {
    return arret('hors_du_champ', [refusDe('avant_l_obligation', [formatDate(periode.fin)], [])], frequence, periode)
  }
  const partielles = Object.entries(lectures).filter(([, l]) => !l.complete)
  if (partielles.length > 0) {
    return arret('incomplete', partielles.map(([nom, l]) => refusDe('lecture_incomplete',
      [NOMS_DES_LECTURES[nom] ?? nom, l.motif ?? 'sans motif rendu'], [{ genre: 'lecture', id: nom }])), frequence, periode)
  }

  const refus: RefusEreporting[] = []
  if (c.aujourdHui <= periode.fin) {
    refus.push(refusDe('periode_en_cours', [formatDate(ajouterJours(periode.fin, 1)), formatDate(periode.echeance)], []))
  }
  if (!c.regimeConfirme) refus.push(refusDe('regime_a_confirmer', [libelleFrequence(frequence, true)], []))
  return { arret: false, periode, frequence, obligation: obligation.etat, refus }
}

const NOMS_DES_LECTURES: Readonly<Record<string, string>> = {
  pieces: 'des pièces du dossier',
  fiches: 'des fiches « fournisseur établi hors de France »',
  taux: 'de la ventilation des fiches',
  textes: 'des textes lus sur les documents',
  factures: 'des factures émises',
  lignes: 'des lignes des factures',
  encaissements: 'des encaissements',
  parts: 'de la répartition des encaissements par taux',
}

/** Le SIREN du dossier, s'il en a un valide (G6.26 : neuf chiffres, connu de l'INSEE — ici, sa clé). */
function sirenDuDossier(d: DossierEreporting): string | null {
  const siren = sirenDe(d.siret)
  return sirenValide(siren) ? siren : null
}

/**
 * L'état d'une déclaration jugée jusqu'au bout. Le contenu décide : incomplète dès qu'une opération ou l'identité du
 * déclarant laisse une donnée sans réponse ; sinon à déclarer s'il y a une opération, rien à déclarer s'il n'y en a pas.
 * Une période pas finie, un régime à confirmer n'en changent pas l'état : ils empêchent seulement de la déclarer
 * aujourd'hui, et `refus` le dit.
 */
function etatDuContenu(refus: readonly RefusEreporting[], nombreOperations: number): EtatDeclarationEreporting {
  const bloquants = refus.filter((r) => r.cle !== 'periode_en_cours' && r.cle !== 'regime_a_confirmer' && r.cle !== 'rien_a_declarer')
  if (bloquants.length > 0) return 'incomplete'
  return nombreOperations > 0 ? 'a_declarer' : 'rien_a_declarer'
}

/** Ce qui se dit quand le contenu est jugé : l'identité du déclarant — seulement s'il y a quelque chose à déclarer — et
 * l'absence d'opération (e1, `transmissionAttendue`). */
function refusDuContenu(objet: ObjetEreporting, d: DossierEreporting, refusDesOperations: readonly RefusEreporting[],
  nombreOperations: number, avecNumeroTva: boolean): RefusEreporting[] {
  const refus: RefusEreporting[] = []
  if (nombreOperations > 0 || refusDesOperations.length > 0) {
    if (sirenDuDossier(d) == null) refus.push(refusDe('siren_invalide', [], []))
    else if (avecNumeroTva && numeroTvaDuDossier(d) == null) refus.push(refusDe('numero_tva_absent', [], []))
  } else {
    // Un compte nul est un entier : e1 rend toujours sa raison.
    refus.push(refusDe('rien_a_declarer', [(transmissionAttendue(objet, 0) as { raison: string }).raison], []))
  }
  return refus
}

/** Le numéro de TVA du dossier : celui qu'un redevable a toujours, celui qu'un franchisé ou un exonéré a demandé (la case
 * de l'onglet TVA, décision du cabinet du 08/10/2026) — calculé de son SIREN. Nul sans SIREN valide, ou sans la case. */
function numeroTvaDuDossier(d: DossierEreporting): string | null {
  const siren = sirenDuDossier(d)
  if (siren == null) return null
  return d.statut_tva === 'redevable' || d.numero_tva_attribue ? numeroTvaFrancais(siren) : null
}

// ── Ce que le statut de TVA fait d'un taux ──────────────────────────────────────────────────────────────────────────

type JugementDuTaux = 'retenu' | 'exonere' | 'taux_positif' | 'zero_sans_article'

/**
 * UN TAUX D'UNE VENTE À UN PARTICULIER, ET CE QUE LE STATUT DU DOSSIER EN FAIT. Un redevable déclare ses lignes taxées ;
 * sa ligne à 0 % est une opération exonérée s'il a l'article de son exonération (elle sort, BOI-TVA-DECLA-20-30-50-10,
 * § 20), une inconnue sinon. Un franchisé déclare ses ventes au taux 0 (point 7 de la conception : TPS1 ou TLB1, pas
 * TNT1). Un dossier exonéré ne déclare pas ses opérations exonérées. Une ligne taxée d'un dossier qui ne facture pas de
 * TVA contredit son statut — sa TVA est due du seul fait d'être mentionnée (CGI, art. 283, 3) : elle se refuse.
 */
function jugerLeTaux(taux: number, statut: StatutTva, article: Dossier['article_exoneration']): JugementDuTaux {
  if (statut === 'redevable') return taux > 0 ? 'retenu' : article != null ? 'exonere' : 'zero_sans_article'
  if (taux > 0) return 'taux_positif'
  return statut === 'franchise' ? 'retenu' : 'exonere'
}

function refusDuTaux(jugement: 'taux_positif' | 'zero_sans_article', taux: number, statut: StatutTva,
  sources: readonly SourceEreporting[]): RefusEreporting {
  if (jugement === 'zero_sans_article') return refusDe('zero_sans_article', [], sources)
  return refusDe('taux_positif', [statut === 'franchise' ? 'en franchise en base' : 'exonéré', tauxCommeLaBase(taux)], sources)
}

// ── Les achats à un fournisseur établi hors de France ───────────────────────────────────────────────────────────────

/** La date qui range l'achat d'une fiche (`Rangement`) : un avoir, à sa date. */
export function dateQuiRangeLAchat(
  fiche: Pick<PieceHorsDeFrance, 'type_document' | 'date_facture' | 'date_operation' | 'periode_fin'>,
  rangement: Rangement,
): string {
  if (rangement === 'date_de_la_facture' || fiche.type_document === '381') return fiche.date_facture
  return fiche.date_operation ?? fiche.periode_fin ?? fiche.date_facture
}

/**
 * LA DÉCLARATION DES ACHATS de la période (bloc 10.1, rôle acheteur). Y entre la fiche COURANTE et non retirée de chaque
 * pièce, rangée par `choix.rangement`, dont la facture est du 1er septembre 2027 ou après, REJUGÉE contre la pièce telle
 * qu'elle est aujourd'hui (la base ne revoit pas une fiche quand sa pièce change — l'écran d'e3 fait de même), le gel mis
 * à part. Une pièce d'achat SANS fiche que les signaux d'e3 désignent (une autre devise, un numéro de TVA de l'Union ou une
 * mention d'autoliquidation lus, un fournisseur déjà décrit), datée de la période ou sans date, attend : la déclaration
 * est incomplète tant que le cabinet ne l'a ni décrite ni écartée. Le dossier y est l'acheteur : son SIREN et son numéro
 * de TVA, exigé (G2.33 ; hypothèse Q3 de la conception).
 */
export function declarationDesAchats(
  c: ContexteDeclaration, sources: SourcesDesAchats, choix: ChoixDesAchats,
): DeclarationEreporting<ContenuAchats> {
  const jugement = jugerLaPeriode('achats', c, { ...sources })
  if (jugement.arret) return jugement.declaration
  const { periode } = jugement
  const dossierId = c.dossier.id
  const pieces = sources.pieces.lignes.filter((p) => p.dossier_id === dossierId)
  const fiches = sources.fiches.lignes.filter((f) => f.dossier_id === dossierId)
  const taux = sources.taux.lignes.filter((t) => t.dossier_id === dossierId)
  const refus: RefusEreporting[] = []
  const ecartees: OperationEcartee[] = []
  const achats: AchatDeclare[] = []

  // La fiche courante de chaque pièce décrite — une seule, la chaîne des versions est linéaire —, non retirée, rangée.
  const courantes = [...new Set(fiches.map((f) => f.piece_id))]
    .map((pieceId) => fiches.find((f) => f.id === ficheCourante(fiches, pieceId)))
    .filter((f): f is PieceHorsDeFrance => f !== undefined && f.retire_le == null)
    .map((f) => ({ fiche: f, date: dateQuiRangeLAchat(f, choix.rangement), id: f.id }))
    .filter((x) => dansLaPeriode(x.date, periode))
    .sort(parDateEtId)
  for (const { fiche, date } of courantes) {
    const source: SourceEreporting = { genre: 'fiche', id: fiche.id }
    if (!dansLObligation(fiche.date_facture)) {
      ecartees.push({ source, raison: 'avant_l_obligation' })
      continue
    }
    const piece = pieces.find((p) => p.id === fiche.piece_id)
    const lignes = ventilationDe(taux, fiche.id)
    // La base garantit la pièce de chaque fiche, et une ventilation à chacune : sans elles, les lectures se contredisent
    // — une ventilation manquante se rejugerait « illisible », ce qu'elle n'est pas.
    if (!piece || lignes.length === 0) {
      refus.push(refusDe('lectures_discordantes', ['une fiche « hors de France »', piece ? 'sa ventilation' : 'sa pièce'], [source]))
      continue
    }
    const rejugee = refusFicheHorsDeFrance(piece, saisieDeLaFiche(fiche, lignes), {
      remplaceId: fiche.id, fiches, anneeFigeante: null, aujourdHui: c.aujourdHui,
    })
    if (rejugee) {
      refus.push(refusDe('fiche_a_revoir', [rejugee.message], [source, { genre: 'piece', id: piece.id }]))
      continue
    }
    // Rejugée : chaque base est au centime, chaque taux et chaque TVA nuls (refus 19 d'e2, hypothèse Q7).
    const declarees: LigneAchatDeclaree[] = lignes.map((l) => ({
      code: l.code_tva, taux: l.taux, baseCentimes: centimesExacts(l.base) as number, tvaCentimes: centimesExacts(l.tva) as number,
      motifCode: l.motif_code, motifTexte: l.motif_texte,
    }))
    achats.push({
      ficheId: fiche.id, pieceId: piece.id, date, numero: fiche.numero, dateFacture: fiche.date_facture,
      typeDocument: fiche.type_document as '380' | '381',
      origine: fiche.facture_origine_numero != null && fiche.facture_origine_date != null
        ? { numero: fiche.facture_origine_numero, date: fiche.facture_origine_date } : null,
      devise: fiche.devise, pays: fiche.pays, schema: fiche.schema_identifiant, identifiant: fiche.identifiant,
      nature: fiche.nature, cadre: cadreDeFacturation(fiche.nature), autoliquidation: fiche.autoliquidation,
      dateOperation: fiche.date_operation, periodeDebut: fiche.periode_debut, periodeFin: fiche.periode_fin,
      lignes: declarees,
      htCentimes: declarees.reduce((s, l) => s + l.baseCentimes, 0),
      // La somme des TVA, nulles ici : une TVA en devise se convertirait (G6.23), et Q7 la met de côté.
      tvaEurosCentimes: declarees.reduce((s, l) => s + l.tvaCentimes, 0),
    })
  }

  // Les pièces candidates : un achat sans aucune fiche, que la période peut concerner, et qu'un signal désigne — validée
  // ou non : la règle de la Checklist (une donnée absente ne se signale que sur une pièce validée) ne vaut pas pour une
  // déclaration, dont le vide est une affirmation, et un achat à l'étranger qui attend sa validation y manquerait. Sans
  // date, elle attend dans toute période : on ne sait pas laquelle est la sienne.
  const decrites = new Set(fiches.map((f) => f.piece_id))
  const textes = new Map(sources.textes.lignes.filter((t) => t.piece_id != null).map((t) => [t.piece_id as string, t.texte]))
  const candidates = pieces
    .filter((p) => TYPES_DE_PIECE_DECRITS.includes(p.type_piece) && !decrites.has(p.id)
      && (p.date_piece == null || dansLaPeriode(p.date_piece, periode)))
    .map((p) => ({ piece: p, date: p.date_piece ?? '', id: p.id }))
    .sort(parDateEtId)
  for (const { piece } of candidates) {
    const signaux = signauxHorsDeFrance({ piece, texte: textes.get(piece.id) ?? null, lecture: { fiches, taux }, pieces })
    if (signaux.length === 0) continue
    const source: SourceEreporting = { genre: 'piece', id: piece.id }
    if (choix.piecesEcartees.has(piece.id)) {
      ecartees.push({ source, raison: 'ecartee_par_le_cabinet' })
      continue
    }
    if (piece.montant_tva != null && piece.montant_tva !== 0) {
      refus.push(refusDe('achat_avec_tva', [euroCommeLaBase(centimes(Math.abs(piece.montant_tva)))], [source]))
    } else {
      refus.push(refusDe('achat_a_verifier', [signaux.map((s) => s.phrase).join(' ')], [source]))
    }
  }

  const tous = dansLOrdre([...jugement.refus, ...refus, ...refusDuContenu('achats', c.dossier, refus, achats.length, true)])
  const totaux = new Map<string, number>()
  for (const a of achats) totaux.set(a.devise, (totaux.get(a.devise) ?? 0) + (a.typeDocument === '381' ? -a.htCentimes : a.htCentimes))
  return {
    objet: 'achats', obligation: jugement.obligation, frequence: jugement.frequence, periode,
    etat: etatDuContenu(tous, achats.length), refus: tous, ecartees,
    contenu: {
      role: 'BY', siren: sirenDuDossier(c.dossier), numeroTva: numeroTvaDuDossier(c.dossier), achats,
      nombreOperations: achats.length,
      totauxParDevise: [...totaux].sort(([a], [b]) => (a < b ? -1 : 1)).map(([devise, htCentimes]) => ({ devise, htCentimes })),
    },
  }
}

// ── Les ventes à des particuliers ───────────────────────────────────────────────────────────────────────────────────

/** La date qui range une facture émise (`Rangement`) : un avoir, à sa date. */
export function dateQuiRangeLaVente(
  f: Pick<FactureEmise, 'type' | 'date_emission' | 'date_prestation' | 'periode_fin'>,
  rangement: Rangement,
): string {
  if (rangement === 'date_de_la_facture' || f.type === 'avoir') return f.date_emission
  return f.date_prestation ?? f.periode_fin ?? f.date_emission
}

/** Le client d'une facture qui la fait passer par la facture électronique, pas par l'e-reporting. */
const versUneEntrepriseEnFrance = (f: Pick<FactureLue, 'type_client'>) =>
  f.type_client === 'assujetti' || f.type_client === 'organisme_public'

interface GroupeDeVente {
  taux: number
  baseCentimes: number
  tvaCentimes: number
}

/**
 * La ventilation d'une facture par taux, telle que la facture électronique l'écrirait (`montantsDuDocument`, celle que
 * le statut « Encaissée » répartit aussi), dans le SENS DE LA PÉRIODE : un avoir en moins (point 21 de la conception, NON
 * VÉRIFIÉ — le flux 10 ne dit pas le signe d'un agrégat ; G1.14 admet un montant négatif). Et si l'en-tête enregistré se
 * retrouve dans les lignes.
 */
function ventilationDeLaVente(f: FactureLue, lignes: readonly LigneLue[]): { groupes: GroupeDeVente[]; coherente: boolean } {
  const m = montantsDuDocument(f, lignes.filter((l) => l.facture_id === f.id), null)
  const signe = f.type === 'avoir' ? -1 : 1
  const coherente = centimesExacts(f.montant_ht) === signe * m.htCentimes && centimesExacts(f.montant_tva) === signe * m.tvaCentimes
    && centimesExacts(f.montant_ttc) === signe * m.ttcCentimes
  return {
    groupes: m.groupes.map((g) => ({ taux: g.taux, baseCentimes: signe * g.baseCentimes, tvaCentimes: signe * g.tvaCentimes })),
    coherente,
  }
}

/**
 * LA DÉCLARATION DES VENTES de la période (bloc 10.3, rôle vendeur) : les factures et les avoirs VALIDÉS adressés à un
 * particulier, rangés par `choix.rangement`, émis le 1er septembre 2027 ou après, agrégés par jour, par catégorie — TLB1
 * pour des biens, TPS1 pour des services (G1.68) — et par option pour les débits, puis par taux. Une facture à une
 * entreprise établie en France n'y entre pas (facture électronique) ; une facture à un client établi hors de France
 * demande des mentions que l'application ne saisit pas encore (étape e7, Q8) : elle se refuse. Seules les factures
 * émises entrent ici, jamais la pièce qui revient de la plateforme ni la recette du relevé qui encaisse la même vente
 * (conception, § 4.5, 5).
 */
export function declarationDesVentes(
  c: ContexteDeclaration, sources: SourcesDesVentes, choix: { rangement: Rangement },
): DeclarationEreporting<ContenuVentes> {
  const jugement = jugerLaPeriode('ventes', c, { ...sources })
  if (jugement.arret) return jugement.declaration
  const { periode } = jugement
  const statut = c.dossier.statut_tva as StatutTva
  const refus: RefusEreporting[] = []
  const ecartees: OperationEcartee[] = []
  const agregats = new Map<string, TransactionsDuJour>()
  let nombreOperations = 0

  const factures = sources.factures.lignes
    .filter((f) => f.dossier_id === c.dossier.id && f.statut === 'validee' && !versUneEntrepriseEnFrance(f))
    .map((f) => ({ facture: f, date: dateQuiRangeLaVente(f, choix.rangement), id: f.id }))
    .filter((x) => dansLaPeriode(x.date, periode))
    .sort(parDateEtId)
  for (const { facture: f, date } of factures) {
    const source: SourceEreporting = { genre: 'facture', id: f.id }
    if (!dansLObligation(f.date_emission)) {
      ecartees.push({ source, raison: 'avant_l_obligation' })
      continue
    }
    const { groupes, coherente } = ventilationDeLaVente(f, sources.lignes.lignes)
    // Une facture porte au moins une ligne (la base le garantit) : sans elles, les lectures se contredisent — et une
    // facture sans ligne passerait pour exonérée.
    if (groupes.length === 0) {
      refus.push(refusDe('lectures_discordantes', ['une facture', 'ses lignes'], [source]))
      continue
    }
    const jugements = groupes.map((g) => ({ groupe: g, jugement: jugerLeTaux(g.taux, statut, c.dossier.article_exoneration) }))
    // Un motif certain de ne rien déclarer l'emporte sur une donnée inconnue : toutes ses lignes sont exonérées.
    if (jugements.every((j) => j.jugement === 'exonere')) {
      ecartees.push({ source, raison: 'operation_exoneree' })
      continue
    }
    const premier = premierRefusDeLaVente(f, coherente)
    if (premier) {
      refus.push(refusDe(premier, [], [source]))
      continue
    }
    const contraire = jugements.find((j) => j.jugement === 'taux_positif' || j.jugement === 'zero_sans_article')
    if (contraire) {
      refus.push(refusDuTaux(contraire.jugement as 'taux_positif' | 'zero_sans_article', contraire.groupe.taux, statut, [source]))
      continue
    }
    if (jugements.some((j) => j.jugement === 'exonere')) ecartees.push({ source, raison: 'part_exoneree' })

    const categorie: CategorieTransactions = f.nature_operation === 'biens' ? 'TLB1' : 'TPS1'
    const optionDebits = categorie === 'TPS1' && f.option_debits === true
    const cle = `${date}|${categorie}|${optionDebits}`
    const agregat: TransactionsDuJour = agregats.get(cle) ?? {
      date, devise: 'EUR', categorie, optionDebits, htCentimes: 0, tvaCentimes: 0, parTaux: [], factures: [],
    }
    for (const { groupe } of jugements.filter((j) => j.jugement === 'retenu')) {
      const t = agregat.parTaux.find((x) => x.taux === groupe.taux)
      if (t) {
        t.baseCentimes += groupe.baseCentimes
        t.tvaCentimes += groupe.tvaCentimes
      } else agregat.parTaux.push({ taux: groupe.taux, baseCentimes: groupe.baseCentimes, tvaCentimes: groupe.tvaCentimes })
      agregat.htCentimes += groupe.baseCentimes
      agregat.tvaCentimes += groupe.tvaCentimes
    }
    agregat.factures.push(f.id)
    agregats.set(cle, agregat)
    nombreOperations += 1
  }

  // Les factures d'un agrégat y entrent dans l'ordre de leur identifiant : elles partagent sa date, et la boucle les prend
  // par date puis par identifiant.
  const transactions = [...agregats.values()]
    .map((a) => ({ ...a, parTaux: a.parTaux.sort((x, y) => y.taux - x.taux) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.categorie < b.categorie ? -1 : a.categorie > b.categorie ? 1
      : Number(a.optionDebits) - Number(b.optionDebits)))
  const tous = dansLOrdre([...jugement.refus, ...refus, ...refusDuContenu('ventes', c.dossier, refus, nombreOperations, false)])
  return {
    objet: 'ventes', obligation: jugement.obligation, frequence: jugement.frequence, periode,
    etat: etatDuContenu(tous, nombreOperations), refus: tous, ecartees,
    contenu: {
      role: 'SE', siren: sirenDuDossier(c.dossier), transactions, nombreOperations,
      htCentimes: transactions.reduce((s, t) => s + t.htCentimes, 0),
      tvaCentimes: transactions.reduce((s, t) => s + t.tvaCentimes, 0),
    },
  }
}

/** Ce qu'une facture à un client qui n'est pas une entreprise établie en France laisse sans réponse, dans l'ordre des
 * refus : son client, ses mentions internationales, sa nature, son option, ses montants. Null : rien. */
function premierRefusDeLaVente(f: FactureLue, coherente: boolean): CleRefusEreporting | null {
  if (f.type_client == null) return 'destinataire_inconnu'
  if (f.type_client === 'etranger') return 'facture_internationale'
  if (f.nature_operation == null) return 'nature_inconnue'
  if (f.nature_operation === 'mixte') return 'facture_mixte'
  if (f.nature_operation === 'services' && f.option_debits == null) return 'option_inconnue'
  if (!coherente) return 'montants_incoherents'
  return null
}

// ── Les paiements des ventes à des particuliers ─────────────────────────────────────────────────────────────────────

/**
 * LA DÉCLARATION DES PAIEMENTS de la période (bloc 10.4, rôle vendeur) : les encaissements du registre de d1 sur les
 * factures à un particulier émises le 1er septembre 2027 ou après — la date de la FACTURE décide de l'obligation, celle de
 * l'encaissement range la période (e1, `dansLObligation`) —, agrégés par jour et par taux. NETS : un encaissement retiré
 * ne compte pas ; une contre-passation compte en moins, rangée par `choix.contrePassation`. Aujourd'hui l'encaissement
 * d'une vente à un particulier ne fait que se retirer : jamais transmise, sa facture n'est pas « déclarée » au sens de d4
 * (`encaissement_declare`), et `annuler_encaissement` ne contre-passe qu'un encaissement déclaré — e5 dira ce qu'un
 * retrait devient dans une période déclarée. Seules les prestations de
 * services dont la TVA est due à l'encaissement : pas une livraison de biens, pas sur option pour les débits (dossier
 * général, note 119 ; BOI-TVA-DECLA-20-30-60, § 1 et § 30). Un paiement n'existe que d'une facture (la base refuse
 * l'encaissement d'un avoir).
 */
export function declarationDesPaiements(
  c: ContexteDeclaration, sources: SourcesDesPaiements, choix: { contrePassation: RangementContrePassation },
): DeclarationEreporting<ContenuPaiements> {
  const jugement = jugerLaPeriode('paiements', c, { ...sources })
  if (jugement.arret) return jugement.declaration
  const { periode } = jugement
  const statut = c.dossier.statut_tva as StatutTva
  const dossierId = c.dossier.id
  const encaissements = sources.encaissements.lignes.filter((e) => e.dossier_id === dossierId)
  const parts = sources.parts.lignes.filter((p) => p.dossier_id === dossierId)
  const refus: RefusEreporting[] = []
  const ecartees: OperationEcartee[] = []
  const agregats = new Map<string, PaiementsDuJour>()
  let nombreOperations = 0

  // Chaque encaissement vivant, rangé : une contre-passation à SA date ou à celle de l'encaissement qu'elle annule
  // (`choix.contrePassation`) — à la sienne quand celui-ci manque à la lecture, qui se dit alors dans cette période-là.
  // L'encaissement annulé se cherche dans tout le registre : la base n'en laisse aucun retiré sous une contre-passation
  // vivante (d1 : `retirer_encaissement` le refuse, le déclencheur aussi).
  const ranges = encaissements
    .filter((e) => e.retire_le == null)
    .map((e) => {
      const annule = e.annule_id == null ? null : encaissements.find((x) => x.id === e.annule_id) ?? 'absent'
      const date = annule != null && annule !== 'absent' && choix.contrePassation === 'date_de_l_encaissement_annule'
        ? annule.date_encaissement : e.date_encaissement
      return { encaissement: e, annuleAbsent: annule === 'absent', date, id: e.id }
    })
    .filter((x) => dansLaPeriode(x.date, periode))
    .sort(parDateEtId)
  for (const { encaissement: e, annuleAbsent, date } of ranges) {
    const source: SourceEreporting = { genre: 'encaissement', id: e.id }
    if (annuleAbsent) {
      refus.push(refusDe('lectures_discordantes', ['une contre-passation', 'l’encaissement qu’elle annule'], [source]))
      continue
    }
    const f = sources.factures.lignes.find((x) => x.id === e.facture_id && x.dossier_id === dossierId)
    if (!f) {
      refus.push(refusDe('lectures_discordantes', ['un encaissement', 'sa facture'], [source]))
      continue
    }
    if (versUneEntrepriseEnFrance(f)) continue
    if (!dansLObligation(f.date_emission)) {
      ecartees.push({ source, raison: 'avant_l_obligation' })
      continue
    }
    // Les motifs certains d'abord : des biens, l'option pour les débits, des parts toutes exonérées.
    if (f.nature_operation === 'biens') {
      ecartees.push({ source, raison: 'livraison_de_biens' })
      continue
    }
    if (f.option_debits === true) {
      ecartees.push({ source, raison: 'option_debits' })
      continue
    }
    const siennes = parts.filter((p) => p.encaissement_id === e.id)
    // La base fait de la somme des parts le montant, jamais nul (d1) : une répartition lue en partie se contredit — et un
    // encaissement sans part, dont la somme est nulle, passerait pour exonéré.
    if (siennes.reduce((s, p) => s + centimes(p.montant), 0) !== centimes(e.montant)) {
      refus.push(refusDe('lectures_discordantes', ['un encaissement', 'sa répartition par taux entière'], [source]))
      continue
    }
    const jugements = siennes.map((p) => ({ part: p, jugement: jugerLeTaux(p.taux, statut, c.dossier.article_exoneration) }))
    if (jugements.every((j) => j.jugement === 'exonere')) {
      ecartees.push({ source, raison: 'operation_exoneree' })
      continue
    }
    const premier = premierRefusDuPaiement(f)
    if (premier) {
      refus.push(refusDe(premier, [], [source, { genre: 'facture', id: f.id }]))
      continue
    }
    const contraire = jugements.find((j) => j.jugement === 'taux_positif' || j.jugement === 'zero_sans_article')
    if (contraire) {
      refus.push(refusDuTaux(contraire.jugement as 'taux_positif' | 'zero_sans_article', contraire.part.taux, statut,
        [source, { genre: 'facture', id: f.id }]))
      continue
    }
    if (jugements.some((j) => j.jugement === 'exonere')) ecartees.push({ source, raison: 'part_exoneree' })

    const agregat: PaiementsDuJour = agregats.get(date) ?? { date, montantCentimes: 0, parTaux: [], encaissements: [] }
    for (const { part } of jugements.filter((j) => j.jugement === 'retenu')) {
      const t = agregat.parTaux.find((x) => x.taux === part.taux)
      if (t) t.montantCentimes += centimes(part.montant)
      else agregat.parTaux.push({ taux: part.taux, montantCentimes: centimes(part.montant) })
      agregat.montantCentimes += centimes(part.montant)
    }
    agregat.encaissements.push(e.id)
    agregats.set(date, agregat)
    nombreOperations += 1
  }

  // Les encaissements d'un jour y entrent dans l'ordre de leur identifiant : la boucle les prend par date de rangement
  // puis par identifiant, et le jour EST cette date.
  const paiements = [...agregats.values()]
    .map((a) => ({ ...a, parTaux: a.parTaux.sort((x, y) => y.taux - x.taux) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const tous = dansLOrdre([...jugement.refus, ...refus, ...refusDuContenu('paiements', c.dossier, refus, nombreOperations, false)])
  return {
    objet: 'paiements', obligation: jugement.obligation, frequence: jugement.frequence, periode,
    etat: etatDuContenu(tous, nombreOperations), refus: tous, ecartees,
    contenu: {
      role: 'SE', siren: sirenDuDossier(c.dossier), paiements, nombreOperations,
      montantCentimes: paiements.reduce((s, p) => s + p.montantCentimes, 0),
    },
  }
}

/** Ce que la facture d'un paiement laisse sans réponse, dans l'ordre des refus. Null : rien. */
function premierRefusDuPaiement(f: FactureLue): CleRefusEreporting | null {
  if (f.type_client == null) return 'destinataire_inconnu'
  if (f.type_client === 'etranger') return 'facture_internationale'
  if (f.nature_operation == null) return 'nature_inconnue'
  if (f.nature_operation === 'mixte') return 'facture_mixte'
  if (f.option_debits == null) return 'option_inconnue'
  return null
}
