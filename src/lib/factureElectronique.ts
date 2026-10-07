import { formatDate } from './format'

// LA LECTURE D'UNE FACTURE ÉLECTRONIQUE (ligne 28.5 de la feuille de route, étape b) : ce qu'une facture reçue de la
// plateforme agréée du client DIT d'elle-même, dans la syntaxe de la norme EN 16931 — CII (le XML de Factur-X, ou
// seul) et UBL. Rien n'y est deviné : une facture structurée porte son numéro, son type, sa date, sa devise, ses
// parties et ses totaux dans des champs nommés (les « BT » de la norme), et chacun se lit à SA place. Ce qui manque ou
// se contredit est dit (`anomalies`), jamais comblé — sauf une chose que la norme définit elle-même : sans total de
// TVA, la somme de sa ventilation par taux (règle BR-CO-14).
//
// Le module est pur : il ne connaît ni la base, ni le réseau, ni pdf.js — le XML d'un PDF Factur-X s'en extrait à
// part (voir lib/factureX.ts). Il ne lit QUE ce qu'on lui donne, avec l'analyseur XML du navigateur, et refuse d'abord
// ce qu'aucune facture ne porte : une DTD ou des entités. L'analyseur les développerait — mesuré sur celui des tests,
// qui remplace une entité interne par sa valeur sans rien dire —, et un document qui en déclare n'est pas une facture
// de la norme, quand il n'est pas une bombe à entités. La fonction serveur refuse déjà un original XML qui en porte ;
// le XML caché dans un PDF Factur-X, lui, n'est passé par aucun contrôle avant ce module.
//
// SON SIGNE EST CELUI DE SON TYPE. Une pièce d'avoir porte des montants négatifs dans l'application ; un avoir de la
// norme les porte POSITIFS, son type (BT-3) disant que c'est un avoir. Un type qu'on ne connaît pas ne laisse donc pas
// savoir dans quel sens compter : les montants restent vides, et la pièce le dit.

export const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  facture: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  avoir: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const

// Les types de document (BT-3) : ceux que la norme EN 16931 admet (règle BR-CL-01, liste UNTDID 1001), tels que les
// publient les artefacts de validation de la Commission européenne — en UBL, la liste des avoirs (CreditNoteTypeCode)
// et celle des factures (InvoiceTypeCode), où 81, un avoir, figure aussi : il compte en avoir. Sans la facture proforma
// (325), qui n'est pas une pièce comptable. Les types que la DGFiP admet (règle G1.01 de ses spécifications externes :
// 380 et 381, 384 rectificative, 386 d'acompte, 389 autofacture, 393 affacturée, 261 autofacture d'avoir, 396 avoir
// affacturé, 471 à 473 et 500 à 503 leurs combinaisons) y figurent tous. factureElectronique.test.ts épingle les deux.
export const TYPES_AVOIR = new Set(['81', '83', '261', '262', '296', '308', '381', '396', '420', '458', '502', '503', '532'])
export const TYPES_FACTURE = new Set([
  '71', '80', '82', '84', '102', '130', '202', '203', '204', '211', '218', '219', '295', '326', '331', '380', '382',
  '383', '384', '385', '386', '387', '388', '389', '390', '393', '394', '395', '456', '457', '471', '472', '473', '500',
  '501', '527', '553', '575', '623', '633', '751', '780', '817', '870', '875', '876', '877', '935',
])

// Bornes de ce qu'on retient d'un texte de la facture, et du nombre de lignes reprises dans le texte lu.
const MAX_TEXTE = 255
const MAX_LIGNES = 200

export type SyntaxeXml = 'CII' | 'UBL'

export interface PartieLue {
  /** Raison sociale (BT-27, BT-44), sinon nom commercial (BT-28, BT-45). */
  nom: string | null
  /** Le SIREN, tiré de l'identifiant légal (SIREN ou SIRET) ou, à défaut, du numéro de TVA français. */
  siren: string | null
  /** Le numéro de TVA intracommunautaire (BT-31, BT-48), tel qu'écrit. */
  tva: string | null
}

