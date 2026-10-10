import { centimesExacts, euroCommeLaBase, remplirModele, tauxCommeLaBase } from './encaissementsFactures'
import { dernierJourDuMois, formatDate, jourDe, moisDe } from './format'
import type { CodeTvaHorsDeFrance, NatureAchatHorsDeFrance, Piece, PieceHorsDeFrance, TypePiece } from './types'

// LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UNE PIÈCE D'ACHAT (ligne 28.5, étape e : e-reporting, deuxième temps
// e2 ; conception du 09/10/2026, HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION », §3).
//
// Tout assujetti établi en France — exonéré et franchisé compris — transmettra à l'administration, facture par facture,
// les données de ses acquisitions auprès d'un assujetti qui n'y est pas établi (CGI, art. 290, I-3° a à c ; flux 10,
// bloc 10.1, rôle « acheteur », sans les lignes de la facture : BOI-TVA-DECLA-20-30-50-20, §70). La FICHE porte ce que
// la pièce ne dit pas : le numéro et la date de la facture, son type, le pays et l'identifiant du fournisseur, la nature
// de l'achat, l'autoliquidation, la date de livraison ou la période, et la ventilation par code et taux de TVA. Le
// cabinet la SAISIT : rien ne s'en déduit, rien ne s'écrit seul.
//
// LA BASE TIENT LA RÈGLE (migration `pieces_hors_de_france`) : une fiche ne se modifie jamais, une nouvelle REMPLACE la
// courante, et la courante se RETIRE (une pièce qui n'était pas un achat à l'étranger) ; seules
// `enregistrer_fiche_hors_de_france` et `retirer_fiche_hors_de_france` l'écrivent. Ce module dit AVANT le clic ce
// qu'elles refuseraient, dans leur ordre et sous leurs mots (`REFUS_FICHE_HORS_DE_FRANCE`, `REFUS_RETRAIT_FICHE`) :
// piecesHorsDeFrance.test.ts les confronte au texte des fonctions que l'export porte, et aux messages que l'essai
// (supabase/essais/piecesHorsDeFrance.sql) a lus en base, valeurs comprises. Un module PUR : il ne lit rien en base et
// ne lit pas l'horloge — l'appelant lui passe les fiches du dossier, lues EN ENTIER, l'exercice qui fige la pièce et le
// jour à Paris. Sur une lecture partielle, l'écran ne propose rien : une lecture partielle ne commande aucune écriture.
//
// LES HYPOTHÈSES DU CABINET (questions du 09/10/2026, sans réponse) sont celles de la fonction : un achat facturé avec
// une TVA est mis de côté (Q7) ; la fiche ne dépend pas du numéro de TVA du dossier (Q3) ; une acquisition de biens
// dans l'Union que le dossier n'autoliquiderait pas est à trancher (point 15). Une autre réponse changera la fonction,
// puis ce module, et le test dira l'écart.

// ── Les listes de la fonction ───────────────────────────────────────────────────────────────────────────────────────

/** ISO 3166-1 alpha-2, les 249 codes attribués (paquet iso-codes 4.16.0, qui reprend la liste de l'ISO) : `c_pays`. */
export const PAYS_ISO_3166: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE',
  'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD',
  'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME',
  'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK',
  'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
]

/** Les vingt-six autres États membres de l'Union : `c_union`. Leur fournisseur se désigne par son numéro de TVA. */
export const ETATS_MEMBRES_HORS_FRANCE: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]

/** La Guadeloupe, la Martinique et La Réunion : la facture électronique, pas cette fiche (BOI-TVA-DECLA-20-30-50-10,
 * §170) — `c_drom_tva`. */
export const OUTRE_MER_FACTURE_ELECTRONIQUE: readonly string[] = ['GP', 'MQ', 'RE']

/** Le reste de l'outre-mer français, hors du territoire de la TVA (§180) : règles et schémas propres — `c_outre_mer`. */
export const OUTRE_MER_HORS_FICHE: readonly string[] = ['GF', 'YT', 'PM', 'BL', 'MF', 'WF', 'PF', 'NC', 'TF']

/** Les codes de TVA de la règle G2.31. */
export const CODES_TVA_HORS_DE_FRANCE: readonly CodeTvaHorsDeFrance[] = ['S', 'E', 'AE', 'K', 'G', 'O', 'Z']

