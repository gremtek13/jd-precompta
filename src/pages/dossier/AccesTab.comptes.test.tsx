import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import { ceQueDitLaCaseComptes } from '../../lib/droitsAcces'

// LA CASE « COMPTES » DANS L'ONGLET ACCÈS (étape C4b), LE DRAPEAU LEVÉ : sa colonne lue, sa quatrième case, sa phrase, et
// l'écriture par la forme à CINQ de `changer_droits_acces`, le seul droit cliqué non nul. Les colonnes et les cases se
// calculent au chargement des modules : le drapeau est levé depuis le 07/11/2026 (l'état réel), et l'état baissé est
// celui des autres tests de l'onglet, qui le baissent par `vi.mock` et gardent l'onglet d'hier, et des tests de leurs
// fonctions (droitsAcces.test.ts, `domainesSelon`, `demandeDeChangementSelon`).

vi.mock('../../lib/situationsPubliees', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/situationsPubliees')>(),
  SITUATIONS_PUBLIEES_EXPORTEES: true,
}))
vi.mock('../../lib/reglageDuDossierLecture', () => ({
  lireLeReglageDuDossier: async (dossierId: string) => ({
    dossierId, reglage: { etat: 'bascule' }, caisse: { etat: 'exclu', statut: 'exonere' }, nature: { etat: 'lue', categorieId: null },
  }),
}))
vi.mock('../../lib/natureDesRecettesLecture', () => ({
  lireLesCategoriesDeLaNature: async (dossierId: string) => ({ dossierId, etat: 'lues', categories: [] }),
  fixerLaNatureDesRecettes: async () => { throw new Error('non jouée ici') },
}))
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))

type LigneAcces = Record<string, unknown> & { id: string; dossier_id: string }
const faux = vi.hoisted(() => ({
  lignes: [] as LigneAcces[],
  colonnes: [] as string[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  liberer: [] as (() => void)[],
}))

// La trace des droits (étape P1-trace) a sa lecture et son écran testés à part (traceDesDroitsLecture.test.ts, AccesTab.trace.test.tsx) :
// ici, lue en entier et vide, pour que les lectures que ce fichier compte restent celles des accès.
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({ dossierId, lignes: [], motif: null }),
}))
vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        return new Promise((r) => {
          faux.liberer.push(() => {
            const ligne = faux.lignes.find((l) => l.id === args.p_membership_id)
            if (ligne && typeof args.p_comptes === 'boolean') ligne.droit_comptes = args.p_comptes
            r({ data: ligne ? { ...ligne } : null, error: null })
          })
        })
      },
      from: () => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          select: (colonnes: string) => { faux.colonnes.push(colonnes); return chaine },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            const lignes = filtrer(faux.lignes, predicats)
            return Promise.resolve({ data: lignes.slice(debut, fin + 1).map((l) => ({ ...l })), error: null, count: lignes.length })
              .then(suite)
          },
        })
        return chaine
      },
    },
  }
})

afterEach(() => { faux.lignes = []; faux.colonnes = []; faux.appels = []; faux.liberer = [] })

const acces = (id: string, email: string): LigneAcces => ({
  id, dossier_id: 'd1', user_id: `u-${id}`, email, created_at: '2026-10-01T08:00:00Z',
  droit_ventes: false, droit_banque: false, droit_caisse: false, droit_comptes: false,
})

describe('AccesTab — la case « Comptes »', () => {
  it('levé : la colonne lue, la quatrième case et sa phrase ; cocher passe par la forme à cinq, puis relit', async () => {
    faux.lignes = [acces('m1', 'client@exemple.fr')]
    render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
    await screen.findByText('client@exemple.fr')
    expect(faux.colonnes.some((c) => c.includes('droit_comptes'))).toBe(true)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Comptes')
    expect(screen.getByText(ceQueDitLaCaseComptes())).toBeTruthy()
    const caseComptes = await screen.findByRole('checkbox', { name: 'Droit « Comptes » de client@exemple.fr' })
    await waitFor(() => expect((caseComptes as HTMLInputElement).disabled).toBe(false))
    act(() => { fireEvent.click(caseComptes); fireEvent.click(caseComptes) })
    expect(faux.appels).toEqual([{
      nom: 'changer_droits_acces',
      args: { p_membership_id: 'm1', p_ventes: null, p_banque: null, p_caisse: null, p_comptes: true },
    }])
    await act(async () => { faux.liberer.forEach((l) => l()) })
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Droit « Comptes » de client@exemple.fr' }) as HTMLInputElement).checked).toBe(true))
  })
})
