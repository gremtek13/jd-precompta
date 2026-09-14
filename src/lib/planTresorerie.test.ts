import { describe, expect, it } from 'vitest'
import { calculerPlanTresorerie, echeancesCotisations, echeancesEmprunts, type LigneBanquePourPlan } from './planTresorerie'
import { ajouterMois, premierJourDuMoisCourant } from './format'
import type { Emprunt } from './emprunts'
import type { CotisationDeclaree } from './types'

const moisCourant = () => premierJourDuMoisCourant()
const cleMois = (decalage: number) => ajouterMois(moisCourant(), decalage).slice(0, 7)

describe('calculerPlanTresorerie', () => {
  it('démarre la projection au mois suivant, pas au mois en cours', () => {
    // Le mois en cours est exclu par construction (il n'est pas terminé). L'ancien calcul
    // l'étiquetait pourtant en première ligne : `toISOString()` sur un 1er du mois à minuit
    // heure de Paris rendait le mois précédent.
    const plan = calculerPlanTresorerie([], 10000, 6, 3)
    expect(plan.lignes.map((l) => l.mois)).toEqual([cleMois(1), cleMois(2), cleMois(3)])
  })

  it('exclut le mois en cours de la moyenne et inclut la borne basse', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: moisCourant(), sens: 'debit', montant: 999 },                  // mois en cours → exclu
      { date: ajouterMois(moisCourant(), -6), sens: 'debit', montant: 600 }, // borne basse → inclus
      { date: ajouterMois(moisCourant(), -7), sens: 'debit', montant: 777 }, // trop ancien → exclu
    ]
    expect(calculerPlanTresorerie(lignes, 0, 6, 1).moyenneEncaissements).toBe(100)
  })

  it('enchaîne les soldes d’un mois sur l’autre', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: ajouterMois(moisCourant(), -1), sens: 'debit', montant: 1200 },
      { date: ajouterMois(moisCourant(), -1), sens: 'credit', montant: 600 },
    ]
    const plan = calculerPlanTresorerie(lignes, 5000, 6, 2)
    expect(plan.moyenneEncaissements).toBe(200)
    expect(plan.moyenneDecaissements).toBe(100)
    expect(plan.lignes[0]).toMatchObject({ soldeDebut: 5000, soldeFin: 5100 })
    expect(plan.lignes[1]).toMatchObject({ soldeDebut: 5100, soldeFin: 5200 })
  })

  it('reste à zéro sans historique bancaire', () => {
    const plan = calculerPlanTresorerie([], 0, 6, 2)
    expect(plan.moyenneEncaissements).toBe(0)
    expect(plan.lignes.every((l) => l.soldeFin === 0)).toBe(true)
  })
})

describe('échéances connues', () => {
  const pret: Emprunt = {
    id: 'e1', dossier_id: 'd1', nom: 'Matériel', organisme_preteur: null,
    capital_initial: 12000, taux_annuel: 3, date_debut: '2026-01-31', duree_mois: 24,
    created_at: '2026-01-01T00:00:00Z',
  }

  it('ne retient que les échéances d’emprunt de la période demandée', () => {
    const echeances = echeancesEmprunts([pret], '2026-04-01', '2026-06-30')
    expect(echeances.map((e) => e.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30'])
    expect(echeances.every((e) => e.libelle.includes('Matériel'))).toBe(true)
  })

  it('ignore un emprunt pas encore commencé', () => {
    expect(echeancesEmprunts([pret], '2025-01-01', '2025-06-30')).toEqual([])
  })

  it('ne retient que les cotisations non versées de la période', () => {
    const cotisations = [
      { id: 'c1', dossier_id: 'd1', echeance: '2026-05-05', montant_appele: 300, montant_verse: null },
      { id: 'c2', dossier_id: 'd1', echeance: '2026-05-20', montant_appele: 400, montant_verse: 400 }, // déjà payée
      { id: 'c3', dossier_id: 'd1', echeance: '2026-09-05', montant_appele: 500, montant_verse: null }, // hors période
    ] as CotisationDeclaree[]
    const echeances = echeancesCotisations(cotisations, '2026-04-01', '2026-06-30')
    expect(echeances).toHaveLength(1)
    expect(echeances[0]).toMatchObject({ date: '2026-05-05', montant: 300 })
  })
})