/** Les natures d'un achat, qui donnent le cadre de facturation (TT-28). */
export const NATURES_ACHAT: readonly NatureAchatHorsDeFrance[] = ['biens', 'services', 'mixte']

/** Les types que la fonction écrit : une facture (380) ou un avoir (381) — la règle G1.01 en connaît d'autres. */
export const TYPES_DOCUMENT_ECRITS: readonly string[] = ['380', '381']

/** La règle G1.05 : lettres sans accent, chiffres, « - + _ / », des espaces simples, ni en tête ni en fin. */
export const NUMERO_G105 = /^[A-Za-z0-9+_/-]+( [A-Za-z0-9+_/-]+)*$/

/** Un code de motif d'exonération de la liste VATEX. */
export const MOTIF_VATEX = /^VATEX-[A-Z]{2}-[0-9A-Z]+(-[0-9A-Z]+)*$/

/** Un numéro de TVA de l'Union : deux lettres, puis deux à seize lettres sans accent, chiffres, « + » ou « * ». */
export const NUMERO_TVA_UNION = /^[A-Z]{2}[0-9A-Z+*]{2,16}$/

/** Les clés qu'une ligne de la ventilation peut porter : une autre la rend illisible. */
export const CLES_DE_LIGNE_VENTILATION: readonly string[] = ['code', 'taux', 'base', 'tva', 'motif_code', 'motif_texte']

/** Les pièces qui reçoivent une fiche : un achat, une note de frais. Une vente à l'étranger demande ses lignes et ses
 * mentions, qui viendront avec elle. */
export const TYPES_DE_PIECE_DECRITS: readonly TypePiece[] = ['achat', 'note_frais']

// ── Les refus ────────────────────────────────────────────────────────────────────────────────────────────────────────

