import { describe, expect, it } from 'vitest'
import { premierReleveDeLaTenue, relevesAuTrenteEtUn } from './releveAuTrenteEtUn'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// LE SOLDE DE LA BANQUE AU 31 DÉCEMBRE, LU SUR LES RELEVÉS (MVPD7-Q2) : la règle que la preuve du relevé de la Révision et la
// confrontation de la validation lisent toutes deux. La preuve est éprouvée par revisionPreuves.test.ts, la validation par
// prealablesValidation.test.ts ; ici, la règle seule, cas par cas. Des jeux FICTIFS.
const controle = (o: Partial<ControleReleveBancaire>): ControleReleveBancaire => ({
  id: 'r1', dossier_id: 'd1', source_fichier: null, solde_initial: 0, solde_final: 0, somme_mouvements: 0, ecart: 0,
  coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31', created_at: '2026-01-05T00:00:00Z', ...o,
})
type Mouvement = Pick<LigneBancaire, 'source_fichier' | 'montant' | 'date'>
const mouvement = (date: string, montant: number, source_fichier = 'chevauche.csv'): Mouvement => ({ date, montant, source_fichier })

describe('relevesAuTrenteEtUn', () => {
  it('prend le solde final du relevé qui finit le 31 décembre, en centimes entiers', () => {
    const r = relevesAuTrenteEtUn([controle({ solde_final: 1234.56 })], [], 2025)
    expect(r.soldes).toEqual([expect.objectContaining({ lu: 'solde_final', centimes: 123456, mouvementsModifies: false })])
  })

  it('préfère un relevé qui finit le 31 décembre à celui qui couvre ce jour', () => {
    const couvre = controle({ id: 'r2', periode_debut: '2025-12-15', periode_fin: '2026-01-15', solde_initial: 10 })
    const r = relevesAuTrenteEtUn([couvre, controle({ solde_final: 5 })], [], 2025)
    expect(r.soldes.map((s) => s.controle.id)).toEqual(['r1'])
    expect(r.regardes.map((c) => c.id)).toEqual(['r1'])
  })

  it('à défaut, le solde initial d’un relevé qui commence le 1er janvier suivant', () => {
    const r = relevesAuTrenteEtUn([controle({ periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: -40.1 })], [], 2025)
    expect(r.soldes).toEqual([expect.objectContaining({ lu: 'solde_initial', centimes: -4010 })])
  })

  it('à défaut, le relevé à cheval : son solde initial et ses mouvements jusqu’au 31 décembre', () => {
    const couvre = controle({
      periode_debut: '2025-12-15', periode_fin: '2026-01-15', source_fichier: 'chevauche.csv', solde_initial: 100, somme_mouvements: -25.5,
    })
    const lignes = [mouvement('2025-12-20', 0.1), mouvement('2025-12-31', 0.2), mouvement('2026-01-02', -25.8), mouvement('2025-12-20', 99, 'autre.csv')]
    expect(relevesAuTrenteEtUn([couvre], lignes, 2025).soldes).toEqual([expect.objectContaining({ lu: 'corrige', centimes: 10030 })])
    // Ses mouvements ne font plus la somme contrôlée, ou ne se retrouvent pas : son solde du 31 ne se calcule pas.
    expect(relevesAuTrenteEtUn([couvre], lignes.slice(1), 2025).soldes).toEqual([expect.objectContaining({ lu: null, raison: 'mouvements_modifies' })])
    expect(relevesAuTrenteEtUn([{ ...couvre, source_fichier: null }], lignes, 2025).soldes)
      .toEqual([expect.objectContaining({ lu: null, raison: 'sans_fichier' })])
  })

  it('ne retient qu’un relevé qui boucle, et regarde celui qui ne boucle pas', () => {
    const r = relevesAuTrenteEtUn([controle({ coherent: false, ecart: 3 })], [], 2025)
    expect(r.soldes).toEqual([])
    expect(r.regardes.map((c) => c.id)).toEqual(['r1'])
  })

  it('ne retient rien d’un relevé d’un autre exercice', () => {
    expect(relevesAuTrenteEtUn([controle({ periode_debut: '2025-03-01', periode_fin: '2025-03-31' })], [], 2025))
      .toEqual({ finissent: [], couvrent: [], regardes: [], soldes: [] })
  })
})

describe('premierReleveDeLaTenue', () => {
  const mars = controle({ id: 'r-mars', periode_debut: '2025-03-01', periode_fin: '2025-03-31' })
  const janvier = controle({ id: 'r-jan', periode_debut: '2025-01-01', periode_fin: '2025-01-31' })

  it('rend le relevé qui commence le plus tôt, quel que soit l’ordre lu', () => {
    expect(premierReleveDeLaTenue([mars, janvier], null)?.id).toBe('r-jan')
  })

  it('écarte, après une reprise, les relevés qui finissent au plus tard le jour de la reprise', () => {
    expect(premierReleveDeLaTenue([mars, janvier], '2025-01-31')?.id).toBe('r-mars')
  })

  it('n’a rien sans relevé daté', () => {
    expect(premierReleveDeLaTenue([controle({ periode_debut: null, periode_fin: null })], null)).toBeUndefined()
  })
})
