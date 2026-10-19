import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import type { LigneDeFacture } from './encaissementsFactures'
import { montantsDuDocument } from './factureCii'
import {
  LIBELLE_MOTIF_VENTE, dateDeLivraison, exemplaireDUneFactureSource, prorataArrondi, recettesFactureesDeLaPeriode,
  regimeDeLaFacture, ventesFacturees, type EncaissementVendu, type FactureVendue, type PartVendue,
  type SourcesVentesFacturees, type VentesFacturees,
} from './ventesFacturees'

// LES VENTES FACTURÉES (chantier EC-Q3, étape VF3a ; lib/ventesFacturees.ts) : la règle du cumul et ses invariants, par
// des cas écrits puis par un tirage ; les dates de la CA3, régime par régime ; ce qui écarte une facture ; ce qui n'entre
// pas (un autre dossier, une facture qui n'est pas source) ; l'exemplaire d'une facture source. Données FICTIVES.

const D = 'd1'

const facture = (o: Partial<FactureVendue> = {}): FactureVendue => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2027-0001', date_emission: '2027-01-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, ...o,
})
const avoir = (o: Partial<FactureVendue> = {}): FactureVendue =>
  facture({ id: 'a1', type: 'avoir', numero: 'A2027-0001', facture_origine_id: 'f1', ...o })

// Une ligne : son HT et son taux. Un avoir stocke ses lignes en négatif.
const ligne = (factureId: string, ht: number, taux: number, ordre = 1): LigneDeFacture => ({
  facture_id: factureId, ordre, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: taux,
})
const ligneAvoir = (avoirId: string, ht: number, taux: number, ordre = 1): LigneDeFacture => ({
  ...ligne(avoirId, ht, taux, ordre), quantite: -1,
})

let horloge = 0
const encaissement = (o: Partial<EncaissementVendu> = {}): EncaissementVendu => ({
  id: `e${++horloge}`, dossier_id: D, facture_id: 'f1', date_encaissement: '2027-02-01', montant: 120, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, cree_le: `2027-02-01T10:00:${String(horloge % 60).padStart(2, '0')}Z`,
  retire_le: null, ...o,
})
const part = (e: EncaissementVendu, taux: number, montant: number): PartVendue => ({
  encaissement_id: e.id, dossier_id: e.dossier_id, taux, montant,
})
// Un encaissement à un seul taux, et sa part.
const aUnTaux = (taux: number, o: Partial<EncaissementVendu>): [EncaissementVendu, PartVendue] => {
  const e = encaissement(o)
  return [e, part(e, taux, e.montant)]
}
const contrePassation = (de: EncaissementVendu, partsDe: readonly PartVendue[], o: Partial<EncaissementVendu> = {}) => {
  const c = encaissement({ facture_id: de.facture_id, montant: -de.montant, annule_id: de.id, date_encaissement: de.date_encaissement, ...o })
  return { c, parts: partsDe.filter((p) => p.encaissement_id === de.id).map((p) => part(c, p.taux, -p.montant)) }
}

const sources = (o: Partial<SourcesVentesFacturees>): SourcesVentesFacturees => ({
  dossierId: D, factures: [facture()], lignes: [ligne('f1', 100, 20)], encaissements: [], parts: [], ...o,
})

// Les centimes d'une liste, par champ.
const somme = <T,>(l: readonly T[], champ: (x: T) => number) => l.reduce((s, x) => s + champ(x), 0)

describe('prorataArrondi — V × P / T, le demi loin de zéro, en entiers longs', () => {
  it('arrondit au plus proche, le demi loin de zéro, des deux côtés', () => {
    expect(prorataArrondi(2000, 5000, 12000)).toBe(833) // 833,33
    expect(prorataArrondi(2000, 7000, 12000)).toBe(1167) // 1 166,67
    expect(prorataArrondi(1, 1, 2)).toBe(1) // 0,5
    expect(prorataArrondi(1, -1, 2)).toBe(-1) // −0,5
    expect(prorataArrondi(3, 1, 2)).toBe(2) // 1,5
    expect(prorataArrondi(-3, 1, 2)).toBe(-2)
    expect(prorataArrondi(0, 5000, 12000)).toBe(0)
  })

  it('reste exact sur des montants que la virgule flottante ne multiplie plus', () => {
    // Dix mille milliards d'euros de TTC, en centimes : le produit V × P passe 2⁵³ de très loin.
    const T = 1_000_000_000_000_000
    const V = 166_666_666_666_667
    expect(prorataArrondi(V, T, T)).toBe(V)
    expect(prorataArrondi(V, T - 1, T)).toBe(V) // 166 666 666 666 666,83… → V
    expect(prorataArrondi(V, 1, T)).toBe(0)
  })
})

describe('regimeDeLaFacture et dateDeLivraison', () => {
  it('lit le régime sur ce que la facture a figé : des biens à la livraison, option ou non ; des services selon l’option', () => {
    expect(regimeDeLaFacture({ nature_operation: 'services', option_debits: false })).toBe('encaissement')
    expect(regimeDeLaFacture({ nature_operation: 'services', option_debits: true })).toBe('debits')
    expect(regimeDeLaFacture({ nature_operation: 'biens', option_debits: false })).toBe('livraison')
    expect(regimeDeLaFacture({ nature_operation: 'biens', option_debits: true })).toBe('livraison')
    expect(regimeDeLaFacture({ nature_operation: 'biens', option_debits: null })).toBe('livraison')
  })

  it('ne devine rien : ni la nature absente ou mixte, ni l’option absente pour des services', () => {
    expect(regimeDeLaFacture({ nature_operation: null, option_debits: false })).toBe('nature')
    expect(regimeDeLaFacture({ nature_operation: 'mixte', option_debits: false })).toBe('nature')
    expect(regimeDeLaFacture({ nature_operation: 'services', option_debits: null })).toBe('option_debits')
  })

  it('la livraison : la date de la prestation, sinon la date d’émission', () => {
    expect(dateDeLivraison({ date_prestation: '2027-03-05', date_emission: '2027-03-01' })).toBe('2027-03-05')
    expect(dateDeLivraison({ date_prestation: null, date_emission: '2027-03-01' })).toBe('2027-03-01')
  })
})