// Les refus de `enregistrer_fiche_hors_de_france`, dans l'ordre de la fonction : chaque « % » reçoit la valeur que la
// base y met (`remplirModele`), « %% » est un « % » littéral.
export const REFUS_FICHE_HORS_DE_FRANCE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.' },
  { cle: 'pas_un_achat', modele: "Seule une pièce d'achat ou une note de frais reçoit une fiche « fournisseur établi hors de France »." },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa fiche ne change plus." },
  { cle: 'ttc_absent', modele: "La pièce n'a pas encore son montant TTC dans sa devise (%) : le saisir sur la pièce d'abord." },
  { cle: 'tva_sur_la_piece', modele: 'La pièce porte une TVA de % € : un achat à un fournisseur établi hors de France facturé avec une TVA — la sienne ou la TVA française — est mis de côté, à trancher par le cabinet.' },
  { cle: 'remplace_etrangere', modele: "La fiche à remplacer n'est pas une fiche de cette pièce." },
  { cle: 'fiche_changee', modele: "Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d'enregistrer." },
  { cle: 'numero_absent', modele: 'Le numéro de la facture est à renseigner.' },
  { cle: 'numero_invalide', modele: 'Le numéro de la facture tient en 35 caractères : lettres sans accent, chiffres, espaces simples et « - + _ / », sans espace au début ni à la fin.' },
  { cle: 'date_absente', modele: 'La date de la facture est à renseigner.' },
  { cle: 'date_avant_2000', modele: "Une facture ne se date pas avant l'an 2000." },
  { cle: 'date_future', modele: "Une facture ne se date pas dans l'avenir : nous sommes le %." },
  { cle: 'type_document', modele: 'Une fiche décrit une facture (380) ou un avoir (381).' },
  { cle: 'sens', modele: 'La pièce et sa fiche ne disent pas le même sens : une facture (380) porte un montant positif dans la pièce, un avoir (381) un montant négatif.' },
  { cle: 'origine_absente', modele: "Un avoir cite la facture qu'il corrige : son numéro et sa date." },
  { cle: 'origine_invalide', modele: "La facture d'origine se cite par un numéro de 35 caractères (lettres sans accent, chiffres, espaces simples et « - + _ / ») et une date entre le 01/01/2000 et aujourd'hui." },
  { cle: 'origine_sur_une_facture', modele: "Seul un avoir cite une facture d'origine." },
  { cle: 'pays_inconnu', modele: 'Le pays du fournisseur est un code de pays à deux lettres (norme ISO 3166).' },
  { cle: 'pays_france', modele: "Un fournisseur établi en France n'a pas de fiche « hors de France »." },
  { cle: 'pays_monaco', modele: "Un fournisseur établi à Monaco est traité comme un fournisseur établi en France : il n'a pas de fiche « hors de France »." },
  { cle: 'pays_facture_electronique', modele: 'Un achat à un fournisseur établi en Guadeloupe, en Martinique ou à La Réunion passe par la facture électronique, pas par cette fiche.' },
  { cle: 'pays_outre_mer', modele: "L'outre-mer français a ses propres règles (Guyane, Mayotte, collectivités d'outre-mer, Nouvelle-Calédonie, Terres australes) : cette fiche ne le couvre pas encore." },
  { cle: 'schema_inconnu', modele: "Le fournisseur se désigne par son numéro de TVA s'il est établi dans l'Union (schéma 0223), par son pays et son nom sinon (schéma 0227)." },
  { cle: 'schema_nom_dans_l_union', modele: "Un fournisseur établi dans l'Union se désigne par son numéro de TVA (schéma 0223)." },
  { cle: 'schema_tva_hors_union', modele: "Un fournisseur établi hors de l'Union se désigne par son pays et son nom (schéma 0227)." },
  { cle: 'identifiant_absent', modele: "L'identifiant du fournisseur est à renseigner." },
  { cle: 'numero_tva_invalide', modele: "Le numéro de TVA d'un fournisseur établi dans ce pays (%) commence par % et tient en 18 caractères au plus : des lettres sans accent et des chiffres." },
  { cle: 'identifiant_hors_union_invalide', modele: "L'identifiant d'un fournisseur établi hors de l'Union est son code de pays (%) suivi des seize premiers caractères de sa dénomination, sans espace au début ni à la fin." },
  { cle: 'nature', modele: "La nature de l'achat est des biens, des services, ou les deux." },
  { cle: 'autoliquidation_absente', modele: 'Dire si le dossier autoliquide la TVA de cet achat.' },
  { cle: 'livraison_et_periode', modele: 'Une facture porte une date de livraison ou une période de facturation, pas les deux.' },
  { cle: 'periode_incomplete', modele: 'Une période de facturation a un début et une fin, et ne finit pas avant de commencer.' },
  { cle: 'dates_hors_bornes', modele: "Une date de livraison ou de période se situe entre l'an 2000 et 2099." },
  { cle: 'ventilation_illisible', modele: 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.' },
  { cle: 'ligne_repetee', modele: 'Le code % au taux de % %% figure deux fois dans la ventilation.' },
  { cle: 'code_inconnu', modele: "Le code de TVA « % » n'est pas un code que la facturation électronique admet." },
  { cle: 'ligne_au_taux_normal', modele: 'Une ligne au taux normal (S) dit une TVA facturée par le fournisseur : cet achat est mis de côté, à trancher par le cabinet.' },
  { cle: 'taux_ou_tva', modele: "Une ligne % ne porte ni taux ni TVA : sans TVA facturée, l'un et l'autre sont nuls." },
  { cle: 'base_invalide', modele: 'Chaque base de la ventilation est un montant positif, au centime.' },
  { cle: 'exoneration_sans_motif', modele: 'Une exonération (E) porte son motif : un code VATEX et son libellé.' },
  { cle: 'motif_invalide', modele: "Un motif se compose d'un code VATEX de 30 caractères au plus et d'un libellé de 1 024 caractères au plus, qui ne se compose pas que de blancs." },
  { cle: 'motif_sur_taux_zero', modele: 'Une ligne au taux zéro (Z) ne porte pas de motif.' },
  { cle: 'exoneration_hors_union', modele: "Une exonération (E) demande le numéro de TVA du fournisseur : un fournisseur établi hors de l'Union n'en a pas." },
  { cle: 'autoliquidation_requise', modele: "Une ligne en autoliquidation (AE) ou une acquisition dans l'Union (K) suppose que le dossier autoliquide la TVA de cet achat ; une acquisition de biens qu'il n'a pas à autoliquider est à trancher par le cabinet." },
  { cle: 'rien_a_autoliquider', modele: 'Rien à autoliquider : une exonération (E) ou un taux zéro (Z) ne laisse aucune TVA due.' },
  { cle: 'ventilation_hors_ttc', modele: 'La ventilation (% %) ne fait pas le montant TTC de la pièce (% %), à un centime près.' },
  { cle: 'facture_deja_decrite', modele: "Cette facture a déjà une fiche, sur une autre pièce du dossier : une facture ne se déclare qu'une fois." },
] as const

