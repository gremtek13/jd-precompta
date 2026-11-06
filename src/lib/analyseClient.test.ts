import { describe, expect, it } from 'vitest'
import * as A from './analyseClient'
import type { LigneDeProvenance } from './analyseClient'
import { motsDuCabinet } from './espaceVentes'
import type { LigneDeFacture, PartLue } from './encaissementsFactures'
import type { EncaissementDesVentes, ListesDesVentes } from './tuilesVentes'
import { factureFigee } from '../test/mentionsFigees'
import type { FactureEmise } from './types'

// « MON ANALYSE » (étape B9a) : chaque chiffre d'une liste lue en entier, muet sinon ; les avoirs déduits, les brouillons
// écartés ; le reste dû du registre, avoirs crédités ; le CSV des autres exports. Des jeux d'essai FICTIFS.

const AUJOURDHUI = '2026-11-06'

function facture(o: Partial<FactureEmise>): FactureEmise {
  return factureFigee({ date_emission: '2026-11-02', date_echeance: null, montant_ht: 100, montant_tva: 20, montant_ttc: 120, ...o })
}
const ligne = (o: Partial<LigneDeFacture>): LigneDeFacture => ({
  facture_id: 'f1', ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o,
})
const encaissement = (o: Partial<EncaissementDesVentes>): EncaissementDesVentes => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', montant: 120, ligne_bancaire_id: null, annule_id: null, retire_le: null,
  date_encaissement: '2026-11-03', moyen: 'virement', cree_par: null, cree_le: '2026-11-03T10:00:00Z', ...o,
})
const part = (o: Partial<PartLue>): PartLue => ({ encaissement_id: 'e1', taux: 20, montant: 120, ...o })
function listes(o: Partial<ListesDesVentes>): ListesDesVentes {
  return {
    factures: [], facturesIncompletes: null, transmissions: [], transmissionsIncompletes: null, lignes: [], encaissements: [],
    parts: [], encaissementsIncomplets: null, declarations: [], evenementsSuperpdp: [], declarationsIncompletes: null,
    statutsLus: [], statutsIncomplets: null, ...o,
  }
}
const provenance = (o: Partial<LigneDeProvenance>): LigneDeProvenance => ({
  id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, reprise_facture_id: null,
  article_id: null, reference: null, ...o,
})

describe('qui voit « Mon analyse »', () => {
  it('avec « Mes ventes » ou « Ma banque », jamais sans les deux', () => {
    expect(A.monAnalyseOuverte(true, false)).toBe(true)
    expect(A.monAnalyseOuverte(false, true)).toBe(true)
    expect(A.monAnalyseOuverte(false, false)).toBe(false)
  })
})

describe('le chiffre d’affaires facturé', () => {
  const lues = listes({
    factures: [
      facture({ id: 'f1', date_emission: '2026-11-02', montant_ht: 1000 }),
      facture({ id: 'a1', type: 'avoir', facture_origine_id: 'f1', date_emission: '2026-11-04', montant_ht: -200 }),
      facture({ id: 'f2', date_emission: '2026-03-10', montant_ht: 500.1 }),
      facture({ id: 'b1', statut: 'brouillon', numero: null, date_emission: '2026-11-05', montant_ht: 9999 }),
      facture({ id: 'f3', date_emission: '2025-11-20', montant_ht: 400 }),
      facture({ id: 'f4', date_emission: '2025-12-20', montant_ht: 7000 }),
    ],
  })

  it('du mois et cumulé depuis janvier, avoirs déduits, brouillons écartés, comparés aux mêmes mois de l’an passé', () => {
    const ca = A.chiffreDAffairesFacture(lues, AUJOURDHUI)
    expect(ca).toEqual({
      etat: 'lu',
      mois: { libelle: 'novembre 2026', centimes: 80000, libelleN1: 'novembre 2025', n1Centimes: 40000 },
      // Décembre 2025 n'est pas dans les mêmes mois que janvier à novembre 2026.
      cumul: { libelle: 'de janvier à novembre 2026', centimes: 130010, libelleN1: 'de janvier à novembre 2025', n1Centimes: 40000 },
    })
    expect(A.variation({ centimes: 80000, n1Centimes: 40000 })).toBe('+100 %')
    expect(A.variation({ centimes: 30000, n1Centimes: 40000 })).toBe('−25 %')
    expect(A.variation({ centimes: 30000, n1Centimes: 0 })).toBeNull()
  })

  it('muet, avec son motif, sur des factures lues en partie : jamais « 0 »', () => {
    expect(A.chiffreDAffairesFacture({ ...lues, facturesIncompletes: '500 lignes sur 900' }, AUJOURDHUI))
      .toEqual({ etat: 'muet', motif: '500 lignes sur 900' })
  })

  it('en janvier, le cumul est le mois', () => {
    const ca = A.chiffreDAffairesFacture(lues, '2026-01-15')
    expect(ca.etat === 'lu' && ca.cumul.libelle).toBe('janvier 2026')
  })
})

