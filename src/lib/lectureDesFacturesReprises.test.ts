// @vitest-environment jsdom
// La lecture d'une facture de l'ancien logiciel du client (A8d1). jsdom : le XML se lit par l'analyseur du navigateur.
// Les factures sont FICTIVES : les CII sont les exemples du générateur de l'application, jugés valides par l'instrument
// officiel (outils/facturation/exemples/, valides.json) ; l'UBL est écrit ici, à la forme de la norme ; le Factur-X est
// fabriqué ici par pdf-lib et lu par la version de pdf.js qui tourne hors navigateur, par le même code que le navigateur.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AFRelationship, PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { documentDeLaTache, type OuvrirPdf, type TachePdfJs } from './factureX'
import {
  ADRESSE_DU_CLIENT_MAX,
  DESIGNATION_MAX,
  LIGNES_MAX,
  NOM_DE_PLATEFORME_MAX,
  NOM_DU_CLIENT_MAX,
  CLES_DE_LIGNE,
  CLES_LAISSEES,
  CLES_REMPLIES,
  FORMATS_LUS,
  formeDImport,
  lireFichierDeReprise,
  lireXmlDeReprise,
  NATURES,
  TAUX_DE_LA_REPRISE,
  TRANSMISSIONS,
  TYPES_CLIENT,
  type ChoixDeLaReprise,
  type FactureRepriseLue,
  type LectureDeReprise,
} from './lectureDesFacturesReprises'
import { UNITES_ARTICLE } from './articles'
import { definitionsSql, indiceSql } from '../test/schema'

const SIREN = '123456782' // celui du vendeur des exemples (SIRET_VENDEUR de src/test/facturesCii.ts)
const exemple = (nom: string) => readFileSync(resolve(process.cwd(), `outils/facturation/exemples/${nom}.xml`), 'utf-8')
const SERVICES = exemple('services-debits')
const BIENS = exemple('biens-livraison')
const AVOIR = exemple('avoir')

const ouvrirHorsNavigateur: OuvrirPdf = (octets) => documentDeLaTache(pdfjs.getDocument({ data: octets }) as unknown as TachePdfJs)
const utf8 = (t: string) => new TextEncoder().encode(t)

function lue(r: LectureDeReprise): FactureRepriseLue {
  if ('refus' in r) throw new Error(`Refusée : ${r.refus.join(' | ')}`)
  return r.lue
}
function refus(r: LectureDeReprise): string[] {
  if ('lue' in r) throw new Error('Lue, quand on attendait un refus.')
  return r.refus
}
const xml = (texte: string, siren: string | null = SIREN) => lireXmlDeReprise(texte, null, siren)

const CHOIX: ChoixDeLaReprise = {
  type_client: 'assujetti',
  transmise_par: 'pdf',
  plateforme_nom: null,
  encaisse_avant_reprise_centimes: 0,
  nature_operation: null,
  option_debits: null,
  natures_des_lignes: null,
}

// ── L'UBL, écrit à la forme de la norme ──────────────────────────────────────────────────────────────────────────

function ubl(o: { racine?: 'Invoice' | 'CreditNote'; code?: string; tva?: string; ttc?: string; reference?: string; vendeur?: string } = {}): string {
  const racine = o.racine ?? 'Invoice'
  const avoir = racine === 'CreditNote'
  const ligne = avoir ? 'CreditNoteLine' : 'InvoiceLine'
  const quantite = avoir ? 'CreditedQuantity' : 'InvoicedQuantity'
  return `<?xml version="1.0" encoding="UTF-8"?>
<${racine} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${racine}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ProfileID>S1</cbc:ProfileID>
  <cbc:ID>FA-2025/118</cbc:ID>
  <cbc:IssueDate>2025-11-20</cbc:IssueDate>
  ${avoir ? '' : '<cbc:DueDate>2025-12-20</cbc:DueDate>'}
  <cbc:${avoir ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${o.code ?? (avoir ? '381' : '380')}</cbc:${avoir ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:InvoicePeriod><cbc:DescriptionCode>432</cbc:DescriptionCode></cac:InvoicePeriod>
  ${o.reference ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${o.reference}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>Atelier Démo Conseil</cbc:RegistrationName><cbc:CompanyID schemeID="0002">${o.vendeur ?? SIREN}</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="0009">98765432400019</cbc:ID></cac:PartyIdentification>
    <cac:PostalAddress><cbc:StreetName>5 avenue du Port</cbc:StreetName><cbc:CityName>Marseille</cbc:CityName><cbc:PostalZone>13002</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Client Fictif SAS</cbc:RegistrationName><cbc:CompanyID schemeID="0002">987654324</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${o.tva ?? '25.20'}</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">126.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">25.20</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">126.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">126.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${o.ttc ?? '151.20'}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${o.ttc ?? '151.20'}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:${ligne}><cbc:ID>1</cbc:ID><cbc:${quantite} unitCode="HUR">1.5</cbc:${quantite}>
    <cbc:LineExtensionAmount currencyID="EUR">126.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Séance d’accompagnement</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">84</cbc:PriceAmount></cac:Price>
  </cac:${ligne}>
</${racine}>`
}