describe('la règle du cumul — cas écrits', () => {
  it('un paiement unique porte la TVA de la facture, la recette son hors taxe', () => {
    const [e, p] = aUnTaux(20, { montant: 120 })
    const v = ventesFacturees(sources({ encaissements: [e], parts: [p] }))
    expect(v.ecartees).toEqual([])
    expect(v.parts).toEqual([expect.objectContaining({
      factureId: 'f1', numero: 'F2027-0001', encaissementId: e.id, annuleId: null, date: '2027-02-01', taux: 20,
      regime: 'encaissement', ttcCentimes: 12000, tvaCentimes: 2000, htCentimes: 10000,
    })])
  })

  it('un paiement partiel : le cumul s’arrondit, et le second paiement qui solde porte exactement le reste de V', () => {
    const [e1, p1] = aUnTaux(20, { montant: 50, date_encaissement: '2027-02-01' })
    const [e2, p2] = aUnTaux(20, { montant: 70, date_encaissement: '2027-03-01' })
    const v = ventesFacturees(sources({ encaissements: [e2, e1], parts: [p2, p1] }))
    expect(v.parts.map((x) => [x.encaissementId, x.ttcCentimes, x.tvaCentimes, x.htCentimes])).toEqual([
      [e1.id, 5000, 833, 4167],
      [e2.id, 7000, 1167, 5833],
    ])
    expect(somme(v.parts, (x) => x.tvaCentimes)).toBe(2000)
  })

  it('trois tiers : chaque tiers prend la différence, le taux soldé porte V au centime', () => {
    // 10,00 € de HT à 20 % : V = 200, T = 1 200 ; trois paiements de 4,00 €.
    const es = [1, 2, 3].map((i) => aUnTaux(20, { montant: 4, date_encaissement: `2027-02-0${i}` }))
    const v = ventesFacturees(sources({ lignes: [ligne('f1', 10, 20)], encaissements: es.map(([e]) => e), parts: es.map(([, p]) => p) }))
    expect(v.parts.map((x) => x.tvaCentimes)).toEqual([67, 66, 67])
    expect(somme(v.parts, (x) => x.tvaCentimes)).toBe(200)
  })

  it('plusieurs taux : chaque taux suit son propre cumul, chacun soldé porte sa TVA', () => {
    const lignes = [ligne('f1', 100, 20, 1), ligne('f1', 50, 5.5, 2)]
    // 120,00 à 20 % et 52,75 à 5,5 % : 172,75 € encaissés en deux fois.
    const e1 = encaissement({ montant: 100, date_encaissement: '2027-02-01' })
    const e2 = encaissement({ montant: 72.75, date_encaissement: '2027-02-15' })
    const parts = [part(e1, 20, 70), part(e1, 5.5, 30), part(e2, 20, 50), part(e2, 5.5, 22.75)]
    const v = ventesFacturees(sources({ lignes, encaissements: [e1, e2], parts }))
    expect(v.parts.map((x) => [x.encaissementId, x.taux, x.ttcCentimes, x.tvaCentimes])).toEqual([
      [e1.id, 20, 7000, 1167], [e1.id, 5.5, 3000, 156],
      [e2.id, 20, 5000, 833], [e2.id, 5.5, 2275, 119],
    ])
    expect(somme(v.parts.filter((x) => x.taux === 20), (x) => x.tvaCentimes)).toBe(2000)
    expect(somme(v.parts.filter((x) => x.taux === 5.5), (x) => x.tvaCentimes)).toBe(275)
  })

  it('un avoir AVANT l’encaissement : V et T nets, et le paiement qui solde porte la TVA nette', () => {
    // Facture 120 (100 + 20), avoir 60 (50 + 10) le 20 janvier, puis 60 encaissés.
    const [e, p] = aUnTaux(20, { montant: 60, date_encaissement: '2027-02-01' })
    const v = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-01-20' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 50, 20)],
      encaissements: [e], parts: [p],
    }))
    expect(v.parts.map((x) => [x.ttcCentimes, x.tvaCentimes, x.htCentimes])).toEqual([[6000, 1000, 5000]])
  })

  it('un avoir APRÈS un premier encaissement : il ne compte qu’à partir de son jour, et le solde porte la TVA nette', () => {
    const [e1, p1] = aUnTaux(20, { montant: 60, date_encaissement: '2027-02-01' })
    const [e2, p2] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-01' })
    const v = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-02-15' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 25, 20)],
      encaissements: [e1, e2], parts: [p1, p2],
    }))
    // Le premier : V = 2 000, T = 12 000 ; le second : V = 1 500, T = 9 000, soldé.
    expect(v.parts.map((x) => x.tvaCentimes)).toEqual([1000, 500])
  })

  it('un avoir daté du jour même de l’encaissement compte pour lui', () => {
    const [e, p] = aUnTaux(20, { montant: 60, date_encaissement: '2027-02-01' })
    const v = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-02-01' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 50, 20)],
      encaissements: [e], parts: [p],
    }))
    expect(v.parts[0].tvaCentimes).toBe(1000)
  })

  it('une contre-passation porte l’exact opposé de l’encaissement qu’elle annule, à sa date ; le suivant reprend la différence', () => {
    const [e1, p1] = aUnTaux(20, { montant: 50, date_encaissement: '2027-02-01' })
    const { c, parts: pc } = contrePassation(e1, [p1], { date_encaissement: '2027-02-20' })
    const [e2, p2] = aUnTaux(20, { montant: 120, date_encaissement: '2027-03-01' })
    const v = ventesFacturees(sources({ encaissements: [e1, c, e2], parts: [p1, ...pc, p2] }))
    expect(v.parts.map((x) => [x.encaissementId, x.annuleId, x.date, x.ttcCentimes, x.tvaCentimes, x.htCentimes])).toEqual([
      [e1.id, null, '2027-02-01', 5000, 833, 4167],
      [c.id, e1.id, '2027-02-20', -5000, -833, -4167],
      [e2.id, null, '2027-03-01', 12000, 2000, 10000],
    ])
  })

  it('une contre-passation de la PREMIÈRE de deux parts : l’opposé exact, même quand le cumul l’arrondirait autrement', () => {
    // V = 200, T = 1 200 : 6,00 puis 6,00 → 100 et 100 ; 3,00 puis 9,00 → 50 et 150 ; contre-passer le premier rend −50.
    const lignes = [ligne('f1', 10, 20)]
    const [e1, p1] = aUnTaux(20, { montant: 3, date_encaissement: '2027-02-01' })
    const [e2, p2] = aUnTaux(20, { montant: 9, date_encaissement: '2027-02-02' })
    const { c, parts: pc } = contrePassation(e1, [p1], { date_encaissement: '2027-02-03' })
    const v = ventesFacturees(sources({ lignes, encaissements: [e1, e2, c], parts: [p1, p2, ...pc] }))
    expect(v.parts.map((x) => x.tvaCentimes)).toEqual([50, 150, -50])
  })

  it('un encaissement retiré ne compte pas ; une contre-passation retirée non plus, et l’encaissement revit', () => {
    const [e1, p1] = aUnTaux(20, { montant: 120, retire_le: '2027-02-02T08:00:00Z' })
    const [e2, p2] = aUnTaux(20, { montant: 120, date_encaissement: '2027-02-03' })
    const { c, parts: pc } = contrePassation(e2, [p2], { date_encaissement: '2027-02-04', retire_le: '2027-02-05T08:00:00Z' })
    const v = ventesFacturees(sources({ encaissements: [e1, e2, c], parts: [p1, p2, ...pc] }))
    expect(v.parts.map((x) => [x.encaissementId, x.tvaCentimes])).toEqual([[e2.id, 2000]])
  })

  it('une franchise ou une exonération : des lignes à 0 %, aucune TVA, la recette au TTC', () => {
    const [e, p] = aUnTaux(0, { montant: 80 })
    const v = ventesFacturees(sources({ lignes: [ligne('f1', 80, 0)], encaissements: [e], parts: [p] }))
    expect(v.parts.map((x) => [x.ttcCentimes, x.tvaCentimes, x.htCentimes])).toEqual([[8000, 0, 8000]])
    expect(v.exigibilites.map((x) => [x.baseCentimes, x.tvaCentimes])).toEqual([[8000, 0]])
  })

  it('deux encaissements du même jour se rangent par leur création, puis leur identifiant — jamais par l’ordre lu', () => {
    const lignes = [ligne('f1', 10, 20)]
    const [a, pa] = aUnTaux(20, { id: 'e-b', montant: 3, cree_le: '2027-02-01T09:00:00Z' })
    const [b, pb] = aUnTaux(20, { id: 'e-a', montant: 9, cree_le: '2027-02-01T10:00:00Z' })
    const [c, pc] = aUnTaux(20, { id: 'e-c', montant: 3, date_encaissement: '2027-02-02', cree_le: '2027-02-01T08:00:00Z' })
    const une = ventesFacturees(sources({ lignes, encaissements: [b, a], parts: [pb, pa] }))
    const autre = ventesFacturees(sources({ lignes, encaissements: [a, b], parts: [pa, pb] }))
    expect(une.parts.map((x) => [x.encaissementId, x.tvaCentimes])).toEqual([['e-b', 50], ['e-a', 150]])
    expect(autre.parts).toEqual(une.parts)
    // Même création : l'identifiant, octet par octet.
    const [d, pd] = aUnTaux(20, { id: 'e-Z', montant: 3, cree_le: '2027-02-01T09:00:00Z' })
    const egal = ventesFacturees(sources({ lignes, encaissements: [a, d], parts: [pa, pd] }))
    expect(egal.parts.map((x) => x.encaissementId)).toEqual(['e-Z', 'e-b'])
    // La date d'abord : créé avant, mais daté du lendemain.
    const dates = ventesFacturees(sources({ lignes, encaissements: [c, a], parts: [pc, pa] }))
    expect(dates.parts.map((x) => x.encaissementId)).toEqual(['e-b', 'e-c'])
  })
})

