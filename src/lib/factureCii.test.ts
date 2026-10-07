// @vitest-environment jsdom
// Le générateur de la facture électronique émise (factureCii.ts). Les factures sont FICTIVES : des identifiants valides
// par leur clé mais inventés, des noms et des adresses de démonstration.
//
// LES EXEMPLES SONT JUGÉS PAR L'INSTRUMENT OFFICIEL, PAS PAR CE FICHIER. Chacun est figé dans outils/facturation/exemples/
// et a passé le schéma CII D16B et les règles de la norme EN 16931 (outils/facturation/valider.mjs, qui écrit
// valides.json) : le dernier test refuse un exemple dont l'empreinte n'y figure pas, si bien qu'un exemple qui change
// repasse au validateur avant de partir. jsdom : la relecture passe par l'analyseur XML du navigateur (lireFactureXml).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENTIONS_VIDES } from '../test/factures'
import { calculerTotaux } from './montantsFacture'
import {
  adresseStructuree,
  cadreDeFacturation,
  decimal,
  factureCii,
  mentionsImprimees,
  montantsDuDocument,
  numeroAdmis,
  numeroTvaFrancais,
  refusEmission,
  sirenDe,
  sirenValide,
  siretValide,
  TAUX_ADMIS,
  type DonneesCii,
  type LigneCii,
  type VendeurCii,
} from './factureCii'
import { lireFactureXml } from './factureElectronique'
import type { FactureEmise } from './types'

const SIRET_VENDEUR = '12345678200010'
const TVA_VENDEUR = 'FR11123456782'
const SIREN_CLIENT = '987654324'
const SIRET_CLIENT = '98765432400019'
const SIREN_PUBLIC = '100000207'
const AUJOURD_HUI = '2026-10-07'

function vendeur(o: Partial<VendeurCii> = {}): VendeurCii {
  return {
    nom: 'Atelier Démo Conseil',
    siret: SIRET_VENDEUR,
    adresse: '12 rue des Exemples\n13001 Marseille',
    numeroTva: TVA_VENDEUR,
    statutTva: 'redevable',
    articleExoneration: null,
    ...o,
  }
}

