// @vitest-environment jsdom
// Le générateur de la facture électronique émise (factureCii.ts). Les factures sont FICTIVES (src/test/facturesCii.ts) :
// des identifiants valides par leur clé mais inventés, des noms et des adresses de démonstration.
//
// LES EXEMPLES SONT JUGÉS PAR L'INSTRUMENT OFFICIEL, PAS PAR CE FICHIER. Chacun est figé dans outils/facturation/exemples/
// et a passé le schéma CII D16B et les règles de la norme EN 16931 (outils/facturation/valider.mjs, qui écrit
// valides.json) : le dernier test refuse un exemple dont l'empreinte n'y figure pas, si bien qu'un exemple qui change
// repasse au validateur avant de partir. jsdom : la relecture passe par l'analyseur XML du navigateur (lireFactureXml).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUJOURD_HUI,
  CAS_DE_REFUS,
  donnees,
  EXEMPLES,
  facture,
  ligne,
  ORIGINE,
  SIREN_CLIENT,
  SIREN_PUBLIC,
  SIRET_VENDEUR,
  TVA_VENDEUR,
  vendeur,
} from '../test/facturesCii'
import {
  adresseStructuree,
  cadreDeFacturation,
  decimal,
  donneesDeLaFacture,
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
} from './factureCii'
import { lireFactureXml } from './factureElectronique'
import type { FactureEmise } from './types'

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

  it('les mentions légales partent avec la facture, ses notes internes jamais', () => {
    // Les notes d'une facture et le motif d'un avoir sont INTERNES : l'écran le dit en les saisissant.
    const services = xml('services-debits')
    expect(services).toContain('<ram:Content>En cas de retard de paiement, une pénalité égale à trois fois')
    expect(services.match(/<ram:IncludedNote>/g)).toHaveLength(1)
    expect(services).not.toContain('Merci de votre confiance')
    expect(xml('avoir')).not.toContain('Deux jours non réalisés')
    expect(xml('avoir')).not.toContain('IncludedNote')
    const notee = xmlDe(donnees({ facture: { notes: 'Client lent à payer : relancer le 10.', mentions_legales: null } }))
    expect(notee).not.toContain('relancer')
    expect(notee).not.toContain('IncludedNote')
  })

  it('le texte est échappé, et ce que XML 1.0 n’admet pas est retiré', () => {
    const special = xml('caracteres-speciaux')
    expect(special).toContain('<ram:Name>Atelier « Démo » &amp; Fils &lt;SARL&gt;</ram:Name>')
    expect(special).toContain('Conseil &quot;stratégique&quot; &amp; suivi — étape &lt;1&gt; ✓')
    expect(special).toContain('<ram:Content>Première ligne\nSeconde ligne, avec &lt;balise&gt; &amp; esperluette</ram:Content>')
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

  const CAS = CAS_DE_REFUS

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

describe('donneesDeLaFacture : la facture de la base, assemblée pour le générateur', () => {
  const lignes = [ligne()]
  const zero = [ligne({ taux_tva: 0 })]
  const redevable = { statut_tva: 'redevable', article_exoneration: null } as const

  it('le vendeur est l’émetteur figé par la facture, son numéro de TVA tiré du SIREN figé', () => {
    const d = donneesDeLaFacture(facture(lignes), lignes, redevable, null, AUJOURD_HUI)
    expect(d).toEqual(donnees({ lignes }))
    expect(refusEmission(d)).toEqual([])
  })

  it('l’émetteur de la facture, jamais un autre : un SIRET figé différent donne son propre numéro', () => {
    const d = donneesDeLaFacture(facture(lignes, { emetteur_siret: '98765432400019', emetteur_nom: 'Autre nom' }), lignes, redevable, null, AUJOURD_HUI)
    expect(d.vendeur).toMatchObject({ nom: 'Autre nom', siret: '98765432400019', numeroTva: numeroTvaFrancais(SIREN_CLIENT) })
  })

  it('un dossier en franchise ou exonéré n’a pas de numéro inventé, et le refus le dit (règle G1.47)', () => {
    for (const dossier of [{ statut_tva: 'franchise', article_exoneration: null }, { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' }] as const) {
      const d = donneesDeLaFacture(facture(zero, { type_client: 'organisme_public', tiers_siren: SIREN_PUBLIC, tiers_siret: '10000020700017' }), zero, dossier, null, AUJOURD_HUI)
      expect(d.vendeur).toMatchObject({ numeroTva: null, statutTva: dossier.statut_tva, articleExoneration: dossier.article_exoneration })
      expect(refusEmission(d)).toEqual([expect.stringContaining('règle G1.47')])
    }
  })

  it('un statut à préciser : le numéro se calcule, et seul le statut se réclame', () => {
    const d = donneesDeLaFacture(facture(zero), zero, { statut_tva: null, article_exoneration: null }, null, AUJOURD_HUI)
    expect(d.vendeur.numeroTva).toBe(TVA_VENDEUR)
    expect(refusEmission(d)).toEqual([expect.stringContaining('Le statut de TVA du dossier est à préciser')])
  })

  it('un SIREN figé faux ou absent : une faute, un refus — le numéro de TVA qui en découle ne se réclame pas', () => {
    for (const emetteur_siret of ['12345678900010', null]) {
      for (const statut_tva of ['redevable', null] as const) {
        const d = donneesDeLaFacture(facture(lignes, { emetteur_siret }), lignes, { statut_tva, article_exoneration: null }, null, AUJOURD_HUI)
        expect(d.vendeur.numeroTva).toBeNull()
        const attendus = [expect.stringContaining('ne donne pas un SIREN valide')]
        if (statut_tva === null) attendus.push(expect.stringContaining('Le statut de TVA du dossier est à préciser'))
        expect(refusEmission(d), `${emetteur_siret} ${statut_tva}`).toEqual(attendus)
      }
    }
  })

  it('un redevable dont le numéro manque encore malgré un SIREN valide le voit réclamé', () => {
    expect(refusEmission(donnees({ vendeur: { numeroTva: null } }))).toEqual(['Le numéro de TVA intracommunautaire du dossier manque.'])
    expect(vendeur().siret).toBe(SIRET_VENDEUR)
  })

  it('un avoir reçoit sa facture d’origine, et la date du jour passe telle quelle', () => {
    const credit = [ligne({ quantite: -1 })]
    const d = donneesDeLaFacture(facture(credit, { type: 'avoir', numero: 'A2026-0001', date_echeance: null }), credit, redevable, ORIGINE, '2026-10-08')
    expect(d.origine).toEqual(ORIGINE)
    expect(d.aujourdHui).toBe('2026-10-08')
    expect(refusEmission(d)).toEqual([])
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
