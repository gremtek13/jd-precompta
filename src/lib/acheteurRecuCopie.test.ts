// @vitest-environment jsdom
// LE BLOC acheteurRecu DANS plateforme-agreee (étape B4r, ligne 51.5). La fonction n'écrit la pièce d'un client « Achats » que
// si la facture désigne le dossier comme acheteur ; ce qu'elle lit doit être ce que lit le lecteur du navigateur
// (`lireFactureXml`, sous DOMParser : d'où jsdom), ou rien. Trois questions :
//   1. La copie est-elle le bloc du module, au caractère près ?
//   2. EXÉCUTÉE seule — avec le bloc cdarRecu et le `sirenDe` de la fonction, rien d'autre —, lit-elle le SIREN que lit
//      `lireFactureXml`, sur des factures CII et UBL de toutes les formes que la règle distingue ? Et refuse-t-elle ce qu'il
//      refuse ?
//   3. Le SIREN du dossier et la concordance suivent-ils `sirenDuDossier` et `concordanceAvecLeDossier` ?
// Les factures sont FICTIVES, écrites ici pour la forme des deux syntaxes.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { executerModule } from '../test/compilationSeparee'
import { concordanceAvecLeDossier, lireFactureXml, NS, sirenDuDossier } from './factureElectronique'
import type * as Module from './acheteurRecu'

// Sous jsdom, `import.meta.url` n'est pas une adresse de fichier : les chemins partent de la racine du dépôt.
const MODULE = readFileSync(resolve(process.cwd(), 'src/lib/acheteurRecu.ts'), 'utf8')
const SOURCE = readFileSync(resolve(process.cwd(), 'supabase/functions/plateforme-agreee/index.ts'), 'utf8')

function blocDe(source: string, nom: string, ou: string): string {
  const debut = `// ── DÉBUT COPIE ${nom} `
  const fin = `// ── FIN COPIE ${nom} `
  const d = source.indexOf(debut)
  const f = source.indexOf(fin)
  expect(d, `bornes du bloc ${nom} introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut, d + 1), `le bloc ${nom} est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc ${nom} n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'acheteurRecu', 'acheteurRecu.ts')
const COPIE = blocDe(SOURCE, 'acheteurRecu', 'plateforme-agreee')

/** Le bloc de la fonction, avec ce qu'il emprunte à la fonction elle-même : le bloc cdarRecu et son `sirenDe`. */
function executerLaCopie(): typeof Module {
  const debut = SOURCE.indexOf('export function sirenDe(')
  const sirenDe = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut) + 3)
  return executerModule<typeof Module>(`${sirenDe}\n${blocDe(SOURCE, 'cdarRecu', 'plateforme-agreee')}\n${COPIE}`)
}

const RSM = `xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}"`
const cii = (acheteur: string, prefixes = RSM) => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${prefixes}>
  <rsm:ExchangedDocument><ram:ID>FA-2026-001</ram:ID><ram:TypeCode>380</ram:TypeCode></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Fournisseur fictif</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Acheteur fictif</ram:Name>${acheteur}</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
const ubl = (partie: string, avoir = false) => `<?xml version="1.0" encoding="UTF-8"?>
<${avoir ? 'CreditNote' : 'Invoice'} xmlns="${avoir ? NS.avoir : NS.facture}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">
  <cbc:ID>FA-2026-002</cbc:ID>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Fournisseur fictif</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>${partie}</cac:Party></cac:AccountingCustomerParty>
</${avoir ? 'CreditNote' : 'Invoice'}>`
const org = (id: string) => `<ram:SpecifiedLegalOrganization>${id}</ram:SpecifiedLegalOrganization>`
const tvaCii = (schema: string, v: string) => `<ram:SpecifiedTaxRegistration><ram:ID schemeID="${schema}">${v}</ram:ID></ram:SpecifiedTaxRegistration>`
const legal = (id: string) => `<cac:PartyLegalEntity><cbc:RegistrationName>Acheteur fictif</cbc:RegistrationName>${id}</cac:PartyLegalEntity>`
const tvaUbl = (schema: string, v: string) => `<cac:PartyTaxScheme><cbc:CompanyID>${v}</cbc:CompanyID><cac:TaxScheme><cbc:ID>${schema}</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`

