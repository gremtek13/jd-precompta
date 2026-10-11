// @vitest-environment jsdom
// Le fichier d'une déclaration d'e-reporting (fluxEreporting.ts). Les déclarations sont FICTIVES (src/test/fluxEreporting.ts),
// calculées par e4 et figées comme e5b1 les fige.
//
// CHAQUE DONNÉE DU FICHIER EST CONFRONTÉE À LA SOURCE QUI LA FONDE : son chemin tel que l'annexe 6 des spécifications
// externes de la DGFiP l'écrit (v1.10 du 30/04/2026, onglet « E-REPORTING - Flux 10 », colonne « Path »), recopié ici,
// et la règle de l'annexe 7 (v1.9, onglet « Règles de gestion ») qui la régit, citée dans le nom du test. LA FORME EST
// JUGÉE PAR L'INSTRUMENT : chaque exemple figé dans outils/facturation/ereporting/exemples/ a passé le schéma XSD du
// flux 10 de l'archive officielle v3.2 (outils/facturation/ereporting/valider.mjs, qui écrit valides.json), et le
// dernier test refuse un exemple dont l'empreinte n'y figure pas. CE QUE LE SCHÉMA LAISSE PASSER ET QUE LES RÈGLES
// INTERDISENT — presque toutes ses feuilles sont des chaînes — est éprouvé ici, règle par règle. jsdom : la relecture
// passe par l'analyseur XML du navigateur.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CINQ_NOVEMBRE, choixFrr, DECLARANT_A_EMETTEUR, DECLARATION_ACHATS, DECLARATION_ACHATS_RECTIFIES, DECLARATION_PAIEMENTS,
  DECLARATION_PAIEMENTS_CONTRE_PASSATION, DECLARATION_VENTES, DECLARATION_VENTES_DEBITS, donneesFrr, EXEMPLES_FRR,
  ID_ACHATS, ID_ACHATS_RECTIFIES, MATRICULE_PLATEFORME_FRR, NOM_A, NOM_B, PLATEFORME_FRR, SIREN_A, SIREN_B, TROIS_DECEMBRE,
} from '../test/fluxEreporting'
import { VERSION_DU_CONTENU } from './declarationsEreporting'
import type { AchatDeclare, LigneAchatDeclaree, PaiementsDuJour, TransactionsDuJour } from './ereporting'
import { numeroTvaFrancais, TAUX_ADMIS } from './factureCii'
import {
  CADRES_FRR, CATEGORIES_FRR, CODES_OPTION_DEBITS_FRR, CODES_TVA_FRR, ETATS_MEMBRES_FRR, fichierFrr, FUSEAUX_FRR,
  horodatageFrr, MOTIF_VATEX_FRR, OBJETS_FRR, PAIEMENTS_NEGATIFS_FRR, PROFIL_EREPORTING, REFUS_FRR, refusFichierFrr,
  ROLE_DU_DECLARANT_FRR, ROLES_EMETTEUR_FRR, SCHEMAS_EMETTEUR_FRR, TYPES_DE_FACTURE_FRR, VERSION_DU_CONTENU_FRR,
  type AchatFrr, type ChoixFrr, type CleRefusFrr, type DeclarationPourFrr, type DonneesFrr, type EmetteurFrr,
  type LigneAchatFrr, type PaiementsFrr, type TransactionsFrr,
} from './fluxEreporting'
import { ETATS_MEMBRES_HORS_FRANCE, MOTIF_VATEX } from './piecesHorsDeFrance'
import type { DeclarationEreportingHorsApplication } from './types'

// Depuis la racine du dépôt, d'où la suite se lance : sous jsdom, import.meta.url n'est pas une adresse de fichier.
const DOSSIER_EXEMPLES = `${resolve(process.cwd(), 'outils/facturation/ereporting/exemples')}/`

type Json = Record<string, unknown>

function xmlDe(d: DonneesFrr): string {
  const r = fichierFrr(d)
  if (r.xml === null) throw new Error(`refusé : ${r.refus.map((x) => x.message).join(' | ')}`)
  return r.xml
}

function lire(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('XML illisible')
  return doc
}

// Les valeurs qu'un chemin de l'annexe 6 désigne, depuis la racine `Report` (l'annexe l'omet) ; un attribut s'écrit
// « /@schemeId ». Les éléments du flux 10 n'ont pas d'espace de noms.
function valeurs(doc: Document, chemin: string): string[] {
  const at = chemin.lastIndexOf('/@')
  const attribut = at >= 0 ? chemin.slice(at + 2) : null
  const segments = (at >= 0 ? chemin.slice(0, at) : chemin).split('/').filter((s) => s !== '')
  let courants: Element[] = [doc.documentElement]
  for (const s of segments) courants = courants.flatMap((e) => [...e.children].filter((x) => x.namespaceURI === null && x.localName === s))
  return courants.map((e) => (attribut ? e.getAttribute(attribut) ?? '' : e.textContent ?? ''))
}

const un = (doc: Document, chemin: string): string | undefined => {
  const v = valeurs(doc, chemin)
  expect(v, chemin).toHaveLength(1)
  return v[0]
}

const cles = (d: DonneesFrr): CleRefusFrr[] => refusFichierFrr(d).map((r) => r.cle)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** La déclaration, son contenu figé changé par `f` (une copie : les exemples ne bougent pas). */
function changee(dec: DeclarationPourFrr, f: (c: Json) => void, o: Partial<DeclarationPourFrr> = {}): DeclarationPourFrr {
  const c = clone(dec.contenu) as Json
  f(c)
  return { ...dec, contenu: c, ...o }
}
const liste = (c: Json, cle: string) => c[cle] as Json[]
const achat = (c: Json, i: number) => liste(c, 'achats')[i]
const ligneDAchat = (c: Json, i: number, j: number) => (achat(c, i).lignes as Json[])[j]
const jourDeVentes = (c: Json, i: number) => liste(c, 'transactions')[i]
const jourDePaiements = (c: Json, i: number) => liste(c, 'paiements')[i]

const achats = (f: (c: Json) => void, o: Partial<DonneesFrr> = {}) => donneesFrr({ declaration: changee(DECLARATION_ACHATS, f), ...o })
const ventes = (f: (c: Json) => void, o: Partial<DonneesFrr> = {}) => donneesFrr({ declaration: changee(DECLARATION_VENTES, f), ...o })
const paiements = (f: (c: Json) => void, o: Partial<DonneesFrr> = {}) => donneesFrr({ declaration: changee(DECLARATION_PAIEMENTS, f), ...o })

// Les achats de l'exemple, dans l'ordre du contenu — celui des dates qui les rangent (e4) : 0 le service allemand (le
// 5), 1 les biens italiens (livrés le 12), 2 l'avoir allemand (le 20), 3 la formation belge exonérée (le 25),
// 4 l'abonnement en dollars (sa période finit le 31).
const SERVICE_ALLEMAND = 0
const BIENS_ITALIENS = 1
const AVOIR_ALLEMAND = 2
const FORMATION_BELGE = 3
const ABONNEMENT_EN_DOLLARS = 4

const TB2 = '/TransactionsReport'
const TB3 = '/PaymentsReport'
const TG8 = `${TB2}/Invoice`

describe('les exemples', () => {
  it.each(EXEMPLES_FRR)('$nom : aucun refus, et le fichier est figé', async (e) => {
    expect(refusFichierFrr(e.donnees)).toEqual([])
    await expect(xmlDe(e.donnees)).toMatchFileSnapshot(`${DOSSIER_EXEMPLES}${e.nom}.xml`)
  })

  it.each(EXEMPLES_FRR)('$nom : se relit, racine Report sans espace de noms (ereporting.xsd), un seul bloc (G6.29)', (e) => {
    const doc = lire(xmlDe(e.donnees))
    expect(doc.documentElement.localName).toBe('Report')
    expect(doc.documentElement.namespaceURI).toBeNull()
    const blocs = [...doc.documentElement.children].map((x) => x.localName)
    expect(blocs).toEqual(['ReportDocument', e.donnees.declaration.objet === 'paiements' ? 'PaymentsReport' : 'TransactionsReport'])
  })

  it('les exemples couvrent chaque bloc écrit, une rectificative et des montants négatifs', () => {
    const xml = EXEMPLES_FRR.map((e) => xmlDe(e.donnees))
    expect(xml.some((x) => x.includes('<Invoice>'))).toBe(true)
    expect(xml.some((x) => x.includes('<TransactionsReport>') && x.includes('<Transactions>'))).toBe(true)
    expect(xml.some((x) => x.includes('<PaymentsReport>'))).toBe(true)
    expect(xml.some((x) => x.includes('<TypeCode>RE</TypeCode>'))).toBe(true)
    expect(xml.some((x) => x.includes('<TaxExclusiveAmount>-'))).toBe(true)
    expect(xml.some((x) => x.includes('<Amount>-'))).toBe(true)
    expect(xml.some((x) => x.includes('<TypeCode>381</TypeCode>'))).toBe(true)
  })
})

// ── Chaque donnée, confrontée à la règle qui la fonde ──────────────────────────────────────────────────────────────

