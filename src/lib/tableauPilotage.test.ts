import { describe, expect, it } from 'vitest'
import { calculerEvolutionMensuelle, soldesFinDeMois } from './tableauPilotage'
import { COMPTE_BANQUE } from './comptes'
import type { EcritureBrouillon } from './types'

const ligne = (date: string, sens: 'debit' | 'credit', montant: number, compte = COMPTE_BANQUE): EcritureBrouillon =>
  ({ id: `${date}-${montant}`, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null,
     date, libelle: 'x', sens, statut: 'proposee', compte, montant,
     created_at: `${date}T00:00:00Z` } as EcritureBrouillon)

describe('calculerEvolutionMensuelle', () => {
  it('sépare encaissements et décaissements par mois', () => {
    // Le compte banque est un compte d'actif : une entrée d'argent le débite, une sortie le crédite.
    const evolution = calculerEvolutionMensuelle([
      ligne('2026-01-10', 'debit', 1000),
      ligne('2026-01-20', 'credit', 300),
      ligne('2026-02-05', 'credit', 250),
    ], 12)
    expect(evolution).toEqual([
      { mois: '2026-01', encaissements: 1000, decaissements: 300 },
      { mois: '2026-02', encaissements: 0, decaissements: 250 },
    ])
  })

  it('ignore tout ce qui n’est pas le compte banque', () => {
    const evolution = calculerEvolutionMensuelle([
      ligne('2026-01-10', 'debit', 1000, '606100'),
      ligne('2026-01-10', 'debit', 50),
    ], 12)
    expect(evolution).toEqual([{ mois: '2026-01', encaissements: 50, decaissements: 0 }])
  })

  it('ne garde que les derniers mois demandés, en ordre chronologique', () => {
    const evolution = calculerEvolutionMensuelle(
      ['2026-01-05', '2026-02-05', '2026-03-05'].map((d) => ligne(d, 'debit', 100)),
      2,
    )
    expect(evolution.map((m) => m.mois)).toEqual(['2026-02', '2026-03'])
  })

  it('rend une série vide sans mouvement bancaire', () => {
    expect(calculerEvolutionMensuelle([], 12)).toEqual([])
  })
})

describe('soldesFinDeMois', () => {
  it('cumule le solde d’un mois sur l’autre', () => {
    // Solde relatif, cumulé depuis la première écriture du brouillon : c'est la pente qui compte,
    // pas le niveau absolu, que seul le relevé bancaire connaît.
    expect(soldesFinDeMois([
      ligne('2026-01-10', 'debit', 1000),
      ligne('2026-02-10', 'credit', 400),
      ligne('2026-03-10', 'debit', 200),
    ], 12)).toEqual([
      { mois: '2026-01', solde: 1000 },
      { mois: '2026-02', solde: 600 },
      { mois: '2026-03', solde: 800 },
    ])
  })

  it('garde le cumul des mois antérieurs même en n’en affichant qu’une partie', () => {
    // Tronquer la série ne doit pas repartir de zéro : le dernier solde reste le cumul total.
    const soldes = soldesFinDeMois([
      ligne('2026-01-10', 'debit', 1000),
      ligne('2026-02-10', 'debit', 500),
      ligne('2026-03-10', 'debit', 300),
    ], 1)
    expect(soldes).toEqual([{ mois: '2026-03', solde: 1800 }])
  })

  it('n’égrène que les mois ayant connu un mouvement', () => {
    // Choix assumé (voir le commentaire du module) : « les N derniers mois d'activité », pas les
    // N derniers mois du calendrier. Février est absent, pas à zéro.
    expect(soldesFinDeMois([
      ligne('2026-01-10', 'debit', 100),
      ligne('2026-03-10', 'debit', 100),
    ], 12).map((s) => s.mois)).toEqual(['2026-01', '2026-03'])
  })

  it('arrondit au centime', () => {
    expect(soldesFinDeMois([
      ligne('2026-01-10', 'debit', 0.1),
      ligne('2026-01-11', 'debit', 0.2),
    ], 12)).toEqual([{ mois: '2026-01', solde: 0.3 }]) // 0.30000000000000004 sans arrondi
  })
})
