import { AUCUNE_PIECE_CITEE } from './facturesSources'
import { describe, expect, it } from 'vitest'
import type { LigneDeFacture } from './encaissementsFactures'
import {
  recettesFactureesDeLaPeriode, SANS_ACOMPTE, ventesFacturees, type AcomptesDesVentes, type EncaissementVendu,
  type FactureVendue, type PartVendue, type VentesFacturees,
} from './ventesFacturees'

// L'ACOMPTE D'UN DEVIS DANS LES MOTEURS (étape P5b3 ; HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS : LA CONCEPTION (P5B) », § AILLEURS,
// et « L'ACOMPTE D'UN DEVIS DANS LES MOTEURS (P5B3) ») : la facture d'acompte et la finale qui la reprend, telles que
// lib/ventesFacturees.ts les rend à la 2035 (les parts, à la date de chaque encaissement) et à la CA3 (les exigibilités).
// La finale porte ses reprises en lignes, au signe opposé (quantité −1, même prix, même taux), comme `facturer_devis` les
// écrit. Données FICTIVES.

const D = 'd1'
const facture = (id: string, o: Partial<FactureVendue> = {}): FactureVendue => ({
  id, dossier_id: D, statut: 'validee', type: 'facture', numero: `F-${id}`, date_emission: '2027-01-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, ...o,
})
const ligne = (factureId: string, ht: number, taux: number, ordre = 1, quantite = 1): LigneDeFacture => ({
  facture_id: factureId, ordre, designation: 'Ligne fictive', quantite, prix_unitaire_ht: ht, taux_tva: taux,
})
let n = 0
const enc = (factureId: string, date: string, parParTaux: Record<number, number>): [EncaissementVendu, PartVendue[]] => {
  const id = `e${++n}`
  const montant = Math.round(Object.values(parParTaux).reduce((s, x) => s + x, 0) * 100) / 100
  const e: EncaissementVendu = {
    id, dossier_id: D, facture_id: factureId, date_encaissement: date, montant, moyen: 'virement', ligne_bancaire_id: null,
    annule_id: null, cree_le: `${date}T10:00:00Z`, retire_le: null,
  }
  return [e, Object.entries(parParTaux).map(([taux, m]) => ({ encaissement_id: id, dossier_id: D, taux: Number(taux), montant: m }))]
}

interface Jeu {
  factures: FactureVendue[]
  lignes: LigneDeFacture[]
  encaissements: [EncaissementVendu, PartVendue[]][]
  acomptes: AcomptesDesVentes
}
const calculer = (j: Jeu, acomptes: AcomptesDesVentes = j.acomptes): VentesFacturees => ventesFacturees({ piecesCitees: AUCUNE_PIECE_CITEE,
  dossierId: D, factures: j.factures, lignes: j.lignes, encaissements: j.encaissements.map(([e]) => e),
  parts: j.encaissements.flatMap(([, p]) => p), acomptes,
})
const marques = (acomptes: string[], reprises: [string, string][]): AcomptesDesVentes => ({
  marques: new Set(acomptes), reprises: reprises.map(([facture_id, reprise_facture_id]) => ({ facture_id, reprise_facture_id })),
})
const somme = <T,>(l: readonly T[], f: (x: T) => number) => l.reduce((s, x) => s + f(x), 0)
const tvaDe = (v: VentesFacturees, factureId?: string) =>
  somme(v.exigibilites.filter((x) => factureId === undefined || x.factureId === factureId), (x) => x.tvaCentimes)
const exigibilitesDe = (v: VentesFacturees, factureId: string) =>
  v.exigibilites.filter((x) => x.factureId === factureId).map((x) => [x.origine, x.date, x.baseCentimes, x.tvaCentimes])

// Un devis de 1 000 € HT à 20 % ; un acompte de 30 % (300 € HT) ; la finale : le devis, puis la reprise de l'acompte.
const acompteEtFinale = (nature: 'services' | 'biens', o: { avecFinale?: boolean } = {}): Jeu => ({
  factures: [
    facture('fa', { nature_operation: nature, date_emission: '2027-01-10' }),
    ...(o.avecFinale === false ? [] : [facture('ff', { nature_operation: nature, date_emission: '2027-03-01', date_prestation: '2027-03-05' })]),
  ],
  lignes: [
    ligne('fa', 300, 20),
    ...(o.avecFinale === false ? [] : [ligne('ff', 1000, 20, 1), ligne('ff', 300, 20, 2, -1)]),
  ],
  encaissements: [
    enc('fa', '2027-01-15', { 20: 360 }),
    ...(o.avecFinale === false ? [] : [enc('ff', '2027-03-20', { 20: 840 })]),
  ],
  acomptes: marques(['fa'], o.avecFinale === false ? [] : [['ff', 'fa']]),
})