describe('l’en-tête (TB-1)', () => {
  const doc = lire(xmlDe(donneesFrr()))

  it('TT-1 : l’identifiant de la transmission est celui de la déclaration (G8.05 : unique par période et déclarant)', () => {
    expect(un(doc, '/ReportDocument/Id')).toBe(ID_ACHATS)
    // Une rectificative a le sien : renvoyer le même serait un doublon, rejeté (G8.05).
    expect(un(lire(xmlDe(donneesFrr({ declaration: DECLARATION_ACHATS_RECTIFIES }))), '/ReportDocument/Id')).toBe(ID_ACHATS_RECTIFIES)
  })

  it('TT-2, facultatif, ne s’écrit pas', () => {
    expect(valeurs(doc, '/ReportDocument/Name')).toEqual([])
  })

  it('TT-3 : AAAAMMJJHHMMSS (G7.53), l’instant de création dans le fuseau choisi', () => {
    expect(un(doc, '/ReportDocument/IssueDateTime/DateTimeString')).toBe('20271105093000')
    const utc = lire(xmlDe(donneesFrr({ choix: choixFrr({ fuseau: 'UTC' }) })))
    expect(un(utc, '/ReportDocument/IssueDateTime/DateTimeString')).toBe('20271105083000')
  })

  it('TT-4 : IN pour une initiale, RE pour une rectificative (G8.01)', () => {
    expect(un(doc, '/ReportDocument/TypeCode')).toBe('IN')
    expect(un(lire(xmlDe(donneesFrr({ declaration: DECLARATION_ACHATS_RECTIFIES }))), '/ReportDocument/TypeCode')).toBe('RE')
  })

  it('TG-3 : l’émetteur choisi — une plateforme, son matricule sous 0238, le rôle WK (G6.22, G7.51)', () => {
    expect(un(doc, '/ReportDocument/Sender/Id')).toBe(MATRICULE_PLATEFORME_FRR)
    expect(un(doc, '/ReportDocument/Sender/Id/@schemeId')).toBe('0238')
    expect(un(doc, '/ReportDocument/Sender/Name')).toBe('Plateforme Fictive')
    expect(un(doc, '/ReportDocument/Sender/RoleCode')).toBe('WK')
    expect(valeurs(doc, '/ReportDocument/Sender/URIUniversalCommunication')).toEqual([])
  })

  it('TG-5 : le déclarant, son SIREN sous 0002 (G6.26), sa raison sociale (TT-14), son rôle (G7.52)', () => {
    expect(un(doc, '/ReportDocument/Issuer/Id')).toBe(SIREN_A)
    expect(un(doc, '/ReportDocument/Issuer/Id/@schemeId')).toBe('0002')
    expect(un(doc, '/ReportDocument/Issuer/Name')).toBe(NOM_A)
    expect(un(doc, '/ReportDocument/Issuer/RoleCode')).toBe('BY')
    for (const [dec, role] of [[DECLARATION_VENTES, 'SE'], [DECLARATION_PAIEMENTS, 'SE']] as const) {
      expect(un(lire(xmlDe(donneesFrr({ declaration: dec }))), '/ReportDocument/Issuer/RoleCode')).toBe(role)
    }
  })

  it('TT-9 et TT-14 s’écrivent sur une ligne, échappés : « & » devient une entité', () => {
    const d = donneesFrr({ declaration: DECLARATION_VENTES_DEBITS, nomDuDeclarant: `  ${NOM_B}\n` })
    const xml = xmlDe(d)
    expect(xml).toContain('<Name>Démo &amp; Fils — Débits</Name>')
    expect(un(lire(xml), '/ReportDocument/Issuer/Name')).toBe(NOM_B)
    const avecDesBlancs = lire(xmlDe(donneesFrr({ choix: choixFrr({ emetteur: { ...PLATEFORME_FRR, nom: 'Plateforme\t\tFictive  ' } }) })))
    expect(un(avecDesBlancs, '/ReportDocument/Sender/Name')).toBe('Plateforme Fictive')
  })

  it('un texte qui porte « < », « > », « & » et des guillemets se relit tel quel', () => {
    const nom = 'Démo <Conseil> & "Fils" l’Ainé'
    const xml = xmlDe(donneesFrr({ nomDuDeclarant: nom }))
    expect(xml).toContain('<Name>Démo &lt;Conseil&gt; &amp; &quot;Fils&quot; l’Ainé</Name>')
    expect(un(lire(xml), '/ReportDocument/Issuer/Name')).toBe(nom)
  })
})

describe('la période (TG-7, TG-33)', () => {
  it('TT-17 et TT-18 : AAAAMMJJ (G1.09), les bornes de la déclaration', () => {
    const doc = lire(xmlDe(donneesFrr()))
    expect(un(doc, `${TB2}/ReportPeriod/StartDate`)).toBe('20271001')
    expect(un(doc, `${TB2}/ReportPeriod/EndDate`)).toBe('20271031')
  })

  it('TT-89 et TT-90 pour des paiements', () => {
    const doc = lire(xmlDe(donneesFrr({ declaration: DECLARATION_PAIEMENTS })))
    expect(un(doc, `${TB3}/ReportPeriod/StartDate`)).toBe('20271001')
    expect(un(doc, `${TB3}/ReportPeriod/EndDate`)).toBe('20271031')
  })
})

describe('les achats (bloc 10.1, le dossier acheteur)', () => {
  const doc = lire(xmlDe(donneesFrr()))
  const factures = () => [...doc.documentElement.getElementsByTagName('Invoice')]
  const de = (i: number, chemin: string) => {
    const f = factures()[i]
    const r = new DOMParser().parseFromString(`<Report><TransactionsReport>${new XMLSerializer().serializeToString(f)}</TransactionsReport></Report>`, 'application/xml')
    return valeurs(r, `${TG8}/${chemin}`)
  }

  it('une facture par fiche, sans ses lignes (BOI-TVA-DECLA-20-30-50-20, § 70, remarque ; TG-24 absent)', () => {
    expect(factures()).toHaveLength(5)
    expect(valeurs(doc, `${TG8}/Line`)).toEqual([])
    expect(valeurs(doc, `${TB2}/Transactions`)).toEqual([])
  })

  it('TT-19, TT-20, TT-21, TT-22 : numéro (G1.05), date AAAAMMJJ (G1.09), type (G1.01), devise (G1.10)', () => {
    expect(valeurs(doc, `${TG8}/ID`)).toEqual(['INV-2027-0042', 'FT 2027/118', 'AV-2027-0007', 'BE-FORM-77', 'NDS-1029'])
    expect(valeurs(doc, `${TG8}/IssueDate`)).toEqual(['20271005', '20271010', '20271020', '20271025', '20271001'])
    expect(valeurs(doc, `${TG8}/TypeCode`)).toEqual(['380', '380', '381', '380', '380'])
    expect(valeurs(doc, `${TG8}/CurrencyCode`)).toEqual(['EUR', 'EUR', 'EUR', 'EUR', 'USD'])
  })

  it('TT-28 : le cadre que le contenu a figé (G1.02 ; B1 pour des biens, S1 pour des services) ; TT-29 : le profil (S1.12)', () => {
    expect(valeurs(doc, `${TG8}/BusinessProcess/ID`)).toEqual(['S1', 'B1', 'S1', 'S1', 'S1'])
    expect(valeurs(doc, `${TG8}/BusinessProcess/TypeID`)).toEqual(Array(5).fill('urn.cpro.gouv.fr:1p0:ereporting'))
    expect(PROFIL_EREPORTING).toBe('urn.cpro.gouv.fr:1p0:ereporting')
  })

  it('TG-11 : un avoir cite la facture qu’il corrige et sa date (G1.32), une facture rien', () => {
    expect(de(AVOIR_ALLEMAND, 'ReferencedDocument/ID')).toEqual(['INV-2027-0042'])
    expect(de(AVOIR_ALLEMAND, 'ReferencedDocument/IssueDate')).toEqual(['20271005'])
    expect(de(SERVICE_ALLEMAND, 'ReferencedDocument')).toEqual([])
  })

  it('TG-12 : dans l’Union, le numéro de TVA sous 0223, répété en TT-34 qualifié « VAT » (G2.19, G2.33) ; le pays (TT-35, G6.08)', () => {
    expect(de(SERVICE_ALLEMAND, 'Seller/CompanyId')).toEqual(['DE000000000'])
    expect(de(SERVICE_ALLEMAND, 'Seller/CompanyId/@schemeId')).toEqual(['0223'])
    expect(de(SERVICE_ALLEMAND, 'Seller/TaxRegistrationId')).toEqual(['DE000000000'])
    expect(de(SERVICE_ALLEMAND, 'Seller/TaxRegistrationId/@qualifyingId')).toEqual(['VAT'])
    expect(de(SERVICE_ALLEMAND, 'Seller/PostalAddress/CountryId')).toEqual(['DE'])
  })

  it('TG-12 : hors de l’Union, le pays et les seize premiers caractères de la dénomination sous 0227, sans TT-34 (G2.19, G2.33)', () => {
    expect(de(ABONNEMENT_EN_DOLLARS, 'Seller/CompanyId')).toEqual(['USNuage Demo Softw'])
    expect(de(ABONNEMENT_EN_DOLLARS, 'Seller/CompanyId/@schemeId')).toEqual(['0227'])
    expect(de(ABONNEMENT_EN_DOLLARS, 'Seller/TaxRegistrationId')).toEqual([])
    expect(de(ABONNEMENT_EN_DOLLARS, 'Seller/PostalAddress/CountryId')).toEqual(['US'])
  })

  it('TG-14 : le dossier acheteur, son SIREN sous 0002 (G6.28 : TT-36 obligatoire) et son numéro de TVA qualifié « VAT » (G2.33)', () => {
    expect(valeurs(doc, `${TG8}/Buyer/CompanyId`)).toEqual(Array(5).fill(SIREN_A))
    expect(valeurs(doc, `${TG8}/Buyer/CompanyId/@schemeId`)).toEqual(Array(5).fill('0002'))
    expect(valeurs(doc, `${TG8}/Buyer/TaxRegistrationId`)).toEqual(Array(5).fill(numeroTvaFrancais(SIREN_A)))
    expect(valeurs(doc, `${TG8}/Buyer/TaxRegistrationId/@qualifyingId`)).toEqual(Array(5).fill('VAT'))
    expect(valeurs(doc, `${TG8}/Buyer/PostalAddress`)).toEqual([])
  })

  it('TG-17 et TG-18 : la date de livraison (TT-41) ou la période de facturation (TT-42, TT-43), quand la fiche les dit', () => {
    expect(de(BIENS_ITALIENS, 'Delivery/Date')).toEqual(['20271012'])
    expect(de(ABONNEMENT_EN_DOLLARS, 'InvoicePeriod/StartDate')).toEqual(['20271001'])
    expect(de(ABONNEMENT_EN_DOLLARS, 'InvoicePeriod/EndDate')).toEqual(['20271031'])
    expect(de(SERVICE_ALLEMAND, 'Delivery')).toEqual([])
    expect(de(SERVICE_ALLEMAND, 'InvoicePeriod')).toEqual([])
    // Une période d'un seul bout s'écrit de ce seul bout : le schéma rend les deux facultatifs.
    const seulDebut = lire(xmlDe(achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).periodeFin = null })))
    expect(valeurs(seulDebut, `${TG8}/InvoicePeriod/StartDate`)).toEqual(['20271001'])
    expect(valeurs(seulDebut, `${TG8}/InvoicePeriod/EndDate`)).toEqual([])
    const seuleFin = lire(xmlDe(achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).periodeDebut = null })))
    expect(valeurs(seuleFin, `${TG8}/InvoicePeriod/StartDate`)).toEqual([])
    expect(valeurs(seuleFin, `${TG8}/InvoicePeriod/EndDate`)).toEqual(['20271031'])
  })

  it('TG-22 : le hors-taxe dans la devise de la facture (TT-51, G1.14), la TVA en euros (TT-52, TT-202 « EUR » ; G6.23)', () => {
    expect(valeurs(doc, `${TG8}/MonetaryTotal/TaxExclusiveAmount`)).toEqual(['49.00', '300.00', '9.00', '250.00', '120.00'])
    expect(valeurs(doc, `${TG8}/MonetaryTotal/TaxAmount`)).toEqual(Array(5).fill('0.00'))
    expect(valeurs(doc, `${TG8}/MonetaryTotal/TaxAmount/@CurrencyCode`)).toEqual(Array(5).fill('EUR'))
  })

  it('TG-23 : base et TVA (TT-54, TT-55 ; G1.14), code (TT-56 ; G2.31), taux (TT-57 ; G1.24) ; un avoir en montants positifs sous 381', () => {
    expect(valeurs(doc, `${TG8}/TaxSubTotal/TaxableAmount`)).toEqual(['49.00', '300.00', '9.00', '250.00', '120.00'])
    expect(valeurs(doc, `${TG8}/TaxSubTotal/TaxAmount`)).toEqual(Array(5).fill('0.00'))
    expect(valeurs(doc, `${TG8}/TaxSubTotal/TaxCategory/Code`)).toEqual(['AE', 'K', 'AE', 'E', 'AE'])
    expect(valeurs(doc, `${TG8}/TaxSubTotal/TaxCategory/Percent`)).toEqual(Array(5).fill('0'))
  })

  it('TT-58 et TT-59 : le motif d’une exonération, libellé et code (G1.40) — après le taux, dans l’ordre du schéma', () => {
    expect(de(FORMATION_BELGE, 'TaxSubTotal/TaxCategory/TaxExemptionReasonCode')).toEqual(['VATEX-EU-132-1I'])
    expect(de(FORMATION_BELGE, 'TaxSubTotal/TaxCategory/TaxExemptionReason'))
      .toEqual(['Exonération : enseignement (directive 2006/112/CE, art. 132, 1, i)'])
    expect(de(SERVICE_ALLEMAND, 'TaxSubTotal/TaxCategory/TaxExemptionReason')).toEqual([])
    const categorie = factures()[FORMATION_BELGE].getElementsByTagName('TaxCategory')[0]
    expect([...categorie.children].map((x) => x.localName)).toEqual(['Code', 'Percent', 'TaxExemptionReason', 'TaxExemptionReasonCode'])
  })

  it('les éléments d’une facture suivent l’ordre de transaction.xsd', () => {
    expect([...factures()[AVOIR_ALLEMAND].children].map((x) => x.localName))
      .toEqual(['ID', 'IssueDate', 'TypeCode', 'CurrencyCode', 'BusinessProcess', 'ReferencedDocument', 'Seller', 'Buyer', 'MonetaryTotal', 'TaxSubTotal'])
    expect([...factures()[BIENS_ITALIENS].children].map((x) => x.localName))
      .toEqual(['ID', 'IssueDate', 'TypeCode', 'CurrencyCode', 'BusinessProcess', 'Seller', 'Buyer', 'Delivery', 'MonetaryTotal', 'TaxSubTotal'])
    expect([...factures()[ABONNEMENT_EN_DOLLARS].children].map((x) => x.localName))
      .toEqual(['ID', 'IssueDate', 'TypeCode', 'CurrencyCode', 'BusinessProcess', 'Seller', 'Buyer', 'InvoicePeriod', 'MonetaryTotal', 'TaxSubTotal'])
  })

  it('une rectificative porte la période ENTIÈRE, de nouveau (dossier général, § 3.7.7) : six factures', () => {
    const rectifie = lire(xmlDe(donneesFrr({ declaration: DECLARATION_ACHATS_RECTIFIES })))
    expect(valeurs(rectifie, `${TG8}/ID`)).toEqual(['INV-2027-0042', 'FT 2027/118', 'AV-2027-0007', 'BE-FORM-77', 'CH-2027-15', 'NDS-1029'])
  })
})

