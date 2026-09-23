import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT } from '../../lib/controles'
import type { CotisationDeclaree } from '../../lib/types'

// RETIRER UNE ÉCHÉANCE DE COTISATION EST LE GESTE DONT PLUS RIEN NE PARLE ENSUITE.
// `lignes_bancaires.cotisation_id` est en `ON DELETE SET NULL` : le prélèvement qui la payait garde
// `statut = 'rapprochee'` et ne désigne plus rien. Et contrairement à une pièce, une cotisation
// n'engendre AUCUNE écriture — ni `rupturesPisteAudit`, ni les contrôles d'Écritures, ni la piste
// d'audit ne partent du mouvement, donc aucun d'eux ne mentionnerait celui-ci. La confirmation est
// la seule occasion de le dire ; c'est la règle du projet, une confirmation nomme ce qu'on perd.
//
// Aucun test de `src/lib` ne peut voir ceci : c'est le CÂBLAGE de la phrase au geste.
const faux = vi.hoisted(() => ({
  cotisations: [] as unknown[],
  suppressions: [] as unknown[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let operation = 'select'
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { operation = 'delete'; return chaine },
        insert: () => chaine,
        update: () => chaine,
        eq: (colonne: string, valeur: unknown) => {
          if (operation === 'delete' && colonne === 'id') faux.suppressions.push(valeur)
          return chaine
        },
        order: () => chaine,
        range: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          if (operation === 'delete') return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
          const lignes = table === 'cotisations_declarees' ? faux.cotisations : []
          return Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite)
        },
      })
      return chaine
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
  },
}))

// Doublés pour ne rien facturer : ce test porte sur ce que dit la confirmation, jamais sur l'OCR.
vi.mock('../../lib/extraction', () => ({
  extractPiece: () => Promise.resolve({}),
  fichierDejaPresent: () => Promise.resolve(false),
  hashFichier: () => Promise.resolve('empreinte-de-test'),
}))

// Typé sans `as` : le compilateur confronte le jeu d'essai à la table.
function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-05',
    montant_appele: 420, montant_verse: null, montant_csg_crds: null,
    previsionnel: false, created_at: '2026-01-05T09:00:00Z', ...o,
  }
}

async function monterEtCliquerRetirer() {
  faux.cotisations = [cotisation()]
  faux.suppressions = []
  render(<CotisationsTab dossierId="dossier-de-test" />)
  const bouton = await screen.findByRole('button', { name: 'Retirer' })
  await act(async () => { bouton.click() })
}

describe('CotisationsTab — retirer une échéance dit ce que ça défait', () => {
  it('nomme le rapprochement bancaire défait dans la confirmation', async () => {
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })

    await monterEtCliquerRetirer()

    expect(message).toContain(AVERTISSEMENT_RAPPROCHEMENT_DEFAIT)
    expect(faux.suppressions).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la confirmation nomme ce qu'on perd » serait satisfait par un
  // bouton qui ne retire JAMAIS.
  it('retire bien quand on confirme', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await monterEtCliquerRetirer()

    expect(faux.suppressions).toEqual(['cot-1'])
  })
})