function ligne(o: Partial<LigneCii> = {}): LigneCii {
  return { ordre: 1, designation: 'Prestation de conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }
}

// La facture telle que la base la garde. Son en-tête est calculé comme l'application le calcule : le total des lignes
// d'une facture, ou, pour un avoir, l'opposé du total des lignes qu'il crédite (creerAvoir) — ses lignes étant stockées
// négatives, on les remet dans le sens du crédit avant de les totaliser.
function facture(lignes: LigneCii[], o: Partial<FactureEmise> = {}): FactureEmise {
  const avoir = o.type === 'avoir'
  const t = calculerTotaux(lignes.map((l) => ({ ...l, quantite: avoir ? -l.quantite : l.quantite })))
  const signe = (n: number) => (avoir && n !== 0 ? -n : n)
  return {
    id: 'f1',
    dossier_id: 'd1',
    numero: 'F2026-0001',
    statut: 'validee',
    type: 'facture',
    facture_origine_id: null,
    date_emission: '2026-09-15',
    date_echeance: '2026-10-15',
    tiers_nom: 'Client Fictif SAS',
    tiers_adresse: '5 avenue du Port\n13002 Marseille',
    tiers_siret: null,
    montant_ht: signe(t.montant_ht),
    montant_tva: signe(t.montant_tva),
    montant_ttc: signe(t.montant_ttc),
    mentions_legales: null,
    notes: null,
    emetteur_nom: 'Atelier Démo Conseil',
    emetteur_siret: SIRET_VENDEUR,
    emetteur_adresse: '12 rue des Exemples\n13001 Marseille',
    superpdp_invoice_id: null,
    superpdp_dernier_statut: null,
    tiers_email: null,
    created_by: null,
    created_at: '2026-09-15T08:00:00Z',
    validated_at: '2026-09-15T08:05:00Z',
    ...MENTIONS_VIDES,
    type_client: 'assujetti',
    tiers_siren: SIREN_CLIENT,
    nature_operation: 'services',
    ...o,
  }
}

interface Cas {
  lignes?: LigneCii[]
  facture?: Partial<FactureEmise>
  vendeur?: Partial<VendeurCii>
  origine?: DonneesCii['origine']
}

const ORIGINE: DonneesCii['origine'] = { numero: 'F2026-0001', date_emission: '2026-09-01' }

function donnees(c: Cas = {}): DonneesCii {
  const lignes = c.lignes ?? [ligne()]
  return { facture: facture(lignes, c.facture), lignes, vendeur: vendeur(c.vendeur), origine: c.origine ?? null, aujourdHui: AUJOURD_HUI }
}

// ── Les exemples figés ─────────────────────────────────────────────────────────────────────────────────────────────
// Chacun porte ce que sa relecture doit rendre, calculé à la main et non par le générateur : HT, TVA, TTC dans le sens
// du document (un avoir positif), et la ventilation par taux (catégorie, taux, base, TVA, code du motif).

interface Exemple {
  nom: string
  donnees: DonneesCii
  numero: string
  nature: 'facture' | 'avoir'
  acheteur: string
  ht: number
  tva: number
  ttc: number
  ventilation: [string, number, number, number, string | null][]
}

const EXEMPLES: Exemple[] = [
  {
    nom: 'services-debits',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Mission de conseil — septembre 2026', quantite: 10, prix_unitaire_ht: 85.5 }),
        ligne({ ordre: 2, designation: 'Frais de dossier', quantite: 1, prix_unitaire_ht: 35 }),
      ],
      facture: {
        numero: 'F2026-0012',
        option_debits: true,
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
        tiers_siret: SIRET_CLIENT,
        tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
        notes: 'Merci de votre confiance.',
        mentions_legales: "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible, " +
          "ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 €.",
      },
    }),
    numero: 'F2026-0012',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 890,
    tva: 178,
    ttc: 1068,
    ventilation: [['S', 20, 890, 178, null]],
  },
  {
    nom: 'biens-livraison',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Fauteuil de consultation', quantite: 2, prix_unitaire_ht: 349.9, taux_tva: 20 }),
        ligne({ ordre: 2, designation: 'Ouvrage de référence', quantite: 3, prix_unitaire_ht: 24.5, taux_tva: 5.5 }),
        ligne({ ordre: 3, designation: 'Remise commerciale', quantite: 1, prix_unitaire_ht: -50, taux_tva: 20 }),
      ],
      facture: {
        numero: 'F2026-0013',
        nature_operation: 'biens',
        // L'option pour les débits ne vise que les services : sur des biens, elle ne se transmet ni ne s'imprime.
        option_debits: true,
        date_prestation: '2026-09-20',
        livraison_adresse: 'Entrepôt Démo, quai des Essais',
        livraison_code_postal: '13016',
        livraison_ville: 'Marseille',
        livraison_pays: 'FR',
        tiers_siret: '98765432400027',
      },
    }),
    numero: 'F2026-0013',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 723.3,
    tva: 134,
    ttc: 857.3,
    ventilation: [['S', 20, 649.8, 129.96, null], ['S', 5.5, 73.5, 4.04, null]],
  },
  {
    nom: 'mixte-organisme-public',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Installation du matériel', quantite: 1, prix_unitaire_ht: 1200, taux_tva: 20 }),
        ligne({ ordre: 2, designation: 'Transport de personnes', quantite: 4, prix_unitaire_ht: 37.25, taux_tva: 10 }),
      ],
      facture: {
        numero: 'F2026-0014',
        type_client: 'organisme_public',
        nature_operation: 'mixte',
        tiers_nom: 'Commune de Démoville',
        tiers_siren: SIREN_PUBLIC,
        tiers_siret: '10000020700017',
        tiers_adresse: 'Hôtel de ville\nPlace de la Mairie\n13999 Démoville',
        code_service: 'SERVICE-ACHATS',
        numero_engagement: 'EJ-2026-0042',
        date_prestation: '2026-09-25',
      },
    }),
    numero: 'F2026-0014',
    nature: 'facture',
    acheteur: SIREN_PUBLIC,
    ht: 1349,
    tva: 254.9,
    ttc: 1603.9,
    ventilation: [['S', 20, 1200, 240, null], ['S', 10, 149, 14.9, null]],
  },
  {
    nom: 'franchise',
    donnees: donnees({
      lignes: [ligne({ designation: 'Séance de coaching', quantite: 3, prix_unitaire_ht: 60, taux_tva: 0 })],
      vendeur: { statutTva: 'franchise' },
      facture: { numero: 'F2026-0015', mentions_legales: 'TVA non applicable, art. 293 B du CGI.' },
    }),
    numero: 'F2026-0015',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 180,
    tva: 0,
    ttc: 180,
    ventilation: [['E', 0, 180, 0, 'VATEX-FR-FRANCHISE']],
  },
  {
    nom: 'redevable-partiellement-exonere',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Formation professionnelle continue (deux jours)', quantite: 2, prix_unitaire_ht: 450, taux_tva: 0 }),
        ligne({ ordre: 2, designation: 'Accompagnement individuel', quantite: 1, prix_unitaire_ht: 99, taux_tva: 20 }),
      ],
      vendeur: { articleExoneration: 'cgi_261_4_4_a' },
      // L'option pour les débits se dit dans chaque ventilation, l'exonérée comprise (G1.43, S1.13).
      facture: { numero: 'F2026-0016', option_debits: true },
    }),
    numero: 'F2026-0016',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 999,
    tva: 19.8,
    ttc: 1018.8,
    ventilation: [['S', 20, 99, 19.8, null], ['E', 0, 900, 0, 'VATEX-FR-CGI261-4']],
  },
  {
    nom: 'exonere-organisme-public',
    donnees: donnees({
      lignes: [ligne({ designation: 'Actes de soins infirmiers — septembre 2026', quantite: 1, prix_unitaire_ht: 640, taux_tva: 0 })],
      vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' },
      facture: {
        numero: 'F2026-0017',
        type_client: 'organisme_public',
        tiers_nom: 'Établissement public de démonstration',
        tiers_siren: SIREN_PUBLIC,
        tiers_siret: '10000020700025',
        tiers_adresse: '1 allée des Essais\n13999 Démoville',
        code_service: 'SOINS',
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
      },
    }),
    numero: 'F2026-0017',
    nature: 'facture',
    acheteur: SIREN_PUBLIC,
    ht: 640,
    tva: 0,
    ttc: 640,
    ventilation: [['E', 0, 640, 0, 'VATEX-FR-CGI261-4']],
  },
  {
    nom: 'avoir',
    donnees: donnees({
      // Deux jours de la mission de « services-debits », crédités : la base garde l'avoir et ses lignes négatifs.
      lignes: [ligne({ designation: 'Mission de conseil — septembre 2026', quantite: -2, prix_unitaire_ht: 85.5 })],
      facture: {
        type: 'avoir',
        numero: 'A2026-0003',
        facture_origine_id: 'f-origine',
        date_emission: '2026-10-02',
        date_echeance: null,
        option_debits: true,
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
        tiers_siret: SIRET_CLIENT,
        tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
        notes: 'Deux jours non réalisés.',
      },
      origine: { numero: 'F2026-0012', date_emission: '2026-09-15' },
    }),
    numero: 'A2026-0003',
    nature: 'avoir',
    acheteur: SIREN_CLIENT,
    ht: 171,
    tva: 34.2,
    ttc: 205.2,
    ventilation: [['S', 20, 171, 34.2, null]],
  },
  {
    nom: 'caracteres-speciaux',
    donnees: donnees({
      lignes: [ligne({ designation: 'Conseil "stratégique" & suivi\u0007 — étape <1> ✓', quantite: 1.5, prix_unitaire_ht: 120.123456 })],
      vendeur: { nom: 'Atelier « Démo »  & Fils <SARL>', adresse: 'Bâtiment B, 3e étage, 12 rue des Exemples, 13001 Marseille' },
      facture: {
        numero: 'F2026/0018',
        tiers_nom: "L'Équipe d'Essai & Cie",
        tiers_adresse: 'Résidence Les Pins\nBâtiment C\nEscalier 2\nAppartement 14\n13008 Marseille',
        notes: 'Première ligne\nSeconde ligne, avec <balise> & esperluette\uD800',
      },
    }),
    numero: 'F2026/0018',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    // 1,5 × 120,123456 = 180,185184 : 180,19 hors taxes, 36,04 de TVA.
    ht: 180.19,
    tva: 36.04,
    ttc: 216.23,
    ventilation: [['S', 20, 180.19, 36.04, null]],
  },
]