describe('les ventes à des particuliers (bloc 10.3)', () => {
  const doc = lire(xmlDe(donneesFrr({ declaration: DECLARATION_VENTES })))
  const T = `${TB2}/Transactions`

  it('une occurrence par jour, devise et catégorie (dossier général, § 3.7.5), AAAAMMJJ (G1.09), en euros (TT-78)', () => {
    expect(valeurs(doc, `${T}/Date`)).toEqual(['20271004', '20271004', '20271011', '20271018'])
    expect(valeurs(doc, `${T}/TransactionsCurrency`)).toEqual(Array(4).fill('EUR'))
    expect(valeurs(doc, `${T}/CategoryCode`)).toEqual(['TLB1', 'TPS1', 'TPS1', 'TPS1'])
    expect(valeurs(doc, `${TB2}/Invoice`)).toEqual([])
  })

  it('TT-82 et TT-83 font les sommes de TT-87 et TT-88 (G1.53) ; un jour où l’avoir l’emporte est négatif (G1.14 admet le signe)', () => {
    expect(valeurs(doc, `${T}/TaxExclusiveAmount`)).toEqual(['80.00', '100.00', '200.00', '-100.00'])
    expect(valeurs(doc, `${T}/TaxTotal`)).toEqual(['11.65', '20.00', '20.00', '-20.00'])
    expect(valeurs(doc, `${T}/TaxSubtotal/TaxPercent`)).toEqual(['20', '5.5', '20', '10', '20'])
    expect(valeurs(doc, `${T}/TaxSubtotal/TaxableAmount`)).toEqual(['50.00', '30.00', '100.00', '200.00', '-100.00'])
    expect(valeurs(doc, `${T}/TaxSubtotal/TaxTotal`)).toEqual(['10.00', '1.65', '20.00', '20.00', '-20.00'])
  })

  it('TT-85, facultatif depuis la v3.1 des XSD, ne s’écrit pas ; TT-80 non plus sans l’option', () => {
    expect(valeurs(doc, `${T}/TransactionsCount`)).toEqual([])
    expect(valeurs(doc, `${T}/TaxDueDateTypeCode`)).toEqual([])
  })

  it('TT-80 : l’option pour les débits sur des services, sous le code choisi (G1.67, P1.11) — jamais sur des biens', () => {
    for (const code of CODES_OPTION_DEBITS_FRR) {
      const d = lire(xmlDe(donneesFrr({ declaration: DECLARATION_VENTES_DEBITS, nomDuDeclarant: NOM_B, choix: choixFrr({ codeOptionDebits: code }) })))
      expect(valeurs(d, `${T}/CategoryCode`)).toEqual(['TLB1', 'TPS1'])
      const occurrences = [...d.documentElement.getElementsByTagName('Transactions')]
      expect(occurrences.map((o) => o.getElementsByTagName('TaxDueDateTypeCode')[0]?.textContent ?? null)).toEqual([null, code])
      // Dans l'ordre du schéma : après la devise, avant la catégorie.
      expect([...occurrences[1].children].map((x) => x.localName).slice(0, 4)).toEqual(['Date', 'TransactionsCurrency', 'TaxDueDateTypeCode', 'CategoryCode'])
    }
  })
})

describe('les paiements des ventes à des particuliers (bloc 10.4)', () => {
  const T = `${TB3}/Transactions/Payment`

  it('un paiement par jour (TT-96), par taux (TT-97 ; G1.24), en euros au centime (TT-99 ; G6.27, G7.07)', () => {
    const doc = lire(xmlDe(donneesFrr({ declaration: DECLARATION_PAIEMENTS })))
    expect(valeurs(doc, `${T}/Date`)).toEqual(['20271015', '20271022'])
    expect(valeurs(doc, `${T}/SubTotals/TaxPercent`)).toEqual(['20', '10', '10'])
    expect(valeurs(doc, `${T}/SubTotals/Amount`)).toEqual(['120.00', '100.00', '120.00'])
    expect(valeurs(doc, `${T}/SubTotals/CurrencyCode`)).toEqual([])
    expect(valeurs(doc, `${TB3}/Invoice`)).toEqual([])
  })

  it('un jour négatif s’écrit avec son signe sous le choix qui l’écrit (G7.07)', () => {
    const doc = lire(xmlDe(donneesFrr({ declaration: DECLARATION_PAIEMENTS_CONTRE_PASSATION, maintenant: TROIS_DECEMBRE })))
    expect(valeurs(doc, `${T}/Date`)).toEqual(['20271103'])
    expect(valeurs(doc, `${T}/SubTotals/Amount`)).toEqual(['-60.00'])
  })
})