describe('les dates de la CA3, régime par régime', () => {
  it('des services : chaque part à la date de son encaissement, une contre-passation à la sienne, en négatif', () => {
    const [e1, p1] = aUnTaux(20, { montant: 120, date_encaissement: '2027-02-01' })
    const { c, parts: pc } = contrePassation(e1, [p1], { date_encaissement: '2027-04-02' })
    const v = ventesFacturees(sources({ encaissements: [e1, c], parts: [p1, ...pc] }))
    expect(v.exigibilites.map((x) => [x.origine, x.encaissementId, x.date, x.taux, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['encaissement', e1.id, '2027-02-01', 20, 10000, 2000],
      ['encaissement', c.id, '2027-04-02', 20, -10000, -2000],
    ])
  })

  it('l’option pour les débits : un acompte d’avant la facture à sa date, le reste à la facture, l’avoir d’après à sa date ; rien d’un encaissement du jour de la facture ou d’après', () => {
    // Facture du 10 mars, 120 € TTC ; acompte de 30 € le 1er mars ; 30 € le jour même ; un avoir de 12 € le 20 mars ;
    // le solde, 48 €, le 1er avril.
    const f = facture({ option_debits: true, date_emission: '2027-03-10' })
    const [acompte, pa] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-01' })
    const [duJour, pj] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-10' })
    const [solde, ps] = aUnTaux(20, { montant: 48, date_encaissement: '2027-04-01' })
    const v = ventesFacturees(sources({
      factures: [f, avoir({ date_emission: '2027-03-20', option_debits: true })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 10, 20)],
      encaissements: [acompte, duJour, solde], parts: [pa, pj, ps],
    }))
    expect(v.exigibilites.map((x) => [x.origine, x.encaissementId, x.avoirId, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['encaissement', acompte.id, null, '2027-03-01', 2500, 500],
      ['facture', null, null, '2027-03-10', 7500, 1500],
      ['avoir', null, 'a1', '2027-03-20', -1000, -200],
    ])
    expect(somme(v.exigibilites, (x) => x.tvaCentimes)).toBe(1800)
    // La 2035 compte chaque encaissement, à sa date, au hors taxe que le cumul lui donne.
    expect(v.parts.map((x) => [x.regime, x.date, x.htCentimes, x.tvaCentimes])).toEqual([
      ['debits', '2027-03-01', 2500, 500], ['debits', '2027-03-10', 2500, 500], ['debits', '2027-04-01', 4000, 800],
    ])
  })

  it('l’option pour les débits : la contre-passation d’un acompte compte datée avant la facture, pas après', () => {
    const f = facture({ option_debits: true, date_emission: '2027-03-10' })
    const [a1, p1] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-01' })
    const { c: c1, parts: pc1 } = contrePassation(a1, [p1], { date_encaissement: '2027-03-05' })
    const [a2, p2] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-06' })
    const { c: c2, parts: pc2 } = contrePassation(a2, [p2], { date_encaissement: '2027-03-20' })
    const v = ventesFacturees(sources({ factures: [f], encaissements: [a1, c1, a2, c2], parts: [p1, ...pc1, p2, ...pc2] }))
    expect(v.exigibilites.map((x) => [x.origine, x.encaissementId, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['encaissement', a1.id, '2027-03-01', 2500, 500],
      ['encaissement', c1.id, '2027-03-05', -2500, -500],
      ['encaissement', a2.id, '2027-03-06', 2500, 500],
      ['facture', null, '2027-03-10', 7500, 1500],
    ])
  })

  it('l’option pour les débits sans encaissement : la facture entière à sa date', () => {
    const v = ventesFacturees(sources({ factures: [facture({ option_debits: true })] }))
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([['facture', '2027-01-10', 10000, 2000]])
  })

  it('des biens : un acompte à sa date, le reste à la livraison, rien de ce qui est encaissé après', () => {
    const f = facture({ nature_operation: 'biens', date_emission: '2027-03-10', date_prestation: '2027-03-15' })
    const [acompte, pa] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-01' })
    const [solde, ps] = aUnTaux(20, { montant: 90, date_encaissement: '2027-04-20' })
    const v = ventesFacturees(sources({ factures: [f], encaissements: [acompte, solde], parts: [pa, ps] }))
    expect(v.exigibilites.map((x) => [x.origine, x.encaissementId, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['encaissement', acompte.id, '2027-03-01', 2500, 500],
      ['livraison', null, '2027-03-15', 7500, 1500],
    ])
    expect(somme(v.exigibilites, (x) => x.tvaCentimes)).toBe(2000)
    // La 2035 compte les deux encaissements, à leur date.
    expect(v.parts.map((x) => [x.date, x.htCentimes])).toEqual([['2027-03-01', 2500], ['2027-04-20', 7500]])
  })

  it('des biens sans date de prestation : la livraison est la date d’émission ; un encaissement du jour même s’y fond', () => {
    const f = facture({ nature_operation: 'biens', date_emission: '2027-03-10' })
    const [e, p] = aUnTaux(20, { montant: 120, date_encaissement: '2027-03-10' })
    const v = ventesFacturees(sources({ factures: [f], encaissements: [e], parts: [p] }))
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['livraison', '2027-03-10', 10000, 2000],
    ])
  })

  it('des biens payés en entier avant la livraison : les acomptes seuls, aucune ligne nulle à la livraison', () => {
    const f = facture({ nature_operation: 'biens', date_emission: '2027-03-10', date_prestation: '2027-03-15' })
    const [e, p] = aUnTaux(20, { montant: 120, date_encaissement: '2027-03-01' })
    const v = ventesFacturees(sources({ factures: [f], encaissements: [e], parts: [p] }))
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.tvaCentimes])).toEqual([['encaissement', '2027-03-01', 2000]])
  })

  it('des biens jamais encaissés : la TVA est due à la livraison quand même', () => {
    const f = facture({ nature_operation: 'biens', option_debits: true, date_emission: '2027-03-10' })
    const v = ventesFacturees(sources({ factures: [f] }))
    expect(v.parts).toEqual([])
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.tvaCentimes])).toEqual([['livraison', '2027-03-10', 2000]])
  })

  it('des biens : un avoir d’avant la livraison s’y déduit, un avoir d’après se régularise à sa date', () => {
    const f = facture({ nature_operation: 'biens', date_emission: '2027-03-10', date_prestation: '2027-03-15' })
    const v = ventesFacturees(sources({
      factures: [f, avoir({ id: 'a1', date_emission: '2027-03-12' }), avoir({ id: 'a2', numero: 'A2', date_emission: '2027-04-01' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 10, 20), ligneAvoir('a2', 20, 20)],
    }))
    expect(v.exigibilites.map((x) => [x.origine, x.avoirId, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([
      ['livraison', null, '2027-03-15', 9000, 1800],
      ['avoir', 'a2', '2027-04-01', -2000, -400],
    ])
  })

  it('des biens : une contre-passation d’un acompte avant la livraison s’y compte ; après, rien', () => {
    const f = facture({ nature_operation: 'biens', date_emission: '2027-03-10', date_prestation: '2027-03-15' })
    const [a1, p1] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-01' })
    const { c: c1, parts: pc1 } = contrePassation(a1, [p1], { date_encaissement: '2027-03-05' })
    const [a2, p2] = aUnTaux(20, { montant: 30, date_encaissement: '2027-03-06' })
    const { c: c2, parts: pc2 } = contrePassation(a2, [p2], { date_encaissement: '2027-03-20' })
    const v = ventesFacturees(sources({ factures: [f], encaissements: [a1, c1, a2, c2], parts: [p1, ...pc1, p2, ...pc2] }))
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.tvaCentimes])).toEqual([
      ['encaissement', '2027-03-01', 500],
      ['encaissement', '2027-03-05', -500],
      ['encaissement', '2027-03-06', 500],
      ['livraison', '2027-03-15', 1500],
    ])
    expect(somme(v.parts, (x) => x.htCentimes)).toBe(0)
  })

  it('les documents, pour l’engagement : la facture et ses avoirs à leur date, par taux, les avoirs en négatif', () => {
    const v = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-02-15' })],
      lignes: [ligne('f1', 100, 20, 1), ligne('f1', 40, 0, 2), ligneAvoir('a1', 50, 20)],
    }))
    expect(v.documents.map((x) => [x.avoirId, x.date, x.taux, x.baseCentimes, x.tvaCentimes, x.ttcCentimes])).toEqual([
      [null, '2027-01-10', 20, 10000, 2000, 12000],
      [null, '2027-01-10', 0, 4000, 0, 4000],
      ['a1', '2027-02-15', 20, -5000, -1000, -6000],
    ])
  })
})