describe('la 2035 en trésorerie : chaque encaissement à sa date, l’acompte comme le solde, rien deux fois', () => {
  it('un acompte de 30 %, puis la finale encaissée : 300 € en janvier, 700 € en mars, 1 000 € en tout', () => {
    for (const nature of ['services', 'biens'] as const) {
      const j = acompteEtFinale(nature)
      const v = calculer(j)
      expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-01-31', 'tresorerie'), nature).toBe(30000)
      expect(recettesFactureesDeLaPeriode(v, '2027-03-01', '2027-03-31', 'tresorerie'), nature).toBe(70000)
      expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-12-31', 'tresorerie'), nature).toBe(100000)
      expect(v.ecartees).toEqual([])
      expect(v.excedents).toEqual([])
      // La marque ne change rien à la 2035 : les parts sont celles d'hier.
      expect(calculer(j, SANS_ACOMPTE).parts).toEqual(v.parts)
    }
  })

  it('deux taux : l’acompte réparti, la finale nette à chaque taux, 1 500 € HT et 250 € de TVA en tout', () => {
    const j: Jeu = {
      factures: [facture('fa'), facture('ff', { date_emission: '2027-03-01' })],
      lignes: [
        ligne('fa', 300, 20, 1), ligne('fa', 150, 10, 2),
        ligne('ff', 1000, 20, 1), ligne('ff', 500, 10, 2), ligne('ff', 300, 20, 3, -1), ligne('ff', 150, 10, 4, -1),
      ],
      encaissements: [enc('fa', '2027-01-15', { 20: 360, 10: 165 }), enc('ff', '2027-03-20', { 20: 840, 10: 385 })],
      acomptes: marques(['fa'], [['ff', 'fa'], ['ff', 'fa']]),
    }
    const v = calculer(j)
    expect(v.ecartees).toEqual([])
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-12-31', 'tresorerie')).toBe(150000)
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-01-31', 'tresorerie')).toBe(45000)
    expect(tvaDe(v)).toBe(25000)
    expect(v.documents.filter((d) => d.factureId === 'ff').map((d) => [d.taux, d.baseCentimes, d.tvaCentimes]))
      .toEqual([[20, 70000, 14000], [10, 35000, 3500]])
  })

  it('une finale créditée en entier : l’acompte seul compte ; une nouvelle finale le reprend, encaissée : 1 000 €', () => {
    const j = acompteEtFinale('services')
    // La finale, validée puis créditée par un avoir qui défait ses reprises (P5B-Q4), avant tout encaissement.
    j.encaissements = j.encaissements.filter(([e]) => e.facture_id !== 'ff')
    j.factures.push(facture('av', { type: 'avoir', facture_origine_id: 'ff', date_emission: '2027-03-02' }))
    j.lignes.push(ligne('av', 1000, 20, 1), ligne('av', 300, 20, 2, -1))
    j.acomptes = marques(['fa'], [['ff', 'fa'], ['av', 'fa']])
    const v = calculer(j)
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-12-31', 'tresorerie')).toBe(30000)
    expect(tvaDe(v)).toBe(6000)
    // La seconde finale, encaissée.
    j.factures.push(facture('ff2', { date_emission: '2027-04-01' }))
    j.lignes.push(ligne('ff2', 1000, 20, 1), ligne('ff2', 300, 20, 2, -1))
    j.encaissements.push(enc('ff2', '2027-04-20', { 20: 840 }))
    j.acomptes = marques(['fa'], [['ff', 'fa'], ['av', 'fa'], ['ff2', 'fa']])
    const w = calculer(j)
    expect(recettesFactureesDeLaPeriode(w, '2027-01-01', '2027-12-31', 'tresorerie')).toBe(100000)
    expect(tvaDe(w)).toBe(20000)
  })
})

