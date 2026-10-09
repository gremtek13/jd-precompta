import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupplementsTab from './SupplementsTab'
import type { CompteCourantAssocie } from '../../lib/cca'
import type { Supplement } from '../../lib/supplements'

// SUPPRIMER UN SUPPLÉMENT OU UN COMPTE COURANT JETAIT LE RÉSULTAT DE LA SUPPRESSION (09/10/2026,
// `ecrituresVerifiees.test.ts`) : refusée, la relecture remettait la ligne, sans un mot, sur un geste que l'opérateur
// venait de CONFIRMER — le défaut que le retrait d'un mouvement de compte courant avait déjà payé (voir
// `SupplementsTab.test.tsx`). Rouges sur le code d'avant.
//
// À part de `SupplementsTab.test.tsx` : son faux client ne connaît que les comptes et leurs mouvements ; celui-ci sert
// aussi les suppléments, et APPLIQUE la suppression qu'il accepte, pour que la relecture la montre.
const faux = vi.hoisted(() => ({
  supplements: [] as Supplement[],
  comptes: [] as CompteCourantAssocie[],
  // Le refus de la base, par table : la suppression n'applique alors rien.
  refus: {} as Record<string, string>,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const chaine: Record<string, unknown> = {}
        let suppression = false
        const predicats: ReturnType<typeof predicatEq>[] = []
        Object.assign(chaine, {
          select: () => chaine,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          in: () => chaine,
          order: () => chaine,
          range: () => chaine,
          delete: () => { suppression = true; return chaine },
          then: (suite: (r: unknown) => unknown) => {
            if (suppression) {
              if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] } }).then(suite)
              if (table === 'supplements') {
                const visees = filtrer(faux.supplements, predicats)
                faux.supplements = faux.supplements.filter((s) => !visees.includes(s))
              }
              if (table === 'comptes_courants_associes') {
                const visees = filtrer(faux.comptes, predicats)
                faux.comptes = faux.comptes.filter((c) => !visees.includes(c))
              }
              return Promise.resolve({ data: null, error: null }).then(suite)
            }
            const lignes = table === 'supplements' ? faux.supplements
              : table === 'comptes_courants_associes' ? faux.comptes : []
            return Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite)
          },
        })
        return chaine
      },
    },
  }
})

function supplement(o: Partial<Supplement> = {}): Supplement {
  return {
    id: 's1', dossier_id: 'd1', type: 'situation_intermediaire', libelle: 'Situation au 30 juin', montant_ht: 400,
    statut: 'a_facturer', date_demande: '2026-07-01', facture_id: null, notes: null, created_at: '2026-07-01T09:00:00Z', ...o,
  }
}

function compte(o: Partial<CompteCourantAssocie> = {}): CompteCourantAssocie {
  return { id: 'c1', dossier_id: 'd1', nom_associe: 'ASSOCIE FICTIF', taux_interet_annuel: null, created_at: '2026-09-01T10:00:00Z', ...o }
}

beforeEach(() => {
  faux.supplements = [supplement()]
  faux.comptes = [compte()]
  faux.refus = {}
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks() })

async function monter() {
  render(<SupplementsTab dossierId="d1" />)
  await screen.findByText('Situation au 30 juin')
}

function boutonDuSupplement() {
  return within(screen.getByText('Situation au 30 juin').closest('tr')!).getByRole('button', { name: 'Supprimer' })
}

function boutonDuCompte() {
  return within(screen.getByText('ASSOCIE FICTIF').closest('.card') as HTMLElement).getByRole('button', { name: 'Supprimer' })
}

describe('SupplementsTab — une suppression refusée se dit', () => {
  it('un supplément refusé le dit avec la raison de la base, et reste', async () => {
    faux.refus = { supplements: 'permission denied for table supplements' }
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await monter()
    await act(async () => { boutonDuSupplement().click() })

    expect(alerte).toHaveBeenCalledWith('Le supplément n’a pas pu être supprimé : permission denied for table supplements.')
    expect(await screen.findByText('Situation au 30 juin')).toBeTruthy()
  })

  it('un compte courant refusé le dit avec la raison de la base, et reste', async () => {
    faux.refus = { comptes_courants_associes: 'JWT expired' }
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await monter()
    await act(async () => { boutonDuCompte().click() })

    expect(alerte).toHaveBeenCalledWith('Le compte courant n’a pas pu être supprimé : JWT expired.')
    expect(await screen.findByText('ASSOCIE FICTIF')).toBeTruthy()
  })

  it('une suppression acceptée ne dit rien, et la ligne part', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « dit son refus » serait satisfait par un écran qui crie à chaque suppression.
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await monter()
    await act(async () => { boutonDuSupplement().click() })
    await act(async () => { boutonDuCompte().click() })

    expect(alerte).not.toHaveBeenCalled()
    expect(faux.supplements).toEqual([])
    expect(faux.comptes).toEqual([])
    expect(await screen.findByText('Aucun compte courant d\'associé enregistré.')).toBeTruthy()
  })
})