describe('ce qui entre, et ce qui écarte une facture', () => {
  it('seules les factures VALIDÉES SOURCES du dossier, et leurs encaissements à elles', () => {
    const [e, p] = aUnTaux(20, { montant: 120 })
    const [eAutre, pAutre] = aUnTaux(20, { montant: 120, facture_id: 'f-autre', dossier_id: 'd2' })
    const [eHier, pHier] = aUnTaux(20, { montant: 120, facture_id: 'f-hier' })
    const v = ventesFacturees(sources({
      factures: [
        facture(),
        facture({ id: 'f-autre', dossier_id: 'd2' }),
        facture({ id: 'f-hier', source_de_la_vente: false }),
        facture({ id: 'f-brouillon', statut: 'brouillon', source_de_la_vente: false }),
      ],
      lignes: [ligne('f1', 100, 20), ligne('f-autre', 100, 20), ligne('f-hier', 100, 20), ligne('f-brouillon', 100, 20)],
      encaissements: [e, eAutre, eHier], parts: [p, pAutre, pHier],
    }))
    expect(v.parts.map((x) => x.factureId)).toEqual(['f1'])
    expect(new Set(v.documents.map((x) => x.factureId))).toEqual(new Set(['f1']))
    expect([...v.sources]).toEqual(['f1'])
    expect(v.dossierId).toBe(D)
  })

  it('un brouillon n’est jamais compté, même s’il se disait source (la base l’interdit : `factures_emises_source_d_une_facture_validee`)', () => {
    const v = ventesFacturees(sources({ factures: [facture({ statut: 'brouillon' })] }))
    expect(v.documents).toEqual([])
    expect(v.sources.size).toBe(0)
  })

  it('deux factures : chacune nette de SES avoirs seulement, et les listes rangées par date, toutes factures mêlées', () => {
    const [e1, p1] = aUnTaux(20, { montant: 120, date_encaissement: '2027-03-01' })
    const [e2, p2] = aUnTaux(20, { montant: 60, facture_id: 'f2', date_encaissement: '2027-02-01' })
    const v = ventesFacturees(sources({
      factures: [facture(), facture({ id: 'f2', numero: 'F2' }), avoir({ facture_origine_id: 'f2', date_emission: '2027-01-20' })],
      lignes: [ligne('f1', 100, 20), ligne('f2', 100, 20), ligneAvoir('a1', 50, 20)],
      encaissements: [e1, e2], parts: [p1, p2],
    }))
    expect(v.parts.map((x) => [x.factureId, x.date, x.tvaCentimes])).toEqual([['f2', '2027-02-01', 1000], ['f1', '2027-03-01', 2000]])
    expect(v.excedents).toEqual([])
    expect(v.documents.map((x) => [x.factureId, x.avoirId, x.date])).toEqual([
      ['f1', null, '2027-01-10'], ['f2', null, '2027-01-10'], ['f2', 'a1', '2027-01-20'],
    ])
  })

  it('une part ou un encaissement d’un AUTRE dossier, même sur la même facture, ne compte pas', () => {
    const [e, p] = aUnTaux(20, { montant: 120 })
    const intrus = { ...part(e, 20, 120), dossier_id: 'd2' }
    const v = ventesFacturees(sources({ encaissements: [e, { ...e, id: 'e-d2', dossier_id: 'd2' }], parts: [p, intrus] }))
    expect(v.parts.map((x) => x.encaissementId)).toEqual([e.id])
  })

  const ecartee = (s: SourcesVentesFacturees) => {
    const v = ventesFacturees(s)
    expect(v.parts).toEqual([])
    expect(v.exigibilites).toEqual([])
    expect(v.documents).toEqual([])
    expect(v.sources.has('f1')).toBe(true)
    expect(v.ecartees).toHaveLength(1)
    expect(v.ecartees[0].detail.startsWith(LIBELLE_MOTIF_VENTE[v.ecartees[0].motif])).toBe(true)
    return v.ecartees[0].motif
  }

  it('une facture qu’on ne sait pas compter est ÉCARTÉE entière, et dite, jamais devinée', () => {
    const [e, p] = aUnTaux(20, { montant: 120 })
    expect(ecartee(sources({ factures: [facture({ nature_operation: null })], encaissements: [e], parts: [p] }))).toBe('nature')
    expect(ecartee(sources({ factures: [facture({ nature_operation: 'mixte' })] }))).toBe('nature')
    expect(ecartee(sources({ factures: [facture({ option_debits: null })] }))).toBe('option_debits')
    expect(ecartee(sources({ lignes: [] }))).toBe('sans_lignes')
  })

  it('un encaissement illisible écarte sa facture : parts qui ne font pas son montant, taux hors facture, signe, doublon, montant hors centime', () => {
    const e = encaissement({ montant: 120 })
    expect(ecartee(sources({ encaissements: [e], parts: [part(e, 20, 100)] }))).toBe('encaissement_illisible')
    expect(ecartee(sources({ encaissements: [e], parts: [] }))).toBe('encaissement_illisible')
    expect(ecartee(sources({ encaissements: [e], parts: [part(e, 10, 120)] }))).toBe('encaissement_illisible')
    // Deux taux de la facture, l'un en négatif ou nul : la somme fait le montant, le signe ou la part nulle trahit.
    const deuxTaux = [ligne('f1', 100, 20, 1), ligne('f1', 100, 10, 2)]
    expect(ecartee(sources({ lignes: deuxTaux, encaissements: [e], parts: [part(e, 20, 130), part(e, 10, -10)] }))).toBe('encaissement_illisible')
    expect(ecartee(sources({ lignes: deuxTaux, encaissements: [e], parts: [part(e, 20, 120), part(e, 10, 0)] }))).toBe('encaissement_illisible')
    expect(ecartee(sources({ encaissements: [e], parts: [part(e, 20, 60), part(e, 20, 60)] }))).toBe('encaissement_illisible')
    const f = encaissement({ montant: 120.001 })
    expect(ecartee(sources({ encaissements: [f], parts: [part(f, 20, 120.001)] }))).toBe('encaissement_illisible')
  })

  it('une contre-passation qui n’est pas l’opposé exact d’un encaissement compté avant elle écarte sa facture', () => {
    const [e1, p1] = aUnTaux(20, { montant: 60 })
    // D'un autre montant.
    const c = encaissement({ montant: -50, annule_id: e1.id })
    expect(ecartee(sources({ encaissements: [e1, c], parts: [p1, part(c, 20, -50)] }))).toBe('contre_passation_illisible')
    // D'un encaissement retiré.
    const retire = { ...e1, retire_le: '2027-02-02T00:00:00Z' }
    const { c: c2, parts: pc2 } = contrePassation(e1, [p1])
    expect(ecartee(sources({ encaissements: [retire, c2], parts: [p1, ...pc2] }))).toBe('contre_passation_illisible')
    // Rangée avant l'encaissement qu'elle annule.
    const { c: c3, parts: pc3 } = contrePassation(e1, [p1], { date_encaissement: '2027-01-31' })
    expect(ecartee(sources({ encaissements: [e1, c3], parts: [p1, ...pc3] }))).toBe('contre_passation_illisible')
    // D'un encaissement d'une autre facture.
    const { c: c4, parts: pc4 } = contrePassation({ ...e1, id: 'e-ailleurs' }, [part({ ...e1, id: 'e-ailleurs' }, 20, 60)])
    expect(ecartee(sources({ encaissements: [e1, c4], parts: [p1, ...pc4] }))).toBe('contre_passation_illisible')
    // Sur un autre taux que celui de l'encaissement.
    const lignes = [ligne('f1', 100, 20, 1), ligne('f1', 100, 10, 2)]
    const c5 = encaissement({ montant: -60, annule_id: e1.id })
    expect(ecartee(sources({ lignes, encaissements: [e1, c5], parts: [p1, part(c5, 10, -60)] }))).toBe('contre_passation_illisible')
  })

  it('un taux que ses avoirs annulent au jour d’un encaissement écarte la facture : plus de TTC à répartir', () => {
    const [e2, p2] = aUnTaux(20, { montant: 60 })
    expect(ecartee(sources({
      factures: [facture(), avoir({ date_emission: '2027-01-20' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 100, 20)],
      encaissements: [e2], parts: [p2],
    }))).toBe('ttc_nul')
  })

  it('au-delà du TTC net : rien n’est écarté — l’argent est reçu —, mais l’excédent est dit, taux par taux', () => {
    // Soldée le 1er février, puis un avoir de 30 € TTC le 15 : 30 € encaissés au-delà, que rien n'a remboursés.
    const [e, p] = aUnTaux(20, { montant: 120 })
    const v = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-02-15' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 25, 20)],
      encaissements: [e], parts: [p],
    }))
    expect(v.ecartees).toEqual([])
    expect(v.parts.map((x) => [x.ttcCentimes, x.tvaCentimes])).toEqual([[12000, 2000]])
    expect(v.excedents).toEqual([{ factureId: 'f1', numero: 'F2027-0001', tiers: 'Client fictif', taux: 20, excedentCentimes: 3000 }])
    // Un avoir du jour même d'un encaissement compte pour lui : la part prend alors plus que sa proportion de V
    // (1 500 × 12 000 / 9 000 = 2 000).
    const [e2, p2] = aUnTaux(20, { montant: 120, date_encaissement: '2027-02-15' })
    const w = ventesFacturees(sources({
      factures: [facture(), avoir({ date_emission: '2027-02-15' })],
      lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 25, 20)],
      encaissements: [e2], parts: [p2],
    }))
    expect(w.parts.map((x) => [x.ttcCentimes, x.tvaCentimes])).toEqual([[12000, 2000]])
    expect(w.excedents.map((x) => x.excedentCentimes)).toEqual([3000])
    // Sans avoir, aucun excédent.
    expect(ventesFacturees(sources({ encaissements: [e], parts: [p] })).excedents).toEqual([])
  })

  it('une facture écartée n’empêche pas les autres de compter', () => {
    const [e, p] = aUnTaux(20, { montant: 120, facture_id: 'f2' })
    const v = ventesFacturees(sources({
      factures: [facture({ nature_operation: null }), facture({ id: 'f2', numero: 'F2' })],
      lignes: [ligne('f1', 100, 20), ligne('f2', 100, 20)],
      encaissements: [e], parts: [p],
    }))
    expect(v.ecartees.map((x) => x.factureId)).toEqual(['f1'])
    expect(v.parts.map((x) => x.factureId)).toEqual(['f2'])
  })
})

