import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoletSocialCard from './VoletSocialCard'
import type { CotisationDeclaree } from '../../lib/types'
import { cotisation } from '../../test/cotisationsGestes'

// LA RÉGULARISATION ESTIMÉE DANS LA CARTE DU VOLET SOCIAL (ligne 27, TNS-Q2) : sous son drapeau, sur des échéances lues en
// entier, muette sous un blocage ; le drapeau baissé, la carte d'avant, mot pour mot. Le calcul est dans
// lib/regularisationDesCotisations.ts : ici, ce que l'écran en montre.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/regularisationDesCotisations', async (importer) => {
  const reel = await importer<typeof import('../../lib/regularisationDesCotisations')>()
  return { ...reel, get REGULARISATION_DES_COTISATIONS_EXPORTEE() { return drapeau.leve } }
})
// Les paramètres des cotisations (TNS-Q1, TNS-Q4), drapeau levé depuis le 07/11/2026 : la carte les lit par ce module ;
// ici, une activité ouverte en 2010 et rien d'autre de saisi — l'estimation d'hier, ses paramètres tenus.
vi.mock('../../lib/parametresDesCotisationsLecture', () => ({
  lireLesParametresDesCotisations: (dossierId: string) =>
    Promise.resolve({ dossierId, etat: 'lus', debutActivite: '2010-01-01', parExercice: new Map() }),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const lecture = {
        select: () => lecture, eq: () => lecture,
        maybeSingle: () => Promise.resolve({ data: {
          id: 'v1', dossier_id: 'd', annee: 2025, profession: 'auxiliaire_medical', remplacant: false, recettes_brutes: null,
          honoraires_conventionnes: 70_000, depassements: 0, recettes_structures: null,
        }, error: null }),
      }
      return lecture
    },
  },
}))

const VALEURS = new Map([['AA', 80_000], ['BA', 20_000]])
const provisionnelle = (o: Partial<CotisationDeclaree>) => cotisation({ organisme: 'urssaf', annee_payee: 2025, nature: 'provisionnelle', ...o })
const DEUX = [provisionnelle({ id: 'p1', echeance: '2025-02-05', montant_appele: 500 }), provisionnelle({ id: 'p2', echeance: '2025-05-05', montant_appele: 500 })]

async function afficher(cotisations: readonly CotisationDeclaree[] | null, blocage: string | null = null) {
  render(<VoletSocialCard dossierId="d" annee={2025} valeurs={VALEURS} blocage={blocage} cotisations={cotisations} exerciceValide={false} />)
  // Sous un blocage, la carte suspend l'estimation entière : on attend la fin de sa lecture, pas l'estimation.
  await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull())
  if (blocage === null) await screen.findByText('Cotisations Urssaf estimées sur les revenus 2025')
}

beforeEach(() => {
  drapeau.leve = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('la régularisation estimée, le drapeau levé', () => {
  it('les définitives moins les deux provisionnelles : à payer en 2026, sa source et la 2035 pas validée dites', async () => {
    await afficher(DEUX)
    expect(screen.getByText('Régularisation estimée de 2025')).toBeTruthy()
    expect(screen.getByText('À payer en 2026')).toBeTruthy()
    expect(screen.getByText(/2 échéances, provisionnelles ou acomptes/)).toBeTruthy()
    expect(screen.getByText(/Source : les échéances de l’onglet Cotisations/).textContent).toContain('La 2035 de 2025 n’est pas validée')
  })
  it('une échéance de 2025 qui ne dit pas qui l’appelle : aucun chiffre, la raison dite', async () => {
    await afficher([...DEUX, cotisation({ id: 'x', echeance: '2025-10-05', organisme: null, annee_payee: null, nature: null })])
    expect(screen.getByText('Elle ne s’estime pas encore :')).toBeTruthy()
    expect(screen.getByText(/ne dit pas qui l’appelle/)).toBeTruthy()
    expect(screen.queryByText('À payer en 2026')).toBeNull()
  })
  it('muette sous un blocage, ou sans échéances lues en entier', async () => {
    await afficher(DEUX, 'Les pièces ne sont pas toutes lues.')
    expect(screen.queryByText('Régularisation estimée de 2025')).toBeNull()
  })
  it('… et sans échéances données', async () => {
    await afficher(null)
    expect(screen.queryByText('Régularisation estimée de 2025')).toBeNull()
  })
})

describe('le drapeau baissé : la carte d’avant', () => {
  it('ni section ni chiffre, et la phrase d’hier', async () => {
    drapeau.leve = false
    await afficher(DEUX)
    expect(screen.queryByText('Régularisation estimée de 2025')).toBeNull()
    expect(screen.getByText(/ne disant ni l'organisme qui les appelle ni l'année qu'elles paient/)).toBeTruthy()
  })
})
