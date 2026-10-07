// @vitest-environment jsdom
// L'analyseur XML est celui du navigateur (`DOMParser`) : ces tests tournent donc dans jsdom, le seul fichier de la
// suite « logique » qui en ait besoin. Les factures sont FICTIVES, écrites ici pour la forme de la norme.
import { describe, expect, it } from 'vitest'
import {
  concordanceAvecLeDossier,
  confianceDeLaFacture,
  lireFactureXml,
  montantEnTexte,
  montantsDeLaFacture,
  sirenDuDossier,
  texteDeLaFacture,
  tiersDeLaFacture,
  TYPES_AVOIR,
  TYPES_FACTURE,
  type FactureLue,
} from './factureElectronique'

const ESPACES_CII = 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"'

interface OptionsCii {
  numero?: string
  type?: string
  date?: string
  formatDate?: string | null
  devise?: string | null
  vendeur?: string
  acheteur?: string
  ventilation?: string
  totaux?: string
  lignes?: string
  echeance?: string
}

const VENDEUR_CII = `<ram:Name>Fournitures Martin SARL</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">123456782</ram:ID></ram:SpecifiedLegalOrganization>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR40123456782</ram:ID></ram:SpecifiedTaxRegistration>`
const ACHETEUR_CII = `<ram:Name>Cabinet infirmier des Lilas</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">987654321</ram:ID></ram:SpecifiedLegalOrganization>`
const VENTILATION_CII = `<ram:ApplicableTradeTax>
        <ram:CalculatedAmount>20.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>20</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`
const TOTAUX_CII = `<ram:LineTotalAmount>100.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>120.00</ram:DuePayableAmount>`
const LIGNE_CII = (nom: string, montant: string) => `<ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${nom}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${montant}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`

