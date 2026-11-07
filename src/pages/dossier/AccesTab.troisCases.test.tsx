import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import { CASES_SANS_EFFET, ceQueDitLaCaseSansEffet } from '../../lib/droitsAcces'

// LES TROIS CASES DE B1 DANS L'ONGLET ACCÈS (« Achats », « Notes de frais », « Documents »), LE DRAPEAU LEVÉ — avec celui
// de C4a, qu'il suppose : leurs colonnes lues, leurs cases, leurs phrases (« ne change encore rien »), et l'écriture par la
// forme à HUIT de `changer_droits_acces`, le seul droit cliqué non nul. Les colonnes et les cases se calculent au chargement
// des modules : l'état baissé (l'état réel) est celui des autres tests de l'onglet, qui gardent l'onglet d'hier, et de
// troisCasesDeLAcces.test.ts (`domainesSelonLesMigrations`, `demandeDeChangementSelonLaForme`).

vi.mock('../../lib/situationsPubliees', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/situationsPubliees')>(),
  SITUATIONS_PUBLIEES_EXPORTEES: true,
}))
vi.mock('../../lib/troisCasesDeLAcces', () => ({ TROIS_CASES_EXPORTEES: true }))
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

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        return new Promise((r) => {
          faux.liberer.push(() => {
            const ligne = faux.lignes.find((l) => l.id === args.p_membership_id)
            // La base n'écrit que les droits non nuls (un droit nul est inchangé).
            for (const [cle, valeur] of Object.entries(args)) {
              if (ligne && cle !== 'p_membership_id' && typeof valeur === 'boolean') ligne[`droit_${cle.slice(2)}`] = valeur
            }
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
  droit_achats: false, droit_frais: false, droit_documents: true,
})

describe('AccesTab — les trois cases de B1', () => {
  it('levé : les trois colonnes lues, les trois cases et leurs phrases ; cocher « Notes de frais » passe par la forme à huit, puis relit', async () => {
    faux.lignes = [acces('m1', 'client@exemple.fr')]
    render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
    await screen.findByText('client@exemple.fr')
    expect(faux.colonnes.some((c) => ['droit_achats', 'droit_frais', 'droit_documents', 'droit_comptes'].every((n) => c.includes(n))))
      .toBe(true)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Comptes', 'Achats', 'Notes de frais', 'Documents']))
    for (const d of CASES_SANS_EFFET) {
      expect(ceQueDitLaCaseSansEffet(d)).toContain('ne change encore rien')
      expect(screen.getByText(ceQueDitLaCaseSansEffet(d))).toBeTruthy()
    }
    // La case lue en base se montre telle quelle : « Documents » cochée, « Achats » non.
    expect((await screen.findByRole('checkbox', { name: 'Droit « Documents » de client@exemple.fr' }) as HTMLInputElement).checked)
      .toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Droit « Achats » de client@exemple.fr' }) as HTMLInputElement).checked).toBe(false)
    const caseFrais = await screen.findByRole('checkbox', { name: 'Droit « Notes de frais » de client@exemple.fr' })
    await waitFor(() => expect((caseFrais as HTMLInputElement).disabled).toBe(false))
    act(() => { fireEvent.click(caseFrais); fireEvent.click(caseFrais) })
    expect(faux.appels).toEqual([{
      nom: 'changer_droits_acces',
      args: {
        p_membership_id: 'm1', p_ventes: null, p_banque: null, p_caisse: null, p_comptes: null,
        p_achats: null, p_frais: true, p_documents: null,
      },
    }])
    await act(async () => { faux.liberer.forEach((l) => l()) })
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Droit « Notes de frais » de client@exemple.fr' }) as HTMLInputElement)
      .checked).toBe(true))
    expect((screen.getByRole('checkbox', { name: 'Droit « Documents » de client@exemple.fr' }) as HTMLInputElement).checked).toBe(true)
  })
})
