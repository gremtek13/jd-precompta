// LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE (ligne 28.5, étape e7a ; la réponse du cabinet à 28.5e-Q8, le 31/10/2026 :
// « oui »). Le pays où le client est établi, son numéro de TVA et le régime de l'opération : trois colonnes de
// `factures_emises`, saisies sur le brouillon et figées avec la validation (migration `facture_internationale`, PRÉPARÉE,
// PAS APPLIQUÉE : supabase/preparees/20261107120000_facture_internationale.sql). Ce module redit, avant le clic et sous les
// mots de la base, les refus que la garde des factures oppose à la validation (le bloc « E7A » de `garder_factures_validees`),
// et tire du régime — une VALEUR figée, jamais un texte de l'appelant (la règle d'A7a) — la mention que la facture imprime,
// la catégorie de TVA et le motif VATEX du CII, et la catégorie de l'e-reporting. Son test le confronte au texte de la
// migration et rejoue les cas de son essai (supabase/essais/factureInternationale.sql). Le récit : HISTORIQUE.md, « LA
// FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, EN BASE (E7A, LIGNE 28.5) (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// Les sources : CGI, art. 259, 1°, 259 A, 259 B, 262, I, 262 ter, I, 286 ter, et ann. II, art. 242 nonies A, I, 3°, 4° et 13° ;
// BOI-TVA-DECLA-30-20-20-30, § 50 à § 105 ; directive 2006/112/CE, art. 44 et 196 ; norme EN 16931-1 (catégories AE, K, G, O,
// E, S ; règle BR-CO-09 ; liste VATEX) ; DGFiP, spécifications externes v3.2, annexe 7 (G1.68). Aucune norme AFNOR.
//
// La relecture adverse du 07/11/2026 : une livraison intracommunautaire ne se facture pas d'un dossier en franchise en
// base — la franchise exclut l'exonération de l'art. 262 ter, I (directive 2006/112/CE, art. 139, 1, premier alinéa), et
// l'acheteur d'un franchisé n'a pas d'acquisition à déclarer (art. 2, 1, b), i)) : sa vente est une opération taxable en
// France, sous la mention de la franchise. L'avoir se juge comme sa facture, dont il reprend tout ce que les refus lisent
// hors de ses lignes et de sa TVA : seule une ligne taxée le refuse.
//
// LIMITE CONNUE (E7A-Q4, au cabinet) : l'Union se lit au code ISO du pays (`ETATS_MEMBRES`). Un territoire d'un État
// membre exclu du territoire de la TVA de l'Union (directive 2006/112/CE, art. 6 : les îles Canaries, Ceuta, Melilla, le
// mont Athos, Heligoland, Büsingen, Livigno…) se lit comme son État ; l'Irlande du Nord (GB), qui suit les règles de
// l'Union pour les biens sous un numéro préfixé XI, se lit hors de l'Union. Aucune liste n'en est écrite ici sans le
// cabinet.
import type { NatureOperation, RegimeInternational, StatutTva, TypeClient } from './types'

// Baissé tant que la migration n'est pas en base : l'écran (e7b) n'envoie ni ne lit les trois colonnes avant elle.
export const FACTURE_INTERNATIONALE_EXPORTEE: boolean = false

export const REGIMES_INTERNATIONAUX: readonly RegimeInternational[] = [
  'autoliquidation_ue', 'prestation_hors_ue', 'livraison_intracommunautaire', 'exportation', 'taxable_en_france', 'hors_champ',
]

// Les 249 codes attribués de l'ISO 3166-1 alpha-2 et les vingt-six autres États membres de l'Union : les listes de la
// garde, qui sont celles de la fiche d'un achat hors de France (migration `pieces_hors_de_france`).
export const PAYS_ATTRIBUES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD '
  + 'CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE '
  + 'GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI '
  + 'KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX '
  + 'MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD '
  + 'SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ '
  + 'VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ')