describe('exemplaireDUneFactureSource', () => {
  const v = ventesFacturees(sources({
    factures: [facture(), avoir(), facture({ id: 'f-hier', source_de_la_vente: false }), facture({ id: 'f-ecartee', nature_operation: null })],
    lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 10, 20), ligne('f-hier', 100, 20), ligne('f-ecartee', 100, 20)],
  }))

  it('vrai pour une pièce désignée à une facture ou un avoir source — même écartée —, faux sinon', () => {
    expect(exemplaireDUneFactureSource({ facture_id: 'f1' }, v)).toBe(true)
    expect(exemplaireDUneFactureSource({ facture_id: 'a1' }, v)).toBe(true)
    expect(exemplaireDUneFactureSource({ facture_id: 'f-ecartee' }, v)).toBe(true)
    expect(exemplaireDUneFactureSource({ facture_id: 'f-hier' }, v)).toBe(false)
    expect(exemplaireDUneFactureSource({ facture_id: null }, v)).toBe(false)
  })
})

describe('recettesFactureesDeLaPeriode', () => {
  const [e1, p1] = aUnTaux(20, { montant: 60, date_encaissement: '2027-01-31' })
  const [e2, p2] = aUnTaux(20, { montant: 60, date_encaissement: '2027-02-01' })
  const v = ventesFacturees(sources({
    factures: [facture({ date_emission: '2026-12-20' }), avoir({ date_emission: '2027-02-28' })],
    lignes: [ligne('f1', 100, 20), ligneAvoir('a1', 10, 20)],
    encaissements: [e1, e2], parts: [p1, p2],
  }))

  it('en trésorerie : le hors taxe des parts encaissées dans la période, bornes comprises', () => {
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-01-31', 'tresorerie')).toBe(5000)
    expect(recettesFactureesDeLaPeriode(v, '2027-02-01', '2027-02-28', 'tresorerie')).toBe(v.parts[1].htCentimes)
    expect(recettesFactureesDeLaPeriode(v, '2026-01-01', '2026-12-31', 'tresorerie')).toBe(0)
  })

  it('en engagement : la facture et ses avoirs datés dans la période', () => {
    expect(recettesFactureesDeLaPeriode(v, '2026-01-01', '2026-12-31', 'engagement')).toBe(10000)
    expect(recettesFactureesDeLaPeriode(v, '2027-02-28', '2027-02-28', 'engagement')).toBe(-1000)
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-01-31', 'engagement')).toBe(0)
  })
})