// Depuis la racine du dépôt, d'où la suite se lance : sous jsdom, import.meta.url n'est pas une adresse de fichier.
const DOSSIER_EXEMPLES = `${resolve(process.cwd(), 'outils/facturation/exemples')}/`

function xmlDe(d: DonneesCii): string {
  const r = factureCii(d)
  if (r.xml === null) throw new Error(`refusée : ${r.refus.join(' | ')}`)
  return r.xml
}

describe('les exemples', () => {
  it.each(EXEMPLES)('$nom : aucun refus, et le XML est figé', async (e) => {
    expect(refusEmission(e.donnees)).toEqual([])
    await expect(xmlDe(e.donnees)).toMatchFileSnapshot(`${DOSSIER_EXEMPLES}${e.nom}.xml`)
  })

  it.each(EXEMPLES)('$nom : se relit sans anomalie, aux montants et à la ventilation calculés à la main', (e) => {
    const lecture = lireFactureXml(xmlDe(e.donnees))
    if (!('facture' in lecture)) throw new Error(lecture.refus)
    const f = lecture.facture
    expect(f.anomalies).toEqual([])
    expect(f.syntaxe).toBe('CII')
    expect(f.numero).toBe(e.numero)
    expect(f.nature).toBe(e.nature)
    expect(f.typeCode).toBe(e.nature === 'avoir' ? '381' : '380')
    expect(f.date).toBe(e.donnees.facture.date_emission)
    expect(f.echeance).toBe(e.donnees.facture.date_echeance)
    expect(f.devise).toBe('EUR')
    expect(f.vendeur.siren).toBe('123456782')
    expect(f.vendeur.tva).toBe(TVA_VENDEUR)
    expect(f.acheteur.siren).toBe(e.acheteur)
    expect([f.montantHt, f.montantTva, f.montantTtc, f.netAPayer]).toEqual([e.ht, e.tva, e.ttc, e.ttc])
    expect(f.ventilation.map((t) => [t.categorie, t.taux, t.base, t.tva, t.codeMotif])).toEqual(e.ventilation)
    expect(f.nbLignes).toBe(e.donnees.lignes.length)
  })

  it('les montants du document sont ceux que la facture a validés, au centime', () => {
    for (const e of EXEMPLES) {
      const m = montantsDuDocument(e.donnees.facture, e.donnees.lignes, null)
      const sens = e.nature === 'avoir' ? -1 : 1
      expect([m.htCentimes, m.tvaCentimes, m.ttcCentimes], e.nom).toEqual([
        Math.round(sens * e.donnees.facture.montant_ht * 100),
        Math.round(sens * e.donnees.facture.montant_tva * 100),
        Math.round(sens * e.donnees.facture.montant_ttc * 100),
      ])
    }
  })
})