describe('la CA3', () => {
  it('des services : l’acompte exigible à ses encaissements, la finale nette aux siens — la marque n’y change rien', () => {
    const j = acompteEtFinale('services')
    const v = calculer(j)
    expect(exigibilitesDe(v, 'fa')).toEqual([['encaissement', '2027-01-15', 30000, 6000]])
    expect(exigibilitesDe(v, 'ff')).toEqual([['encaissement', '2027-03-20', 70000, 14000]])
    expect(calculer(j, SANS_ACOMPTE).exigibilites).toEqual(v.exigibilites)
  })

  it('des services sur l’option pour les débits : l’acompte exigible à sa date, sauf ce qui est encaissé avant', () => {
    const j = acompteEtFinale('services')
    for (const f of j.factures) f.option_debits = true
    expect(exigibilitesDe(calculer(j), 'fa')).toEqual([['facture', '2027-01-10', 30000, 6000]])
    // Payé avant sa facture (la date du versement, BT-9) : exigible au versement.
    j.encaissements[0] = enc('fa', '2027-01-05', { 20: 360 })
    expect(exigibilitesDe(calculer(j), 'fa')).toEqual([['encaissement', '2027-01-05', 30000, 6000]])
  })

  it('des biens : l’acompte exigible à son encaissement ; sa part impayée à la livraison de la finale ; la finale nette', () => {
    const j = acompteEtFinale('biens')
    // L'acompte payé à moitié en janvier, le reste en avril, avec le solde.
    j.encaissements[0] = enc('fa', '2027-01-15', { 20: 180 })
    j.encaissements.push(enc('fa', '2027-04-10', { 20: 180 }))
    j.encaissements[1] = enc('ff', '2027-04-10', { 20: 840 })
    const v = calculer(j)
    expect(exigibilitesDe(v, 'fa')).toEqual([
      ['encaissement', '2027-01-15', 15000, 3000],
      ['livraison', '2027-03-05', 15000, 3000],
    ])
    expect(exigibilitesDe(v, 'ff')).toEqual([['livraison', '2027-03-05', 70000, 14000]])
    // Rien deux fois : la TVA exigible est celle du devis, et celle des documents.
    expect(tvaDe(v)).toBe(20000)
    expect(somme(v.documents, (d) => d.tvaCentimes)).toBe(20000)
    // Sans la marque (le drapeau baissé), l'acompte serait une livraison à sa propre date : toute sa TVA en janvier, avant
    // d'avoir été payée.
    expect(exigibilitesDe(calculer(j, SANS_ACOMPTE), 'fa')).toEqual([['livraison', '2027-01-10', 30000, 6000]])
  })

  it('des biens, sans finale validée : seule la part encaissée est exigible', () => {
    const j = acompteEtFinale('biens', { avecFinale: false })
    j.encaissements[0] = enc('fa', '2027-01-15', { 20: 180 })
    expect(exigibilitesDe(calculer(j), 'fa')).toEqual([['encaissement', '2027-01-15', 15000, 3000]])
  })

  it('des biens : une reprise portée par une facture d’un autre dossier, ou qui n’est pas source, ne livre rien', () => {
    const j = acompteEtFinale('biens', { avecFinale: false })
    j.encaissements[0] = enc('fa', '2027-01-15', { 20: 180 })
    j.factures.push(
      facture('ailleurs', { dossier_id: 'd2', nature_operation: 'biens', date_emission: '2027-02-01' }),
      facture('pas-source', { source_de_la_vente: false, nature_operation: 'biens', date_emission: '2027-02-02' }),
      facture('brouillon', { statut: 'brouillon', nature_operation: 'biens', date_emission: '2027-02-03' }),
    )
    j.acomptes = marques(['fa'], [['ailleurs', 'fa'], ['pas-source', 'fa'], ['brouillon', 'fa']])
    expect(exigibilitesDe(calculer(j), 'fa')).toEqual([['encaissement', '2027-01-15', 15000, 3000]])
  })

  it('des biens : deux finales validées qui le reprennent, la livraison de la plus ancienne', () => {
    const j = acompteEtFinale('biens')
    j.encaissements[0] = enc('fa', '2027-01-15', { 20: 180 })
    j.factures.push(facture('ff0', { nature_operation: 'biens', date_emission: '2027-02-20', date_prestation: '2027-02-25' }))
    j.acomptes = marques(['fa'], [['ff', 'fa'], ['ff0', 'fa']])
    expect(exigibilitesDe(calculer(j), 'fa')).toEqual([
      ['encaissement', '2027-01-15', 15000, 3000], ['livraison', '2027-02-25', 15000, 3000],
    ])
  })

  it('la marque d’un acompte de services ne change rien, ni une reprise sans marque', () => {
    const j = acompteEtFinale('services')
    j.acomptes = marques(['fa', 'ff'], [['ff', 'fa']])
    expect(calculer(j).exigibilites).toEqual(calculer(j, SANS_ACOMPTE).exigibilites)
    const k = acompteEtFinale('biens')
    k.acomptes = marques([], [['ff', 'fa']])
    expect(calculer(k).exigibilites).toEqual(calculer(k, SANS_ACOMPTE).exigibilites)
  })

  it('une facture de biens marquée sans finale qui la reprenne n’est exigible qu’à ses encaissements', () => {
    const j = acompteEtFinale('biens')
    j.acomptes = marques(['ff'], [])
    expect(exigibilitesDe(calculer(j), 'ff')).toEqual([['encaissement', '2027-03-20', 70000, 14000]])
    expect(exigibilitesDe(calculer(j, SANS_ACOMPTE), 'ff')).toEqual([['livraison', '2027-03-05', 70000, 14000]])
  })
})