export type CleRefusFiche = (typeof REFUS_FICHE_HORS_DE_FRANCE)[number]['cle']

// Les refus de `retirer_fiche_hors_de_france`, dans son ordre et sous ses mots.
export const REFUS_RETRAIT_FICHE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'fiche_introuvable', modele: 'Fiche introuvable dans ce dossier.' },
  { cle: 'remplacee', modele: 'Cette fiche a été remplacée depuis : relire avant de la retirer.' },
  { cle: 'deja_retiree', modele: 'Cette fiche est déjà retirée.' },
  { cle: 'figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa fiche ne se retire plus." },
] as const

export type CleRefusRetraitFiche = (typeof REFUS_RETRAIT_FICHE)[number]['cle']

export interface RefusFiche<C extends string = CleRefusFiche> {
  cle: C
  message: string
}

function refus(cle: CleRefusFiche, ...valeurs: string[]): RefusFiche {
  return { cle, message: remplirModele(REFUS_FICHE_HORS_DE_FRANCE.find((r) => r.cle === cle)!.modele, valeurs) }
}

// ── La fiche courante, le montant de la pièce ──────────────────────────────────────────────────────────────────────

/** La fiche COURANTE d'une pièce : celle qu'aucune autre ne remplace — la chaîne est linéaire (une seule première, une
 * seule suite par fiche). Retirée, elle reste la courante : c'est elle qu'une fiche nouvelle remplace. */
export function ficheCourante(
  fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'piece_id' | 'remplace_id'>[],
  pieceId: string,
): string | null {
  const remplacees = new Set(fiches.map((f) => f.remplace_id).filter((id): id is string => id != null))
  return fiches.find((f) => f.piece_id === pieceId && !remplacees.has(f.id))?.id ?? null
}

/** Le préfixe du numéro de TVA d'un État membre : son code de pays, EL pour la Grèce. */
export function prefixeTva(pays: string): string {
  return pays === 'GR' ? 'EL' : pays
}

/** Le montant TTC de la pièce dans sa devise, celui que la ventilation refait : `montant_ttc` en euros, sinon
 * `montant_devise`. */
export function montantDansSaDevise(piece: Pick<Piece, 'devise' | 'montant_ttc' | 'montant_devise'>): number | null {
  return piece.devise === 'EUR' ? piece.montant_ttc : piece.montant_devise
}

// ── Ce que l'écran envoie ──────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne de la ventilation, telle que la fonction la lit (`p_taux`, un tableau JSON). */
export interface LigneVentilation {
  code: string
  taux: number
  base: number
  tva: number
  motif_code?: string | null
  motif_texte?: string | null
}

/** Ce que le cabinet saisit. Une date est civile (AAAA-MM-JJ) : une autre forme ne parviendrait pas à la fonction —
 * PostgREST refuserait de la lire comme une date —, la fiche la tient pour non renseignée et ne l'envoie pas. */
export interface SaisieFiche {
  numero: string | null
  date_facture: string | null
  type_document: string | null
  facture_origine_numero: string | null
  facture_origine_date: string | null
  pays: string | null
  // `SchemaIdentifiantFournisseur` attendu ; un autre texte est un refus, pas une erreur de type.
  schema_identifiant: string | null
  identifiant: string | null
  // `NatureAchatHorsDeFrance` attendue ; un autre texte est un refus.
  nature: string | null
  autoliquidation: boolean | null
  date_operation: string | null
  periode_debut: string | null
  periode_fin: string | null
  taux: readonly LigneVentilation[]
}

