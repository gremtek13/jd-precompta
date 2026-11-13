// Une facture d'achat FICTIVE en CII, telle qu'une plateforme la remet (B4R-Q1) : pour les tests de « Lire la facture
// électronique ». Les SIREN sont fictifs ; l'acheteur, par défaut, est le dossier des tests (SIRET 98765432100017).

const ESPACES = 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"'

export const SIREN_DU_DOSSIER = '987654321'
export const SIRET_DU_DOSSIER = '98765432100017'

export function factureRecueCii(o: { type?: string; acheteur?: string | null; devise?: string; ttc?: string | null } = {}): string {
  const acheteur = o.acheteur === null ? ''
    : `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${o.acheteur ?? SIREN_DU_DOSSIER}</ram:ID></ram:SpecifiedLegalOrganization>`
  const devise = o.devise ?? 'EUR'
  const ttc = o.ttc === null ? '' : `<ram:GrandTotalAmount>${o.ttc ?? '120.00'}</ram:GrandTotalAmount>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${ESPACES}>
  <rsm:ExchangedDocument><ram:ID>F-42</ram:ID><ram:TypeCode>${o.type ?? '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260915</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Fournitures Martin</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">123456782</ram:ID></ram:SpecifiedLegalOrganization></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Cabinet des Lilas</ram:Name>${acheteur}</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>${devise}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${devise}">20.00</ram:TaxTotalAmount>
        ${ttc}
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

export const octetsDe = (texte: string): Uint8Array => new TextEncoder().encode(texte)