describe('ce que le XML porte', () => {
  const xml = (nom: string) => xmlDe(EXEMPLES.find((e) => e.nom === nom)!.donnees)

  it('l’option pour les débits se transmet sur des services, pas sur des biens', () => {
    expect(xml('services-debits')).toContain('<ram:DueDateTypeCode>5</ram:DueDateTypeCode>')
    expect(xml('biens-livraison')).not.toContain('DueDateTypeCode')
    expect(xml('franchise')).not.toContain('DueDateTypeCode')
  })

  it('le cadre de facturation suit la nature des opérations', () => {
    expect(xml('services-debits')).toContain('<ram:ID>S1</ram:ID>')
    expect(xml('biens-livraison')).toContain('<ram:ID>B1</ram:ID>')
    expect(xml('mixte-organisme-public')).toContain('<ram:ID>M1</ram:ID>')
    expect([cadreDeFacturation('biens'), cadreDeFacturation('services'), cadreDeFacturation('mixte')]).toEqual(['B1', 'S1', 'M1'])
  })

  it('un organisme public reçoit son code service et son numéro d’engagement ; une entreprise, non', () => {
    const publique = xml('mixte-organisme-public')
    expect(publique).toContain('<ram:BuyerReference>SERVICE-ACHATS</ram:BuyerReference>')
    expect(publique).toContain('<ram:IssuerAssignedID>EJ-2026-0042</ram:IssuerAssignedID>')
    expect(publique).toContain('<ram:GlobalID schemeID="0009">10000020700017</ram:GlobalID>')
    const privee = xmlDe(donnees({ facture: { code_service: 'X', numero_engagement: 'Y' } }))
    expect(privee).not.toContain('BuyerReference')
    expect(privee).not.toContain('BuyerOrderReferencedDocument')
  })

  it('l’adresse électronique du client est celle de l’annuaire quand elle est donnée, sinon son SIREN', () => {
    expect(xml('services-debits')).toContain(`<ram:URIID schemeID="0225">${SIREN_CLIENT}_FACTURES</ram:URIID>`)
    expect(xml('franchise')).toContain(`<ram:URIID schemeID="0225">${SIREN_CLIENT}</ram:URIID>`)
    expect(xml('franchise')).toContain('<ram:URIID schemeID="0225">123456782</ram:URIID>')
  })

  it('un avoir cite sa facture, porte des montants positifs et n’a pas d’échéance', () => {
    const avoir = xml('avoir')
    expect(avoir).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(avoir).toContain('<ram:IssuerAssignedID>F2026-0012</ram:IssuerAssignedID>')
    expect(avoir).toContain('<qdt:DateTimeString format="102">20260915</qdt:DateTimeString>')
    expect(avoir).toContain('<ram:Description>Avoir sur la facture F2026-0012 du 15/09/2026.</ram:Description>')
    expect(avoir).toContain('<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>')
    expect(avoir).not.toContain('DueDateDateTime')
    expect(avoir).not.toMatch(/Amount[^>]*>-/)
  })

  it('une remise saisie avec un prix négatif part avec un prix positif et une quantité négative', () => {
    const biens = xml('biens-livraison')
    expect(biens).toContain('<ram:ChargeAmount>50</ram:ChargeAmount>')
    expect(biens).toContain('<ram:BilledQuantity unitCode="C62">-1</ram:BilledQuantity>')
    expect(biens).toContain('<ram:LineTotalAmount>-50.00</ram:LineTotalAmount>')
    expect(biens).not.toMatch(/ChargeAmount>-/)
  })

  it('une ligne exonérée porte la catégorie E, son motif et son code', () => {
    const partiel = xml('redevable-partiellement-exonere')
    expect(partiel).toContain('<ram:ExemptionReason>Exonération de TVA, art. 261, 4, 4° a du CGI.</ram:ExemptionReason>')
    expect(partiel).toContain('<ram:ExemptionReasonCode>VATEX-FR-CGI261-4</ram:ExemptionReasonCode>')
    expect(xml('franchise')).toContain('<ram:ExemptionReason>TVA non applicable, art. 293 B du CGI.</ram:ExemptionReason>')
  })

  it('le texte est échappé, et ce que XML 1.0 n’admet pas est retiré', () => {
    const special = xml('caracteres-speciaux')
    expect(special).toContain('<ram:Name>Atelier « Démo » &amp; Fils &lt;SARL&gt;</ram:Name>')
    expect(special).toContain('Conseil &quot;stratégique&quot; &amp; suivi — étape &lt;1&gt; ✓')
    expect([special.includes('\u0007'), special.includes('\uD800')]).toEqual([false, false])
    expect(special).toContain('<ram:LineThree>Escalier 2, Appartement 14</ram:LineThree>')
    expect(special).toContain('<ram:LineOne>Bâtiment B, 3e étage, 12 rue des Exemples</ram:LineOne>')
  })

  it('les noms et les libellés partent sur une ligne, le SIRET sans ses espaces', () => {
    const x = xmlDe(donnees({
      lignes: [ligne({ designation: 'Mission\n  de   conseil' })],
      facture: { tiers_nom: 'Client\nFictif   SAS', tiers_siret: '987 654 324 00019' },
    }))
    expect(x).toContain('<ram:Name>Client Fictif SAS</ram:Name>')
    expect(x).toContain('<ram:Name>Mission de conseil</ram:Name>')
    expect(x).toContain('<ram:GlobalID schemeID="0009">98765432400019</ram:GlobalID>')
  })

  it('l’adresse de livraison part sur une ligne, dans son pays', () => {
    const x = xmlDe(donnees({ facture: {
      nature_operation: 'biens', livraison_adresse: 'Entrepôt Démo\n  quai des Essais', livraison_code_postal: '1000',
      livraison_ville: 'Bruxelles', livraison_pays: 'BE',
    } }))
    const livraison = x.slice(x.indexOf('<ram:ShipToTradeParty>'), x.indexOf('</ram:ShipToTradeParty>'))
    expect(livraison).toContain('<ram:LineOne>Entrepôt Démo quai des Essais</ram:LineOne>')
    expect(livraison).toContain('<ram:CityName>Bruxelles</ram:CityName>')
    expect(livraison).toContain('<ram:CountryID>BE</ram:CountryID>')
  })

  it('l’option pour les débits se dit dans chaque ventilation, l’exonérée comprise', () => {
    const partiel = xml('redevable-partiellement-exonere')
    expect(partiel.match(/<ram:DueDateTypeCode>5<\/ram:DueDateTypeCode>/g)).toHaveLength(2)
    // Une facture de services toute exonérée d'un prestataire qui a opté le dit aussi, comme sa mention imprimée — à un
    // organisme public, puisqu'entre entreprises elle sortirait du champ (G2.32).
    const exoneree = xmlDe(donnees({
      lignes: [ligne({ taux_tva: 0 })],
      vendeur: { articleExoneration: 'cgi_261_4_4_a' },
      facture: { option_debits: true, type_client: 'organisme_public', tiers_siren: SIREN_PUBLIC, tiers_siret: '10000020700017' },
    }))
    expect(exoneree).toContain('<ram:DueDateTypeCode>5</ram:DueDateTypeCode>')
  })

  it('un avoir ne transmet pas d’échéance', () => {
    // Défensif : enregistrer_facture n'en écrit pas sur un avoir. Un avoir n'est pas « dû » par l'acheteur ; sa
    // condition de paiement (BT-20) dit la facture qu'il corrige, ce qui satisfait la règle BR-CO-25.
    const avoir = xmlDe(donnees({ lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: '2026-11-01' }, origine: ORIGINE }))
    expect(avoir).not.toContain('DueDateDateTime')
    expect(avoir).toContain('<ram:Description>Avoir sur la facture F2026-0001 du 01/09/2026.</ram:Description>')
  })

  it('une facture refusée ne rend aucun XML, et dit pourquoi', () => {
    const r = factureCii(donnees({ facture: { statut: 'brouillon' } }))
    expect(r).toEqual({ xml: null, refus: ['Seule une facture validée se transmet.'] })
  })
})