// ── Le tirage ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const TAUX = [20, 10, 5.5, 2.1, 8.5, 0] as const

interface Cas {
  sources: SourcesVentesFacturees
  // Les encaissements ordinaires, dans l'ordre du registre, et celles des contre-passations.
  ordinaires: EncaissementVendu[]
  contrePassations: EncaissementVendu[]
  avoirs: FactureVendue[]
  soldee: boolean
}

// Une facture tirée : un à trois taux, une à quatre lignes ; puis, jour après jour, des encaissements partiels (jamais au
// delà du reste net), des avoirs (jamais au-delà de ce qui n'est pas encaissé), des contre-passations ; puis, une fois sur
// deux, le solde de chaque taux.
function tirerUnCas(suivant: () => number, numero: number): Cas {
  const entier = (n: number) => entierTire(suivant, n)
  const factureId = `f${numero}`
  const nature = entier(3) === 0 ? 'biens' : 'services'
  const f = facture({
    // Émise entre le 8 et le 27 janvier, quand les encaissements commencent le 11 : une part des factures de chaque régime
    // a des encaissements d'AVANT sa date (des acomptes), et d'avant sa livraison.
    id: factureId, numero: `F${numero}`, nature_operation: nature, option_debits: entier(2) === 0,
    date_emission: `2027-01-${String(8 + entier(20)).padStart(2, '0')}`,
    date_prestation: entier(2) === 0 ? null : `2027-01-${String(8 + entier(22)).padStart(2, '0')}`,
  })
  const taux = [...new Set(Array.from({ length: 1 + entier(3) }, () => TAUX[entier(TAUX.length)]))]
  const lignes: LigneDeFacture[] = []
  taux.forEach((t) => {
    for (let i = 0; i < 1 + entier(2); i++) {
      lignes.push({ ...ligne(factureId, (1 + entier(2_000_000)) / 100, t, lignes.length + 1), quantite: 1 + entier(3) })
    }
  })
  const ttcDe = (doc: FactureVendue) => {
    const m = new Map<number, number>()
    for (const g of montantsDuDocument(doc, lignes.filter((l) => l.facture_id === doc.id), null).groupes) {
      m.set(g.taux, (m.get(g.taux) ?? 0) + g.baseCentimes + g.tvaCentimes)
    }
    return m
  }
  const ttc = ttcDe(f)
  const encaisse = new Map<number, number>(taux.map((t) => [t, 0]))
  const credite = new Map<number, number>(taux.map((t) => [t, 0]))
  const reste = (t: number) => ttc.get(t)! - credite.get(t)! - encaisse.get(t)!

  const encaissements: EncaissementVendu[] = []
  const parts: PartVendue[] = []
  const ordinaires: EncaissementVendu[] = []
  const contrePassations: EncaissementVendu[] = []
  const avoirs: FactureVendue[] = []
  const annules = new Set<string>()
  let jour = 0
  const date = () => {
    jour += entier(3)
    const d = new Date(Date.UTC(2027, 0, 11 + jour))
    return d.toISOString().slice(0, 10)
  }
  const nouvel = (montants: Map<number, number>, o: Partial<EncaissementVendu>) => {
    const total = [...montants.values()].reduce((s, c) => s + c, 0)
    // Créés dans l'ordre du registre : un même jour se range par la création.
    const e = encaissement({ facture_id: factureId, montant: total / 100, cree_le: new Date(Date.UTC(2027, 0, 1) + encaissements.length * 1000).toISOString(), ...o })
    encaissements.push(e)
    for (const [t, c] of montants) if (c !== 0) parts.push(part(e, t, c / 100))
    return e
  }

  for (let pas = 0; pas < entier(8); pas++) {
    const coup = entier(10)
    if (coup < 6) {
      const montants = new Map<number, number>()
      for (const t of taux) {
        const r = reste(t)
        if (r > 0 && entier(3) !== 0) montants.set(t, 1 + entier(r))
      }
      if (montants.size === 0) continue
      const e = nouvel(montants, { date_encaissement: date() })
      for (const [t, c] of montants) encaisse.set(t, encaisse.get(t)! + c)
      ordinaires.push(e)
    } else if (coup < 8) {
      // Un avoir d'une ligne, sur un taux qui garde du reste : son TTC, recalculé, ne doit pas dépasser ce reste.
      const t = taux[entier(taux.length)]
      if (reste(t) < 2) continue
      // Daté APRÈS tout ce qui précède : un avoir du jour d'un encaissement déjà enregistré compterait pour lui, et
      // pourrait le faire passer au-dessus de son TTC net (le cas écrit « au-delà du TTC » le joue).
      // Un avoir suit sa facture : jamais daté avant elle.
      jour += 1
      const jourAvoir = date()
      const a = avoir({
        id: `${factureId}-a${avoirs.length}`, numero: `A${numero}-${avoirs.length}`, facture_origine_id: factureId,
        date_emission: jourAvoir < f.date_emission ? f.date_emission : jourAvoir,
      })
      const l = ligneAvoir(a.id, (1 + entier(Math.max(1, Math.floor(reste(t) / 1.3)))) / 100, t)
      lignes.push(l)
      const credit = ttcDe(a).get(t)!
      if (credit > reste(t)) {
        lignes.pop()
        continue
      }
      credite.set(t, credite.get(t)! + credit)
      avoirs.push(a)
    } else {
      const candidats = ordinaires.filter((e) => !annules.has(e.id))
      if (candidats.length === 0) continue
      const de = candidats[entier(candidats.length)]
      const siennes = new Map(parts.filter((p) => p.encaissement_id === de.id).map((p) => [p.taux, -Math.round(p.montant * 100)]))
      const d = date()
      const c = nouvel(siennes, { annule_id: de.id, date_encaissement: d < de.date_encaissement ? de.date_encaissement : d })
      for (const [t, m] of siennes) encaisse.set(t, encaisse.get(t)! + m)
      annules.add(de.id)
      contrePassations.push(c)
    }
  }
  const soldee = entier(2) === 0
  if (soldee) {
    const montants = new Map(taux.filter((t) => reste(t) > 0).map((t) => [t, reste(t)]))
    if (montants.size > 0) ordinaires.push(nouvel(montants, { date_encaissement: date() }))
    for (const t of taux) encaisse.set(t, encaisse.get(t)! + (montants.get(t) ?? 0))
  }
  // Un registre lu dans le désordre : le module ne doit pas dépendre de l'ordre de la lecture.
  const melange = <T,>(l: T[]) => l.map((x) => [x, suivant()] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  return {
    sources: sources({ factures: melange([f, ...avoirs]), lignes: melange(lignes), encaissements: melange(encaissements), parts: melange(parts) }),
    ordinaires, contrePassations, avoirs, soldee,
  }
}

// La facture d'un cas, et son fait générateur : la livraison d'un bien, la date d'une facture sur les débits.
const emise = (c: Cas) => c.sources.factures.find((f) => f.type === 'facture')!
const faitGenerateur = (c: Cas) => {
  const f = emise(c)
  return regimeDeLaFacture(f) === 'livraison' ? dateDeLivraison(f) : f.date_emission
}

// V et T d'un taux, nets des avoirs datés au plus tard de `date` — recalculés ici, sur le texte du § 6.
function netAu(cas: Cas, factureId: string, taux: number, date: string) {
  const docs = cas.sources.factures.filter((d) => d.id === factureId || (d.facture_origine_id === factureId && d.date_emission <= date))
  let V = 0
  let T = 0
  for (const d of docs) {
    const sens = d.type === 'avoir' ? -1 : 1
    for (const g of montantsDuDocument(d, cas.sources.lignes.filter((l) => l.facture_id === d.id), null).groupes) {
      if (g.taux !== taux) continue
      V += sens * g.tvaCentimes
      T += sens * (g.baseCentimes + g.tvaCentimes)
    }
  }
  return { V, T }
}

describe('la règle du cumul — un tirage de 3 000 factures', () => {
  const suivant = tirage(20261019)
  const cas = Array.from({ length: 3000 }, (_, i) => tirerUnCas(suivant, i))
  const calcules: [Cas, VentesFacturees][] = cas.map((c) => [c, ventesFacturees(c.sources)])

  it('le tirage couvre ce qu’il prétend : des paiements partiels, des avoirs, des contre-passations, plusieurs taux, chaque régime', () => {
    expect(calcules.every(([, v]) => v.ecartees.length === 0 && v.excedents.length === 0)).toBe(true)
    const compte = (p: (c: Cas, v: VentesFacturees) => boolean) => calcules.filter(([c, v]) => p(c, v)).length
    expect(compte((c) => c.ordinaires.length >= 2)).toBeGreaterThan(800)
    expect(compte((c) => c.avoirs.length > 0)).toBeGreaterThan(400)
    expect(compte((c) => c.contrePassations.length > 0)).toBeGreaterThan(300)
    expect(compte((_, v) => new Set(v.documents.map((d) => d.taux)).size >= 2)).toBeGreaterThan(800)
    for (const r of ['encaissement', 'debits', 'livraison'] as const) {
      expect(compte((_, v) => v.parts.some((p) => p.regime === r)), r).toBeGreaterThan(100)
      // Des encaissements d'avant la date de la facture, dans chaque régime ; et, sur les débits et les biens, d'avant
      // comme d'après le fait générateur dans la même facture.
      expect(compte((c, v) => v.parts.some((p) => p.regime === r && p.date < emise(c).date_emission)), r).toBeGreaterThan(60)
      if (r !== 'encaissement') {
        expect(compte((c, v) => v.parts.some((p) => p.regime === r && p.date < faitGenerateur(c))
          && v.parts.some((p) => p.regime === r && p.date >= faitGenerateur(c))), r).toBeGreaterThan(40)
      }
    }
  })

  it('chaque part : h + v = p ; les parts d’un encaissement font son montant ; une contre-passation, l’opposé exact', () => {
    for (const [c, v] of calcules) {
      for (const p of v.parts) expect(p.htCentimes + p.tvaCentimes).toBe(p.ttcCentimes)
      const parE = new Map<string, number>()
      for (const p of v.parts) parE.set(p.encaissementId, (parE.get(p.encaissementId) ?? 0) + p.ttcCentimes)
      for (const e of [...c.ordinaires, ...c.contrePassations]) expect(parE.get(e.id)).toBe(Math.round(e.montant * 100))
      for (const cp of c.contrePassations) {
        const siennes = v.parts.filter((p) => p.encaissementId === cp.id)
        for (const p of siennes) {
          const o = v.parts.find((x) => x.encaissementId === cp.annule_id && x.taux === p.taux)!
          expect([p.ttcCentimes, p.tvaCentimes, p.htCentimes]).toEqual([-o.ttcCentimes, -o.tvaCentimes, -o.htCentimes])
        }
      }
    }
  })

  it('après chaque encaissement ordinaire, la TVA portée par le taux vaut V × P / T arrondi, V et T nets des avoirs de ce jour', () => {
    let verifies = 0
    for (const [c, v] of calcules) {
      const factureId = c.sources.factures.find((f) => f.type === 'facture')!.id
      for (let i = 0; i < v.parts.length; i++) {
        const p = v.parts[i]
        if (p.annuleId != null) continue
        const jusque = v.parts.slice(0, i + 1).filter((x) => x.taux === p.taux)
        const P = somme(jusque, (x) => x.ttcCentimes)
        const { V, T } = netAu(c, factureId, p.taux, p.date)
        expect(somme(jusque, (x) => x.tvaCentimes)).toBe(prorataArrondi(V, P, T))
        verifies++
      }
    }
    expect(verifies).toBeGreaterThan(5000)
  })

  it('les dates d’un bien ou des débits : aucun encaissement compté au fait générateur ou après ; à toute date d’ensuite, la TVA exigible cumulée vaut la TVA nette des avoirs de ce jour', () => {
    let dates = 0
    for (const [c, v] of calcules) {
      const f = emise(c)
      const regime = regimeDeLaFacture(f)
      if (regime === 'encaissement') continue
      const L = faitGenerateur(c)
      expect(v.exigibilites.filter((x) => x.origine === 'encaissement' && x.date >= L)).toEqual([])
      expect(v.exigibilites.filter((x) => x.origine !== 'encaissement' && x.origine !== 'avoir' && x.date !== L)).toEqual([])
      const jours = new Set([L, '2099-12-31', ...v.parts.map((p) => p.date), ...c.avoirs.map((a) => a.date_emission)].filter((d) => d >= L))
      for (const taux of new Set(v.documents.map((d) => d.taux))) {
        for (const d of jours) {
          const exigible = somme(v.exigibilites.filter((x) => x.taux === taux && x.date <= d), (x) => x.tvaCentimes)
          expect(exigible).toBe(netAu(c, f.id, taux, d).V)
          dates++
        }
      }
    }
    expect(dates).toBeGreaterThan(3000)
  })

  it('un taux soldé porte EXACTEMENT sa TVA nette ; la CA3 d’un bien ou des débits porte toute la TVA nette, encaissée ou non', () => {
    let soldes = 0
    for (const [c, v] of calcules) {
      const factureId = c.sources.factures.find((f) => f.type === 'facture')!.id
      const fin = '2099-12-31'
      for (const taux of new Set(v.documents.map((d) => d.taux))) {
        const { V, T } = netAu(c, factureId, taux, fin)
        const siennes = v.parts.filter((p) => p.taux === taux)
        // Soldé au jour du dernier encaissement, sur V et T nets des avoirs de CE jour : un avoir daté plus tard (un
        // encaissement saisi après lui, à une date antérieure) ne compte pas encore pour lui.
        const derniere = siennes.at(-1)
        if (derniere && derniere.annuleId == null) {
          const auDernier = netAu(c, factureId, taux, derniere.date)
          if (somme(siennes, (p) => p.ttcCentimes) === auDernier.T) {
            expect(somme(siennes, (p) => p.tvaCentimes)).toBe(auDernier.V)
            soldes++
          }
        }
        const regime = v.parts[0]?.regime ?? regimeDeLaFacture(c.sources.factures.find((f) => f.id === factureId)!)
        const exigible = somme(v.exigibilites.filter((x) => x.taux === taux), (x) => x.tvaCentimes)
        const base = somme(v.exigibilites.filter((x) => x.taux === taux), (x) => x.baseCentimes)
        if (regime === 'encaissement') {
          expect(exigible).toBe(somme(siennes, (p) => p.tvaCentimes))
          expect(base).toBe(somme(siennes, (p) => p.htCentimes))
        } else {
          expect(exigible).toBe(V)
          expect(base).toBe(T - V)
        }
      }
    }
    expect(soldes).toBeGreaterThan(1000)
  })

  it('les documents portent la facture et ses avoirs, au centime de la facture électronique', () => {
    for (const [c, v] of calcules) {
      const factureId = c.sources.factures.find((f) => f.type === 'facture')!.id
      for (const taux of new Set(v.documents.map((d) => d.taux))) {
        const { V, T } = netAu(c, factureId, taux, '2099-12-31')
        const siens = v.documents.filter((d) => d.taux === taux)
        expect(somme(siens, (d) => d.tvaCentimes)).toBe(V)
        expect(somme(siens, (d) => d.ttcCentimes)).toBe(T)
      }
    }
  })

  it('le calcul ne dépend pas de l’ordre de la lecture', () => {
    const inverse = (s: SourcesVentesFacturees): SourcesVentesFacturees => ({
      ...s, factures: [...s.factures].reverse(), lignes: [...s.lignes].reverse(),
      encaissements: [...s.encaissements].reverse(), parts: [...s.parts].reverse(),
    })
    for (const [c, v] of calcules.slice(0, 500)) expect(ventesFacturees(inverse(c.sources))).toEqual(v)
  })
})