// L'Union au code du pays seulement : la limite connue de l'en-tête (E7A-Q4).
export const ETATS_MEMBRES: readonly string[] = (
  'AT BE BG CY CZ DE DK EE ES FI GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK').split(' ')
// Ce qui n'est pas un pays étranger : la France, Monaco (du territoire de la TVA française) et l'outre-mer français.
export const PAYS_QUI_NE_SONT_PAS_ETRANGERS: readonly string[] = (
  'FR MC GP MQ RE GF YT PM BL MF WF PF NC TF').split(' ')

// Les trois contraintes de FORME de la migration, que la base oppose en 23514 sans mots : l'écran les dit ici.
export const FORME_DU_PAYS = /^[A-Z]{2}$/
export const FORME_DU_NUMERO_DE_TVA = /^[A-Z]{2}[0-9A-Z+*]{2,18}$/

// Le régime tel que les refus le nomment (la variable `v_regime_lu` de la garde).
export const LIBELLES_DES_REGIMES: Record<RegimeInternational, string> = {
  autoliquidation_ue: 'une autoliquidation par le client',
  prestation_hors_ue: "une prestation hors de l'Union",
  livraison_intracommunautaire: 'une livraison intracommunautaire',
  exportation: 'une exportation',
  taxable_en_france: 'une opération taxable en France',
  hors_champ: 'une prestation hors champ (art. 259 B du CGI)',
}

// La mention de TVA que la facture imprime, tirée du régime ; nulle pour une opération taxable en France, qui imprime
// celle du dossier (lib/statutTva.ts, `mentionTva`), comme une facture en France. « Autoliquidation » : CGI, ann. II, art.
// 242 nonies A, I, 13° (BOI-TVA-DECLA-30-20-20-30, § 105) ; la livraison intracommunautaire : la mention de l'exonération
// (même BOFiP, § 70 : « ou toute autre mention équivalente ») ; la prestation hors de l'Union et le hors champ : la loi
// n'en prescrit aucune, la facture dit pourquoi elle ne porte pas de TVA (E7A-Q3).
export const MENTIONS_DES_REGIMES: Record<RegimeInternational, string | null> = {
  autoliquidation_ue: 'Autoliquidation (art. 196 de la directive 2006/112/CE).',
  prestation_hors_ue: 'TVA non applicable, art. 259, 1° du CGI.',
  livraison_intracommunautaire: 'Exonération de TVA, art. 262 ter, I du CGI.',
  exportation: 'Exonération de TVA, art. 262, I du CGI.',
  taxable_en_france: null,
  hors_champ: 'TVA non applicable, art. 259 B du CGI.',
}

export function mentionDuRegime(regime: RegimeInternational | null): string | null {
  return regime == null ? null : MENTIONS_DES_REGIMES[regime]
}

// Une opération que la TVA française ne taxe pas : ni sa TVA, ni la mention de TVA du dossier.
export function horsDeLaTvaFrancaise(regime: RegimeInternational | null): boolean {
  return regime != null && regime !== 'taxable_en_france'
}

// La mention de TVA du dossier (la franchise, l'article d'exonération) ne s'exige que d'une opération que la TVA
// française taxe : une facture en France, ou au régime « opération taxable en France ».
export function mentionDuDossierExigee(regime: RegimeInternational | null): boolean {
  return !horsDeLaTvaFrancaise(regime)
}

// Le préfixe du numéro de TVA d'un pays (norme EN 16931, BR-CO-09 : le code ISO 3166-1, sauf la Grèce, EL).
export function prefixeDuNumeroDeTva(pays: string): string {
  return pays === 'GR' ? 'EL' : pays
}

const UNION_EXIGEE: readonly RegimeInternational[] = ['autoliquidation_ue', 'livraison_intracommunautaire']
const UNION_EXCLUE: readonly RegimeInternational[] = ['prestation_hors_ue', 'exportation', 'hors_champ']
const A_UNE_ENTREPRISE: readonly RegimeInternational[] = ['autoliquidation_ue', 'prestation_hors_ue', 'livraison_intracommunautaire']
const DE_BIENS: readonly RegimeInternational[] = ['livraison_intracommunautaire', 'exportation']
const DE_SERVICES: readonly RegimeInternational[] = ['autoliquidation_ue', 'prestation_hors_ue', 'hors_champ']