async function facturX(contenu: string, nom = 'factur-x.xml'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  await doc.attach(Buffer.from(contenu, 'utf-8').toString('base64'), nom, { mimeType: 'text/xml', description: 'Facture', afRelationship: AFRelationship.Alternative })
  return doc.save()
}

// ── Les lectures ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('une facture CII', () => {
  it('lit l’en-tête, le client, la nature (BT-23), l’option sur les débits (BT-8) et les lignes, les totaux en centimes', () => {
    const f = lue(xml(SERVICES))
    expect(f).toMatchObject({
      format: 'cii', numero: 'F2026-0012', type: 'facture', origine_numero: null, date_emission: '2026-09-15',
      date_echeance: '2026-10-15', tiers_nom: 'Client Fictif SAS', tiers_adresse: '5 avenue du Port\n13002 Marseille',
      tiers_siren: '987654324', tiers_siret: '98765432400019', nature_lue: 'services', option_debits_lue: true,
      ht_centimes: 89000, tva_centimes: 17800, ttc_centimes: 106800,
    })
    expect(f.lignes).toEqual([
      { designation: 'Mission de conseil — septembre 2026', quantite: 10, prix_unitaire_ht: 85.5, taux_tva: 20, unite: 'C62' },
      { designation: 'Frais de dossier', quantite: 1, prix_unitaire_ht: 35, taux_tva: 20, unite: 'C62' },
    ])
  })

  it('lit deux taux et une remise (une quantité négative), et une facture de biens sans option dite', () => {
    const f = lue(xml(BIENS))
    expect(f).toMatchObject({ nature_lue: 'biens', option_debits_lue: null, ht_centimes: 72330 })
    expect(f.lignes.map((l) => [l.quantite, l.prix_unitaire_ht, l.taux_tva])).toEqual([[2, 349.9, 20], [3, 24.5, 5.5], [-1, 50, 20]])
  })
})

describe('un avoir', () => {
  it('se reconnaît à son type (381), cite sa facture (BT-25), et prend le sens de l’application : tout négatif', () => {
    const f = lue(xml(AVOIR))
    expect(f).toMatchObject({ type: 'avoir', origine_numero: 'F2026-0012', ttc_centimes: -20520, ht_centimes: -17100 })
    expect(f.lignes.every((l) => l.quantite < 0 && l.prix_unitaire_ht > 0)).toBe(true)
    const r = formeDImport(f, { ...CHOIX })
    if ('refus' in r) throw new Error(r.refus.join(' | '))
    expect(r.facture).toMatchObject({ type: 'avoir', origine_numero: 'F2026-0012', montant_ttc: -205.2, encaisse_avant_reprise: 0 })
  })

  it('un avoir UBL (CreditNote) aussi', () => {
    const f = lue(xml(ubl({ racine: 'CreditNote', reference: 'FA-2025/100' })))
    expect(f).toMatchObject({ format: 'ubl', type: 'avoir', origine_numero: 'FA-2025/100', ttc_centimes: -15120 })
    expect(f.lignes[0]).toMatchObject({ quantite: -1.5, prix_unitaire_ht: 84 })
  })
})

