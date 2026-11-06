import '../../test/ecrans'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CarteEspaceClient from './CarteEspaceClient'

// LA CARTE P10 DE LA VUE D'ENSEMBLE (étape B9b), « Espace client : ce qui a bougé depuis le … ». Ce que ces cas gardent :
// rien avant le retour des lectures (un squelette, ni liste ni « aucun ») ; les gestes du CLIENT seuls, un membre du cabinet
// absent ; muette, sans rien lister, sur une lecture partielle ; la lecture du dossier demandé, bornée à la fenêtre.

const faux = vi.hoisted(() => ({
  lignes: {} as Record<string, Record<string, unknown>[]>,
  refusees: new Set<string>(),
  retenir: false,
  demandes: [] as { table: string; dossier: unknown; borne: unknown }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, dossier: null as unknown, borne: null as unknown }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => {
            if (colonne === 'dossier_id') demande.dossier = valeur
            predicats.push(predicatEq(colonne, valeur))
            return c
          },
          // `.gte(colonne, jour)` : une date ISO se compare en texte à un instant ISO ; une colonne nulle n'est pas retenue.
          gte: (colonne: string, valeur: string) => {
            demande.borne = valeur
            predicats.push((l) => typeof l[colonne] === 'string' && (l[colonne] as string) >= valeur)
            return c
          },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.retenir) return new Promise(() => {})
            if (faux.refusees.has(table)) return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            const toutes = filtrer(faux.lignes[table] ?? [], predicats)
            return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const CLIENT = 'u-client'
const MEMBRE = 'u-membre'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
  faux.retenir = false
  faux.refusees = new Set()
  faux.demandes = []
  faux.lignes = {
    memberships: [{ id: 'm1', dossier_id: 'd1', user_id: CLIENT, created_at: '2026-01-01T00:00:00Z' }],
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', numero: 'F2026-0007', valide_par: CLIENT, validated_at: '2026-11-03T09:00:00Z', created_by: MEMBRE, created_at: '2026-11-02T09:00:00Z' },
      { id: 'f2', dossier_id: 'd1', numero: 'F2026-0008', valide_par: MEMBRE, validated_at: '2026-11-04T09:00:00Z', created_by: MEMBRE, created_at: '2026-11-04T08:00:00Z' },
      { id: 'f3', dossier_id: 'd2', numero: 'F2026-0001', valide_par: CLIENT, validated_at: '2026-11-04T09:00:00Z', created_by: CLIENT, created_at: '2026-11-04T08:00:00Z' },
    ],
    pieces: [
      { id: 'p1', dossier_id: 'd1', uploaded_by: CLIENT, created_at: '2026-11-05T15:00:00Z' },
      { id: 'p2', dossier_id: 'd1', uploaded_by: CLIENT, created_at: '2026-09-01T15:00:00Z' },
      { id: 'p3', dossier_id: 'd1', uploaded_by: MEMBRE, created_at: '2026-11-05T16:00:00Z' },
    ],
  }
})

afterEach(() => { vi.useRealTimers() })

describe('la carte « Espace client : ce qui a bougé »', () => {
  it('ne dit rien avant le retour des lectures : un squelette, ni geste ni « aucun »', () => {
    faux.retenir = true
    render(<CarteEspaceClient dossierId="d1" />)
    expect(screen.getByText('Espace client : ce qui a bougé depuis le 08/10/2026')).toBeTruthy()
    expect(screen.getByLabelText('Chargement du journal de l’espace client').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.body.textContent).not.toMatch(/aucun|rien/i)
  })

  it('liste les gestes du client, du plus récent au plus ancien ; ceux d’un membre du cabinet n’y paraissent pas', async () => {
    render(<CarteEspaceClient dossierId="d1" />)
    const liste = await screen.findByRole('list', { name: 'Gestes du client' })
    const lignes = [...liste.querySelectorAll('[role="listitem"]')].map((l) => l.textContent)
    expect(lignes).toEqual(['Pièce déposéele 05/11/2026', 'Facture F2026-0007 validéele 03/11/2026'])
    expect(document.body.textContent).not.toContain('F2026-0008')
    expect(document.body.textContent).not.toContain('Facture créée')
    expect(screen.getByText('2 évènements.')).toBeTruthy()
    expect(screen.getByText(/ce qui se supprime sans trace/)).toBeTruthy()
    // La lecture : le dossier demandé seul, bornée un jour avant la fenêtre.
    expect(new Set(faux.demandes.map((d) => d.dossier))).toEqual(new Set(['d1']))
    expect(faux.demandes.filter((d) => d.table !== 'memberships').every((d) => d.borne === '2026-10-07')).toBe(true)
  })

  it('muette sur une lecture partielle : elle le dit et ne liste rien', async () => {
    faux.refusees.add('contacts')
    render(<CarteEspaceClient dossierId="d1" />)
    expect(await screen.findByText('Le journal ne peut pas être dit : une lecture est incomplète.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.body.textContent).not.toContain('Pièce déposée')
    expect(document.body.textContent).toContain('Client ajouté')
  })

  it('muette sur des accès refusés, même quand toutes les sources sont revenues', async () => {
    faux.refusees.add('memberships')
    render(<CarteEspaceClient dossierId="d1" />)
    expect(await screen.findByText(/La liste des accès du dossier n’a pas été lue en entier/)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })
})