describe('ce que tes clients te doivent', () => {
  const lues = (o: Partial<ListesDesVentes> = {}) => listes({
    factures: [
      // En retard : échéance passée, rien encaissé.
      facture({ id: 'f1', date_echeance: '2026-10-31' }),
      // À venir : 300 TTC, encaissée de 120.
      facture({ id: 'f2', date_echeance: '2026-12-01', montant_ht: 250, montant_tva: 50, montant_ttc: 300 }),
      // Sans échéance, en partie créditée par un avoir de 20 TTC.
      facture({ id: 'f3', date_echeance: null }),
      facture({ id: 'a3', type: 'avoir', facture_origine_id: 'f3', montant_ht: -16.67, montant_tva: -3.33, montant_ttc: -20 }),
      // Encaissée en entier : ne doit rien.
      facture({ id: 'f4', date_echeance: '2026-09-30' }),
      // Un brouillon ne doit rien.
      facture({ id: 'b1', statut: 'brouillon', numero: null, date_echeance: '2026-09-30' }),
    ],
    lignes: [
      ligne({ facture_id: 'f1' }), ligne({ facture_id: 'f2', prix_unitaire_ht: 250 }), ligne({ facture_id: 'f3' }),
      ligne({ facture_id: 'f4' }), ligne({ facture_id: 'b1' }),
    ],
    encaissements: [encaissement({ id: 'e2', facture_id: 'f2' }), encaissement({ id: 'e4', facture_id: 'f4' }),
      // Un encaissement retiré ne compte pas.
      encaissement({ id: 'e1r', facture_id: 'f1', retire_le: '2026-11-04T10:00:00Z' })],
    parts: [part({ encaissement_id: 'e2' }), part({ encaissement_id: 'e4' }), part({ encaissement_id: 'e1r' })],
    ...o,
  })

  it('en retard, à venir, sans échéance et le total, du registre et des avoirs', () => {
    expect(A.creancesClients(lues(), AUJOURDHUI)).toEqual({
      etat: 'lu',
      enRetard: { nombre: 1, centimes: 12000 },
      aVenir: { nombre: 1, centimes: 18000 },
      sansEcheance: { nombre: 1, centimes: 10000 },
      total: { nombre: 3, centimes: 40000 },
    })
  })

  it('muet si les factures OU le registre ne sont pas lus en entier', () => {
    expect(A.creancesClients(lues({ encaissementsIncomplets: 'registre coupé' }), AUJOURDHUI)).toEqual({ etat: 'muet', motif: 'registre coupé' })
    expect(A.creancesClients(lues({ facturesIncompletes: 'factures coupées' }), AUJOURDHUI)).toEqual({ etat: 'muet', motif: 'factures coupées' })
  })
})