describe('une facture UBL', () => {
  it('lit les mêmes champs à leur place UBL : l’unité, l’adresse, le SIRET, l’exigibilité au paiement', () => {
    const f = lue(xml(ubl()))
    expect(f).toMatchObject({
      format: 'ubl', numero: 'FA-2025/118', type: 'facture', date_emission: '2025-11-20', date_echeance: '2025-12-20',
      tiers_siren: '987654324', tiers_siret: '98765432400019', tiers_adresse: '5 avenue du Port\n13002 Marseille',
      nature_lue: 'services', option_debits_lue: false, ht_centimes: 12600, tva_centimes: 2520, ttc_centimes: 15120,
    })
    expect(f.lignes).toEqual([{ designation: 'Séance d’accompagnement', quantite: 1.5, prix_unitaire_ht: 84, taux_tva: 20, unite: 'HUR' }])
  })
})

describe('un Factur-X', () => {
  it('se reconnaît au contenu (un PDF), et se lit par sa facture structurée jointe', async () => {
    const r = await lireFichierDeReprise(await facturX(SERVICES), SIREN, ouvrirHorsNavigateur)
    expect(lue(r)).toMatchObject({ format: 'facturx', numero: 'F2026-0012', ttc_centimes: 106800 })
  })

  it('un PDF sans facture structurée se refuse, et le dit', async () => {
    const r = await lireFichierDeReprise(await facturX(SERVICES, 'notes.xml'), SIREN, ouvrirHorsNavigateur)
    expect(refus(r)).toEqual(['Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »).'])
  })

  it('un XML seul se lit par le même chemin, son format tiré de sa syntaxe', async () => {
    expect(lue(await lireFichierDeReprise(utf8(SERVICES), SIREN)).format).toBe('cii')
    expect(lue(await lireFichierDeReprise(utf8(ubl()), SIREN)).format).toBe('ubl')
  })
})

// ── Les refus, chacun nommé ──────────────────────────────────────────────────────────────────────────────────────

