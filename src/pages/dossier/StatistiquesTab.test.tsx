import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import StatistiquesTab from './StatistiquesTab'

// « Une recherche filtre l'affichage, jamais un total » — la règle que cet écran a violée : ses
// totaux débit/crédit portaient sur les lignes TROUVÉES, si bien que taper « 606 » affichait le
// badge rouge « écart … », celui qui signale normalement un brouillon cassé. Une recherche ne doit
// jamais fabriquer une alerte.
//
// Le test vise donc le PIED du tableau autant que son corps : c'est leur divergence qui est la
// règle (moins de lignes, mêmes totaux).
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: faux.parTable[table] ?? [], error: null }).then(suite),
      })
      return chaine
    },
  },
}))

function ecriture(compte: string, sens: 'debit' | 'credit', montant: number) {
  return {
    id: `${compte}-${sens}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
    date: '2025-03-10', compte, libelle: 'Écriture de test', montant, sens,
    statut: 'brouillon', created_at: '2025-03-10T00:00:00Z',
  }
}

function piedDuTableau(): HTMLTableRowElement {
  const pied = document.querySelector('tfoot tr')
  if (!pied) throw new Error('Pied de tableau introuvable — la balance ne s’est pas affichée.')
  return pied as HTMLTableRowElement
}

describe('StatistiquesTab — Balance des comptes', () => {
  it('réduit les lignes affichées sans toucher aux totaux ni fabriquer un écart', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120),
      ecriture('512000', 'credit', 120),
    ]
    faux.parTable.categories = []
    faux.parTable.pieces = []

    render(
      <AnneeProvider defaut="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} />
      </AnneeProvider>,
    )

    await screen.findByText('606100')
    // `children` compte les cellules, pas les colonnes : le premier `td` du pied porte colSpan={3},
    // donc débit, crédit et badge sont en 1, 2 et 3.
    const totauxAvant = [piedDuTableau().children[1].textContent, piedDuTableau().children[2].textContent]
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')

    const champ = screen.getByRole('searchbox', { name: /Rechercher un numéro/ })
    await act(async () => { fireEvent.change(champ, { target: { value: '606' } }) })

    // Le corps se réduit…
    expect(screen.getByText('606100')).toBeDefined()
    expect(screen.queryByText('512000')).toBeNull()
    expect(screen.getByText('1 sur 2')).toBeDefined()

    // …et le pied ne bouge pas d'un centime, badge compris.
    const pied = piedDuTableau()
    expect(pied.children[0].textContent).toBe('Total (tous les comptes)')
    expect([pied.children[1].textContent, pied.children[2].textContent]).toEqual(totauxAvant)
    expect(pied.children[3].textContent).toContain('équilibré')
    expect(pied.children[3].textContent).not.toContain('écart')
  })
})