// Une date civile AAAA-MM-JJ qui existe (la règle de `dateCivile` de lib/encaissementsFactures.ts).
function dateCivile(date: string | null): string | null {
  if (date == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const mois = moisDe(date)
  return mois >= 1 && mois <= 12 && jourDe(date) >= 1 && date <= dernierJourDuMois(date) ? date : null
}

/** Les paramètres de `enregistrer_fiche_hors_de_france`, dans l'ordre de sa signature : le dossier annoncé (la fonction
 * y contrôle l'accès avant de rien lire), la pièce, la fiche courante qu'elle remplace (nulle s'il n'y en a pas), la
 * saisie. */
export function argumentsDeLaFiche(dossierId: string, pieceId: string, remplaceId: string | null, saisie: SaisieFiche) {
  return {
    p_dossier_id: dossierId,
    p_piece_id: pieceId,
    p_remplace_id: remplaceId,
    p_numero: saisie.numero,
    p_date_facture: dateCivile(saisie.date_facture),
    p_type_document: saisie.type_document,
    p_facture_origine_numero: saisie.facture_origine_numero,
    p_facture_origine_date: dateCivile(saisie.facture_origine_date),
    p_pays: saisie.pays,
    p_schema_identifiant: saisie.schema_identifiant,
    p_identifiant: saisie.identifiant,
    p_nature: saisie.nature,
    p_autoliquidation: saisie.autoliquidation,
    p_date_operation: dateCivile(saisie.date_operation),
    p_periode_debut: dateCivile(saisie.periode_debut),
    p_periode_fin: dateCivile(saisie.periode_fin),
    p_taux: saisie.taux,
  }
}

/** Les paramètres de `retirer_fiche_hors_de_france`. */
export function argumentsDuRetrait(dossierId: string, ficheId: string) {
  return { p_dossier_id: dossierId, p_fiche_id: ficheId }
}

// ── Les refus dits avant le clic ────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'écran sait quand il propose d'enregistrer. */
export interface ContexteFiche {
  /** La fiche que la saisie remplace : la courante que l'écran a lue, nulle s'il n'y en avait pas. */
  remplaceId: string | null
  /** Toutes les versions des fiches du dossier, retirées comprises, lues EN ENTIER. */
  fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'piece_id' | 'remplace_id' | 'retire_le' | 'schema_identifiant' | 'identifiant' | 'numero' | 'date_facture'>[]
  /** L'exercice qui fige la pièce — sa première écriture validée, ou celle du bien qu'elle justifie (`piecesFigees`,
   * le critère de `exercice_figeant_la_piece`) —, nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Aujourd'hui À PARIS (`aujourdHuiAParis`) : la base lit la date ainsi. */
  aujourdHui: string
}

// Ce que la base lit de ses textes : `btrim(x, E' \t\n\r')` pour un champ vide, `char_length` en caractères, `btrim(x)`
// sans second argument qui ne retire que l'espace, et `[[:cntrl:]]` qui ne vise que U+0000–U+001F et U+007F–U+009F
// (relevé en production le 10/10/2026 : PostgreSQL 17.6, locale ICU en-US). `upper()` y suit, comme `toUpperCase`, le
// mappage de casse complet d'Unicode (« ß » devient « SS »).
const blanc = (texte: string) => /^[ \t\n\r]*$/.test(texte)
const caracteres = (texte: string) => [...texte].length
const sansEspacesAuxBords = (texte: string) => texte.replace(/^ +| +$/g, '')
const controle = (texte: string) => [...texte].some((c) => {
  const n = c.codePointAt(0) ?? 0
  return n <= 0x1f || (n >= 0x7f && n <= 0x9f)
})
const anneeDe = (date: string) => date.slice(0, 4)

// LA VENTILATION TELLE QUE LA BASE LA REÇOIT : le tableau passe par JSON.stringify — une clé indéfinie disparaît, un
// nombre qui n'en est pas un (NaN, Infinity) devient null —, et c'est ce texte que la fonction lit.
function ventilationRecue(taux: readonly LigneVentilation[]): unknown {
  try {
    return JSON.parse(JSON.stringify(taux)) as unknown
  } catch {
    return null
  }
}

interface LigneLue {
  code: string
  taux: number
  base: number
  tva: number
  motif_code: string | null
  motif_texte: string | null
}

// La forme que la fonction exige : une liste non vide d'objets, chacun un code (texte), un taux, une base et une TVA
// (nombres), et peut-être un motif (texte ou nul), sans autre clé. Null : illisible.
function lignesLisibles(recue: unknown): LigneLue[] | null {
  if (!Array.isArray(recue) || recue.length === 0) return null
  const lignes: LigneLue[] = []
  for (const v of recue as unknown[]) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const o = v as Record<string, unknown>
    if (Object.keys(o).some((k) => !CLES_DE_LIGNE_VENTILATION.includes(k))) return null
    if (typeof o.code !== 'string' || typeof o.taux !== 'number' || typeof o.base !== 'number' || typeof o.tva !== 'number') return null
    for (const m of [o.motif_code, o.motif_texte]) {
      if (m !== undefined && m !== null && typeof m !== 'string') return null
    }
    lignes.push({
      code: o.code, taux: o.taux, base: o.base, tva: o.tva,
      motif_code: (o.motif_code as string | null | undefined) ?? null, motif_texte: (o.motif_texte as string | null | undefined) ?? null,
    })
  }
  return lignes
}