// LES SEIZE REFUS DU BLOC « E7A » DE LA GARDE, dans son ordre et sous ses mots ; « % » y tient la place de chaque valeur,
// comme dans la base. Le test les confronte au texte de la migration. Le septième, la livraison intracommunautaire d'un
// franchisé, renvoie au régime d'une opération taxable en France et à la mention de la franchise (lib/statutTva.ts,
// `MENTION_FRANCHISE`) ; le quinzième, le numéro du vendeur, ne dit la franchise que d'une autoliquidation.
export const REFUS_DE_LA_FACTURE_INTERNATIONALE: readonly string[] = [
  "Le pays où le client est établi manque : le régime de l'opération et le numéro de TVA du client se portent avec lui.",
  "Le pays du client, « % », n'est pas un code de pays attribué (ISO 3166-1, deux lettres).",
  "Le client est établi hors de France (%) : la facture dit le régime de l'opération, d'où vient la mention de TVA qu'elle imprime.",
  'Un client établi hors de France est une entreprise établie hors de France ou un particulier : la facture le dit par le type de son client.',
  "Le hors champ de l'art. 259 B du CGI ne vise qu'un client non assujetti : une entreprise établie hors de l'Union reçoit une prestation hors de l'Union (art. 259, 1° du CGI).",
  "La facture porte %, qui ne se facture qu'à une entreprise (un assujetti), jamais à un particulier.",
  "La facture porte une livraison intracommunautaire, que la franchise en base exclut : un dossier en franchise ne bénéficie pas de l'exonération de l'art. 262 ter, I du CGI (directive 2006/112/CE, art. 139, 1, premier alinéa), et son client n'a aucune acquisition intracommunautaire à déclarer. Elle porte le régime d'une opération taxable en France, sous la mention de la franchise, « TVA non applicable, art. 293 B du CGI. ».",
  "La facture porte %, qui vise un client établi dans un autre État membre de l'Union : « % » n'en est pas un.",
  "La facture porte %, qui vise un client établi hors de l'Union : « % » en est un État membre.",
  'La facture porte %, une livraison de biens : sa nature est « biens ».',
  'La facture porte %, une prestation de services : sa nature est « services ».',
  'La facture porte %, qui exige le numéro de TVA du client (CGI, ann. II, art. 242 nonies A, I, 3° et 4°).',
  'Le numéro de TVA du client, « % », commence par le code de son pays, « % » (norme EN 16931, règle BR-CO-09).',
  "Le numéro de TVA d'un client de l'Union tient en deux lettres suivies de deux à douze chiffres ou lettres : « % » n'en a pas la forme.",
  "La facture porte %, qui exige le numéro de TVA du vendeur (CGI, ann. II, art. 242 nonies A, I, 3° et 4°) : ce dossier n'en imprime aucun. %, le cabinet coche le numéro attribué (CGI, art. 286 ter) ; un statut de TVA à préciser se précise.",
  'La facture porte %, que la TVA française ne taxe pas : chaque ligne est au taux 0.',
]
// Le refus qui suit la mention de TVA du dossier, d'une facture comme d'un avoir.
export const REFUS_DE_LA_MENTION_DU_DOSSIER =
  'Les mentions légales portent « % », la mention de TVA du dossier : elle ne vaut que pour une opération que la TVA française taxe, et la facture porte %, qui imprime la sienne.'

function dire(gabarit: string, ...valeurs: string[]): string {
  let i = 0
  return gabarit.replace(/%/g, () => valeurs[i++] ?? '%')
}