describe('les états de synthèse', () => {
  const lues = listes({
    factures: [
      facture({ id: 'f1', tiers_nom: 'Atelier Fictif', date_emission: '2026-02-01', montant_ht: 300 }),
      facture({ id: 'f2', tiers_nom: ' Atelier Fictif ', date_emission: '2026-05-01', montant_ht: 200 }),
      facture({ id: 'a2', type: 'avoir', facture_origine_id: 'f2', tiers_nom: 'Atelier Fictif', date_emission: '2026-05-03', montant_ht: -50 }),
      facture({ id: 'f3', tiers_nom: 'Boutique Essai', date_emission: '2026-05-10', montant_ht: 1000 }),
      facture({ id: 'fa', tiers_nom: 'Boutique Essai', date_emission: '2026-04-01', montant_ht: 300, acompte: true }),
      facture({ id: 'f5', tiers_nom: 'Ancien Client', date_emission: '2025-05-10', montant_ht: 70 }),
      facture({ id: 'b1', statut: 'brouillon', numero: null, tiers_nom: 'Brouillon', date_emission: '2026-05-10', montant_ht: 9 }),
    ],
  })

  it('par client : le nom de l’acheteur tel que la facture le garde, avoirs déduits, du plus fort au plus faible', () => {
    expect(A.parClient(lues, 2026)).toEqual({
      etat: 'lu', centimes: 175000,
      lignes: [
        { cle: 'Boutique Essai', libelle: 'Boutique Essai', detail: null, documents: 2, centimes: 130000 },
        { cle: 'Atelier Fictif', libelle: 'Atelier Fictif', detail: null, documents: 3, centimes: 45000 },
      ],
    })
    expect(A.parClient({ ...lues, facturesIncompletes: 'coupé' }, 2026)).toEqual({ etat: 'muet', motif: 'coupé' })
  })

  it('par article : la provenance des lignes, nommée par sa ligne la plus récente ; les acomptes et les lignes libres à part', () => {
    const lignes = {
      complete: true, motif: null,
      lignes: [
        provenance({ id: 'l1', facture_id: 'f1', article_id: 'art-1', designation: 'Séance (ancien nom)', prix_unitaire_ht: 150, quantite: 2 }),
        provenance({ id: 'l2', facture_id: 'f2', article_id: 'art-1', designation: 'Séance', reference: 'SEA-1', prix_unitaire_ht: 200 }),
        provenance({ id: 'l3', facture_id: 'a2', article_id: 'art-1', designation: 'Séance', reference: 'SEA-1', quantite: -1, prix_unitaire_ht: 50 }),
        provenance({ id: 'l4', facture_id: 'f3', article_id: null, designation: 'Travaux', prix_unitaire_ht: 1300 }),
        provenance({ id: 'l5', facture_id: 'f3', ordre: 2, designation: 'Reprise de l’acompte', quantite: -1, prix_unitaire_ht: 300, reprise_facture_id: 'fa' }),
        provenance({ id: 'l6', facture_id: 'fa', designation: 'Acompte de 30 %', prix_unitaire_ht: 300 }),
        provenance({ id: 'l7', facture_id: 'f5', article_id: 'art-1', designation: 'Vieux nom', prix_unitaire_ht: 70 }),
        provenance({ id: 'l8', facture_id: 'b1', article_id: 'art-2', prix_unitaire_ht: 9 }),
      ],
    }
    expect(A.parArticle(lues, lignes, 2026)).toEqual({
      etat: 'lu', centimes: 175000,
      lignes: [
        { cle: 'sans_article', libelle: A.SANS_ARTICLE, detail: null, documents: 1, centimes: 130000 },
        { cle: 'art-1', libelle: 'Séance', detail: 'SEA-1', documents: 3, centimes: 45000 },
        { cle: 'acomptes', libelle: A.ACOMPTES, detail: null, documents: 2, centimes: 0 },
      ],
    })
    expect(A.parArticle(lues, { ...lignes, complete: false, motif: 'lignes coupées' }, 2026)).toEqual({ etat: 'muet', motif: 'lignes coupées' })
    expect(A.parArticle(lues, { ...lignes, lignes: [provenance({ facture_id: 'inconnue' })] }, 2026).etat).toBe('muet')
  })

  it('par mois : les douze, avec ceux de l’an passé', () => {
    const mois = A.parMois(lues, 2026)
    expect(mois.etat).toBe('lu')
    if (mois.etat !== 'lu') return
    expect(mois.lignes).toHaveLength(12)
    expect(mois.lignes[4]).toEqual({ mois: '2026-05', libelle: 'mai 2026', centimes: 115000, n1Centimes: 7000 })
    expect([mois.centimes, mois.n1Centimes]).toEqual([175000, 7000])
  })

  it('les années : celles des documents validés, et l’année en cours', () => {
    expect(A.anneesDesVentes(lues.factures, AUJOURDHUI)).toEqual([2026, 2025])
    expect(A.anneesDesVentes([], AUJOURDHUI)).toEqual([2026])
  })

  it('le CSV : BOM UTF-8, point-virgule, champCsv, virgule décimale', () => {
    const clients = A.parClient(lues, 2026)
    if (clients.etat !== 'lu') throw new Error('attendu lu')
    const csv = A.csvDeLEtat('client', 2026, { ...clients, lignes: [...clients.lignes, { cle: 'x', libelle: 'Dupont; "fils"', detail: null, documents: 1, centimes: -1234 }] })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Client;Documents;Chiffre d\'affaires HT 2026',
      'Boutique Essai;2;1300,00',
      'Atelier Fictif;3;450,00',
      '"Dupont; ""fils""";1;-12,34',
    ])
    const mois = A.parMois(lues, 2026)
    if (mois.etat !== 'lu') throw new Error('attendu lu')
    expect(A.csvParMois(2026, mois).slice(1).split('\r\n')[5]).toBe('2026-05;1150,00;70,00')
    expect(A.nomFichierDeLEtat('article', 2026)).toBe('ventes-par-article-2026.csv')
  })
})

describe('les mots', () => {
  it('tutoient et ne nomment aucun onglet du cabinet', () => {
    const textes = Object.values(A).filter((v): v is string => typeof v === 'string')
    textes.push(A.motsDuSolde({ etat: 'aucun_releve' }), A.motsDuSolde({ etat: 'aucun_solde_sur', releves: 2 }),
      A.motsDuSolde({ etat: 'muet', motif: 'x' }), A.motsDuSolde({ etat: 'lu', solde: 1, au: '2026-10-31' }))
    expect(textes.length).toBeGreaterThan(12)
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })
})