// Le montant TTC de la pièce, rapporté à la somme des bases (en centimes exacts) : l'écart dépasse-t-il un centime, et le
// montant tel que `to_char(abs(x), 'FM999999999990.00')` l'écrit (arrondi au centime, au plus loin de zéro). Un montant
// en devise n'est pas toujours au centime : le calcul se fait sur son écriture décimale, sans virgule flottante.
function ecartAuTtc(sommeCentimes: number, ttc: number): { depasse: boolean; ttcEcrit: string } {
  const decimal = tauxCommeLaBase(Math.abs(ttc)).replace(',', '.')
  const [entier, fraction = ''] = decimal.split('.')
  const chiffres = Math.max(fraction.length, 2)
  const echelle = 10n ** BigInt(chiffres)
  const t = BigInt(entier) * echelle + BigInt(fraction.padEnd(chiffres, '0') || '0')
  const s = BigInt(sommeCentimes) * (echelle / 100n)
  const ecart = s > t ? s - t : t - s
  const centimesDuTtc = (t * 100n + echelle / 2n) / echelle
  return { depasse: ecart > echelle / 100n, ttcEcrit: euroCommeLaBase(Number(centimesDuTtc)) }
}

/**
 * POURQUOI CETTE FICHE NE S'ENREGISTRERAIT PAS, dit avant le clic, dans l'ordre de la fonction et sous ses mots — sauf
 * l'accès et la pièce introuvable, que l'écran ne peut pas dire (il ne propose que les pièces qu'il a lues, du dossier
 * qu'il montre). Null : la base l'accepterait.
 */