export interface TauxLu {
  /** La catégorie de TVA (BT-118) : S, Z, E, AE, K, G, O, L, M. */
  categorie: string | null
  /** Le taux, en pour cent (BT-119). */
  taux: number | null
  base: number | null
  tva: number | null
  /** Le motif d'exonération (BT-120) et son code (BT-121, VATEX). */
  motif: string | null
  codeMotif: string | null
}

export interface LigneLue {
  libelle: string | null
  /** Le montant net de la ligne (BT-131), dans la devise de la facture. */
  montant: number | null
}

export interface FactureLue {
  syntaxe: SyntaxeXml
  numero: string | null
  typeCode: string | null
  /** Ce que dit le type : une facture, un avoir, ou rien de connu. */
  nature: 'facture' | 'avoir' | null
  /** Date d'émission (BT-2), AAAA-MM-JJ. */
  date: string | null
  /** Date d'échéance (BT-9), AAAA-MM-JJ. */
  echeance: string | null
  /** La devise de la facture (BT-5), code ISO 4217. */
  devise: string | null
  vendeur: PartieLue
  acheteur: PartieLue
  // Les totaux TELS QUE LE DOCUMENT LES ÉCRIT, dans sa devise et avec son signe — avant celui de l'avoir.
  /** Total hors taxes (BT-109). */
  montantHt: number | null
  /** Total de la TVA dans la devise de la facture (BT-110), ou la somme de sa ventilation (BR-CO-14). */
  montantTva: number | null
  /** Total toutes taxes comprises (BT-112). */
  montantTtc: number | null
  /** Montant à payer (BT-115) : le TTC moins ce qui a déjà été payé. */
  netAPayer: number | null
  ventilation: TauxLu[]
  /** Les premières lignes de la facture ; `nbLignes` dit combien elle en porte. */
  lignes: LigneLue[]
  nbLignes: number
  /** Ce qui manque ou se contredit, en français : vide quand la facture se lit entière. */
  anomalies: string[]
}

export type LectureFacture = { facture: FactureLue } | { refus: string }

// ── Navigation ────────────────────────────────────────────────────────────────────────────────────────────────────
// Toujours par les ENFANTS DIRECTS, par espace de noms et nom local : un même nom (« Name », « ID ») revient à dix
// endroits d'une facture, et une recherche dans toute la descendance prendrait celui d'une ligne ou d'une adresse pour
// celui du vendeur. Le préfixe, lui, est libre : seul l'espace de noms désigne l'élément.

function enfants(el: Element | null, ns: string, nom: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === nom)
}

function enfant(el: Element | null, ns: string, nom: string): Element | null {
  return enfants(el, ns, nom)[0] ?? null
}

function chemin(el: Element | null, etapes: readonly (readonly [string, string])[]): Element | null {
  let courant = el
  for (const [ns, nom] of etapes) courant = enfant(courant, ns, nom)
  return courant
}