// Une facture, ou l'avoir qui reprend d'elle les trois colonnes, le type du client, la nature, et ce qu'elle a figé : le
// statut de TVA et le numéro du vendeur.
export interface SaisieInternationale {
  typeClient: TypeClient | null
  pays: string | null
  numeroTva: string | null
  regime: RegimeInternational | null
  nature: NatureOperation | null
  // Le statut de TVA que la validation figera (`statut_tva` : celui du dossier ; pour un avoir, celui de sa facture), nul
  // pour un statut à préciser. La franchise refuse la livraison intracommunautaire.
  statutTva: StatutTva | null
  // Le numéro de TVA que la validation figera (`numero_tva_imprime` : celui du dossier, nul en franchise ou exonéré sans
  // numéro attribué, pour un statut à préciser, ou sur un SIRET illisible ; pour un avoir, celui de sa facture).
  numeroTvaDuVendeur: string | null
  montantTva: number
  tauxDesLignes: readonly number[]
}

/** Le premier refus de la garde à la validation de cette facture ou de cet avoir, sous ses mots ; nul quand il passe. Un
 * avoir se juge comme sa facture : il passe où elle a passé, et seule une ligne taxée le refuse. Une facture ou un avoir
 * qui ne porte aucune des trois colonnes n'en est pas jugé : il se valide comme hier. */
export function refusDeLaFactureInternationale(s: SaisieInternationale): string | null {
  const { pays, numeroTva: numero, regime } = s
  if (pays == null && numero == null && regime == null) return null
  const R = REFUS_DE_LA_FACTURE_INTERNATIONALE
  if (pays == null) return R[0]
  if (!PAYS_ATTRIBUES.includes(pays)) return dire(R[1], pays)
  if (regime == null) return dire(R[2], pays)
  if (s.typeClient !== 'etranger' && s.typeClient !== 'non_assujetti') return R[3]
  if (s.typeClient === 'etranger' && regime === 'hors_champ') return R[4]
  const lu = LIBELLES_DES_REGIMES[regime]
  if (s.typeClient === 'non_assujetti' && A_UNE_ENTREPRISE.includes(regime)) return dire(R[5], lu)
  if (regime === 'livraison_intracommunautaire' && s.statutTva === 'franchise') return R[6]
  const dansLUnion = ETATS_MEMBRES.includes(pays)
  if (UNION_EXIGEE.includes(regime) && !dansLUnion) return dire(R[7], lu, pays)
  if (UNION_EXCLUE.includes(regime) && dansLUnion) return dire(R[8], lu, pays)
  if (DE_BIENS.includes(regime) && s.nature !== 'biens') return dire(R[9], lu)
  if (DE_SERVICES.includes(regime) && s.nature !== 'services') return dire(R[10], lu)
  if (UNION_EXIGEE.includes(regime) && numero == null) return dire(R[11], lu)
  const prefixe = prefixeDuNumeroDeTva(pays)
  if (numero != null && numero.slice(0, 2) !== prefixe) return dire(R[12], numero, prefixe)
  if (numero != null && dansLUnion && numero.length > 14) return dire(R[13], numero)
  // Un franchisé n'arrive ici que d'une autoliquidation : sa livraison intracommunautaire s'est refusée plus haut.
  if (UNION_EXIGEE.includes(regime) && s.numeroTvaDuVendeur == null) {
    return dire(R[14], lu, regime === 'autoliquidation_ue' ? 'En franchise ou exonéré' : 'Exonéré')
  }
  if (horsDeLaTvaFrancaise(regime) && (s.montantTva !== 0 || s.tauxDesLignes.some((t) => t !== 0))) return dire(R[15], lu)
  return null
}

/** Le refus qui suit, pour une facture comme pour un avoir : une opération que la TVA française ne taxe pas ne porte pas
 * la mention de TVA du dossier, qui en dirait une autre raison. Nul quand elle passe. */