export function refusFicheHorsDeFrance(
  piece: Pick<Piece, 'id' | 'type_piece' | 'devise' | 'montant_ttc' | 'montant_devise' | 'montant_tva'>,
  saisie: SaisieFiche,
  contexte: ContexteFiche,
): RefusFiche | null {
  // 3. Un achat ; 4. une pièce que rien ne fige ; 5. son montant TTC dans sa devise ; 6. sans TVA (hypothèse Q7).
  if (!TYPES_DE_PIECE_DECRITS.includes(piece.type_piece)) return refus('pas_un_achat')
  if (contexte.anneeFigeante != null) return refus('piece_figee', String(contexte.anneeFigeante))
  const ttc = montantDansSaDevise(piece)
  if (ttc == null) return refus('ttc_absent', piece.devise)
  if (piece.montant_tva != null && piece.montant_tva !== 0) {
    return refus('tva_sur_la_piece', euroCommeLaBase(Math.round(Math.abs(piece.montant_tva) * 100)))
  }

  // 7. La fiche remplacée : une fiche de cette pièce, et la courante.
  const remplace = contexte.remplaceId
  if (remplace != null && !contexte.fiches.some((f) => f.id === remplace && f.piece_id === piece.id)) {
    return refus('remplace_etrangere')
  }
  if (remplace !== ficheCourante(contexte.fiches, piece.id)) return refus('fiche_changee')

  // 8. Le numéro (G1.05) ; 9. la date (G1.36, G1.07).
  const numero = saisie.numero
  if (numero == null || blanc(numero)) return refus('numero_absent')
  if (caracteres(numero) > 35 || !NUMERO_G105.test(numero)) return refus('numero_invalide')
  const date = dateCivile(saisie.date_facture)
  if (date == null) return refus('date_absente')
  if (date < '2000-01-01') return refus('date_avant_2000')
  if (date > contexte.aujourdHui) return refus('date_future', formatDate(contexte.aujourdHui))

  // 10. Le type ; 11. le sens, lu dans la devise de la pièce ; 12. la facture d'origine d'un avoir (G1.32).
  const type = saisie.type_document
  if (type == null || !TYPES_DOCUMENT_ECRITS.includes(type)) return refus('type_document')
  if ((type === '381' && ttc > 0) || (type === '380' && ttc < 0)) return refus('sens')
  const origineNumero = saisie.facture_origine_numero
  const origineDate = dateCivile(saisie.facture_origine_date)
  if (type === '381') {
    if (origineNumero == null || blanc(origineNumero) || origineDate == null) return refus('origine_absente')
    if (caracteres(origineNumero) > 35 || !NUMERO_G105.test(origineNumero) || origineDate < '2000-01-01' || origineDate > contexte.aujourdHui) {
      return refus('origine_invalide')
    }
  } else if (origineNumero != null || origineDate != null) {
    return refus('origine_sur_une_facture')
  }

  // 13. Le pays (G2.01), hors de France au sens de la TVA.
  const pays = saisie.pays
  if (pays == null || !PAYS_ISO_3166.includes(pays)) return refus('pays_inconnu')
  if (pays === 'FR') return refus('pays_france')
  if (pays === 'MC') return refus('pays_monaco')
  if (OUTRE_MER_FACTURE_ELECTRONIQUE.includes(pays)) return refus('pays_facture_electronique')
  if (OUTRE_MER_HORS_FICHE.includes(pays)) return refus('pays_outre_mer')

  // 14. Le schéma de l'identifiant ; 15. l'identifiant (G2.19).
  const schema = saisie.schema_identifiant
  const dansLUnion = ETATS_MEMBRES_HORS_FRANCE.includes(pays)
  if (schema !== '0223' && schema !== '0227') return refus('schema_inconnu')
  if (schema === '0227' && dansLUnion) return refus('schema_nom_dans_l_union')
  if (schema === '0223' && !dansLUnion) return refus('schema_tva_hors_union')
  const identifiant = saisie.identifiant
  if (identifiant == null || blanc(identifiant)) return refus('identifiant_absent')
  if (schema === '0223' && (!NUMERO_TVA_UNION.test(identifiant) || identifiant.slice(0, 2) !== prefixeTva(pays))) {
    return refus('numero_tva_invalide', pays, prefixeTva(pays))
  }
  if (schema === '0227') {
    const n = caracteres(identifiant)
    if ([...identifiant].slice(0, 2).join('') !== pays || n < 3 || n > 18 || identifiant !== sansEspacesAuxBords(identifiant) || controle(identifiant)) {
      return refus('identifiant_hors_union_invalide', pays)
    }
  }

  // 16. La nature ; 17. l'autoliquidation, dite ; 18. une date de livraison ou une période (G1.38, G1.36, G6.20).
  const nature = saisie.nature
  if (nature == null || !(NATURES_ACHAT as readonly string[]).includes(nature)) return refus('nature')
  const autoliquidation = saisie.autoliquidation
  if (autoliquidation == null) return refus('autoliquidation_absente')
  const livraison = dateCivile(saisie.date_operation)
  const debut = dateCivile(saisie.periode_debut)
  const fin = dateCivile(saisie.periode_fin)
  if (livraison != null && (debut != null || fin != null)) return refus('livraison_et_periode')
  if ((debut == null) !== (fin == null) || (debut != null && fin != null && fin < debut)) return refus('periode_incomplete')
  if ([livraison, debut, fin].some((d) => d != null && (d < '2000-01-01' || d > '2099-12-31'))) return refus('dates_hors_bornes')

  // 19. La ventilation : chaque règle se juge sur toutes les lignes avant la suivante, et le refus nomme la PREMIÈRE
  // ligne fautive dans l'ordre de la saisie.
  const lignes = lignesLisibles(ventilationRecue(saisie.taux))
  if (lignes == null) return refus('ventilation_illisible')
  const repetee = lignes.find((l, i) => lignes.slice(0, i).some((d) => d.code === l.code && d.taux === l.taux))
  if (repetee) return refus('ligne_repetee', repetee.code, tauxCommeLaBase(repetee.taux))
  const inconnue = lignes.find((l) => !(CODES_TVA_HORS_DE_FRANCE as readonly string[]).includes(l.code))
  if (inconnue) return refus('code_inconnu', inconnue.code)
  if (lignes.some((l) => l.code === 'S')) return refus('ligne_au_taux_normal')
  const nonNulle = lignes.find((l) => l.taux !== 0 || l.tva !== 0)
  if (nonNulle) return refus('taux_ou_tva', nonNulle.code)
  if (lignes.some((l) => !(l.base > 0 && l.base < 10_000_000_000_000) || centimesExacts(l.base) == null)) return refus('base_invalide')
  if (lignes.some((l) => l.code === 'E' && (l.motif_code == null || l.motif_texte == null))) return refus('exoneration_sans_motif')
  if (lignes.some((l) => (l.motif_code != null && (caracteres(l.motif_code) > 30 || !MOTIF_VATEX.test(l.motif_code)))
    || (l.motif_texte != null && (caracteres(l.motif_texte) > 1024 || blanc(l.motif_texte))))) {
    return refus('motif_invalide')
  }
  if (lignes.some((l) => l.code === 'Z' && (l.motif_code != null || l.motif_texte != null))) return refus('motif_sur_taux_zero')
  if (schema === '0227' && lignes.some((l) => l.code === 'E')) return refus('exoneration_hors_union')
  if (!autoliquidation && lignes.some((l) => l.code === 'AE' || l.code === 'K')) return refus('autoliquidation_requise')
  if (autoliquidation && lignes.every((l) => l.code === 'E' || l.code === 'Z')) return refus('rien_a_autoliquider')
  // Toutes les TVA sont nulles ici : la somme est celle des bases, chacune au centime.
  const somme = lignes.reduce((total, l) => total + (centimesExacts(l.base) ?? 0), 0)
  const { depasse, ttcEcrit } = ecartAuTtc(somme, ttc)
  if (depasse) return refus('ventilation_hors_ttc', euroCommeLaBase(somme), piece.devise, ttcEcrit, piece.devise)

  // 20. La même facture — numéro, année, fournisseur — sur une autre pièce du dossier, dont la fiche courante n'est pas
  // retirée (G1.42, transposée à l'acheteur).
  const remplacees = new Set(contexte.fiches.map((f) => f.remplace_id).filter((id): id is string => id != null))
  const memeFacture = contexte.fiches.some((f) => f.piece_id !== piece.id && f.retire_le == null && !remplacees.has(f.id)
    && f.schema_identifiant === schema && f.identifiant.toUpperCase() === identifiant.toUpperCase()
    && f.numero.toUpperCase() === numero.toUpperCase() && anneeDe(f.date_facture) === anneeDe(date))
  if (memeFacture) return refus('facture_deja_decrite')
  return null
}

/**
 * POURQUOI CETTE FICHE NE SE RETIRE PAS, dit avant le clic — sauf l'accès et la fiche introuvable, que l'écran ne peut
 * pas dire : une autre l'a remplacée depuis la lecture ; elle est déjà retirée ; la validation fige sa pièce.
 */
export function refusRetraitFiche(
  fiche: Pick<PieceHorsDeFrance, 'id' | 'retire_le'>,
  fiches: readonly Pick<PieceHorsDeFrance, 'remplace_id'>[],
  anneeFigeante: number | null,
): RefusFiche<CleRefusRetraitFiche> | null {
  const dire = (cle: CleRefusRetraitFiche, ...valeurs: string[]): RefusFiche<CleRefusRetraitFiche> => ({
    cle, message: remplirModele(REFUS_RETRAIT_FICHE.find((r) => r.cle === cle)!.modele, valeurs),
  })
  if (fiches.some((f) => f.remplace_id === fiche.id)) return dire('remplacee')
  if (fiche.retire_le != null) return dire('deja_retiree')
  if (anneeFigeante != null) return dire('figee', String(anneeFigeante))
  return null
}