function cii(o: OptionsCii = {}): string {
  const format = o.formatDate === undefined ? ' format="102"' : o.formatDate === null ? '' : ` format="${o.formatDate}"`
  const devise = o.devise === undefined ? '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>'
    : o.devise === null ? '' : `<ram:InvoiceCurrencyCode>${o.devise}</ram:InvoiceCurrencyCode>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${ESPACES_CII}>
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${o.numero ?? 'F2026-0042'}</ram:ID>
    <ram:TypeCode>${o.type ?? '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString${format}>${o.date ?? '20260915'}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${o.lignes ?? LIGNE_CII('Ramette de papier', '100.00')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        ${o.vendeur ?? VENDEUR_CII}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        ${o.acheteur ?? ACHETEUR_CII}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      ${devise}
      ${o.ventilation ?? VENTILATION_CII}
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${o.echeance ?? '20261015'}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        ${o.totaux ?? TOTAUX_CII}
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

const ESPACES_UBL = 'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'

interface OptionsUbl {
  avoir?: boolean
  type?: string
  /** `null` : sans numéro. */
  numero?: string | null
  /** `null` : sans date d'émission. */
  date?: string | null
  devise?: string
  /** Écrit après la devise : une référence à une facture antérieure (BG-3), par exemple. */
  reference?: string
  fournisseur?: string
  client?: string
  taxes?: string
  totaux?: string
  /** Écrit dans la première ligne. */
  dansLaLigne?: string
}

const FOURNISSEUR_UBL = `<cac:PartyName><cbc:Name>Logiciels Dupont</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>FR83111222333</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Logiciels Dupont SAS</cbc:RegistrationName><cbc:CompanyID schemeID="0002">111222333</cbc:CompanyID></cac:PartyLegalEntity>`
const CLIENT_UBL = `<cac:PartyLegalEntity><cbc:RegistrationName>Cabinet infirmier des Lilas</cbc:RegistrationName><cbc:CompanyID schemeID="0009">98765432100017</cbc:CompanyID></cac:PartyLegalEntity>`
const sousTotal = (base: string, tva: string, taux: string, devise = 'EUR') =>
  `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${devise}">${base}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${devise}">${tva}</cbc:TaxAmount>` +
  `<cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${taux}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`
const TAXES_UBL = `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">11.00</cbc:TaxAmount>${sousTotal('50.00', '10.00', '20')}${sousTotal('10.00', '1.00', '10')}</cac:TaxTotal>`
const TOTAUX_UBL = `<cbc:LineExtensionAmount currencyID="EUR">60.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">60.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">71.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">71.00</cbc:PayableAmount>`

function ubl(o: OptionsUbl = {}): string {
  const racine = o.avoir ? 'CreditNote' : 'Invoice'
  const ligne = o.avoir ? 'CreditNoteLine' : 'InvoiceLine'
  const quantite = o.avoir ? 'CreditedQuantity' : 'InvoicedQuantity'
  return `<?xml version="1.0" encoding="UTF-8"?>
<${racine} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${racine}-2" ${ESPACES_UBL}>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  ${o.numero === null ? '' : `<cbc:ID>${o.numero ?? 'FA-77'}</cbc:ID>`}
  ${o.date === null ? '' : `<cbc:IssueDate>${o.date ?? '2026-09-20'}</cbc:IssueDate>`}
  ${o.avoir ? '' : '<cbc:DueDate>2026-10-20</cbc:DueDate>'}
  <cbc:${racine}TypeCode>${o.type ?? (o.avoir ? '381' : '380')}</cbc:${racine}TypeCode>
  <cbc:DocumentCurrencyCode>${o.devise ?? 'EUR'}</cbc:DocumentCurrencyCode>
  ${o.reference ?? ''}
  <cac:AccountingSupplierParty><cac:Party>${o.fournisseur ?? FOURNISSEUR_UBL}</cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>${o.client ?? CLIENT_UBL}</cac:Party></cac:AccountingCustomerParty>
  ${o.taxes ?? TAXES_UBL}
  <cac:LegalMonetaryTotal>${o.totaux ?? TOTAUX_UBL}</cac:LegalMonetaryTotal>
  <cac:${ligne}><cbc:ID>1</cbc:ID><cbc:${quantite} unitCode="C62">1</cbc:${quantite}>
    <cbc:LineExtensionAmount currencyID="EUR">50.00</cbc:LineExtensionAmount>${o.dansLaLigne ?? ''}<cac:Item><cbc:Name>Abonnement logiciel</cbc:Name></cac:Item></cac:${ligne}>
  <cac:${ligne}><cbc:ID>2</cbc:ID><cbc:${quantite} unitCode="C62">1</cbc:${quantite}>
    <cbc:LineExtensionAmount currencyID="EUR">10.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Formation</cbc:Name></cac:Item></cac:${ligne}>
</${racine}>`
}

function lue(xml: string): FactureLue {
  const r = lireFactureXml(xml)
  if ('refus' in r) throw new Error(`refusé : ${r.refus}`)
  return r.facture
}

function refus(xml: string): string {
  const r = lireFactureXml(xml)
  if (!('refus' in r)) throw new Error('lu alors qu’un refus était attendu')
  return r.refus
}

describe('lireFactureXml — CII (le XML de Factur-X)', () => {
  it('lit chaque champ à sa place', () => {
    const f = lue(cii())
    expect(f).toMatchObject({
      syntaxe: 'CII',
      numero: 'F2026-0042',
      typeCode: '380',
      nature: 'facture',
      date: '2026-09-15',
      echeance: '2026-10-15',
      devise: 'EUR',
      vendeur: { nom: 'Fournitures Martin SARL', siren: '123456782', tva: 'FR40123456782' },
      acheteur: { nom: 'Cabinet infirmier des Lilas', siren: '987654321', tva: null },
      montantHt: 100,
      montantTva: 20,
      montantTtc: 120,
      netAPayer: 120,
      nbLignes: 1,
      anomalies: [],
    })
    expect(f.lignes).toEqual([{ libelle: 'Ramette de papier', montant: 100 }])
    expect(confianceDeLaFacture(f)).toBe('haute')
  })

  it('ne lit la ventilation que de l’en-tête : la TVA d’une ligne n’est pas un taux de la facture', () => {
    // Chaque ligne porte aussi un `ApplicableTradeTax` ; une recherche dans tout le document les compterait.
    const f = lue(cii({ lignes: LIGNE_CII('A', '60.00') + LIGNE_CII('B', '40.00') }))
    expect(f.ventilation).toEqual([{ categorie: 'S', taux: 20, base: 100, tva: 20, motif: null, codeMotif: null }])
    expect(f.lignes.map((l) => l.libelle)).toEqual(['A', 'B'])
  })

  it('le nom d’une ligne n’est jamais pris pour celui du vendeur', () => {
    const f = lue(cii({ vendeur: '<ram:SpecifiedLegalOrganization><ram:ID>123456782</ram:ID></ram:SpecifiedLegalOrganization>' }))
    expect(f.vendeur.nom).toBeNull()
    expect(f.vendeur.siren).toBe('123456782')
  })

  it('reprend le nom commercial quand la raison sociale manque', () => {
    const f = lue(cii({
      vendeur: '<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">123456782</ram:ID>' +
        '<ram:TradingBusinessName>Martin Bureau</ram:TradingBusinessName></ram:SpecifiedLegalOrganization>',
    }))
    expect(f.vendeur.nom).toBe('Martin Bureau')
  })

  it('le préfixe est libre : seul l’espace de noms désigne l’élément', () => {
    const autre = cii()
      .replaceAll('rsm:', 'cii:').replaceAll('xmlns:rsm=', 'xmlns:cii=')
      .replaceAll('ram:', 'x:').replaceAll('xmlns:ram=', 'xmlns:x=')
    const f = lue(autre)
    expect(f.numero).toBe('F2026-0042')
    expect(f.montantTtc).toBe(120)
    expect(f.vendeur.nom).toBe('Fournitures Martin SARL')
  })

  it('un mauvais espace de noms n’est pas une facture', () => {
    expect(refus(cii().replace('CrossIndustryInvoice:100" ', 'CrossIndustryInvoice:999" ')))
      .toMatch(/ni une facture CII ni une facture UBL/)
  })

  it('la date d’émission est au format 102 ; un autre format ou un jour impossible ne donnent pas de date', () => {
    expect(lue(cii({ formatDate: null })).date).toBe('2026-09-15')
    const periode = lue(cii({ formatDate: '610', date: '202609' }))
    expect(periode.date).toBeNull()
    expect(periode.anomalies).toContain('Date d’émission absente ou illisible')
    // Huit chiffres sous un autre format ne sont pas davantage un jour : seul le format dit ce qu'ils sont.
    expect(lue(cii({ formatDate: '610', date: '20260915' })).date).toBeNull()
    expect(lue(cii({ date: '20260230' })).date).toBeNull()
    expect(lue(cii({ date: '2026-09-15' })).date).toBeNull()
  })

  it('prend le total de TVA dans la devise de la facture, pas celui de la devise de comptabilisation', () => {
    const f = lue(cii({
      devise: 'USD',
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">18.52</ram:TaxTotalAmount>
        <ram:TaxTotalAmount currencyID="USD">20.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>`,
    }))
    expect(f.devise).toBe('USD')
    expect(f.montantTva).toBe(20)
    expect(f.anomalies).toEqual([])
  })

  it('sans total dans la devise de la facture, la TVA est la somme de sa ventilation (BR-CO-14)', () => {
    const f = lue(cii({
      devise: 'USD',
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">18.52</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>`,
    }))
    expect(f.montantTva).toBe(20)
    expect(f.anomalies).toEqual([])
  })

  it('sans total ni ventilation, la TVA est le TTC moins le hors taxes — et la déduction se dit', () => {
    const f = lue(cii({
      ventilation: '',
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:GrandTotalAmount>105.50</ram:GrandTotalAmount>`,
    }))
    expect(f.montantTva).toBe(5.5)
    expect(f.anomalies).toEqual(['Total de la TVA absent : déduit du TTC moins le hors taxes'])
    expect(confianceDeLaFacture(f)).toBe('moyenne')
  })

  it('deux totaux de TVA qu’on ne sait pas départager ne donnent aucun des deux', () => {
    const f = lue(cii({
      ventilation: '',
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount>20.00</ram:TaxTotalAmount><ram:TaxTotalAmount>18.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>`,
    }))
    expect(f.anomalies).toContain('Total de la TVA ambigu : plusieurs totaux pour la devise de la facture')
    // Deux totaux qui disent tous deux la devise de la facture ne se départagent pas davantage : aucun n'est pris, et
    // la TVA est celle que la norme définit (BR-CO-15), le TTC moins le hors taxes.
    const g = lue(cii({
      ventilation: '',
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">18.00</ram:TaxTotalAmount><ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>`,
    }))
    expect(g.montantTva).toBe(20)
    expect(g.anomalies).toEqual([
      'Total de la TVA ambigu : plusieurs totaux pour la devise de la facture',
      'Total de la TVA déduit du TTC moins le hors taxes',
    ])
  })

  it('un TTC qui ne vaut pas le hors taxes plus la TVA se dit', () => {
    const f = lue(cii({ totaux: TOTAUX_CII.replace('<ram:GrandTotalAmount>120.00', '<ram:GrandTotalAmount>121.00') }))
    expect(f.montantTtc).toBe(121)
    expect(f.anomalies).toEqual(['Le total TTC ne vaut pas le hors taxes plus la TVA'])
    expect(confianceDeLaFacture(f)).toBe('moyenne')
  })

  it('compare les totaux en centimes : 0,29 + 0,06 vaut bien 0,35', () => {
    const f = lue(cii({
      ventilation: '',
      totaux: `<ram:TaxBasisTotalAmount>0.29</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">0.06</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>0.35</ram:GrandTotalAmount>`,
    }))
    expect(f.anomalies).toEqual([])
  })

  it('lit un montant en centimes exacts, au plus deux décimales significatives', () => {
    const avec = (ttc: string) => lue(cii({ ventilation: '', totaux: `<ram:GrandTotalAmount>${ttc}</ram:GrandTotalAmount>` }))
    expect(avec('1234.5').montantTtc).toBe(1234.5)
    expect(avec('1234.500').montantTtc).toBe(1234.5)
    expect(avec('+5').montantTtc).toBe(5)
    expect(avec('-12.30').montantTtc).toBe(-12.3)
    expect(avec('-0.00').montantTtc).toBe(0)
    expect(avec('9999999999.99').montantTtc).toBe(9999999999.99)
    expect(Object.is(avec('-0.00').montantTtc, -0)).toBe(false)
    for (const illisible of ['1234.567', '1,234.00', '12 345.00', '1e3', 'douze', '12345678901.00']) {
      const f = avec(illisible)
      expect(f.montantTtc, illisible).toBeNull()
      expect(f.anomalies, illisible).toContain('Total TTC illisible (plus de deux décimales, ou pas un nombre)')
    }
  })

  it('une devise absente ou illisible se dit, et laisse la pièce sans montants', () => {
    const sans = lue(cii({ devise: null }))
    expect(sans.anomalies).toContain('Devise de la facture absente')
    expect(montantsDeLaFacture(sans)).toEqual({ montant_ht: null, montant_tva: null, montant_ttc: null, devise: null })
    expect(lue(cii({ devise: 'eur' })).anomalies).toContain('Devise de la facture illisible')
    expect(lue(cii({ devise: 'EURO' })).devise).toBeNull()
  })

  it('dit un numéro absent et un TTC absent', () => {
    const f = lue(cii({ numero: '', totaux: '<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>' }))
    expect(f.anomalies).toEqual(expect.arrayContaining(['Numéro de facture absent', 'Total TTC absent']))
  })

  it('ne reprend que les deux cents premières lignes, et compte toutes les autres', () => {
    const lignes = Array.from({ length: 205 }, (_, i) => LIGNE_CII(`Article ${i + 1}`, '1.00')).join('')
    const f = lue(cii({ lignes }))
    expect(f.lignes).toHaveLength(200)
    expect(f.nbLignes).toBe(205)
    expect(texteDeLaFacture(f, 'achat')).toContain('… et 5 autre(s) ligne(s)')
  })

  it('un texte de la facture est débarrassé de ses caractères de commande et borné', () => {
    const f = lue(cii({ vendeur: `<ram:Name>  Martin&#9;\n  et   fils ${'x'.repeat(400)}</ram:Name>` }))
    expect(f.vendeur.nom?.startsWith('Martin et fils x')).toBe(true)
    expect(f.vendeur.nom).toHaveLength(255)
    // Un caractère de commande qui n'est pas un blanc — U+0085, que XML 1.0 admet — n'entre pas dans un texte.
    expect(lue(cii({ vendeur: '<ram:Name>Martin&#x85;fils&#x9B;</ram:Name>' })).vendeur.nom).toBe('Martin fils')
  })
})

describe('lireFactureXml — le type décide du sens', () => {
  it('chaque avoir de la norme EN 16931 et de la règle G1.01 de la DGFiP est un avoir', () => {
    for (const code of ['381', '261', '262', '396', '502', '503', '81', '83']) {
      expect(lue(cii({ type: code })).nature, code).toBe('avoir')
    }
  })

  it('chaque facture de la règle G1.01 de la DGFiP est une facture', () => {
    for (const code of ['380', '384', '386', '389', '393', '471', '472', '473', '500', '501']) {
      expect(lue(cii({ type: code })).nature, code).toBe('facture')
    }
  })

  it('les listes sont celles que publie la Commission européenne (BR-CL-01), à deux choix près, et G1.01 y tient', () => {
    // Relevées le 07/10/2026 sur les artefacts de validation EN 16931 (EN16931-UBL-validation, version 1.3.16) : la
    // liste des CreditNoteTypeCode et celle des InvoiceTypeCode. Les deux choix : 81, un avoir présent dans la seconde,
    // compte en avoir ; 325, la facture proforma, n'est pas une pièce.
    const avoirsPublies = '81 83 261 262 296 308 381 396 420 458 502 503 532'.split(' ')
    const facturesPubliees = ('71 80 81 82 84 102 130 202 203 204 211 218 219 295 325 326 331 380 382 383 384 385 386 ' +
      '387 388 389 390 393 394 395 456 457 471 472 473 500 501 527 553 575 623 633 751 780 817 870 875 876 877 935').split(' ')
    expect([...TYPES_AVOIR].sort()).toEqual([...avoirsPublies].sort())
    expect([...TYPES_FACTURE].sort()).toEqual(facturesPubliees.filter((c) => c !== '81' && c !== '325').sort())
    // La règle G1.01 des spécifications externes de la DGFiP (v3.2) : les seuls types qu'une facture française porte.
    for (const code of ['380', '389', '393', '501', '386', '500', '384', '471', '472', '473']) expect(TYPES_FACTURE.has(code), code).toBe(true)
    for (const code of ['261', '381', '396', '502', '503']) expect(TYPES_AVOIR.has(code), code).toBe(true)
  })

  it('aucun code n’est à la fois une facture et un avoir, et la facture proforma n’est ni l’un ni l’autre', () => {
    for (const code of TYPES_AVOIR) expect(TYPES_FACTURE.has(code), code).toBe(false)
    expect(TYPES_FACTURE.has('325')).toBe(false)
    expect(TYPES_AVOIR.has('325')).toBe(false)
  })

  it('un type inconnu laisse la pièce sans montants, et dit pourquoi', () => {
    const f = lue(cii({ type: '325' }))
    expect(f.nature).toBeNull()
    expect(f.anomalies).toContain('Type de document inconnu (code 325) : le sens de ses montants n’est pas connu')
    expect(montantsDeLaFacture(f)).toEqual({ montant_ht: null, montant_tva: null, montant_ttc: null, devise: 'EUR' })
    expect(lue(cii({ type: '' })).anomalies).toContain('Type de document absent')
  })

  it('un avoir porte ses montants en négatif dans la pièce ; une facture, tels quels', () => {
    expect(montantsDeLaFacture(lue(cii({ type: '381' })))).toEqual({ montant_ht: -100, montant_tva: -20, montant_ttc: -120, devise: 'EUR' })
    expect(montantsDeLaFacture(lue(cii()))).toEqual({ montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR' })
  })

  it('un avoir écrit en négatif redevient positif, et un zéro reste un zéro', () => {
    const f = lue(cii({
      type: '381', ventilation: '',
      totaux: `<ram:TaxBasisTotalAmount>-50.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>-50.00</ram:GrandTotalAmount>`,
    }))
    const m = montantsDeLaFacture(f)
    expect(m.montant_ht).toBe(50)
    expect(m.montant_ttc).toBe(50)
    expect(Object.is(m.montant_tva, 0)).toBe(true)
  })
})

describe('lireFactureXml — UBL', () => {
  it('lit une facture, raison sociale avant nom commercial, et la ventilation de son total de TVA', () => {
    const f = lue(ubl())
    expect(f).toMatchObject({
      syntaxe: 'UBL',
      numero: 'FA-77',
      typeCode: '380',
      nature: 'facture',
      date: '2026-09-20',
      echeance: '2026-10-20',
      devise: 'EUR',
      vendeur: { nom: 'Logiciels Dupont SAS', siren: '111222333', tva: 'FR83111222333' },
      acheteur: { nom: 'Cabinet infirmier des Lilas', siren: '987654321', tva: null },
      montantHt: 60,
      montantTva: 11,
      montantTtc: 71,
      netAPayer: 71,
      nbLignes: 2,
      anomalies: [],
    })
    expect(f.ventilation.map((t) => [t.taux, t.base, t.tva])).toEqual([[20, 50, 10], [10, 10, 1]])
    expect(f.lignes).toEqual([{ libelle: 'Abonnement logiciel', montant: 50 }, { libelle: 'Formation', montant: 10 }])
  })

  it('un avoir UBL est un avoir par sa racine, et ses lignes sont des lignes d’avoir', () => {
    const f = lue(ubl({ avoir: true }))
    expect(f.nature).toBe('avoir')
    expect(f.echeance).toBeNull()
    expect(f.nbLignes).toBe(2)
    expect(montantsDeLaFacture(f)).toEqual({ montant_ht: -60, montant_tva: -11, montant_ttc: -71, devise: 'EUR' })
    // La racine le dit, même quand son code est celui d'une facture.
    expect(lue(ubl({ avoir: true, type: '380' })).nature).toBe('avoir')
  })

  it('un code d’avoir dans une facture UBL en fait un avoir', () => {
    expect(lue(ubl({ type: '381' })).nature).toBe('avoir')
  })

  it('reprend le nom commercial quand la raison sociale manque', () => {
    const f = lue(ubl({ fournisseur: '<cac:PartyName><cbc:Name>Dupont</cbc:Name></cac:PartyName>' }))
    expect(f.vendeur).toEqual({ nom: 'Dupont', siren: null, tva: null })
  })

  it('une facture en devise : total et ventilation pris dans le bloc de sa devise', () => {
    const f = lue(ubl({
      devise: 'USD',
      taxes: `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">9.26</cbc:TaxAmount></cac:TaxTotal>` +
        `<cac:TaxTotal><cbc:TaxAmount currencyID="USD">11.00</cbc:TaxAmount>${sousTotal('50.00', '10.00', '20', 'USD')}${sousTotal('10.00', '1.00', '10', 'USD')}</cac:TaxTotal>`,
      totaux: TOTAUX_UBL.replaceAll('EUR', 'USD'),
    }))
    expect(f.montantTva).toBe(11)
    expect(f.ventilation).toHaveLength(2)
    expect(f.anomalies).toEqual([])
    // Ventilé lui aussi et placé AVANT, un bloc dans la devise de comptabilisation n'est pas pris pour celui de la
    // facture.
    const g = lue(ubl({
      devise: 'USD',
      taxes: `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">9.26</cbc:TaxAmount>${sousTotal('50.51', '9.26', '20', 'EUR')}</cac:TaxTotal>` +
        `<cac:TaxTotal><cbc:TaxAmount currencyID="USD">11.00</cbc:TaxAmount>${sousTotal('50.00', '10.00', '20', 'USD')}${sousTotal('10.00', '1.00', '10', 'USD')}</cac:TaxTotal>`,
      totaux: TOTAUX_UBL.replaceAll('EUR', 'USD'),
    }))
    expect(g.ventilation.map((t) => [t.base, t.tva])).toEqual([[50, 10], [10, 1]])
  })

  it('un champ absent n’est pas cherché plus bas : ni le numéro ni la date de la facture qu’un avoir corrige', () => {
    // Un avoir cite la facture qu'il corrige (BG-3), sous les mêmes noms que les siens : une recherche dans toute la
    // descendance de la racine prendrait le numéro et la date de cette facture pour ceux de l'avoir.
    const reference = '<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>F-2026-0007</cbc:ID>' +
      '<cbc:IssueDate>2026-08-01</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>'
    const f = lue(ubl({ avoir: true, numero: null, date: null, reference }))
    expect(f.numero).toBeNull()
    expect(f.date).toBeNull()
    expect(f.anomalies).toEqual(expect.arrayContaining(['Numéro de facture absent', 'Date d’émission absente ou illisible']))
    // Présents, ce sont bien les siens qui sont lus.
    const g = lue(ubl({ avoir: true, reference }))
    expect([g.numero, g.date]).toEqual(['FA-77', '2026-09-20'])
  })

  it('le total de TVA d’une ligne, qu’UBL admet, n’est pas un second total de la facture', () => {
    const f = lue(ubl({ dansLaLigne: '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">10.00</cbc:TaxAmount></cac:TaxTotal>' }))
    expect(f.montantTva).toBe(11)
    expect(f.anomalies).toEqual([])
  })

  it('une date UBL peut porter un fuseau, qui ne change pas le jour écrit', () => {
    expect(lue(ubl({ date: '2026-09-20+02:00' })).date).toBe('2026-09-20')
    expect(lue(ubl({ date: '2026-09-20Z' })).date).toBe('2026-09-20')
    expect(lue(ubl({ date: '2026-9-20' })).date).toBeNull()
    expect(lue(ubl({ date: '2026-02-30' })).date).toBeNull()
  })
})

describe('lireFactureXml — ce qui n’est pas lu', () => {
  it('refuse une DTD ou une entité AVANT l’analyse : l’analyseur les développerait', () => {
    const bombe = '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'
    expect(refus(bombe)).toMatch(/DTD ou des entités/)
    expect(refus(cii().replace('<rsm:CrossIndustryInvoice', '<!doctype x><rsm:CrossIndustryInvoice'))).toMatch(/DTD/)
    expect(refus('<!ENTITY x "y"><a/>')).toMatch(/entités/)
  })

  it('refuse un XML mal formé, un document vide, et une racine qui n’est pas une facture', () => {
    expect(refus('<a><b></a>')).toMatch(/bien formé/)
    expect(refus('')).toMatch(/bien formé/)
    expect(refus('<a>&nbsp;</a>')).toMatch(/bien formé/)
    expect(refus('<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>')).toMatch(/ni une facture CII ni une facture UBL/)
  })
})

describe('SIREN et concordance avec le dossier', () => {
  const acheteurCii = (id: string, tva = '') => `<ram:Name>Acheteur</ram:Name>
        <ram:SpecifiedLegalOrganization>${id}</ram:SpecifiedLegalOrganization>${tva}`

  it('tire le SIREN d’un SIREN ou d’un SIRET, avec ou sans schéma, sinon du numéro de TVA français', () => {
    const siren = (id: string, tva = '') => lue(cii({ acheteur: acheteurCii(id, tva) })).acheteur.siren
    expect(siren('<ram:ID schemeID="0002">987654321</ram:ID>')).toBe('987654321')
    expect(siren('<ram:ID>987654321</ram:ID>')).toBe('987654321')
    expect(siren('<ram:ID schemeID="0009">98765432100017</ram:ID>')).toBe('987654321')
    expect(siren('<ram:ID>987 654 321 00017</ram:ID>')).toBe('987654321')
    // Un autre schéma ne dit rien du SIREN : le numéro de TVA prend le relais.
    const tva = '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR 12 987654321</ram:ID></ram:SpecifiedTaxRegistration>'
    expect(siren('<ram:ID schemeID="0088">3012345678901</ram:ID>', tva)).toBe('987654321')
    expect(siren('<ram:ID schemeID="0088">3012345678901</ram:ID>')).toBeNull()
    expect(siren('<ram:ID schemeID="0002">98765432</ram:ID>')).toBeNull()
    // Neuf ou quatorze chiffres d'un autre schéma (un numéro DUNS, par exemple) ne sont pas un SIREN.
    expect(siren('<ram:ID schemeID="0060">123456789</ram:ID>')).toBeNull()
    expect(siren('<ram:ID schemeID="0060">12345678901234</ram:ID>')).toBeNull()
    // Un numéro de TVA étranger de la même longueur qu'un numéro français ne donne pas de SIREN.
    const italien = '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">IT12345678901</ram:ID></ram:SpecifiedTaxRegistration>'
    expect(siren('', italien)).toBeNull()
    const etranger = '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE123456789</ram:ID></ram:SpecifiedTaxRegistration>'
    expect(siren('', etranger)).toBeNull()
    // Un numéro fiscal (schéma FC) n'est pas un numéro de TVA.
    const fiscal = '<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">FR12987654321</ram:ID></ram:SpecifiedTaxRegistration>'
    expect(siren('', fiscal)).toBeNull()
  })

  it('le SIREN d’un dossier vient de son SIRET', () => {
    expect(sirenDuDossier('987 654 321 00017')).toBe('987654321')
    expect(sirenDuDossier('987654321')).toBe('987654321')
    expect(sirenDuDossier('9876543210001')).toBeNull()
    expect(sirenDuDossier('abc')).toBeNull()
    expect(sirenDuDossier(null)).toBeNull()
    expect(sirenDuDossier(undefined)).toBeNull()
  })

  it('un achat doit désigner le dossier comme acheteur, une vente comme vendeur', () => {
    const f = lue(cii())
    expect(concordanceAvecLeDossier(f, 'achat', '987654321')).toEqual({ etat: 'concorde' })
    expect(concordanceAvecLeDossier(f, 'achat', '111111111')).toEqual({ etat: 'autre', siren: '987654321' })
    expect(concordanceAvecLeDossier(f, 'vente', '123456782')).toEqual({ etat: 'concorde' })
    expect(concordanceAvecLeDossier(f, 'vente', '987654321')).toEqual({ etat: 'autre', siren: '123456782' })
    expect(concordanceAvecLeDossier(f, 'achat', null)).toEqual({ etat: 'inconnue' })
    const sansSiren = lue(cii({ acheteur: '<ram:Name>Acheteur</ram:Name>' }))
    expect(concordanceAvecLeDossier(sansSiren, 'achat', '987654321')).toEqual({ etat: 'inconnue' })
  })

  it('le tiers d’un achat est le vendeur, celui d’une vente l’acheteur', () => {
    const f = lue(cii())
    expect(tiersDeLaFacture(f, 'achat')).toBe('Fournitures Martin SARL')
    expect(tiersDeLaFacture(f, 'vente')).toBe('Cabinet infirmier des Lilas')
  })
})

describe('le texte lu d’une facture électronique', () => {
  it('écrit les montants à la française, de la même façon partout', () => {
    expect(montantEnTexte(1234567.5, 'EUR')).toBe('1 234 567,50 EUR')
    expect(montantEnTexte(-12.3, 'USD')).toBe('-12,30 USD')
    expect(montantEnTexte(0, null)).toBe('0,00')
    expect(montantEnTexte(-0.001, 'EUR')).toBe('0,00 EUR')
    expect(montantEnTexte(999, 'EUR')).toBe('999,00 EUR')
    expect(montantEnTexte(1000, 'EUR')).toBe('1 000,00 EUR')
  })

  it('dit ce que la facture porte : numéro, dates, parties, totaux, taux et lignes', () => {
    const texte = texteDeLaFacture(lue(cii()), 'achat')
    expect(texte.split('\n')).toEqual([
      'Facture reçue par la plateforme agréée (CII)',
      'Numéro : F2026-0042',
      'Type : facture (code 380)',
      'Date : 15/09/2026',
      'Échéance : 15/10/2026',
      'Vendeur : Fournitures Martin SARL — SIREN 123456782 — TVA FR40123456782',
      'Acheteur : Cabinet infirmier des Lilas — SIREN 987654321',
      'Devise : EUR',
      'Total hors taxes : 100,00 EUR',
      'TVA : 20,00 EUR',
      'Total TTC : 120,00 EUR',
      'Net à payer : 120,00 EUR',
      '',
      'TVA par taux :',
      '  S 20 % : base 100,00 EUR, TVA 20,00 EUR',
      '',
      'Lignes :',
      '  - Ramette de papier : 100,00 EUR HT',
    ])
  })

  it('dit une vente, une exonération et ce qui est à vérifier', () => {
    const f = lue(cii({
      type: '999',
      ventilation: `<ram:ApplicableTradeTax><ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
        <ram:ExemptionReason>Exonération des soins</ram:ExemptionReason><ram:BasisAmount>100.00</ram:BasisAmount>
        <ram:CategoryCode>E</ram:CategoryCode><ram:ExemptionReasonCode>VATEX-FR-261-4-1</ram:ExemptionReasonCode>
        <ram:RateApplicablePercent>0</ram:RateApplicablePercent></ram:ApplicableTradeTax>`,
      totaux: `<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>100.00</ram:GrandTotalAmount>`,
    }))
    const texte = texteDeLaFacture(f, 'vente')
    expect(texte).toContain('Facture émise par la plateforme agréée (CII)')
    expect(texte).toContain('Type : inconnu (code 999)')
    expect(texte).toContain('  E 0 % : base 100,00 EUR, TVA 0,00 EUR — exonération : VATEX-FR-261-4-1 Exonération des soins')
    expect(texte).toContain('À vérifier :\n  - Type de document inconnu (code 999) : le sens de ses montants n’est pas connu')
    expect(texte).not.toContain('Net à payer')
  })

  it('un taux décimal s’écrit avec une virgule', () => {
    const f = lue(ubl({ taxes: `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">3.30</cbc:TaxAmount>${sousTotal('60.00', '3.30', '5.5')}</cac:TaxTotal>`,
      totaux: TOTAUX_UBL.replace('71.00</cbc:TaxInclusive', '63.30</cbc:TaxInclusive') }))
    expect(texteDeLaFacture(f, 'achat')).toContain('  S 5,5 % : base 60,00 EUR, TVA 3,30 EUR')
  })
})