export function refusDeLaMentionDuDossier(
  regime: RegimeInternational | null, mentionDuDossier: string | null, mentionsLegales: string | null,
): string | null {
  if (mentionDuDossier == null || !horsDeLaTvaFrancaise(regime) || !(mentionsLegales ?? '').includes(mentionDuDossier)) return null
  return dire(REFUS_DE_LA_MENTION_DU_DOSSIER, mentionDuDossier, LIBELLES_DES_REGIMES[regime as RegimeInternational])
}

/** Ce que les contraintes de forme refuseraient (23514, sans mots), dit avant l'écriture du brouillon. Nul : rien. */
export function refusDeLaForme(pays: string | null, numeroTva: string | null): string | null {
  if (pays != null && (!FORME_DU_PAYS.test(pays) || PAYS_QUI_NE_SONT_PAS_ETRANGERS.includes(pays))) {
    return "Le pays du client s'écrit en deux capitales (ISO 3166-1), hors de la France, de Monaco et de l'outre-mer."
  }
  if (numeroTva != null && !FORME_DU_NUMERO_DE_TVA.test(numeroTva)) {
    return "Le numéro de TVA du client s'écrit sans blanc ni ponctuation : deux capitales, puis deux à dix-huit chiffres ou capitales."
  }
  return null
}

// LE CII (norme EN 16931) : la catégorie de TVA de chaque ligne (BT-151) et le motif de l'exonération (BT-120, BT-121,
// liste VATEX) que le régime impose ; nul pour une opération taxable en France, dont chaque ligne garde sa catégorie (S, ou
// E et le motif du dossier : lib/statutTva.ts, `motifExoneration`). Le CII d'une facture à un client établi hors de France
// ne part pas aujourd'hui (lib/factureCii.ts) : c'est l'étape e7c qui le lira, pour l'e-reporting.
export interface CategorieDuRegime {
  categorie: 'AE' | 'O' | 'K' | 'G'
  vatex: string
  texte: string
}

export function categorieTvaDuRegime(regime: RegimeInternational | null): CategorieDuRegime | null {
  const texte = mentionDuRegime(regime)
  switch (regime) {
    case 'autoliquidation_ue': return { categorie: 'AE', vatex: 'VATEX-EU-AE', texte: texte as string }
    case 'livraison_intracommunautaire': return { categorie: 'K', vatex: 'VATEX-EU-IC', texte: texte as string }
    case 'exportation': return { categorie: 'G', vatex: 'VATEX-EU-G', texte: texte as string }
    case 'prestation_hors_ue':
    case 'hors_champ': return { categorie: 'O', vatex: 'VATEX-EU-O', texte: texte as string }
    default: return null
  }
}

// L'E-REPORTING : une vente à une entreprise établie hors de France se déclare facture par facture (bloc 10.1, rôle
// vendeur), sous la catégorie de TVA du régime (nulle : celle de chaque ligne) ; une vente à un particulier, agrégée par
// jour (bloc 10.3), sous TNT1 pour une opération non située en France (règle G1.68), TLB1 ou TPS1 pour une opération
// taxable en France selon sa nature. L'exportation à un particulier n'a pas de catégorie établie : nulle, à confirmer.
export type CategorieEreporting =
  | { bloc: '10.1'; categorieTva: CategorieDuRegime['categorie'] | null }
  | { bloc: '10.3'; categorie: 'TNT1' | 'TLB1' | 'TPS1' | null }

export function categorieEreporting(
  regime: RegimeInternational | null, typeClient: TypeClient | null, nature: NatureOperation | null,
): CategorieEreporting | null {
  if (regime == null) return null
  if (typeClient === 'etranger') return { bloc: '10.1', categorieTva: categorieTvaDuRegime(regime)?.categorie ?? null }
  if (typeClient !== 'non_assujetti') return null
  if (regime === 'hors_champ') return { bloc: '10.3', categorie: 'TNT1' }
  if (regime === 'taxable_en_france') {
    return { bloc: '10.3', categorie: nature === 'biens' ? 'TLB1' : nature === 'services' ? 'TPS1' : null }
  }
  return { bloc: '10.3', categorie: null }
}