describe('les refus de la lecture', () => {
  const remplacer = (texte: string, de: string, vers: string) => {
    expect(texte).toContain(de)
    return texte.replace(de, vers)
  }

  it('une facture qui n’est pas celle de l’émetteur du dossier, ou dont rien ne prouve qu’elle l’est', () => {
    expect(refus(xml(SERVICES, '552100554'))).toEqual(['Le vendeur de cette facture (SIREN 123456782) n’est pas l’émetteur du dossier.'])
    expect(refus(xml(SERVICES, null))).toEqual(['Le SIREN du dossier n’est pas connu : rien ne prouve que la facture est la sienne.'])
    const sansVendeur = remplacer(ubl(), `<cbc:CompanyID schemeID="0002">${SIREN}</cbc:CompanyID>`, '')
    expect(refus(xml(sansVendeur))).toEqual(['SIREN du vendeur absent : rien ne prouve que la facture est celle du dossier.'])
  })

  it('un type autre que la facture et l’avoir', () => {
    expect(refus(xml(remplacer(SERVICES, '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>386</ram:TypeCode>'))))
      .toEqual(['Type de document 386 : seule une facture (380) ou un avoir (381) se reprend.'])
  })

  it('un avoir qui ne cite pas sa facture', () => {
    expect(refus(xml(ubl({ racine: 'CreditNote' })))).toEqual(['L’avoir ne cite pas la facture qu’il crédite (BT-25).'])
  })

  it('une devise autre que l’euro, une échéance illisible, un numéro hors de G1.05', () => {
    const usd = SERVICES.replace('<ram:InvoiceCurrencyCode>EUR', '<ram:InvoiceCurrencyCode>USD').replace('currencyID="EUR"', 'currencyID="USD"')
    expect(refus(xml(usd))).toEqual(['Devise USD : une facture reprise est en euros.'])
    expect(refus(xml(remplacer(ubl(), '2025-12-20', '2025-12-32')))).toEqual(['Date d’échéance illisible'])
    expect(refus(xml(remplacer(ubl(), 'FA-2025/118', 'FA#2025-118'))))
      .toEqual([expect.stringContaining('Numéro de facture hors de la forme admise')])
  })

  it('une ligne : sa désignation, sa quantité, son prix, son unité, son taux, son montant net', () => {
    expect(refus(xml(remplacer(ubl(), '<cbc:Name>Séance d’accompagnement</cbc:Name>', '')))).toEqual(['Ligne 1 : désignation absente'])
    expect(refus(xml(remplacer(ubl(), 'unitCode="HUR">1.5<', 'unitCode="HUR">1,5<')))).toEqual(['Ligne 1 : quantité illisible'])
    expect(refus(xml(remplacer(ubl(), '<cbc:PriceAmount currencyID="EUR">84<', '<cbc:PriceAmount currencyID="EUR">84.0000001<'))))
      .toEqual(['Ligne 1 : prix net illisible (six décimales au plus)'])
    expect(refus(xml(remplacer(ubl(), 'unitCode="HUR"', 'unitCode="XPP"')))).toEqual(['Ligne 1 : unité XPP, hors de celles de l’application'])
    expect(refus(xml(ubl().replaceAll('<cbc:Percent>20</cbc:Percent>', '<cbc:Percent>7</cbc:Percent>'))))
      .toEqual(['Ligne 1 : le taux de 7 % n’est pas un taux de la TVA française'])
    expect(refus(xml(remplacer(ubl(), '<cbc:PriceAmount currencyID="EUR">84<', '<cbc:PriceAmount currencyID="EUR">85<'))))
      .toEqual(['Ligne 1 : son montant net (126,00 €) ne vaut pas sa quantité fois son prix (127,50 €).'])
  })

  it('les totaux recontrôlés sur les lignes : le hors taxe, la TVA, un montant au-delà du centime', () => {
    const ht = SERVICES.replace('<ram:TaxBasisTotalAmount>890.00', '<ram:TaxBasisTotalAmount>890.01')
      .replace('<ram:GrandTotalAmount>1068.00', '<ram:GrandTotalAmount>1068.01')
    expect(refus(xml(ht))).toEqual(['La facture déclare 890,01 € hors taxe ; ses lignes en font 890,00 € (un écart de 0,01 €).'])
    expect(refus(xml(ubl({ tva: '25.30', ttc: '151.30' }))))
      .toEqual(['La facture déclare 25,30 € de TVA ; ses lignes en font 25,20 € par taux (EN 16931, BR-CO-17), 25,20 € ligne à ligne.'])
    expect(refus(xml(ubl({ ttc: '151.205' })))).toContain('Total TTC illisible (plus de deux décimales, ou pas un nombre)')
  })

  it('une remise sur l’ensemble, et une facture définitive après acompte', () => {
    const remise = remplacer(ubl(), '<cac:TaxTotal>', '<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">0</cbc:Amount></cac:AllowanceCharge><cac:TaxTotal>')
    expect(refus(xml(remise))).toEqual(['Remise ou frais sur l’ensemble de la facture (BG-20, BG-21) : ne se reprend pas.'])
    expect(refus(xml(remplacer(ubl(), '<cbc:ProfileID>S1', '<cbc:ProfileID>S4'))))
      .toEqual(['Cadre de facturation S4 : une facture définitive après acompte ne se reprend pas sans son devis.'])
  })

  it('un fichier qui n’est ni un PDF ni un XML, un XML d’un autre encodage, une DTD', async () => {
    expect(refus(await lireFichierDeReprise(utf8('numero;montant'), SIREN))).toEqual(['Ce fichier n’est ni un PDF ni un XML : ni un Factur-X, ni un CII, ni un UBL.'])
    expect(refus(await lireFichierDeReprise(new Uint8Array([0x3c, 0xff, 0xfe]), SIREN)))
      .toEqual(['Ce fichier n’est ni un PDF ni un texte UTF-8 : ni un Factur-X, ni un CII, ni un UBL.'])
    expect(refus(await lireFichierDeReprise(utf8(SERVICES.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')), SIREN)))
      .toEqual(['Ce XML se déclare en ISO-8859-1 : une facture se reprend en UTF-8.'])
    expect(refus(xml('<!DOCTYPE x [<!ENTITY a "b">]><x/>'))).toEqual([expect.stringContaining('DTD')])
  })
})

// ── La forme qu'importer_factures attend ─────────────────────────────────────────────────────────────────────────

describe('formeDImport', () => {
  it('ce que le fichier ne dit pas se choisit, sans défaut, et ne contredit pas ce qu’il dit', () => {
    const biens = lue(xml(BIENS))
    expect(formeDImport(biens, CHOIX)).toEqual({ refus: ['Le fichier ne dit pas si la facture a été émise sous l’option pour les débits (BT-8) : à préciser.'] })
    expect(formeDImport(biens, { ...CHOIX, option_debits: false, nature_operation: 'services' }))
      .toEqual({ refus: ['Le fichier dit des opérations « biens » : le choix ne le contredit pas.'] })
    const sansCadre = lue(xml(ubl().replace('<cbc:ProfileID>S1</cbc:ProfileID>', '')))
    expect(formeDImport(sansCadre, CHOIX)).toEqual({ refus: ['Le fichier ne dit pas la nature des opérations (BT-23) : biens, services ou mixte, à préciser.'] })
    expect(formeDImport(sansCadre, { ...CHOIX, nature_operation: 'mixte' }))
      .toEqual({ refus: ['Une facture mixte dit la nature de chacune de ses 1 lignes.'] })
    const mixte = formeDImport(sansCadre, { ...CHOIX, nature_operation: 'mixte', natures_des_lignes: ['services'] })
    expect('facture' in mixte && mixte.facture.lignes[0].nature).toBe('services')
  })

  it('la transmission et l’encaissé avant la reprise', () => {
    const f = lue(xml(SERVICES))
    expect(formeDImport(f, { ...CHOIX, transmise_par: 'plateforme' }))
      .toEqual({ refus: ['Une facture transmise par une plateforme agréée la nomme, et seule celle-là.'] })
    expect(formeDImport(f, { ...CHOIX, encaisse_avant_reprise_centimes: 106801 }))
      .toEqual({ refus: ['L’encaissé avant la reprise dépasse le TTC de la facture (1 068,00 €).'] })
    expect(formeDImport(lue(xml(AVOIR)), { ...CHOIX, encaisse_avant_reprise_centimes: 100 }))
      .toEqual({ refus: ['Un avoir ne porte pas d’encaissé avant la reprise : il s’impute sur sa facture.'] })
    const r = formeDImport(f, { ...CHOIX, transmise_par: 'plateforme', plateforme_nom: ' Plateforme Démo ', encaisse_avant_reprise_centimes: 50000 })
    expect(r).toEqual({
      facture: {
        numero: 'F2026-0012', type: 'facture', date_emission: '2026-09-15', date_echeance: '2026-10-15',
        tiers_nom: 'Client Fictif SAS', tiers_adresse: '5 avenue du Port\n13002 Marseille', tiers_siren: '987654324',
        tiers_siret: '98765432400019', type_client: 'assujetti', nature_operation: 'services', option_debits: true,
        montant_ht: 890, montant_tva: 178, montant_ttc: 1068,
        lignes: [
          { designation: 'Mission de conseil — septembre 2026', quantite: 10, prix_unitaire_ht: 85.5, taux_tva: 20, unite: 'C62' },
          { designation: 'Frais de dossier', quantite: 1, prix_unitaire_ht: 35, taux_tva: 20, unite: 'C62' },
        ],
        encaisse_avant_reprise: 500, transmise_par: 'plateforme', plateforme_nom: 'Plateforme Démo',
      },
    })
  })
})

// ── La confrontation au texte d'importer_factures, au nom près ───────────────────────────────────────────────────

describe('la forme rendue, confrontée à importer_factures', () => {
  // Sous jsdom, import.meta.url n'est pas une adresse de fichier (que lit `fichiersDuSchema`) : l'export se lit depuis la
  // racine du dépôt, d'où la suite se lance, et la DERNIÈRE définition est celle que la base exécute.
  const dossier = resolve(process.cwd(), 'supabase/schema')
  const fichiers = readdirSync(dossier).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => ({ chemin: `supabase/schema/${n}`, texte: readFileSync(`${dossier}/${n}`, 'utf8') }))
  const definitions = definitionsSql('importer_factures', fichiers)
  const sql = definitions[definitions.length - 1].definition
  const tableau = (nom: string): string[] => {
    const m = new RegExp(`${nom} constant (?:text|numeric)\\[\\] := array\\[([^\\]]*)\\]`).exec(sql)
    if (!m) throw new Error(`${nom} introuvable`)
    return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))
  }
  const liste = (avant: string): string[] => {
    const i = indiceSql(sql, avant)
    if (i < 0) throw new Error(`${avant} introuvable`)
    const m = /in \(([^)]*)\)/.exec(sql.slice(i))
    if (!m) throw new Error(`liste après ${avant} introuvable`)
    return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))
  }

  it('les clés d’une facture : celles qu’il remplit et celles qu’il laisse, chacune avec sa raison, font la liste de la base', () => {
    expect([...CLES_REMPLIES, ...Object.keys(CLES_LAISSEES)].sort()).toEqual(tableau('v_cles_facture').sort())
    expect(Object.keys(CLES_LAISSEES)).toHaveLength(4)
    expect(new Set(CLES_REMPLIES).size).toBe(CLES_REMPLIES.length)
  })

  it('les clés d’une ligne, et chaque clé que la forme rendue porte', () => {
    expect([...CLES_DE_LIGNE].sort()).toEqual(tableau('v_cles_ligne').sort())
    for (const exemple of [SERVICES, BIENS, AVOIR]) {
      const r = formeDImport(lue(xml(exemple)), { ...CHOIX, option_debits: exemple === BIENS ? false : null })
      if ('refus' in r) throw new Error(r.refus.join(' | '))
      for (const cle of Object.keys(r.facture)) expect(CLES_REMPLIES).toContain(cle)
      for (const l of r.facture.lignes) for (const cle of Object.keys(l)) expect(CLES_DE_LIGNE).toContain(cle)
    }
  })

  it('les taux, les formats, les types de client, les transmissions, les natures et les unités sont ceux de la base', () => {
    expect([...TAUX_DE_LA_REPRISE].map(String)).toEqual(tableau('v_taux_admis'))
    expect(liste("v_format not in")).toEqual(expect.arrayContaining([...FORMATS_LUS]))
    expect(liste("v_type_client not in")).toEqual([...TYPES_CLIENT])
    expect(liste("v_transmise not in")).toEqual([...TRANSMISSIONS])
    expect(liste("v_nature not in")).toEqual([...NATURES])
    expect(liste("v_u not in")).toEqual(UNITES_ARTICLE.map((u) => u.code))
  })

  it('les bornes : le nom du client, son adresse, la désignation, le nombre de lignes, le nom de la plateforme', () => {
    expect(sql).toContain(`char_length(v_tiers_nom) > ${NOM_DU_CLIENT_MAX}`)
    expect(sql).toContain(`char_length(v_f->>'tiers_adresse') > ${ADRESSE_DU_CLIENT_MAX}`)
    expect(sql).toContain(`char_length(v_l->>'designation') > ${DESIGNATION_MAX}`)
    expect(sql).toContain(`not between 1 and ${LIGNES_MAX}`)
    expect(sql).toContain(`char_length(v_plateforme) > ${NOM_DE_PLATEFORME_MAX}`)
  })
})

describe('le journal', () => {
  it('ne reçoit rien : une facture porte le nom de son client, une lecture et un refus n’écrivent nulle part', async () => {
    const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      lue(xml(SERVICES))
      refus(xml(SERVICES, '552100554'))
      refus(await lireFichierDeReprise(utf8('numero;montant'), SIREN))
      lue(await lireFichierDeReprise(await facturX(AVOIR), SIREN, ouvrirHorsNavigateur))
      for (const e of espions) expect(e).not.toHaveBeenCalled()
    } finally {
      for (const e of espions) e.mockRestore()
    }
  })
})
