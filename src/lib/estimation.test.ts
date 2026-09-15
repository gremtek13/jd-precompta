import { describe, expect, it } from 'vitest'
import { ecartPct, totauxPourAnnee } from './estimation'
import type { CotisationDeclaree, Piece } from './types'

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'vente',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 100,
  categorie_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const cotisation = (o: Partial<CotisationDeclaree>): CotisationDeclaree =>
  ({ id: 'c', dossier_id: 'd1', echeance: '2026-02-05', montant_appele: 300, montant_verse: null, ...o } as CotisationDeclaree)

describe('totauxPourAnnee', () => {
  it('ne retient que l’année demandée', () => {
    const totaux = totauxPourAnnee(
      [piece({ id: 'a', date_piece: '2026-01-01', montant_ttc: 100 }),
       piece({ id: 'b', date_piece: '2025-12-31', montant_ttc: 900 })],
      [cotisation({ echeance: '2026-02-05', montant_appele: 300 }),
       cotisation({ echeance: '2025-02-05', montant_appele: 999 })],
      2026,
    )
    expect(totaux).toEqual({ ca: 100, cotis: 300 })
  })

  it('préfère le HT au TTC quand il est renseigné', () => {
    expect(totauxPourAnnee([piece({ montant_ht: 80, montant_ttc: 96 })], [], 2026).ca).toBe(80)
    expect(totauxPourAnnee([piece({ montant_ht: null, montant_ttc: 96 })], [], 2026).ca).toBe(96)
  })

  it('ignore une pièce sans date', () => {
    expect(totauxPourAnnee([piece({ date_piece: null })], [], 2026).ca).toBe(0)
  })

  it('retient le montant versé d’une cotisation, sinon celui appelé', () => {
    const cotis = totauxPourAnnee([], [
      cotisation({ id: 'x', montant_appele: 300, montant_verse: 280 }),
      cotisation({ id: 'y', montant_appele: 400, montant_verse: null }),
    ], 2026).cotis
    expect(cotis).toBe(680)
  })

  it('additionne sans trier : le filtrage ventes/validées est au chargement', () => {
    // Contrat implicite mais réel : `EstimationTab` et `ClientSimulation` chargent tous deux avec
    // `.eq('statut','validee').eq('type_piece','vente')`. Cette fonction ne re-filtre pas — lui
    // passer des achats les ferait entrer dans le chiffre d'affaires.
    const avecAchat = totauxPourAnnee(
      [piece({ id: 'v', montant_ttc: 100 }), piece({ id: 'a', type_piece: 'achat', montant_ttc: 70 })],
      [], 2026,
    )
    expect(avecAchat.ca).toBe(170)
  })
})

describe('ecartPct', () => {
  it('formate l’écart avec son signe', () => {
    expect(ecartPct(120, 100)).toBe('+20 %')
    expect(ecartPct(80, 100)).toBe('-20 %')
    expect(ecartPct(100, 100)).toBe('+0 %')
  })

  it('rend un tiret faute de base de comparaison', () => {
    // Zéro comme absence : sans cela, la division rendrait Infinity.
    expect(ecartPct(120, null)).toBe('—')
    expect(ecartPct(120, 0)).toBe('—')
  })

  it('arrondit à l’entier', () => {
    expect(ecartPct(133, 100)).toBe('+33 %')
    expect(ecartPct(100.4, 100)).toBe('+0 %')
  })
})