// ── Les choix ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('les quatre choix, sans valeur par défaut', () => {
  it('le type ne laisse omettre aucun choix (vérifié par le compilateur), et un choix absent se refuse, jamais ne se remplace', () => {
    const b = choixFrr()
    // @ts-expect-error — l'émetteur n'a pas de valeur par défaut.
    const sansEmetteur: ChoixFrr = { fuseau: b.fuseau, codeOptionDebits: b.codeOptionDebits, paiementsNegatifs: b.paiementsNegatifs }
    // @ts-expect-error — le fuseau non plus.
    const sansFuseau: ChoixFrr = { emetteur: b.emetteur, codeOptionDebits: b.codeOptionDebits, paiementsNegatifs: b.paiementsNegatifs }
    // @ts-expect-error — ni le code de l'option pour les débits.
    const sansCode: ChoixFrr = { emetteur: b.emetteur, fuseau: b.fuseau, paiementsNegatifs: b.paiementsNegatifs }
    // @ts-expect-error — ni ce que devient un paiement négatif.
    const sansNegatifs: ChoixFrr = { emetteur: b.emetteur, fuseau: b.fuseau, codeOptionDebits: b.codeOptionDebits }
    expect(cles(donneesFrr({ choix: sansEmetteur }))).toEqual(['emetteur_absent'])
    expect(cles(donneesFrr({ choix: sansFuseau }))).toEqual(['fuseau'])
    expect(cles(donneesFrr({ choix: sansCode }))).toEqual(['code_option_debits'])
    expect(cles(donneesFrr({ choix: sansNegatifs }))).toEqual(['choix_paiements_negatifs'])
    expect(refusFichierFrr(donneesFrr({ choix: sansFuseau }))[0].message).toBe('Le fuseau de l’horodatage du fichier, « undefined », n’est ni Europe/Paris ni UTC.')
    // Ce que le fichier demande hors des choix n'a pas de valeur par défaut non plus.
    // @ts-expect-error — la raison sociale du déclarant n'est pas figée : l'appelant la donne.
    const sansNom: DonneesFrr = { declaration: DECLARATION_ACHATS, maintenant: CINQ_NOVEMBRE, choix: b }
    expect(cles(sansNom)).toEqual(['nom_du_declarant'])
    // @ts-expect-error — ni l'instant de création.
    const sansInstant: DonneesFrr = { declaration: DECLARATION_ACHATS, nomDuDeclarant: NOM_A, choix: b }
    expect(cles(sansInstant)).toEqual(['horodatage'])
  })

  it('1. l’émetteur : la plateforme, le déclarant lui-même, ou qui dépose pour lui sous son SIREN et le rôle WK', () => {
    const declarant = lire(xmlDe(donneesFrr({ declaration: DECLARATION_PAIEMENTS, choix: choixFrr({ emetteur: DECLARANT_A_EMETTEUR }) })))
    expect(un(declarant, '/ReportDocument/Sender/Id')).toBe(SIREN_A)
    expect(un(declarant, '/ReportDocument/Sender/Id/@schemeId')).toBe('0002')
    expect(un(declarant, '/ReportDocument/Sender/RoleCode')).toBe('SE')
    const tiers: EmetteurFrr = { identifiant: SIREN_B, schema: '0002', nom: 'Cabinet Fictif', role: 'WK' }
    const pourLui = lire(xmlDe(donneesFrr({ choix: choixFrr({ emetteur: tiers }) })))
    expect(un(pourLui, '/ReportDocument/Sender/Id')).toBe(SIREN_B)
    expect(un(pourLui, '/ReportDocument/Sender/RoleCode')).toBe('WK')
    // Le déclarant d'achats émet en acheteur.
    const acheteur = { ...DECLARANT_A_EMETTEUR, role: 'BY' as const }
    expect(un(lire(xmlDe(donneesFrr({ choix: choixFrr({ emetteur: acheteur }) }))), '/ReportDocument/Sender/RoleCode')).toBe('BY')
    expect(SCHEMAS_EMETTEUR_FRR).toEqual(['0002', '0238'])
    expect(ROLES_EMETTEUR_FRR).toEqual(['WK', 'SE', 'BY'])
  })

  it('2. le fuseau : Paris ou UTC, à l’heure d’été comme à l’heure d’hiver', () => {
    expect(FUSEAUX_FRR).toEqual(['Europe/Paris', 'UTC'])
    expect(horodatageFrr(new Date('2027-10-31T00:59:59Z'), 'Europe/Paris')).toBe('20271031025959')
    expect(horodatageFrr(new Date('2027-10-31T01:00:00Z'), 'Europe/Paris')).toBe('20271031020000')
    expect(horodatageFrr(new Date('2027-10-31T01:00:00Z'), 'UTC')).toBe('20271031010000')
    // Minuit s'écrit 00, jamais 24.
    expect(horodatageFrr(new Date('2027-10-31T23:30:00Z'), 'Europe/Paris')).toBe('20271101003000')
    expect(horodatageFrr(new Date('2027-11-01T00:00:00Z'), 'UTC')).toBe('20271101000000')
    expect(horodatageFrr(new Date('invalide'), 'UTC')).toBeNull()
    expect(horodatageFrr(new Date('2027-10-31T01:00:00Z'), 'America/Cayenne' as never)).toBeNull()
  })

  it('3. le code de l’option : 5 ou 3', () => {
    expect(CODES_OPTION_DEBITS_FRR).toEqual(['5', '3'])
  })

  it('4. un paiement négatif : écrit avec son signe, ou refusé (G1.16) — et le refus nomme le jour et le taux', () => {
    expect(PAIEMENTS_NEGATIFS_FRR).toEqual(['ecrits_avec_leur_signe', 'refuses'])
    const refuse = donneesFrr({ declaration: DECLARATION_PAIEMENTS_CONTRE_PASSATION, maintenant: TROIS_DECEMBRE, choix: choixFrr({ paiementsNegatifs: 'refuses' }) })
    expect(refusFichierFrr(refuse)).toEqual([{
      cle: 'paiement_negatif', regle: 'G1.16', message: 'Les paiements du 03/11/2027 sont négatifs au taux de 20 % : le choix retenu ne les écrit pas.',
    }])
    expect(fichierFrr(refuse).xml).toBeNull()
    // Un paiement positif s'écrit sous les deux choix.
    expect(cles(donneesFrr({ declaration: DECLARATION_PAIEMENTS, choix: choixFrr({ paiementsNegatifs: 'refuses' }) }))).toEqual([])
    // Un montant nul n'est pas négatif.
    expect(cles(paiements((c) => { ((jourDePaiements(c, 1).parTaux as Json[])[0]).montantCentimes = 0 }, { choix: choixFrr({ paiementsNegatifs: 'refuses' }) }))).toEqual([])
  })
})

// ── Les refus, un par faute ────────────────────────────────────────────────────────────────────────────────────────

const autreEmetteur = (o: Partial<EmetteurFrr>) => donneesFrr({ choix: choixFrr({ emetteur: { ...PLATEFORME_FRR, ...o } }) })
const declarationAutre = (o: Partial<DeclarationPourFrr>) => donneesFrr({ declaration: { ...DECLARATION_ACHATS, ...o } })
const periodeChangee = (debut: string, fin: string, garder?: number) => donneesFrr({
  declaration: changee(DECLARATION_ACHATS, (c) => {
    c.debut = debut
    c.fin = fin
    if (garder != null) c.achats = [achat(c, garder)]
  }, { periode_debut: debut, periode_fin: fin }),
})