function texte(el: Element | null): string | null {
  if (!el) return null
  const net = (el.textContent ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  return net === '' ? null : net.slice(0, MAX_TEXTE)
}

function attribut(el: Element | null, nom: string): string | null {
  const v = el?.getAttribute(nom)?.trim() ?? ''
  return v === '' ? null : v
}

// ── Valeurs ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Un montant de la norme : un décimal XML, au plus deux décimales significatives pour un total (règles BR-DEC). Lu en
// CENTIMES ENTIERS, sans passer par un nombre à virgule flottante : « 0.29 » fois cent y vaudrait 28,999… Dans ces
// bornes, un arrondi au centime retrouverait le même entier ; la forme entière tient, elle, par construction.
// Dix chiffres avant la virgule au plus : les montants d'une pièce n'en tiennent pas davantage (numeric(12,2)), et
// l'enregistrement échouerait sur un montant qu'on aurait pourtant lu.
const DECIMAL = /^([+-])?(\d{1,10})(?:\.(\d+))?$/

function centimesDe(valeur: string | null): number | null | 'illisible' {
  if (valeur === null) return null
  const m = DECIMAL.exec(valeur.trim())
  if (!m) return 'illisible'
  const fraction = m[3] ?? ''
  if (/[1-9]/.test(fraction.slice(2))) return 'illisible'
  const centimes = Number(m[2]) * 100 + Number((fraction + '00').slice(0, 2))
  return m[1] === '-' && centimes !== 0 ? -centimes : centimes
}

function montant(el: Element | null, libelle: string, anomalies: string[]): number | null {
  const c = centimesDe(texte(el))
  if (c === 'illisible') {
    anomalies.push(`${libelle} illisible (plus de deux décimales, ou pas un nombre)`)
    return null
  }
  return c === null ? null : c / 100
}

/** Un taux de TVA en pour cent (« 20 », « 5.5 », « 20.00 »). */
function pourcentage(el: Element | null): number | null {
  const v = texte(el)
  if (v === null || !/^\d{1,3}(\.\d{1,4})?$/.test(v)) return null
  return Number(v)
}

function dateCivile(an: number, mois: number, jour: number): string | null {
  const d = new Date(Date.UTC(an, mois - 1, jour))
  if (d.getUTCFullYear() !== an || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null
  return `${String(an).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

// Une date CII : `udt:DateTimeString` au format 102 (AAAAMMJJ), le seul que la norme admette pour une date de facture.
// Sans attribut de format, huit chiffres ne peuvent être que celui-là ; un autre format (une période, une semaine) ne
// donne pas de jour.
function dateCii(el: Element | null): string | null {
  const dts = enfant(el, NS.udt, 'DateTimeString')
  const v = texte(dts)
  const format = attribut(dts, 'format')
  if (v === null || (format !== null && format !== '102')) return null
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  return m ? dateCivile(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

// Une date UBL : un `xs:date`, AAAA-MM-JJ, avec un fuseau facultatif qui ne change pas le jour écrit.
function dateUbl(el: Element | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:Z|[+-]\d{2}:\d{2})?$/.exec(texte(el) ?? '')
  return m ? dateCivile(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

// Le SIREN d'une partie : son identifiant légal quand c'est un SIREN (schéma 0002) ou un SIRET (0009) — sans schéma,
// neuf ou quatorze chiffres ne peuvent être que l'un ou l'autre —, sinon son numéro de TVA français (FR, la clé, puis
// le SIREN). Un identifiant d'un autre schéma (un GLN, un numéro étranger) ne dit rien du SIREN.
function sirenDe(idLegal: Element | null, tva: string | null): string | null {
  const v = (idLegal?.textContent ?? '').replace(/\s/g, '')
  const schema = attribut(idLegal, 'schemeID')
  if ((schema === null || schema === '0002') && /^\d{9}$/.test(v)) return v
  if ((schema === null || schema === '0009') && /^\d{14}$/.test(v)) return v.slice(0, 9)
  const m = /^FR[0-9A-Z]{2}(\d{9})$/.exec((tva ?? '').replace(/\s/g, '').toUpperCase())
  return m ? m[1] : null
}

/** Le SIREN d'un dossier, tiré de son SIRET (ou d'un SIREN saisi seul) ; nul quand on ne peut pas le savoir. */
export function sirenDuDossier(siret: string | null | undefined): string | null {
  const v = (siret ?? '').replace(/\s/g, '')
  if (/^\d{14}$/.test(v)) return v.slice(0, 9)
  if (/^\d{9}$/.test(v)) return v
  return null
}

// Le total de TVA dans la devise de la facture : quand la facture est en devise, elle peut porter AUSSI celui de la
// devise de comptabilisation (BT-111), sous le même nom — c'est l'attribut de devise qui les distingue. Un total seul et
// sans attribut est celui de la facture ; un total dans une autre devise seulement laisse celui de la facture ABSENT ;
// deux totaux qu'on ne sait pas départager sont ambigus, et aucun n'est pris.
function tvaDansLaDevise(candidats: Element[], devise: string | null): Element | null | 'ambigu' {
  const memeDevise = candidats.filter((c) => devise !== null && attribut(c, 'currencyID') === devise)
  if (memeDevise.length === 1) return memeDevise[0]
  if (memeDevise.length > 1) return 'ambigu'
  const sansDevise = candidats.filter((c) => attribut(c, 'currencyID') === null)
  if (sansDevise.length === 0) return null
  return candidats.length === 1 ? sansDevise[0] : 'ambigu'
}

// ── Lecture ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lit une facture électronique CII ou UBL. Refuse ce qui n'est pas un XML bien formé, sans DTD, dont la racine est une
 * facture ou un avoir de l'une des deux syntaxes ; tout le reste se lit champ par champ.
 */
export function lireFactureXml(xml: string): LectureFacture {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { refus: 'Ce XML déclare une DTD ou des entités : une facture électronique n’en porte pas, il n’est pas lu.' }
  }
  let document: Document
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return { refus: 'Ce fichier n’est pas un XML lisible.' }
  }
  if (document.getElementsByTagNameNS('*', 'parsererror').length > 0) {
    return { refus: 'Ce fichier n’est pas un XML bien formé.' }
  }
  const racine = document.documentElement
  if (racine.namespaceURI === NS.rsm && racine.localName === 'CrossIndustryInvoice') return { facture: lireCii(racine) }
  if (racine.namespaceURI === NS.facture && racine.localName === 'Invoice') return { facture: lireUbl(racine, false) }
  if (racine.namespaceURI === NS.avoir && racine.localName === 'CreditNote') return { facture: lireUbl(racine, true) }
  return { refus: 'Ce XML n’est ni une facture CII ni une facture UBL.' }
}

function natureDuType(code: string | null): FactureLue['nature'] {
  if (code !== null && TYPES_AVOIR.has(code)) return 'avoir'
  if (code !== null && TYPES_FACTURE.has(code)) return 'facture'
  return null
}

function lireCii(racine: Element): FactureLue {
  const { rsm, ram } = NS
  const anomalies: string[] = []
  const document = enfant(racine, rsm, 'ExchangedDocument')
  const transaction = enfant(racine, rsm, 'SupplyChainTradeTransaction')
  const accord = enfant(transaction, ram, 'ApplicableHeaderTradeAgreement')
  const reglement = enfant(transaction, ram, 'ApplicableHeaderTradeSettlement')
  const totaux = enfant(reglement, ram, 'SpecifiedTradeSettlementHeaderMonetarySummation')

  const typeCode = texte(enfant(document, ram, 'TypeCode'))
  const devise = deviseLue(texte(enfant(reglement, ram, 'InvoiceCurrencyCode')), anomalies)

  const partie = (p: Element | null): PartieLue => {
    const organisation = enfant(p, ram, 'SpecifiedLegalOrganization')
    const tva = enfants(p, ram, 'SpecifiedTaxRegistration')
      .map((r) => enfant(r, ram, 'ID'))
      .find((id) => attribut(id, 'schemeID') === 'VA') ?? null
    const numeroTva = texte(tva)
    return {
      nom: texte(enfant(p, ram, 'Name')) ?? texte(enfant(organisation, ram, 'TradingBusinessName')),
      siren: sirenDe(enfant(organisation, ram, 'ID'), numeroTva),
      tva: numeroTva,
    }
  }

  const ventilation = enfants(reglement, ram, 'ApplicableTradeTax').map((t): TauxLu => ({
    categorie: texte(enfant(t, ram, 'CategoryCode')),
    taux: pourcentage(enfant(t, ram, 'RateApplicablePercent')),
    base: montant(enfant(t, ram, 'BasisAmount'), 'Base d’un taux de TVA', anomalies),
    tva: montant(enfant(t, ram, 'CalculatedAmount'), 'TVA d’un taux', anomalies),
    motif: texte(enfant(t, ram, 'ExemptionReason')),
    codeMotif: texte(enfant(t, ram, 'ExemptionReasonCode')),
  }))

  const lignesXml = enfants(transaction, ram, 'IncludedSupplyChainTradeLineItem')
  const lignes = lignesXml.slice(0, MAX_LIGNES).map((l): LigneLue => ({
    libelle: texte(chemin(l, [[ram, 'SpecifiedTradeProduct'], [ram, 'Name']])),
    montant: montantLigne(chemin(l, [
      [ram, 'SpecifiedLineTradeSettlement'], [ram, 'SpecifiedTradeSettlementLineMonetarySummation'], [ram, 'LineTotalAmount'],
    ])),
  }))

  return completer({
    syntaxe: 'CII',
    numero: texte(enfant(document, ram, 'ID')),
    typeCode,
    nature: natureDuType(typeCode),
    date: dateCii(enfant(document, ram, 'IssueDateTime')),
    echeance: dateCii(chemin(reglement, [[ram, 'SpecifiedTradePaymentTerms'], [ram, 'DueDateDateTime']])),
    devise,
    vendeur: partie(enfant(accord, ram, 'SellerTradeParty')),
    acheteur: partie(enfant(accord, ram, 'BuyerTradeParty')),
    montantHt: montant(enfant(totaux, ram, 'TaxBasisTotalAmount'), 'Total hors taxes', anomalies),
    montantTva: tvaTotale(enfants(totaux, ram, 'TaxTotalAmount'), devise, anomalies),
    montantTtc: montant(enfant(totaux, ram, 'GrandTotalAmount'), 'Total TTC', anomalies),
    netAPayer: montant(enfant(totaux, ram, 'DuePayableAmount'), 'Net à payer', anomalies),
    ventilation,
    lignes,
    nbLignes: lignesXml.length,
    anomalies,
  })
}

function lireUbl(racine: Element, avoir: boolean): FactureLue {
  const { cac, cbc } = NS
  const anomalies: string[] = []
  const typeCode = texte(enfant(racine, cbc, avoir ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'))
  const devise = deviseLue(texte(enfant(racine, cbc, 'DocumentCurrencyCode')), anomalies)

  const partie = (p: Element | null): PartieLue => {
    const legal = enfant(p, cac, 'PartyLegalEntity')
    const tva = enfants(p, cac, 'PartyTaxScheme')
      .find((s) => texte(chemin(s, [[cac, 'TaxScheme'], [cbc, 'ID']])) === 'VAT') ?? null
    const numeroTva = texte(enfant(tva, cbc, 'CompanyID'))
    return {
      nom: texte(enfant(legal, cbc, 'RegistrationName')) ?? texte(chemin(p, [[cac, 'PartyName'], [cbc, 'Name']])),
      siren: sirenDe(enfant(legal, cbc, 'CompanyID'), numeroTva),
      tva: numeroTva,
    }
  }

  // Le total de TVA et sa ventilation vivent dans le `TaxTotal` de la devise de la facture — un second, sans
  // ventilation, peut porter la TVA dans la devise de comptabilisation (BT-111).
  const totauxTva = enfants(racine, cac, 'TaxTotal')
  const totalTva = tvaDansLaDevise(
    totauxTva.map((t) => enfant(t, cbc, 'TaxAmount')).filter((e): e is Element => e !== null), devise)
  const blocVentile = totauxTva.find((t) => {
    if (enfants(t, cac, 'TaxSubtotal').length === 0) return false
    const devisePortee = attribut(enfant(t, cbc, 'TaxAmount'), 'currencyID')
    return devisePortee === null || devisePortee === devise
  }) ?? null
  const ventilation = enfants(blocVentile, cac, 'TaxSubtotal').map((s): TauxLu => {
    const categorie = enfant(s, cac, 'TaxCategory')
    return {
      categorie: texte(enfant(categorie, cbc, 'ID')),
      taux: pourcentage(enfant(categorie, cbc, 'Percent')),
      base: montant(enfant(s, cbc, 'TaxableAmount'), 'Base d’un taux de TVA', anomalies),
      tva: montant(enfant(s, cbc, 'TaxAmount'), 'TVA d’un taux', anomalies),
      motif: texte(enfant(categorie, cbc, 'TaxExemptionReason')),
      codeMotif: texte(enfant(categorie, cbc, 'TaxExemptionReasonCode')),
    }
  })

  const lignesXml = enfants(racine, cac, avoir ? 'CreditNoteLine' : 'InvoiceLine')
  const lignes = lignesXml.slice(0, MAX_LIGNES).map((l): LigneLue => ({
    libelle: texte(chemin(l, [[cac, 'Item'], [cbc, 'Name']])),
    montant: montantLigne(enfant(l, cbc, 'LineExtensionAmount')),
  }))

  const totaux = enfant(racine, cac, 'LegalMonetaryTotal')
  return completer({
    syntaxe: 'UBL',
    numero: texte(enfant(racine, cbc, 'ID')),
    typeCode,
    // La racine d'un avoir UBL dit ce qu'il est ; son code ne fait que préciser lequel.
    nature: avoir ? 'avoir' : natureDuType(typeCode),
    date: dateUbl(enfant(racine, cbc, 'IssueDate')),
    echeance: dateUbl(enfant(racine, cbc, 'DueDate')) ??
      dateUbl(chemin(racine, [[cac, 'PaymentMeans'], [cbc, 'PaymentDueDate']])),
    devise,
    vendeur: partie(chemin(racine, [[cac, 'AccountingSupplierParty'], [cac, 'Party']])),
    acheteur: partie(chemin(racine, [[cac, 'AccountingCustomerParty'], [cac, 'Party']])),
    montantHt: montant(enfant(totaux, cbc, 'TaxExclusiveAmount'), 'Total hors taxes', anomalies),
    montantTva: totalTva === 'ambigu' ? ambigu(anomalies) : montant(totalTva, 'Total de la TVA', anomalies),
    montantTtc: montant(enfant(totaux, cbc, 'TaxInclusiveAmount'), 'Total TTC', anomalies),
    netAPayer: montant(enfant(totaux, cbc, 'PayableAmount'), 'Net à payer', anomalies),
    ventilation,
    lignes,
    nbLignes: lignesXml.length,
    anomalies,
  })
}

function deviseLue(code: string | null, anomalies: string[]): string | null {
  if (code !== null && /^[A-Z]{3}$/.test(code)) return code
  anomalies.push(code === null ? 'Devise de la facture absente' : 'Devise de la facture illisible')
  return null
}

function tvaTotale(candidats: Element[], devise: string | null, anomalies: string[]): number | null {
  const choisi = tvaDansLaDevise(candidats, devise)
  if (choisi === 'ambigu') return ambigu(anomalies)
  return montant(choisi, 'Total de la TVA', anomalies)
}

const TVA_AMBIGUE = 'Total de la TVA ambigu : plusieurs totaux pour la devise de la facture'

function ambigu(anomalies: string[]): null {
  anomalies.push(TVA_AMBIGUE)
  return null
}

// Le montant d'une ligne n'est qu'un repère du texte lu : illisible, il manque à la ligne sans rien dire de la facture.
function montantLigne(el: Element | null): number | null {
  const c = centimesDe(texte(el))
  return typeof c === 'number' ? c / 100 : null
}

// Ce qui se vérifie une fois tout lu : chaque champ dont une pièce a besoin, et les deux égalités que la norme pose entre
// les totaux. Sans total de TVA, la norme le définit elle-même : la somme de sa ventilation par taux (BR-CO-14), sinon
// le TTC moins le hors taxes (BR-CO-15) — une déduction, et elle se dit.
function completer(f: FactureLue): FactureLue {
  const anomalies = f.anomalies
  const centimes = (n: number) => Math.round(n * 100)
  let montantTva = f.montantTva
  if (montantTva === null) {
    const tvaVentilees = f.ventilation.map((t) => t.tva)
    if (tvaVentilees.length > 0 && tvaVentilees.every((t): t is number => t !== null)) {
      montantTva = tvaVentilees.reduce((somme, t) => somme + centimes(t), 0) / 100
    } else if (f.montantHt !== null && f.montantTtc !== null) {
      montantTva = (centimes(f.montantTtc) - centimes(f.montantHt)) / 100
      anomalies.push(anomalies.includes(TVA_AMBIGUE)
        ? 'Total de la TVA déduit du TTC moins le hors taxes'
        : 'Total de la TVA absent : déduit du TTC moins le hors taxes')
    }
  }
  if (f.numero === null) anomalies.push('Numéro de facture absent')
  if (f.typeCode === null) anomalies.push('Type de document absent')
  else if (f.nature === null) anomalies.push(`Type de document inconnu (code ${f.typeCode}) : le sens de ses montants n’est pas connu`)
  if (f.date === null) anomalies.push('Date d’émission absente ou illisible')
  if (f.montantTtc === null) anomalies.push('Total TTC absent')
  if (f.montantHt !== null && montantTva !== null && f.montantTtc !== null &&
    centimes(f.montantHt) + centimes(montantTva) !== centimes(f.montantTtc)) {
    anomalies.push('Le total TTC ne vaut pas le hors taxes plus la TVA')
  }
  return { ...f, montantTva, anomalies }
}

// ── Ce que la pièce en reçoit ────────────────────────────────────────────────────────────────────────────────────

export interface MontantsDeLaFacture {
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  /** La devise écrite par la facture ; nulle quand elle n'est pas lisible. */
  devise: string | null
}

const negatif = (n: number | null): number | null => (n === null || n === 0 ? n : -n)

/**
 * Les montants de la pièce, avec le signe de l'application : négatifs pour un avoir. Vides quand on ne peut pas savoir
 * dans quel sens compter (type inconnu) ni dans quelle monnaie (devise illisible) : une pièce sans montant se voit et
 * se complète, un montant compté à l'envers part en déduction.
 */
export function montantsDeLaFacture(f: FactureLue): MontantsDeLaFacture {
  if (f.nature === null || f.devise === null) {
    return { montant_ht: null, montant_tva: null, montant_ttc: null, devise: f.devise }
  }
  const signe = f.nature === 'avoir' ? negatif : (n: number | null) => n
  return { montant_ht: signe(f.montantHt), montant_tva: signe(f.montantTva), montant_ttc: signe(f.montantTtc), devise: f.devise }
}

/** Le tiers de la pièce : le vendeur d'un achat, l'acheteur d'une vente — comme une pièce saisie. */
export function tiersDeLaFacture(f: FactureLue, sens: 'achat' | 'vente'): string | null {
  return sens === 'achat' ? f.vendeur.nom : f.acheteur.nom
}

export type Concordance = { etat: 'concorde' } | { etat: 'inconnue' } | { etat: 'autre'; siren: string }

/**
 * La facture désigne-t-elle bien le dossier ? Un achat doit l'avoir pour acheteur, une vente pour vendeur. Une
 * identité ouverte au cabinet peut servir plusieurs entreprises : sans cette vérification, une organisation mal
 * configurée ferait entrer les factures d'un client dans le dossier d'un autre. « Inconnue » quand l'un des deux
 * SIREN manque : rien ne prouve alors une erreur.
 */
export function concordanceAvecLeDossier(f: FactureLue, sens: 'achat' | 'vente', sirenDossier: string | null): Concordance {
  const partie = sens === 'achat' ? f.acheteur : f.vendeur
  if (sirenDossier === null || partie.siren === null) return { etat: 'inconnue' }
  return partie.siren === sirenDossier ? { etat: 'concorde' } : { etat: 'autre', siren: partie.siren }
}

/** Haute quand la facture se lit entière, moyenne quand quelque chose y manque ou s'y contredit. */
export function confianceDeLaFacture(f: FactureLue): 'haute' | 'moyenne' {
  return f.anomalies.length === 0 ? 'haute' : 'moyenne'
}

// Un montant écrit à la française, avec sa devise : l'écriture est faite ici plutôt que par `toLocaleString`, dont le
// séparateur de milliers change d'un moteur à l'autre — et le texte lu d'une même facture doit être le même partout,
// c'est son empreinte qui repère un doublon de contenu.
export function montantEnTexte(n: number, devise: string | null): string {
  const centimes = Math.round(Math.abs(n) * 100)
  const entier = String(Math.floor(centimes / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const decimales = String(centimes % 100).padStart(2, '0')
  return `${n < 0 && centimes !== 0 ? '-' : ''}${entier},${decimales}${devise ? ` ${devise}` : ''}`
}

const LIBELLE_NATURE: Record<'facture' | 'avoir', string> = { facture: 'facture', avoir: 'avoir' }

function partieEnTexte(p: PartieLue): string {
  return [p.nom ?? '(nom absent)', p.siren ? `SIREN ${p.siren}` : null, p.tva ? `TVA ${p.tva}` : null]
    .filter((x): x is string => x !== null).join(' — ')
}

/**
 * Le texte lu d'une facture électronique : ce qu'elle dit, en clair, pour la relire à l'arbitrage et la retrouver par
 * la recherche — à la place du texte qu'un OCR aurait lu sur un document déposé.
 */
export function texteDeLaFacture(f: FactureLue, sens: 'achat' | 'vente'): string {
  const d = f.devise
  const m = (n: number | null) => (n === null ? '—' : montantEnTexte(n, d))
  const lignes: string[] = [
    `${sens === 'achat' ? 'Facture reçue' : 'Facture émise'} par la plateforme agréée (${f.syntaxe})`,
    `Numéro : ${f.numero ?? '—'}`,
    `Type : ${f.nature ? LIBELLE_NATURE[f.nature] : 'inconnu'}${f.typeCode ? ` (code ${f.typeCode})` : ''}`,
    `Date : ${f.date ? formatDate(f.date) : '—'}`,
  ]
  if (f.echeance) lignes.push(`Échéance : ${formatDate(f.echeance)}`)
  lignes.push(
    `Vendeur : ${partieEnTexte(f.vendeur)}`,
    `Acheteur : ${partieEnTexte(f.acheteur)}`,
    `Devise : ${d ?? '—'}`,
    `Total hors taxes : ${m(f.montantHt)}`,
    `TVA : ${m(f.montantTva)}`,
    `Total TTC : ${m(f.montantTtc)}`,
  )
  if (f.netAPayer !== null) lignes.push(`Net à payer : ${m(f.netAPayer)}`)
  if (f.ventilation.length > 0) {
    lignes.push('', 'TVA par taux :')
    for (const t of f.ventilation) {
      const motif = [t.codeMotif, t.motif].filter((x): x is string => x !== null).join(' ')
      lignes.push(`  ${t.categorie ?? '?'} ${t.taux === null ? '?' : `${String(t.taux).replace('.', ',')} %`} : ` +
        `base ${m(t.base)}, TVA ${m(t.tva)}${motif ? ` — exonération : ${motif}` : ''}`)
    }
  }
  if (f.lignes.length > 0) {
    lignes.push('', 'Lignes :')
    for (const l of f.lignes) lignes.push(`  - ${l.libelle ?? '(sans libellé)'} : ${m(l.montant)} HT`)
    if (f.nbLignes > f.lignes.length) lignes.push(`  … et ${f.nbLignes - f.lignes.length} autre(s) ligne(s)`)
  }
  if (f.anomalies.length > 0) {
    lignes.push('', 'À vérifier :')
    for (const a of f.anomalies) lignes.push(`  - ${a}`)
  }
  return lignes.join('\n')
}
