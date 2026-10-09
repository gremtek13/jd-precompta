import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EquipePage from './EquipePage'
import type { CabinetAdmin, Dossier, DossierAssignation } from '../lib/types'

// ASSIGNER UN DOSSIER À UN COMPTABLE JETAIT LE RÉSULTAT DE L'ÉCRITURE (09/10/2026, `ecrituresVerifiees.test.ts`) :
// refusée, la relecture remettait la case comme avant, sans un mot — et le comptable gardait, ou n'avait jamais, l'accès
// au dossier que le chef croyait lui avoir retiré ou donné. C'est une écriture qui décide de QUI VOIT QUOI. Rouges sur
// le code d'avant.
const faux = vi.hoisted(() => ({
  assignations: [] as DossierAssignation[],
  refus: null as string | null,
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const c: Record<string, unknown> = {}
        let operation: 'select' | 'insert' | 'delete' = 'select'
        let insertion: Record<string, unknown> = {}
        const predicats: ReturnType<typeof predicatEq>[] = []
        Object.assign(c, {
          select: () => c,
          insert: (valeur: Record<string, unknown>) => { operation = 'insert'; insertion = valeur; return c },
          delete: () => { operation = 'delete'; return c },
          eq: (colonne: string, valeur: unknown) => {
            if (colonne !== 'cabinet_id') predicats.push(predicatEq(colonne, valeur))
            return c
          },
          order: () => c,
          range: () => c,
          then: (suite: (r: unknown) => unknown) => {
            if (operation !== 'select') {
              // Refusée, l'écriture n'applique rien : la relecture rend la case telle qu'elle est restée.
              if (faux.refus) return Promise.resolve({ data: null, error: { message: faux.refus } }).then(suite)
              if (operation === 'delete') {
                const visees = filtrer(faux.assignations, predicats)
                faux.assignations = faux.assignations.filter((a) => !visees.includes(a))
              } else {
                faux.assignations = [...faux.assignations, {
                  id: `a-${faux.assignations.length + 1}`, dossier_id: String(insertion.dossier_id), user_id: String(insertion.user_id),
                  created_at: '2026-10-09T09:00:00Z',
                }]
              }
              return Promise.resolve({ data: null, error: null }).then(suite)
            }
            const lignes: readonly unknown[] = table === 'cabinet_admins' ? [membre()]
              : table === 'dossiers' ? [dossier()]
                : table === 'dossier_assignations' ? faux.assignations : []
            return Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite)
          },
        })
        return c
      },
    },
  }
})

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: null, monCabinetId: 'cab1' }) }))

function membre(o: Partial<CabinetAdmin> = {}): CabinetAdmin {
  return { user_id: 'u-comptable', cabinet_id: 'cab1', role: 'comptable', email: 'comptable@exemple.test', ...o }
}

function dossier(o: Partial<Dossier> = {}): Dossier {
  return {
    id: 'd1', nom: 'Dossier fictif', cabinet_id: 'cab1', siret: '12345678901234', contact_nom: null, contact_email: null,
    notes: null, archive: false, created_at: '2026-01-05T09:00:00Z', code_email: 'abc123', assujetti_tva: true,
    statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false, tva_periodicite: 'trimestrielle',
    tva_sur_debits: false, mode_comptable: 'tresorerie', compte_notes_de_frais: '108000', code_naf: null, libelle_naf: null,
    adresse: null, ...o,
  }
}

const assignation = (): DossierAssignation => ({ id: 'a-1', dossier_id: 'd1', user_id: 'u-comptable', created_at: '2026-09-01T09:00:00Z' })

beforeEach(() => {
  faux.assignations = []
  faux.refus = null
})
afterEach(() => { vi.restoreAllMocks() })

async function cocherLeDossier() {
  render(<MemoryRouter><EquipePage /></MemoryRouter>)
  const gerer = await screen.findByRole('button', { name: /dossier\(s\) — gérer/ })
  await act(async () => { gerer.click() })
  const caseDossier = screen.getByRole('checkbox', { name: 'Dossier fictif' })
  await act(async () => { fireEvent.click(caseDossier) })
  return caseDossier as HTMLInputElement
}

describe('EquipePage — une assignation refusée se dit', () => {
  it('une assignation refusée le dit avec la raison de la base, et la case reste décochée', async () => {
    faux.refus = 'permission denied for table dossier_assignations'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const caseDossier = await cocherLeDossier()

    expect(alerte).toHaveBeenCalledWith('L’assignation n’a pas pu être ajoutée : permission denied for table dossier_assignations.')
    expect(faux.assignations).toEqual([])
    expect(caseDossier.checked).toBe(false)
  })

  it('un retrait d’assignation refusé le dit, et l’accès reste', async () => {
    faux.assignations = [assignation()]
    faux.refus = 'JWT expired'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const caseDossier = await cocherLeDossier()

    expect(alerte).toHaveBeenCalledWith('L’assignation n’a pas pu être retirée : JWT expired.')
    expect(faux.assignations).toHaveLength(1)
    expect(caseDossier.checked).toBe(true)
  })

  it('une assignation acceptée ne dit rien, et la case suit la base', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « dit son refus » serait satisfait par un écran qui crie à chaque case.
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await cocherLeDossier()

    expect(alerte).not.toHaveBeenCalled()
    expect(faux.assignations.map((a) => a.dossier_id)).toEqual(['d1'])
    expect((screen.getByRole('checkbox', { name: 'Dossier fictif' }) as HTMLInputElement).checked).toBe(true)
  })
})