const CORPUS: Record<string, string> = {
  'CII, SIREN au schéma 0002': cii(org('<ram:ID schemeID="0002">123456789</ram:ID>')),
  'CII, SIRET au schéma 0009': cii(org('<ram:ID schemeID="0009">12345678900012</ram:ID>')),
  'CII, SIREN sans schéma': cii(org('<ram:ID>123456789</ram:ID>')),
  'CII, SIRET sans schéma': cii(org('<ram:ID>12345678900012</ram:ID>')),
  'CII, SIREN espacé': cii(org('<ram:ID schemeID="0002"> 123 456 789 </ram:ID>')),
  'CII, quatorze chiffres au schéma 0002': cii(org('<ram:ID schemeID="0002">12345678900012</ram:ID>')),
  'CII, un autre schéma (GLN)': cii(org('<ram:ID schemeID="0088">123456789</ram:ID>')),
  'CII, le numéro de TVA seul': cii(tvaCii('VA', 'FR32123456789')),
  'CII, le numéro de TVA espacé, en minuscules': cii(tvaCii('VA', 'fr 32 123 456 789')),
  'CII, un identifiant fiscal puis la TVA': cii(`${tvaCii('FC', '1234567890123')}${tvaCii('VA', 'FR32123456789')}`),
  'CII, une TVA étrangère': cii(tvaCii('VA', 'DE123456789')),
  'CII, l’identifiant illisible, la TVA lisible': cii(`${org('<ram:ID schemeID="0002">12345</ram:ID>')}${tvaCii('VA', 'FR32987654321')}`),
  'CII, aucun identifiant': cii(''),
  'CII, sous d’autres préfixes': cii(org('<ram:ID schemeID="0002">123456789</ram:ID>'), RSM)
    .replace(/rsm:/g, 'x:').replace(/xmlns:rsm=/, 'xmlns:x=').replace(/ram:/g, 'y:').replace(/xmlns:ram=/, 'xmlns:y='),
  'UBL, SIREN au schéma 0002': ubl(legal('<cbc:CompanyID schemeID="0002">123456789</cbc:CompanyID>')),
  'UBL, SIRET au schéma 0009': ubl(legal('<cbc:CompanyID schemeID="0009">12345678900012</cbc:CompanyID>')),
  'UBL, le numéro de TVA seul': ubl(tvaUbl('VAT', 'FR32123456789')),
  'UBL, un régime qui n’est pas la TVA': ubl(tvaUbl('GST', 'FR32123456789')),
  'UBL, un avoir': ubl(legal('<cbc:CompanyID schemeID="0002">123456789</cbc:CompanyID>'), true),
  'UBL, aucun identifiant': ubl('<cac:PartyName><cbc:Name>Acheteur fictif</cbc:Name></cac:PartyName>'),
  'une racine qui n’est pas une facture': '<?xml version="1.0"?><Commande xmlns="urn:exemple"><ID>1</ID></Commande>',
  'une DTD': `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "123456789">]>${cii(org('<ram:ID>&e;</ram:ID>')).replace(/^<\?xml[^>]*>/, '')}`,
  'un XML mal formé': cii(org('<ram:ID schemeID="0002">123456789</ram:ID>')).replace('</rsm:CrossIndustryInvoice>', ''),
}

describe('le bloc acheteurRecu de plateforme-agreee', () => {
  it('est le bloc du module, au caractère près', () => {
    expect(COPIE).toBe(ORIGINE)
    for (const espace of [NS.rsm, NS.ram, NS.facture, NS.avoir, NS.cac, NS.cbc]) expect(ORIGINE).toContain(`'${espace}'`)
  })

  const copie = executerLaCopie()

  it.each(Object.entries(CORPUS))('lit le SIREN que lit le navigateur : %s', (_nom, xml) => {
    const dom = lireFactureXml(xml)
    const lu = copie.acheteurDeLaFacture(xml)
    if ('refus' in dom) {
      expect('refus' in lu, JSON.stringify(lu)).toBe(true)
      return
    }
    expect(lu).toEqual({ syntaxe: dom.facture.syntaxe, siren: dom.facture.acheteur.siren })
  })

  it('le corpus porte des SIREN lus ET des SIREN absents, dans les deux syntaxes', () => {
    const lus = Object.values(CORPUS).map((xml) => lireFactureXml(xml)).flatMap((l) => ('facture' in l ? [l.facture] : []))
    expect(lus.filter((f) => f.acheteur.siren !== null).map((f) => f.syntaxe)).toEqual(expect.arrayContaining(['CII', 'UBL']))
    expect(lus.filter((f) => f.acheteur.siren === null).map((f) => f.syntaxe)).toEqual(expect.arrayContaining(['CII', 'UBL']))
  })

  it('un identifiant qui porte des éléments ne se lit pas (le côté fermé)', () => {
    expect(copie.acheteurDeLaFacture(cii(org('<ram:ID schemeID="0002">1234<ram:X/>56789</ram:ID>')))).toEqual({ syntaxe: 'CII', siren: null })
  })

  it('le SIREN du dossier et la concordance suivent la règle du navigateur', () => {
    for (const siret of ['12345678900012', '123456789', ' 123 456 789 00012 ', '1234567890', '', null, undefined]) {
      expect(copie.sirenDuDossierRecu(siret)).toBe(sirenDuDossier(siret))
    }
    expect(copie.sirenDuDossierRecu(123456789)).toBeNull()
    for (const xml of Object.values(CORPUS)) {
      const dom = lireFactureXml(xml)
      for (const siren of ['123456789', '987654321', null]) {
        const attendu = 'refus' in dom ? 'inconnue'
          : { concorde: 'concorde', autre: 'autre', inconnue: 'inconnue' }[concordanceAvecLeDossier(dom.facture, 'achat', siren).etat]
        expect(copie.concordanceDeLAcheteur(copie.acheteurDeLaFacture(xml), siren)).toBe(attendu)
      }
    }
  })
})