// Chaque cas : une seule faute, et le refus qu'elle rend SEUL.
const CAS: [string, DonneesFrr, CleRefusFrr][] = [
  // La déclaration.
  ['une déclaration remplacée par une rectificative', declarationAutre({ etat: 'remplacee' }), 'declaration_remplacee'],
  ['un type de transmission inconnu (G8.01)', declarationAutre({ type_transmission: 'XX' }), 'type_de_transmission'],
  ['une rectificative qui ne remplace rien', declarationAutre({ type_transmission: 'RE', remplace_id: null }), 'rectificative_discordante'],
  ['une initiale qui remplace', declarationAutre({ remplace_id: ID_ACHATS_RECTIFIES }), 'rectificative_discordante'],
  ['un identifiant accentué (G1.104)', declarationAutre({ id: 'déclaration-1' }), 'identifiant_de_transmission'],
  ['un identifiant de 51 caractères', declarationAutre({ id: 'x'.repeat(51) }), 'identifiant_de_transmission'],
  ['un identifiant vide', declarationAutre({ id: '' }), 'identifiant_de_transmission'],
  ['un identifiant qui commence par une espace', declarationAutre({ id: ' a' }), 'identifiant_de_transmission'],
  ['un identifiant qui finit par une espace', declarationAutre({ id: 'a ' }), 'identifiant_de_transmission'],
  ['un identifiant à deux espaces de suite', declarationAutre({ id: 'a  b' }), 'identifiant_de_transmission'],
  ['un identifiant qui porte un « # »', declarationAutre({ id: 'a#b' }), 'identifiant_de_transmission'],
  // Le contenu figé.
  ['un contenu d’un autre objet', achats((c) => { c.objet = 'ventes' }), 'contenu_d_une_autre_declaration'],
  ['un contenu d’une autre période', achats((c) => { c.debut = '2027-09-01' }), 'contenu_d_une_autre_declaration'],
  ['une déclaration d’une autre fin que son contenu', declarationAutre({ periode_fin: '2027-11-30' }), 'contenu_d_une_autre_declaration'],
  ['un déclarant vendeur de ses achats (G7.52)', achats((c) => { c.role = 'SE' }), 'role_du_declarant'],
  ['des achats qui portent aussi des transactions (G6.29)', achats((c) => { c.transactions = [{}] }), 'objets_meles'],
  ['des ventes qui portent aussi des paiements (G6.29)', ventes((c) => { c.paiements = [{}] }), 'objets_meles'],
  ['des paiements qui portent aussi des achats (G7.52)', paiements((c) => { c.achats = [{}] }), 'objets_meles'],
  // Les choix.
  ['un émetteur sous le schéma 0009', autreEmetteur({ schema: '0009' as never }), 'emetteur_schema'],
  ['un émetteur sous 0009, au rôle du déclarant : la seule faute du schéma', autreEmetteur({ schema: '0009' as never, role: 'BY' }), 'emetteur_schema'],
  ['un émetteur au SIREN à la clé fausse', autreEmetteur({ schema: '0002', identifiant: '123456789' }), 'emetteur_siren'],
  ['un émetteur au SIREN faux, au rôle du déclarant : la seule faute du SIREN', autreEmetteur({ schema: '0002', identifiant: '123456789', role: 'BY' }), 'emetteur_siren'],
  ['un matricule de trois chiffres', autreEmetteur({ identifiant: '999' }), 'emetteur_matricule'],
  ['un matricule de cinq chiffres', autreEmetteur({ identifiant: '99991' }), 'emetteur_matricule'],
  ['un matricule qui porte une lettre', autreEmetteur({ identifiant: '99A1' }), 'emetteur_matricule'],
  ['un émetteur au rôle DFH', autreEmetteur({ role: 'DFH' as never }), 'emetteur_role'],
  ['une plateforme sous le rôle de vendeur (G7.51)', autreEmetteur({ role: 'SE' }), 'emetteur_plateforme'],
  ['un émetteur acheteur qui n’est pas le déclarant', autreEmetteur({ schema: '0002', identifiant: SIREN_B, role: 'BY' }), 'emetteur_declarant'],
  ['le déclarant émetteur sous un autre rôle que le sien', autreEmetteur({ schema: '0002', identifiant: SIREN_A, role: 'SE' }), 'emetteur_declarant'],
  ['un émetteur sans raison sociale', autreEmetteur({ nom: '' }), 'emetteur_nom'],
  ['un émetteur dont la raison sociale n’est que blancs', autreEmetteur({ nom: ' \t\n ' }), 'emetteur_nom'],
  ['un émetteur dont la raison sociale passe 150 caractères', autreEmetteur({ nom: 'x'.repeat(151) }), 'emetteur_nom'],
  ['un émetteur dont la raison sociale passe 150 caractères, en emojis', autreEmetteur({ nom: '😀'.repeat(151) }), 'emetteur_nom'],
  ['un fuseau inconnu', donneesFrr({ choix: choixFrr({ fuseau: 'America/Cayenne' as never }) }), 'fuseau'],
  ['un code d’option 4', donneesFrr({ choix: choixFrr({ codeOptionDebits: '4' as never }) }), 'code_option_debits'],
  ['un choix des paiements négatifs inconnu', donneesFrr({ choix: choixFrr({ paiementsNegatifs: 'oui' as never }) }), 'choix_paiements_negatifs'],
  // L'en-tête.
  ['un instant qui n’en est pas un', donneesFrr({ maintenant: new Date('invalide') }), 'horodatage'],
  ['un fichier créé le dernier jour de la période, à Paris (G7.43)', donneesFrr({ maintenant: new Date('2027-10-31T21:00:00Z') }), 'horodatage_avant_la_fin'],
  ['un fichier créé le 1er novembre à Paris, encore le 31 octobre en UTC', donneesFrr({ maintenant: new Date('2027-10-31T23:30:00Z'), choix: choixFrr({ fuseau: 'UTC' }) }), 'horodatage_avant_la_fin'],
  ['un SIREN du déclarant à la clé fausse (G6.26)', achats((c) => { c.siren = '123456789' }), 'siren_du_declarant'],
  ['un déclarant sans SIREN', ventes((c) => { c.siren = null }), 'siren_du_declarant'],
  ['un déclarant sans raison sociale', donneesFrr({ nomDuDeclarant: '' }), 'nom_du_declarant'],
  ['une raison sociale du déclarant faite de blancs', donneesFrr({ nomDuDeclarant: ' \n ' }), 'nom_du_declarant'],
  ['une raison sociale du déclarant de 151 caractères', donneesFrr({ nomDuDeclarant: 'x'.repeat(151) }), 'nom_du_declarant'],
  ['des achats sans le numéro de TVA du dossier (G2.33)', achats((c) => { c.numeroTva = null }), 'numero_tva_du_declarant'],
  ['des achats sous un numéro de TVA qui n’est pas celui du SIREN', achats((c) => { c.numeroTva = 'FR00123456782' }), 'numero_tva_du_declarant'],
  // La période.
  ['une période qui commence en 1999 (G1.36)', periodeChangee('1999-10-01', '2027-10-31'), 'periode_dates'],
  ['une période qui finit un 30 février (G1.09)', periodeChangee('2027-10-01', '2027-02-30'), 'periode_dates'],
  ['une période d’un jour (G6.25)', periodeChangee('2027-10-31', '2027-10-31', ABONNEMENT_EN_DOLLARS), 'periode_bornes'],
  // Ses cinq achats ne se jugent pas contre une période qui finit avant de commencer : tous en seraient « hors ».
  ['une période qui finit avant de commencer, ses achats non jugés (G6.25)', periodeChangee('2027-10-31', '2027-10-01'), 'periode_bornes'],
  // Les achats.
  ['un achat rangé le lendemain de la période', achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-11-01' }), 'achat_hors_periode'],
  ['un achat rangé la veille de la période', achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-09-30' }), 'achat_hors_periode'],
  ['un achat rangé à une date qui n’en est pas une', achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-10-0a' }), 'achat_hors_periode'],
  ['un numéro accentué (G1.05)', achats((c) => { achat(c, SERVICE_ALLEMAND).numero = 'FACTURE-É1' }), 'achat_numero'],
  ['un numéro de 36 caractères', achats((c) => { achat(c, SERVICE_ALLEMAND).numero = 'x'.repeat(36) }), 'achat_numero'],
  ['une facture datée après la création du fichier (G1.07)', achats((c) => { achat(c, SERVICE_ALLEMAND).dateFacture = '2027-11-06' }), 'achat_date'],
  ['une facture datée de 1999 (G1.36)', achats((c) => { achat(c, SERVICE_ALLEMAND).dateFacture = '1999-12-31' }), 'achat_date'],
  ['une facture datée d’un 30 février (G1.09)', achats((c) => { achat(c, SERVICE_ALLEMAND).dateFacture = '2027-02-30' }), 'achat_date'],
  ['une facture rectificative (384), que les fiches ne décrivent pas', achats((c) => { achat(c, SERVICE_ALLEMAND).typeDocument = '384' }), 'achat_type'],
  ['un avoir sans sa facture d’origine (G1.32)', achats((c) => { achat(c, AVOIR_ALLEMAND).origine = null }), 'achat_avoir_sans_origine'],
  ['un avoir dont l’origine a un numéro à deux espaces', achats((c) => { (achat(c, AVOIR_ALLEMAND).origine as Json).numero = 'INV  42' }), 'achat_origine'],
  ['un avoir dont l’origine est datée après la création du fichier', achats((c) => { (achat(c, AVOIR_ALLEMAND).origine as Json).date = '2027-11-06' }), 'achat_origine'],
  ['un avoir dont l’origine est datée de 1999', achats((c) => { (achat(c, AVOIR_ALLEMAND).origine as Json).date = '1999-01-01' }), 'achat_origine'],
  ['une devise en minuscules (G1.10)', achats((c) => { achat(c, SERVICE_ALLEMAND).devise = 'eur' }), 'achat_devise'],
  ['une devise de quatre lettres', achats((c) => { achat(c, SERVICE_ALLEMAND).devise = 'EURO' }), 'achat_devise'],
  ['un cadre de facturation inconnu (G1.02)', achats((c) => { achat(c, SERVICE_ALLEMAND).cadre = 'X9' }), 'achat_cadre'],
  ['un fournisseur sous le schéma d’un SIREN (G2.19)', achats((c) => { achat(c, SERVICE_ALLEMAND).schema = '0002' }), 'achat_vendeur_schema'],
  ['un fournisseur de l’Union sous 0227', achats((c) => { achat(c, SERVICE_ALLEMAND).schema = '0227' }), 'achat_vendeur_pays'],
  ['un fournisseur hors de l’Union sous 0223', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).schema = '0223' }), 'achat_vendeur_pays'],
  ['un fournisseur établi en France', achats((c) => { Object.assign(achat(c, ABONNEMENT_EN_DOLLARS), { pays: 'FR', identifiant: 'FRNuage Demo Softw' }) }), 'achat_vendeur_pays'],
  ['un pays en minuscules (G2.01)', achats((c) => { achat(c, SERVICE_ALLEMAND).pays = 'de' }), 'achat_vendeur_pays'],
  ['un pays hors de l’Union en minuscules, l’identifiant de même', achats((c) => {
    Object.assign(achat(c, ABONNEMENT_EN_DOLLARS), { pays: 'us', identifiant: 'usNuage Demo Softw' })
  }), 'achat_vendeur_pays'],
  ['un numéro de TVA de l’Union à une espace', achats((c) => { achat(c, SERVICE_ALLEMAND).identifiant = 'DE 00000000' }), 'achat_vendeur_identifiant'],
  ['un numéro de TVA de l’Union de 19 caractères', achats((c) => { achat(c, SERVICE_ALLEMAND).identifiant = `DE${'0'.repeat(17)}` }), 'achat_vendeur_identifiant'],
  ['un numéro de TVA de l’Union sans son préfixe', achats((c) => { achat(c, SERVICE_ALLEMAND).identifiant = '000000000' }), 'achat_vendeur_identifiant'],
  ['un identifiant hors de l’Union d’un autre pays', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).identifiant = 'CANuage Demo Softw' }), 'achat_vendeur_identifiant'],
  ['un identifiant hors de l’Union de 19 caractères', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).identifiant = 'USNuage Demo Softwa' }), 'achat_vendeur_identifiant'],
  ['un identifiant hors de l’Union qui finit par une espace', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).identifiant = 'USNuage ' }), 'achat_vendeur_identifiant'],
  ['un identifiant hors de l’Union réduit au pays', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).identifiant = 'US' }), 'achat_vendeur_identifiant'],
  ['une livraison datée d’un treizième mois (G1.09)', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2027-13-01' }), 'achat_livraison'],
  ['une période facturée qui finit avant de commencer (G6.20)', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).periodeFin = '2027-09-30' }), 'achat_livraison'],
  ['une période facturée qui commence en 1999 (G1.36)', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).periodeDebut = '1999-12-31' }), 'achat_livraison'],
  ['une livraison datée de 2100 (G1.36)', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2100-01-01' }), 'achat_livraison'],
  ['une livraison datée d’un 29 février d’une année commune', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2027-02-29' }), 'achat_livraison'],
  ['une livraison datée d’un jour 00', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2027-10-00' }), 'achat_livraison'],
  ['une facture datée avec une heure (G1.09)', achats((c) => { achat(c, SERVICE_ALLEMAND).dateFacture = '2027-10-05T00:00' }), 'achat_date'],
  ['une facture sans ventilation (TG-23, 1..n)', achats((c) => { Object.assign(achat(c, SERVICE_ALLEMAND), { lignes: [], htCentimes: 0 }) }), 'achat_sans_ventilation'],
  ['un code de TVA inconnu (G2.31)', achats((c) => { ligneDAchat(c, SERVICE_ALLEMAND, 0).code = 'X' }), 'achat_code_tva'],
  ['le code des îles Canaries, que G2.31 écarte en France', achats((c) => { ligneDAchat(c, SERVICE_ALLEMAND, 0).code = 'L' }), 'achat_code_tva'],
  ['un taux de 19 % (G1.24)', achats((c) => { ligneDAchat(c, SERVICE_ALLEMAND, 0).taux = 19 }), 'achat_taux'],
  ['une exonération sans code de motif (G1.40)', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifCode = null }), 'achat_motif'],
  ['une exonération sans libellé de motif (G1.40)', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = null }), 'achat_motif'],
  ['une exonération dont le libellé n’est que blancs', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = ' \t ' }), 'achat_motif'],
  ['une exonération dont le libellé passe 1 024 caractères', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = 'x'.repeat(1025) }), 'achat_motif'],
  ['une exonération dont le code n’est pas de la liste VATEX', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifCode = 'vatex-eu-132-1i' }), 'achat_motif'],
  ['une exonération dont le code passe 30 caractères', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifCode = `VATEX-EU-${'X'.repeat(22)}` }), 'achat_motif'],
  ['le motif d’un avoir net de taxe sur une facture (G6.21)', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifCode = 'VATEX-FR-CNWVAT' }), 'achat_motif_d_avoir'],
  ['une exonération d’un fournisseur hors de l’Union (G1.102)', achats((c) => {
    Object.assign(ligneDAchat(c, ABONNEMENT_EN_DOLLARS, 0), { code: 'E', motifCode: 'VATEX-EU-132-1I', motifTexte: 'Exonération' })
  }), 'achat_tva_du_vendeur'],
  ['un hors-taxe qui ne fait pas la somme des bases (G1.53)', achats((c) => { achat(c, SERVICE_ALLEMAND).htCentimes = 4901 }), 'achat_totaux'],
  ['une TVA en euros qui ne fait pas la somme des TVA, d’une facture en euros (G1.53)', achats((c) => { achat(c, SERVICE_ALLEMAND).tvaEurosCentimes = 1 }), 'achat_totaux'],
  // Les ventes.
  ['des ventes datées du lendemain de la période', ventes((c) => { jourDeVentes(c, 0).date = '2027-11-01' }), 'ventes_date'],
  ['des ventes datées d’un jour qui n’existe pas', ventes((c) => { jourDeVentes(c, 0).date = '2027-10-0a' }), 'ventes_date'],
  ['des ventes en dollars (G6.23)', ventes((c) => { jourDeVentes(c, 0).devise = 'USD' }), 'ventes_devise'],
  ['une catégorie inconnue (G1.68)', ventes((c) => { jourDeVentes(c, 0).categorie = 'TXX1' }), 'ventes_categorie'],
  ['des ventes de biens sur option pour les débits (G1.67)', ventes((c) => { jourDeVentes(c, 0).optionDebits = true }), 'ventes_option_hors_services'],
  ['des ventes sans répartition par taux (TG-32, 1..n)', ventes((c) => { Object.assign(jourDeVentes(c, 0), { parTaux: [], htCentimes: 0, tvaCentimes: 0 }) }), 'ventes_sans_ventilation'],
  ['des ventes à 19 % (G1.24)', ventes((c) => { ((jourDeVentes(c, 0).parTaux as Json[])[0]).taux = 19 }), 'ventes_taux'],
  ['un hors-taxe de ventes qui ne fait pas la somme (G1.53)', ventes((c) => { jourDeVentes(c, 0).htCentimes = 8001 }), 'ventes_totaux'],
  ['une TVA de ventes qui ne fait pas la somme (G1.53)', ventes((c) => { jourDeVentes(c, 0).tvaCentimes = 1166 }), 'ventes_totaux'],
  // Les paiements.
  ['des paiements datés du lendemain de la période', paiements((c) => { jourDePaiements(c, 0).date = '2027-11-01' }), 'paiements_date'],
  ['des paiements sans répartition par taux (TG-39, 1..n)', paiements((c) => { jourDePaiements(c, 0).parTaux = [] }), 'paiements_sans_ventilation'],
  ['des paiements à 19 % (G1.24)', paiements((c) => { ((jourDePaiements(c, 0).parTaux as Json[])[0]).taux = 19 }), 'paiements_taux'],
  // Les textes libres (XML 1.0, § 2.2).
  ['une raison sociale du déclarant qui porte un caractère de commande', donneesFrr({ nomDuDeclarant: 'Démo\u0001' }), 'caractere_interdit'],
  ['une raison sociale de l’émetteur qui porte U+FFFE', autreEmetteur({ nom: 'Plateforme\uFFFE' }), 'caractere_interdit'],
  ['une raison sociale qui porte une demi-paire de substitution', donneesFrr({ nomDuDeclarant: 'Démo \uD800' }), 'caractere_interdit'],
  ['un identifiant hors de l’Union qui porte un caractère de commande', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).identifiant = 'USNuage\u0007Demo' }), 'caractere_interdit'],
  ['un motif d’exonération qui porte le caractère nul', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = 'Exonération\u0000' }), 'caractere_interdit'],
  // La fin.
  ['des achats sans opération', achats((c) => { c.achats = [] }), 'aucune_operation'],
  ['des ventes sans opération', ventes((c) => { c.transactions = [] }), 'aucune_operation'],
  ['des paiements sans opération', paiements((c) => { c.paiements = [] }), 'aucune_operation'],
]