describe('refusEmission : chaque faute, seule, rend son refus et lui seul', () => {
  it('la facture de départ se transmet', () => {
    expect(refusEmission(donnees())).toEqual([])
  })

  const CAS: [string, Cas, string][] = [
    ['un brouillon', { facture: { statut: 'brouillon' } }, 'Seule une facture validée se transmet.'],
    ['sans numéro', { facture: { numero: null } }, 'Seule une facture validée se transmet.'],
    ['un numéro hors du jeu de caractères', { facture: { numero: 'F2026#1' } }, 'Le numéro F2026#1 ne peut pas être transmis'],
    ['une année hors des bornes', { facture: { date_emission: '1999-12-31' } }, 'La date d’émission (31/12/1999) n’est pas une date admise (années 2000 à 2099).'],
    // Une date au-delà de 2099 est aussi dans l'avenir : une seule faute, un seul refus.
    ['une année après 2099', { facture: { date_emission: '2101-01-01' } }, 'n’est pas une date admise'],
    ['une date dans l’avenir', { facture: { date_emission: '2026-10-08' } }, 'qui n’est pas encore arrivé'],
    ['sans destinataire', { facture: { type_client: null } }, 'Dis à qui la facture est adressée'],
    ['à un particulier', { facture: { type_client: 'non_assujetti' } }, 'Une facture à un particulier ne passe pas par la plateforme'],
    ['à un client étranger', { facture: { type_client: 'etranger' } }, 'client établi hors de France'],
    ['sans nature d’opération', { facture: { nature_operation: null } }, 'des livraisons de biens, des prestations de services'],
    ['sans nom de dossier', { vendeur: { nom: '  ' } }, 'Le nom du dossier manque'],
    ['un SIRET du dossier à la clé fausse', { vendeur: { siret: '12345678900010' } }, 'ne donne pas un SIREN valide'],
    ['sans SIRET du dossier', { vendeur: { siret: null } }, 'ne donne pas un SIREN valide'],
    ['sans adresse du dossier', { vendeur: { adresse: null } }, 'L’adresse du dossier manque'],
    ['sans nom de client', { facture: { tiers_nom: ' ' } }, 'Le nom du client manque'],
    ['sans SIREN de client', { facture: { tiers_siren: null } }, 'Le SIREN du client manque'],
    ['un SIREN de client à la clé fausse', { facture: { tiers_siren: '987654321' } }, 'Le SIREN du client manque ou ne passe pas'],
    // Ce qui découle du SIREN ne se juge pas sur un SIREN faux : son refus suffit.
    ['un SIREN de client faux, avec un SIRET', { facture: { tiers_siren: '987654321', tiers_siret: SIRET_CLIENT } }, 'Le SIREN du client manque ou ne passe pas'],
    [
      'un SIREN de client faux, avec une adresse électronique',
      { facture: { tiers_siren: '987654321', tiers_adresse_electronique: SIREN_CLIENT } },
      'Le SIREN du client manque ou ne passe pas',
    ],
    ['sans adresse de client', { facture: { tiers_adresse: null } }, 'L’adresse du client manque'],
    ['un organisme public sans SIRET', { facture: { type_client: 'organisme_public' } }, 'Un organisme public se désigne par son SIRET'],
    ['un SIRET de client à la clé fausse', { facture: { tiers_siret: '98765432400010' } }, 'Le SIRET du client ne passe pas sa clé'],
    ['le SIRET d’un autre SIREN', { facture: { tiers_siret: SIRET_VENDEUR } }, 'Le SIRET du client ne commence pas par son SIREN'],
    ['une adresse électronique d’une autre forme', { facture: { tiers_adresse_electronique: 'FACTURES' } }, 'n’a pas la forme que l’annuaire publie'],
    ['l’adresse électronique d’un autre SIREN', { facture: { tiers_adresse_electronique: '123456782' } }, 'L’adresse de facturation électronique du client ne commence pas par son SIREN'],
    ['un statut de TVA à préciser', { vendeur: { statutTva: null } }, 'Le statut de TVA du dossier est à préciser'],
    ['un statut de TVA à préciser, ligne à 0 %', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: null } }, 'Le statut de TVA du dossier est à préciser'],
    ['aucune ligne', { lignes: [] }, 'La facture n’a aucune ligne.'],
    // Sans ligne, rien ne demande le numéro de TVA du dossier (BR-S-02, BR-E-02 et G1.47 partent des lignes).
    ['aucune ligne, sans numéro de TVA', { lignes: [], vendeur: { numeroTva: null } }, 'La facture n’a aucune ligne.'],
    ['une ligne sans désignation', { lignes: [ligne({ designation: ' ' })] }, 'Ligne 1 : sa désignation manque.'],
    ['une quantité à cinq décimales', { lignes: [ligne({ quantite: 1.23456 })] }, 'Ligne 1 : la quantité ne s’écrit pas avec quatre décimales au plus.'],
    ['un prix à sept décimales', { lignes: [ligne({ prix_unitaire_ht: 10.1234567 })] }, 'Ligne 1 : le prix ne s’écrit pas avec six décimales au plus.'],
    ['un taux inconnu', { lignes: [ligne({ taux_tva: 15 })] }, 'Ligne 1 : le taux de 15 % n’est pas un taux de TVA admis.'],
    ['une ligne taxée en franchise', { vendeur: { statutTva: 'franchise' } }, 'Ligne 1 : Un dossier en franchise en base ne facture pas de TVA'],
    ['une ligne taxée d’un exonéré', { vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' } }, 'Ligne 1 : Un dossier exonéré ne facture pas de TVA'],
    ['une ligne à 0 % d’un redevable sans article', { lignes: [ligne({ taux_tva: 0 }), ligne({ ordre: 2, taux_tva: 0 })] }, 'Une ligne à 0 % d’un dossier redevable demande l’article'],
    ['une ligne à 0 % d’un exonéré sans article', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere' } }, 'Le dossier est exonéré sans article'],
    ['un total négatif', { lignes: [ligne({ prix_unitaire_ht: -50 })] }, 'Le total de la facture n’est pas positif'],
    ['un total nul', { lignes: [ligne({ prix_unitaire_ht: 0 })] }, 'Le total de la facture n’est pas positif'],
    [
      'un avoir nul',
      { lignes: [ligne({ quantite: -1, prix_unitaire_ht: 0 })], facture: { type: 'avoir', date_echeance: null }, origine: ORIGINE },
      'Un avoir crédite un montant : son total doit être positif.',
    ],
    ['un total TTC qui n’est pas celui des lignes', { facture: { montant_ttc: 120.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
    ['un total HT qui n’est pas celui des lignes', { facture: { montant_ht: 100.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
    ['une TVA qui n’est pas celle des lignes', { facture: { montant_tva: 20.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
    [
      'une facture tout exonérée par l’article 261 à une entreprise',
      { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' } },
      'Une facture dont toutes les opérations sont exonérées par les articles 261 à 261 E du CGI n’entre pas dans la facturation électronique entre entreprises.',
    ],
    [
      'une facture tout exonérée par l’article 261 C à une entreprise',
      { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_c_2' } },
      'n’entre pas dans la facturation électronique entre entreprises',
    ],
    // Hors du champ, c'est tout ce qu'il y a à dire : réclamer le numéro de TVA laisserait croire qu'il suffirait.
    [
      'une facture tout exonérée à une entreprise, sans numéro de TVA',
      { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', numeroTva: null } },
      'n’entre pas dans la facturation électronique entre entreprises',
    ],
    ['sans numéro de TVA, redevable', { vendeur: { numeroTva: null } }, 'Le numéro de TVA intracommunautaire du dossier manque.'],
    ['sans numéro de TVA, en franchise', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'franchise', numeroTva: null } }, 'règle G1.47 de la DGFiP'],
    ['un numéro de TVA d’un autre SIREN', { vendeur: { numeroTva: 'FR00123456782' } }, 'ne correspond pas à son SIREN'],
    ['une facture sans échéance', { facture: { date_echeance: null } }, 'Indique la date d’échéance'],
    ['une échéance hors des bornes', { facture: { date_echeance: '2100-01-01' } }, 'La date d’échéance n’est pas une date admise'],
    [
      'un avoir qui ne cite pas sa facture',
      { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null } },
      'L’avoir doit citer la facture qu’il corrige.',
    ],
    [
      'un avoir qui cite une facture au numéro hors du jeu de caractères',
      { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: { ...ORIGINE, numero: 'F#12' } },
      'Le numéro de la facture corrigée (F#12) ne peut pas être transmis.',
    ],
    [
      'un avoir qui cite une facture datée hors des bornes',
      { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: { ...ORIGINE, date_emission: '1999-12-31' } },
      'La date de la facture corrigée n’est pas une date admise',
    ],
    ['une période à l’envers', { facture: { periode_debut: '2026-09-30', periode_fin: '2026-09-01' } }, 'La période de la prestation finit avant de commencer.'],
    // Hors des bornes et à l'envers : une seule faute dite, celle des bornes.
    ['une période hors des bornes', { facture: { periode_debut: '2026-09-01', periode_fin: '1999-09-30' } }, 'La période de la prestation porte une date qui n’est pas admise'],
    ['une période qui commence avant 2000', { facture: { periode_debut: '1999-09-01', periode_fin: '2026-09-30' } }, 'La période de la prestation porte une date qui n’est pas admise'],
    ['une date de prestation avant 2000', { facture: { date_prestation: '1999-01-01' } }, 'La date de la livraison ou de la prestation n’est pas une date admise'],
    ['une date de prestation après 2099', { facture: { date_prestation: '2100-01-01' } }, 'La date de la livraison ou de la prestation n’est pas une date admise'],
  ]

  it.each(CAS)('%s', (_, c, attendu) => {
    expect(refusEmission(donnees(c))).toEqual([expect.stringContaining(attendu)])
  })

  it('ce qui se transmet : une facture datée du jour, des bornes atteintes, un SIRET de 14 chiffres, un avoir sans échéance', () => {
    expect(refusEmission(donnees({ facture: { date_emission: AUJOURD_HUI } }))).toEqual([])
    expect(refusEmission(donnees({ facture: { date_emission: '2000-01-01', date_echeance: '2099-12-31', date_prestation: '2099-12-31' } }))).toEqual([])
    expect(refusEmission(donnees({ facture: { periode_debut: '2000-01-01', periode_fin: '2099-12-31' } }))).toEqual([])
    // L'échéance d'un avoir ne se transmet pas : elle n'est pas jugée.
    expect(refusEmission(donnees({
      lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: '2100-01-01' }, origine: ORIGINE,
    }))).toEqual([])
  })

  it('ce qui se transmet : un organisme public tout exonéré, une franchise, un SIRET écrit avec des espaces, un avoir', () => {
    expect(refusEmission(donnees({
      lignes: [ligne({ taux_tva: 0 })],
      vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' },
      facture: { type_client: 'organisme_public', tiers_siret: '987 654 324 00019' },
    }))).toEqual([])
    expect(refusEmission(donnees({ lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'franchise' } }))).toEqual([])
    expect(refusEmission(donnees({ facture: { tiers_siret: '987 654 324 00019' } }))).toEqual([])
    expect(refusEmission(EXEMPLES.find((e) => e.nom === 'avoir')!.donnees)).toEqual([])
  })

  it('une ligne se désigne par son rang dans la facture, pas par l’ordre où elle arrive', () => {
    const lignes = [ligne({ ordre: 2, designation: 'Seconde' }), ligne({ ordre: 1, designation: '' })]
    expect(refusEmission(donnees({ lignes }))).toEqual(['Ligne 1 : sa désignation manque.'])
  })

  it('tout est dit ensemble, dans l’ordre de l’écran', () => {
    expect(refusEmission(donnees({
      facture: { type_client: null, nature_operation: null, date_echeance: null, numero: 'F#1' },
      vendeur: { adresse: null },
    }))).toEqual([
      expect.stringContaining('Le numéro F#1'),
      expect.stringContaining('Dis à qui'),
      expect.stringContaining('livraisons de biens'),
      expect.stringContaining('L’adresse du dossier'),
      expect.stringContaining('date d’échéance'),
    ])
  })
})

describe('les identifiants', () => {
  it('un SIREN : neuf chiffres et leur clé', () => {
    expect(sirenValide('123456782')).toBe(true)
    expect(sirenValide('123456789')).toBe(false)
    expect(sirenValide('12345678')).toBe(false)
    expect(sirenValide('12345678a')).toBe(false)
    expect(sirenValide(null)).toBe(false)
    expect(sirenValide(undefined)).toBe(false)
  })

  it('un SIRET : quatorze chiffres et leur clé, sauf les établissements de La Poste', () => {
    expect(siretValide(SIRET_VENDEUR)).toBe(true)
    expect(siretValide('12345678200011')).toBe(false)
    expect(siretValide('1234567820001')).toBe(false)
    expect(siretValide(null)).toBe(false)
    // Un établissement de La Poste : la somme de ses chiffres est un multiple de 5, la clé de Luhn ne vaut pas.
    expect(siretValide('35600000000001')).toBe(true)
    expect(siretValide('35600000000014')).toBe(false)
    // Son siège garde la clé de Luhn.
    expect(siretValide('35600000000048')).toBe(true)
  })

  it('le SIREN d’un SIRET', () => {
    expect(sirenDe('123 456 782 00010')).toBe('123456782')
    expect(sirenDe('123456782')).toBe('123456782')
    expect(sirenDe('1234567820001')).toBeNull()
    expect(sirenDe('abc')).toBeNull()
    expect(sirenDe(null)).toBeNull()
  })

  it('le numéro de TVA français, clé sur deux chiffres', () => {
    expect(numeroTvaFrancais('123456782')).toBe('FR11123456782')
    expect(numeroTvaFrancais('987654324')).toBe('FR14987654324')
    expect(numeroTvaFrancais('100000207')).toBe('FR03100000207')
  })

  it('le numéro d’une facture', () => {
    expect(numeroAdmis('F2026-0001')).toBe(true)
    expect(numeroAdmis('A2026/12_b+1')).toBe(true)
    expect(numeroAdmis('F 2026 1')).toBe(true)
    expect(numeroAdmis('F'.repeat(35))).toBe(true)
    expect(numeroAdmis('F'.repeat(36))).toBe(false)
    expect(numeroAdmis(' F1')).toBe(false)
    expect(numeroAdmis('F1 ')).toBe(false)
    expect(numeroAdmis('F  1')).toBe(false)
    expect(numeroAdmis('F#1')).toBe(false)
    expect(numeroAdmis('É1')).toBe(false)
    expect(numeroAdmis('')).toBe(false)
  })

  it('les taux admis sont les quinze de la règle G1.24, métropole, Corse et outre-mer', () => {
    expect([...TAUX_ADMIS].sort((a, b) => a - b)).toEqual([0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6])
  })

  it('un SIRET n’est pas un SIREN, ni l’inverse, et la longueur compte', () => {
    expect(sirenValide(SIRET_VENDEUR)).toBe(false)
    expect(siretValide('123456782')).toBe(false)
    // Un zéro en tête ne change pas la clé de Luhn : seule la longueur refuse ces deux-là.
    expect(sirenValide(`0${SIREN_CLIENT}`)).toBe(false)
    expect(siretValide(`0${SIRET_VENDEUR}`)).toBe(false)
  })
})

describe('l’adresse', () => {
  it('la ligne au code postal donne le code et la ville, les autres sont les lignes', () => {
    expect(adresseStructuree('12 rue des Exemples\n  Bâtiment   B \n13001 Marseille')).toEqual({
      lignes: ['12 rue des Exemples', 'Bâtiment B'], codePostal: '13001', ville: 'Marseille',
    })
  })

  it('une adresse sur une ligne qui finit par « , 75001 Paris »', () => {
    expect(adresseStructuree('3 place des Essais, 75001 Paris')).toEqual({ lignes: ['3 place des Essais'], codePostal: '75001', ville: 'Paris' })
  })

  it('le code postal se cherche depuis la fin', () => {
    expect(adresseStructuree('13000 Lot A\n2 rue Neuve\n13001 Marseille CEDEX 01')).toEqual({
      lignes: ['13000 Lot A', '2 rue Neuve'], codePostal: '13001', ville: 'Marseille CEDEX 01',
    })
  })

  it('sans code postal reconnu, rien n’est interprété', () => {
    expect(adresseStructuree('Rue sans code\nVille')).toEqual({ lignes: ['Rue sans code', 'Ville'], codePostal: null, ville: null })
    expect(adresseStructuree(null)).toEqual({ lignes: [], codePostal: null, ville: null })
    expect(adresseStructuree('1300 Marseille')).toEqual({ lignes: ['1300 Marseille'], codePostal: null, ville: null })
  })
})

describe('les nombres', () => {
  it('un décimal sans exposant, au plus de décimales que la règle admet', () => {
    expect(decimal(1.5, 4)).toBe('1.5')
    expect(decimal(2, 4)).toBe('2')
    expect(decimal(-0.25, 2)).toBe('-0.25')
    expect(decimal(0.0001, 4)).toBe('0.0001')
    expect(decimal(0.1 + 0.2, 4)).toBe('0.3')
    expect(decimal(120.123456, 6)).toBe('120.123456')
    expect(decimal(1.23456, 4)).toBeNull()
    expect(decimal(-0.00001, 4)).toBeNull()
    expect(decimal(Number.NaN, 2)).toBeNull()
    expect(decimal(Number.POSITIVE_INFINITY, 2)).toBeNull()
    expect(decimal(-0, 4)).toBe('0')
    expect(decimal(1e21, 2)).toBeNull()
    expect(decimal(2 ** 53, 0)).toBeNull()
    expect(decimal(2 ** 53 - 1, 0)).toBe('9007199254740991')
  })

  it('les montants du document : dans le sens de son type, regroupés par taux du plus fort au plus faible', () => {
    const m = montantsDuDocument(
      { type: 'avoir' },
      [ligne({ ordre: 2, quantite: -1, prix_unitaire_ht: 10, taux_tva: 5.5 }), ligne({ ordre: 1, quantite: -2, prix_unitaire_ht: 100, taux_tva: 20 })],
      null,
    )
    expect(m.lignes.map((l) => [l.numero, l.quantite, l.prix, l.htCentimes, l.tvaCentimes])).toEqual([[1, 2, 100, 20000, 4000], [2, 1, 10, 1000, 55]])
    expect(m.groupes.map((g) => [g.categorie, g.taux, g.baseCentimes, g.tvaCentimes])).toEqual([['S', 20, 20000, 4000], ['S', 5.5, 1000, 55]])
    expect([m.htCentimes, m.tvaCentimes, m.ttcCentimes]).toEqual([21000, 4055, 25055])
  })

  it('une remise au prix négatif : quantité négative, prix positif, même montant au centime', () => {
    const [l] = montantsDuDocument({ type: 'facture' }, [ligne({ quantite: 3, prix_unitaire_ht: -0.35 })], null).lignes
    expect([l.quantite, l.prix, l.htCentimes, l.tvaCentimes]).toEqual([-3, 0.35, -105, -21])
  })

  it('une quantité nulle reste un zéro, jamais « -0 »', () => {
    const [l] = montantsDuDocument({ type: 'avoir' }, [ligne({ quantite: 0 })], null).lignes
    expect(Object.is(l.quantite, 0)).toBe(true)
  })

  it('le motif n’habille que la catégorie E', () => {
    const m = montantsDuDocument({ type: 'facture' }, [ligne({ taux_tva: 0 }), ligne({ ordre: 2 })], { code: 'VATEX-X', texte: 'Motif' })
    expect(m.groupes.map((g) => [g.categorie, g.codeMotif, g.motif])).toEqual([['S', null, null], ['E', 'VATEX-X', 'Motif']])
  })
})

describe('les mentions imprimées', () => {
  const mentions = (o: Partial<FactureEmise>) => mentionsImprimees(facture([ligne()], o))

  it('ce que la facture porte, et rien de ce qu’elle n’a pas', () => {
    expect(mentions({ tiers_siren: null, nature_operation: null })).toEqual([])
    expect(mentions({})).toEqual([
      { libelle: 'SIREN du client', texte: '987 654 324' },
      { libelle: 'Opérations', texte: 'Prestations de services' },
    ])
  })

  it('la date ou la période de la prestation, et l’adresse de livraison', () => {
    expect(mentions({ tiers_siren: null, nature_operation: 'biens', date_prestation: '2026-09-20',
      livraison_adresse: 'Quai  des Essais', livraison_code_postal: '13016', livraison_ville: 'Marseille', livraison_pays: 'BE' })).toEqual([
      { libelle: 'Opérations', texte: 'Livraisons de biens' },
      { libelle: 'Date de la livraison ou de la prestation', texte: '20/09/2026' },
      { libelle: 'Adresse de livraison', texte: 'Quai des Essais, 13016 Marseille, BE' },
    ])
    expect(mentions({ tiers_siren: null, nature_operation: 'biens', livraison_adresse: 'Quai des Essais', livraison_code_postal: '13016',
      livraison_ville: 'Marseille', livraison_pays: 'FR' })).toContainEqual({ libelle: 'Adresse de livraison', texte: 'Quai des Essais, 13016 Marseille' })
    expect(mentions({ tiers_siren: null, nature_operation: 'mixte', periode_debut: '2026-09-01', periode_fin: '2026-09-30' })).toEqual([
      { libelle: 'Opérations', texte: 'Livraisons de biens et prestations de services' },
      { libelle: 'Période', texte: 'du 01/09/2026 au 30/09/2026' },
    ])
  })

  it('l’option pour les débits, sur des services seulement', () => {
    const debits = { libelle: 'TVA', texte: 'Option pour le paiement de la taxe d’après les débits' }
    expect(mentions({ option_debits: true })).toContainEqual(debits)
    expect(mentions({ option_debits: true, nature_operation: 'mixte' })).toContainEqual(debits)
    expect(mentions({ option_debits: true, nature_operation: 'biens' })).not.toContainEqual(debits)
    expect(mentions({ option_debits: false })).not.toContainEqual(debits)
  })

  it('le code service et le numéro d’engagement, pour un organisme public seulement', () => {
    expect(mentions({ type_client: 'organisme_public', code_service: 'SOINS', numero_engagement: 'EJ-1' })).toEqual(expect.arrayContaining([
      { libelle: 'Code service', texte: 'SOINS' },
      { libelle: 'Numéro d’engagement', texte: 'EJ-1' },
    ]))
    expect(mentions({ code_service: 'SOINS', numero_engagement: 'EJ-1' }).map((m) => m.libelle)).not.toContain('Code service')
  })
})

// ── Le dernier mot est au validateur ───────────────────────────────────────────────────────────────────────────────

describe('les exemples ont passé le validateur officiel de la norme', () => {
  it('chaque exemple figé porte l’empreinte que outils/facturation/valider.mjs a écrite', () => {
    const fichiers = readdirSync(DOSSIER_EXEMPLES).filter((f) => f.endsWith('.xml')).sort()
    expect(fichiers).toEqual(EXEMPLES.map((e) => `${e.nom}.xml`).sort())
    const manifeste = JSON.parse(readFileSync(`${DOSSIER_EXEMPLES}valides.json`, 'utf8')) as {
      fichiers: Record<string, { sha256: string; avertissements: string[] }>
    }
    expect(Object.keys(manifeste.fichiers).sort()).toEqual(fichiers)
    for (const f of fichiers) {
      const empreinte = createHash('sha256').update(readFileSync(`${DOSSIER_EXEMPLES}${f}`)).digest('hex')
      expect(manifeste.fichiers[f].sha256, `${f} a changé depuis sa validation : relancer valider.mjs`).toBe(empreinte)
      expect(manifeste.fichiers[f].avertissements, f).toEqual([])
    }
  })
})