describe('les refus, un par faute', () => {
  it.each(CAS)('%s', (_quoi, d, cle) => {
    expect(cles(d)).toEqual([cle])
    // Rien ne s'écrit, et le refus dit la règle sans la citer.
    const r = fichierFrr(d)
    expect(r.xml).toBeNull()
    for (const x of r.refus) {
      expect(x.message).not.toMatch(/\b(?:art\.|CGI|BOI|[GPS]\d\.\d)/)
      expect(x.regle).toBe(REFUS_FRR.find((y) => y.cle === x.cle)?.regle)
    }
  })

  it('chaque refus de la liste a au moins un cas, sauf ceux éprouvés à part', () => {
    const vus = new Set(CAS.map(([, , cle]) => cle))
    const aPart: CleRefusFrr[] = ['objet_inconnu', 'contenu_illisible', 'version_du_contenu', 'emetteur_absent', 'paiement_negatif']
    expect(REFUS_FRR.map((r) => r.cle).filter((c) => !vus.has(c) && !aPart.includes(c))).toEqual([])
  })

  it('les messages sont remplis : la valeur fautive, le jour, la facture', () => {
    const message = (d: DonneesFrr) => refusFichierFrr(d)[0].message
    expect(message(declarationAutre({ type_transmission: 'XX' }))).toBe('Une transmission est initiale (IN) ou rectificative (RE) : « XX » n’est ni l’une ni l’autre.')
    expect(message(autreEmetteur({ role: 'DFH' as never })))
      .toBe('L’émetteur du fichier a un rôle inconnu (« DFH ») : WK pour une plateforme, ou le rôle du déclarant quand il émet lui-même.')
    expect(message(donneesFrr({ maintenant: new Date('2027-10-31T21:00:00Z') })))
      .toBe('Le fichier serait daté du 31/10/2027 (22 h 00, Europe/Paris), qui n’est pas après la fin de la période, le 31/10/2027 : il se crée une fois la période finie.')
    expect(message(achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-11-01' }))).toBe('La facture n° INV-2027-0042 est rangée au 01/11/2027, hors de la période.')
    expect(message(achats((c) => { ligneDAchat(c, SERVICE_ALLEMAND, 0).taux = 5.25 }))).toBe('La facture n° INV-2027-0042 porte un taux de TVA que le fichier n’admet pas (5,25 %).')
    expect(message(achats((c) => { achat(c, SERVICE_ALLEMAND).numero = 'x'.repeat(36) })))
      .toBe('Le numéro d’une facture rangée au 05/10/2027 ne s’écrit pas dans le fichier : 35 caractères au plus — lettres sans accent, chiffres, « - », « + », « _ », « / » et des espaces simples, ni au début ni à la fin.')
    expect(message(periodeChangee('2027-10-31', '2027-10-31', ABONNEMENT_EN_DOLLARS)))
      .toBe('La période commence le 31/10/2027 et finit le 31/10/2027 : une période de transmission finit après son début.')
    expect(message(achats((c) => { c.transactions = [{}]; c.paiements = [{}] })))
      .toBe('Le contenu porte aussi des ventes à des particuliers et des paiements : un fichier ne porte que des transactions ou que des paiements, d’un seul rôle de déclarant.')
    expect(message(ventes((c) => { jourDeVentes(c, 0).devise = 'USD' })))
      .toBe('Les ventes du 04/10/2027 sont en « USD » : celles de l’application sont en euros, et le fichier dit leur TVA en euros.')
    expect(message(donneesFrr({ nomDuDeclarant: 'Démo\u0001' }))).toBe('La raison sociale du déclarant porte un caractère que XML n’admet pas : il ne s’écrirait pas tel quel.')
    // Une valeur qui porte un « % » ne se relit pas comme un trou du modèle.
    expect(message(declarationAutre({ type_transmission: '%%' }))).toBe('Une transmission est initiale (IN) ou rectificative (RE) : « %% » n’est ni l’une ni l’autre.')
  })
})

describe('ce qui passe, au bord des règles', () => {
  it.each<[string, DonneesFrr]>([
    ['un identifiant de 50 caractères, une espace simple et « + _ / - »', declarationAutre({ id: `A+_/- b${'x'.repeat(43)}` })],
    ['un matricule de quatre chiffres sous le rôle WK', autreEmetteur({ identifiant: '0001' })],
    ['un tiers sous son SIREN et le rôle WK', autreEmetteur({ schema: '0002', identifiant: SIREN_B })],
    ['le déclarant lui-même, sous son rôle d’acheteur', autreEmetteur({ schema: '0002', identifiant: SIREN_A, role: 'BY' })],
    ['une raison sociale de 150 caractères, en emojis', autreEmetteur({ nom: '😀'.repeat(150) })],
    ['une raison sociale du déclarant de 150 caractères après la mise sur une ligne', donneesFrr({ nomDuDeclarant: ` ${'x'.repeat(150)}\n` })],
    ['une tabulation verticale dans une raison sociale, mise sur une ligne', donneesFrr({ nomDuDeclarant: 'Démo\vConseil' })],
    ['une tabulation verticale dans la raison sociale de l’émetteur, mise sur une ligne', autreEmetteur({ nom: 'Plateforme\vFictive' })],
    ['une livraison datée du 29 février 2000, bissextile', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2000-02-29' })],
    ['une livraison datée du 31/12/2099', achats((c) => { achat(c, BIENS_ITALIENS).dateOperation = '2099-12-31' })],
    ['un fichier créé à 0 h 30 le 1er novembre à Paris', donneesFrr({ maintenant: new Date('2027-10-31T23:30:00Z') })],
    ['une facture datée du jour de la création du fichier, à Paris (G1.07)', achats((c) => { achat(c, SERVICE_ALLEMAND).dateFacture = '2027-11-06' }, { maintenant: new Date('2027-11-05T23:30:00Z') })],
    ['un achat rangé le premier jour de la période', achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-10-01' })],
    ['un achat rangé le dernier jour de la période', achats((c) => { achat(c, SERVICE_ALLEMAND).date = '2027-10-31' })],
    ['un numéro de 35 caractères', achats((c) => { achat(c, SERVICE_ALLEMAND).numero = 'x'.repeat(35) })],
    ['un cadre de facture déjà payée (S2), que G1.02 admet', achats((c) => { achat(c, SERVICE_ALLEMAND).cadre = 'S2' })],
    ['la Grèce sous 0223, l’Irlande du Nord hors de l’Union', achats((c) => {
      Object.assign(achat(c, SERVICE_ALLEMAND), { pays: 'GR', identifiant: 'EL000000000' })
      Object.assign(achat(c, ABONNEMENT_EN_DOLLARS), { pays: 'GB', identifiant: 'GBNuage Demo Softw' })
    })],
    ['un taux de 5,5 % sur un achat (G1.24 : le format, pas l’hypothèse Q7)', achats((c) => { ligneDAchat(c, SERVICE_ALLEMAND, 0).taux = 5.5 })],
    ['un libellé de motif de 1 024 caractères', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = 'x'.repeat(1024) })],
    ['le motif d’un avoir net de taxe sur un avoir (G6.21)', achats((c) => {
      Object.assign(ligneDAchat(c, AVOIR_ALLEMAND, 0), { motifCode: 'VATEX-FR-CNWVAT', motifTexte: 'Avoir net de taxe' })
    })],
    ['une TVA en euros d’une facture en dollars (G1.53 ne vaut qu’en euros)', achats((c) => { achat(c, ABONNEMENT_EN_DOLLARS).tvaEurosCentimes = 1 })],
    ['une facture qui cite une facture antérieure (TG-11, 0..n)', achats((c) => { achat(c, SERVICE_ALLEMAND).origine = { numero: 'INV-2027-0001', date: '2027-09-01' } })],
    ['les catégories TNT1 et TMA1 (G1.68)', ventes((c) => { jourDeVentes(c, 0).categorie = 'TNT1'; jourDeVentes(c, 1).categorie = 'TMA1' })],
    ['des ventes de services sur option pour les débits', ventes((c) => { jourDeVentes(c, 1).optionDebits = true })],
    // G1.67 rend l'option obligatoire pour les services sans l'interdire ailleurs ; TNT1 et TMA1 comptent des services
    // (G1.68 : « livraisons de biens et prestations de services » ; CGI, art. 266, 1, e). Seul TLB1, des biens, se refuse.
    ['l’option pour les débits sous TNT1 et TMA1, qui comptent des services (G1.67, G1.68)', ventes((c) => {
      Object.assign(jourDeVentes(c, 0), { categorie: 'TNT1', optionDebits: true })
      Object.assign(jourDeVentes(c, 1), { categorie: 'TMA1', optionDebits: true })
    })],
    ['un saut de ligne dans un motif, que XML admet', achats((c) => { ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = 'Exonération\nart. 132' })],
  ])('%s', (_quoi, d) => {
    expect(refusFichierFrr(d)).toEqual([])
    expect(fichierFrr(d).xml).not.toBeNull()
  })

  it('un cadre et une TVA en euros s’écrivent tels que figés ; un motif garde son saut de ligne', () => {
    const doc = lire(xmlDe(achats((c) => {
      achat(c, SERVICE_ALLEMAND).cadre = 'S2'
      achat(c, ABONNEMENT_EN_DOLLARS).tvaEurosCentimes = 1
      ligneDAchat(c, FORMATION_BELGE, 0).motifTexte = 'Exonération\nart. 132'
    })))
    expect(valeurs(doc, `${TG8}/BusinessProcess/ID`)[SERVICE_ALLEMAND]).toBe('S2')
    expect(valeurs(doc, `${TG8}/MonetaryTotal/TaxAmount`)[ABONNEMENT_EN_DOLLARS]).toBe('0.01')
    expect(valeurs(doc, `${TG8}/TaxSubTotal/TaxCategory/TaxExemptionReason`)).toEqual(['Exonération\nart. 132'])
  })
})

describe('l’ordre des refus', () => {
  it('la liste, épinglée : la déclaration, le contenu, les choix, l’en-tête, la période, les opérations, la fin', () => {
    expect(REFUS_FRR.map((r) => r.cle)).toEqual([
      'objet_inconnu', 'declaration_remplacee', 'type_de_transmission', 'rectificative_discordante', 'identifiant_de_transmission',
      'contenu_illisible', 'version_du_contenu', 'contenu_d_une_autre_declaration', 'role_du_declarant', 'objets_meles',
      'emetteur_absent', 'emetteur_schema', 'emetteur_siren', 'emetteur_matricule', 'emetteur_role', 'emetteur_plateforme',
      'emetteur_declarant', 'emetteur_nom', 'fuseau', 'code_option_debits', 'choix_paiements_negatifs',
      'horodatage', 'horodatage_avant_la_fin', 'siren_du_declarant', 'nom_du_declarant', 'numero_tva_du_declarant',
      'periode_dates', 'periode_bornes',
      'achat_hors_periode', 'achat_numero', 'achat_date', 'achat_type', 'achat_avoir_sans_origine', 'achat_origine', 'achat_devise',
      'achat_cadre', 'achat_vendeur_schema', 'achat_vendeur_pays', 'achat_vendeur_identifiant', 'achat_livraison',
      'achat_sans_ventilation', 'achat_code_tva', 'achat_taux', 'achat_motif', 'achat_motif_d_avoir', 'achat_tva_du_vendeur',
      'achat_totaux',
      'ventes_date', 'ventes_devise', 'ventes_categorie', 'ventes_option_hors_services', 'ventes_sans_ventilation', 'ventes_taux',
      'ventes_totaux',
      'paiements_date', 'paiements_sans_ventilation', 'paiements_taux', 'paiement_negatif',
      'caractere_interdit', 'aucune_operation',
    ])
  })

  it('plusieurs fautes : chacune son refus, dans l’ordre de la liste ; dans une même clé, l’ordre du contenu', () => {
    const d = donneesFrr({
      declaration: changee(DECLARATION_ACHATS, (c) => {
        c.numeroTva = null
        achat(c, FORMATION_BELGE).devise = 'eur'
        achat(c, SERVICE_ALLEMAND).devise = 'Eu'
        ligneDAchat(c, BIENS_ITALIENS, 0).code = 'X'
        achat(c, AVOIR_ALLEMAND).numero = 'x'.repeat(40)
      }, { etat: 'remplacee' }),
      nomDuDeclarant: 'Démo\u0001',
      choix: choixFrr({ fuseau: 'Asia/Tokyo' as never, emetteur: { ...PLATEFORME_FRR, identifiant: '1' } }),
    })
    const refus = refusFichierFrr(d)
    expect(refus.map((r) => r.cle)).toEqual([
      'declaration_remplacee', 'emetteur_matricule', 'fuseau', 'numero_tva_du_declarant', 'achat_numero', 'achat_devise', 'achat_devise',
      'achat_code_tva', 'caractere_interdit',
    ])
    expect(refus.filter((r) => r.cle === 'achat_devise').map((r) => r.message))
      .toEqual(['La facture n° INV-2027-0042 est en « Eu », qui n’est pas un code de devise de trois lettres.',
        'La facture n° BE-FORM-77 est en « eur », qui n’est pas un code de devise de trois lettres.'])
  })

  it('des achats d’un déclarant au SIREN faux et sans numéro de TVA : les deux refus, le second sans le SIREN', () => {
    // Un numéro absent manque toujours ; un numéro présent ne se confronte qu'à un SIREN valide (cas « un SIREN du
    // déclarant à la clé fausse » : un seul refus).
    expect(cles(achats((c) => { c.siren = '123456789'; c.numeroTva = null }))).toEqual(['siren_du_declarant', 'numero_tva_du_declarant'])
  })

  it('une facture fautive en plusieurs points reçoit un refus par faute', () => {
    expect(cles(achats((c) => {
      Object.assign(achat(c, SERVICE_ALLEMAND), { dateFacture: '1999-01-01', cadre: 'Z', devise: '?', htCentimes: 1 })
    }))).toEqual(['achat_date', 'achat_devise', 'achat_cadre', 'achat_totaux'])
  })
})

// ── Le contenu figé, lu sans rien deviner ──────────────────────────────────────────────────────────────────────────

describe('le contenu figé, lu sans rien deviner', () => {
  const illisible = (d: DonneesFrr) => {
    const refus = refusFichierFrr(d)
    expect(refus.map((r) => r.cle)).toEqual(['contenu_illisible'])
    return refus[0].message
  }

  it('un objet inconnu arrête tout : rien ne se lit', () => {
    const d = donneesFrr({ declaration: { ...DECLARATION_ACHATS, objet: 'tva', etat: 'remplacee' }, choix: choixFrr({ fuseau: 'x' as never }) })
    expect(refusFichierFrr(d)).toEqual([{
      cle: 'objet_inconnu', regle: 'G7.52, G6.29',
      message: 'Une déclaration d’e-reporting porte sur les ventes, les achats ou les paiements du dossier : « tva » n’est aucun des trois.',
    }])
    expect(OBJETS_FRR).toEqual(['ventes', 'achats', 'paiements'])
  })

  it('un contenu qui n’est pas un objet', () => {
    for (const contenu of [null, [], 'achats', 42]) {
      expect(illisible(declarationAutre({ contenu }))).toBe('Le contenu figé de la déclaration ne se lit pas (un objet est attendu) : rien ne s’en écrit.')
    }
  })

  it('une autre version arrête la lecture', () => {
    for (const version of [2, '1', undefined]) {
      const refus = refusFichierFrr(achats((c) => { c.version = version }))
      expect(refus.map((r) => r.cle)).toEqual(['version_du_contenu'])
      expect(refus[0].message).toBe(`Le contenu figé est de la version ${String(version)}, que ce module ne sait pas écrire : il écrit la version 1.`)
    }
  })

  it('la première faute de lecture est dite, son chemin et ce qu’il y fallait — jamais la valeur', () => {
    const cas: [string, (c: Json) => void, string][] = [
      ['des achats qui ne sont pas une liste', (c) => { c.achats = {} }, 'achats : une liste est attendue'],
      ['un achat qui n’est pas un objet', (c) => { liste(c, 'achats')[1] = 3 as never }, 'achats[1] : un objet est attendu'],
      ['un achat sans date', (c) => { delete achat(c, 0).date }, 'achats[0].date : un texte est attendu'],
      ['une date de livraison absente plutôt que nulle', (c) => { delete achat(c, 0).dateOperation }, 'achats[0].dateOperation : un texte ou rien est attendu'],
      ['une base en euros, pas en centimes', (c) => { ligneDAchat(c, 0, 0).baseCentimes = 49.5 }, 'achats[0].lignes[0].baseCentimes : un nombre entier de centimes est attendu'],
      ['une base au-delà des entiers sûrs', (c) => { ligneDAchat(c, 0, 0).baseCentimes = 2 ** 53 }, 'achats[0].lignes[0].baseCentimes : un nombre entier de centimes est attendu'],
      ['un taux écrit en texte', (c) => { ligneDAchat(c, 0, 0).taux = '0' }, 'achats[0].lignes[0].taux : un nombre est attendu'],
      ['un taux infini', (c) => { ligneDAchat(c, 0, 0).taux = Infinity }, 'achats[0].lignes[0].taux : un nombre est attendu'],
      ['une origine qui n’est pas une facture', (c) => { achat(c, AVOIR_ALLEMAND).origine = 'INV-2027-0042' }, `achats[${AVOIR_ALLEMAND}].origine : la facture d’origine ou rien est attendu`],
      ['une origine sans date', (c) => { delete (achat(c, AVOIR_ALLEMAND).origine as Json).date }, `achats[${AVOIR_ALLEMAND}].origine.date : un texte est attendu`],
      ['un SIREN écrit en nombre', (c) => { c.siren = 123456782 }, 'siren : un texte ou rien est attendu'],
      ['un numéro de TVA absent', (c) => { delete c.numeroTva }, 'numeroTva : un texte ou rien est attendu'],
      ['un rôle absent', (c) => { delete c.role }, 'role : un texte est attendu'],
      ['deux fautes : la première, dans l’ordre de lecture', (c) => { delete achat(c, 0).numero; ligneDAchat(c, 1, 0).baseCentimes = 0.5 }, 'achats[0].numero : un texte est attendu'],
    ]
    for (const [quoi, f, chemin] of cas) {
      expect(illisible(achats(f)), quoi).toBe(`Le contenu figé de la déclaration ne se lit pas (${chemin}) : rien ne s’en écrit.`)
    }
    expect(illisible(ventes((c) => { jourDeVentes(c, 0).optionDebits = 'oui' }))).toContain('(transactions[0].optionDebits : vrai ou faux est attendu)')
    expect(illisible(ventes((c) => { delete ((jourDeVentes(c, 0).parTaux as Json[])[0]).tvaCentimes })))
      .toContain('(transactions[0].parTaux[0].tvaCentimes : un nombre entier de centimes est attendu)')
    expect(illisible(paiements((c) => { ((jourDePaiements(c, 1).parTaux as Json[])[0]).montantCentimes = '12000' })))
      .toContain('(paiements[1].parTaux[0].montantCentimes : un nombre entier de centimes est attendu)')
  })

  it('un contenu illisible arrête ce qui en dépend, pas ce qui se juge sans lui', () => {
    const d = donneesFrr({
      declaration: changee(DECLARATION_ACHATS, (c) => { delete c.siren }, { etat: 'remplacee' }),
      choix: choixFrr({ fuseau: 'x' as never }),
      nomDuDeclarant: '',
    })
    expect(cles(d)).toEqual(['declaration_remplacee', 'contenu_illisible', 'fuseau', 'nom_du_declarant'])
  })

  it('ce que le fichier n’écrit pas ne se lit pas : un total du contenu qu’aucune donnée du fichier ne porte', () => {
    expect(cles(paiements((c) => { jourDePaiements(c, 0).montantCentimes = 'quelconque'; c.nombreOperations = -1 }))).toEqual([])
    expect(cles(achats((c) => { c.totauxParDevise = null; delete achat(c, 0).nature }))).toEqual([])
  })

  it('des listes vides d’un autre objet ne mêlent rien', () => {
    expect(cles(achats((c) => { c.transactions = []; c.paiements = [] }))).toEqual([])
  })
})

// ── G6.29, que le schéma ne voit pas ───────────────────────────────────────────────────────────────────────────────

describe('des transactions OU des paiements, jamais les deux (G6.29) — ce que le schéma laisse passer', () => {
  it('aucun fichier écrit ne porte les deux blocs : un par déclaration, celui de son objet', () => {
    for (const d of [DECLARATION_ACHATS, DECLARATION_ACHATS_RECTIFIES, DECLARATION_VENTES, DECLARATION_PAIEMENTS]) {
      const xml = xmlDe(donneesFrr({ declaration: d }))
      expect(xml.includes('<TransactionsReport>') && xml.includes('<PaymentsReport>'), d.objet).toBe(false)
    }
  })

  it('un contenu qui en porte deux se refuse, et rien ne s’écrit', () => {
    const d = ventes((c) => { c.paiements = clone(DECLARATION_PAIEMENTS.contenu as Json).paiements })
    expect(cles(d)).toEqual(['objets_meles'])
    expect(fichierFrr(d).xml).toBeNull()
  })
})

// ── Ce que le module partage avec les sources et le dépôt ──────────────────────────────────────────────────────────

describe('les listes du module, confrontées à leur source', () => {
  it('G1.24 : les quinze taux, ceux du générateur de la facture électronique', () => {
    expect([...TAUX_ADMIS].sort((a, b) => a - b)).toEqual([0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6])
  })

  it('G2.31, G1.02, G1.68 : recopiés de l’annexe 7', () => {
    expect(CODES_TVA_FRR).toEqual(['S', 'E', 'AE', 'K', 'G', 'O', 'Z'])
    expect(CADRES_FRR).toEqual(['B1', 'S1', 'M1', 'B2', 'S2', 'M2', 'B4', 'S4', 'M4', 'S5', 'S6', 'B7', 'S7'])
    expect(CATEGORIES_FRR).toEqual(['TLB1', 'TPS1', 'TNT1', 'TMA1'])
    expect(TYPES_DE_FACTURE_FRR).toEqual(['380', '381'])
  })

  it('chaque règle qu’un refus cite vaut pour le flux 10 (annexe 7, colonne « RG applicable au F10 »)', () => {
    // Les soixante règles que la colonne marque, recopiées de l'annexe 7 v1.9 : une jumelle du flux 1 (G1.43 pour
    // G1.44, par exemple) n'y est pas.
    const DU_FLUX_10 = new Set(['G1.01', 'G1.02', 'G1.05', 'G1.07', 'G1.09', 'G1.10', 'G1.102', 'G1.104', 'G1.14', 'G1.15',
      'G1.16', 'G1.18', 'G1.24', 'G1.32', 'G1.36', 'G1.38', 'G1.40', 'G1.42', 'G1.44', 'G1.52', 'G1.53', 'G1.55', 'G1.57',
      'G1.60', 'G1.65', 'G1.66', 'G1.67', 'G1.68', 'G2.01', 'G2.19', 'G2.31', 'G2.33', 'G6.06', 'G6.07', 'G6.08', 'G6.11',
      'G6.14', 'G6.15', 'G6.20', 'G6.21', 'G6.22', 'G6.23', 'G6.24', 'G6.25', 'G6.26', 'G6.27', 'G6.28', 'G6.29', 'G6.30',
      'G7.07', 'G7.40', 'G7.43', 'G7.51', 'G7.52', 'G7.53', 'G8.01', 'G8.05', 'P1.11', 'P1.12', 'S1.12'])
    expect(DU_FLUX_10.size).toBe(60)
    const citees = REFUS_FRR.flatMap((r) => r.regle.match(/\b[GPS]\d\.\d+\b/g) ?? [])
    expect(new Set(citees).size).toBeGreaterThan(30)
    expect(citees.filter((r) => !DU_FLUX_10.has(r))).toEqual([])
  })

  it('les copies d’e2 et d’e5b1 : les États membres, le motif VATEX, la version du contenu', () => {
    expect([...ETATS_MEMBRES_FRR].sort()).toEqual([...ETATS_MEMBRES_HORS_FRANCE].sort())
    expect(MOTIF_VATEX_FRR.source).toBe(MOTIF_VATEX.source)
    expect(VERSION_DU_CONTENU_FRR).toBe(VERSION_DU_CONTENU)
  })

  it('le rôle de chaque objet est celui qu’e4 fige dans son contenu (G7.52)', () => {
    for (const d of [DECLARATION_ACHATS, DECLARATION_VENTES, DECLARATION_PAIEMENTS]) {
      expect((d.contenu as Json).role).toBe(ROLE_DU_DECLARANT_FRR[d.objet as 'achats'])
    }
  })

  it('ce qu’e4 calcule et ce que la base garde se lisent comme le module les lit (le compilateur, sans `as`)', () => {
    const ligneDAchatLue = (l: LigneAchatDeclaree): LigneAchatFrr => l
    const achatLu = (a: AchatDeclare): AchatFrr => a
    const transactionsLues = (t: TransactionsDuJour): TransactionsFrr => t
    const paiementsLus = (p: PaiementsDuJour): PaiementsFrr => p
    const declarationLue = (d: DeclarationEreportingHorsApplication): DeclarationPourFrr => d
    expect([ligneDAchatLue, achatLu, transactionsLues, paiementsLus, declarationLue]).toHaveLength(5)
  })

  it('chaque règle que la conception attribue au fichier est citée par le code qui l’applique', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/fluxEreporting.ts'), 'utf8')
    for (const regle of ['G1.104', 'G8.01', 'G8.05', 'G7.43', 'G7.53', 'G6.24', 'G6.25', 'G6.26', 'G7.52', 'G6.29', 'G6.28', 'G2.19',
      'G2.33', 'G2.31', 'G1.24', 'G1.53', 'G1.14', 'G7.07', 'G6.23', 'G6.27', 'G1.68', 'S1.12', 'G1.02', 'G1.40']) {
      expect(source, regle).toMatch(new RegExp(`\\b${regle.replace('.', '\\.')}\\b`))
    }
  })
})

describe('G6.24 suit de G6.25 et de G7.43', () => {
  it('une période qui commence après la création du fichier finit après elle : G7.43 la refuse', () => {
    expect(cles(donneesFrr({ maintenant: new Date('2027-09-15T10:00:00Z') }))).toContain('horodatage_avant_la_fin')
  })
})

// ── Le fuseau de la machine n'y est pour rien ──────────────────────────────────────────────────────────────────────

describe('les quatre fuseaux de la suite', () => {
  const fuseauDOrigine = process.env.TZ
  afterEach(() => {
    process.env.TZ = fuseauDOrigine
  })

  it('le même fichier, que la machine soit à Paris, en UTC, à New York ou à Auckland', () => {
    const attendus = EXEMPLES_FRR.map((e) => xmlDe(e.donnees))
    for (const tz of ['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = tz
      expect(EXEMPLES_FRR.map((e) => xmlDe(e.donnees)), tz).toEqual(attendus)
    }
  })
})

// ── Le dernier mot est au validateur ───────────────────────────────────────────────────────────────────────────────

describe('les exemples ont passé le schéma XSD du flux 10 de la DGFiP', () => {
  it('chaque exemple figé porte l’empreinte que outils/facturation/ereporting/valider.mjs a écrite', () => {
    const fichiers = readdirSync(DOSSIER_EXEMPLES).filter((f) => f.endsWith('.xml')).sort()
    expect(fichiers).toEqual(EXEMPLES_FRR.map((e) => `${e.nom}.xml`).sort())
    const manifeste = JSON.parse(readFileSync(`${DOSSIER_EXEMPLES}valides.json`, 'utf8')) as { fichiers: Record<string, { sha256: string }> }
    expect(Object.keys(manifeste.fichiers).sort()).toEqual(fichiers)
    for (const f of fichiers) {
      const empreinte = createHash('sha256').update(readFileSync(`${DOSSIER_EXEMPLES}${f}`)).digest('hex')
      expect(manifeste.fichiers[f].sha256, `${f} a changé depuis sa validation : relancer valider.mjs`).toBe(empreinte)
    }
  })
})
