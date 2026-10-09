import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { CotisationDeclaree, DocumentDivers } from '../../lib/types'
import { AvecExercicesValides } from '../../test/exercicesValides'

// ATTACHER OU DÉTACHER L'AVIS D'UNE ÉCHÉANCE JETAIT LE RÉSULTAT DE LA MISE À JOUR (09/10/2026,
// `ecrituresVerifiees.test.ts`) : refusée, la relecture laissait l'échéance sans son document — ou avec —, sans un mot,
// et l'opérateur croyait l'avis joint. Rouges sur le code d'avant.
//
// À part de `CotisationsTab.test.tsx` : son faux client ne rend aucun document ; celui-ci sert les documents du dossier
// et APPLIQUE la mise à jour qu'il accepte, pour que la relecture la montre.
const faux = vi.hoisted(() => ({
  cotisations: [] as CotisationDeclaree[],
  documents: [] as DocumentDivers[],
  refusMaj: null as string | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIs, predicatNot } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const c: Record<string, unknown> = {}
        let valeurMaj: Partial<DocumentDivers> | null = null
        const predicats: ReturnType<typeof predicatEq>[] = []
        Object.assign(c, {
          select: () => c,
          update: (valeur: Partial<DocumentDivers>) => { valeurMaj = valeur; return c },
          eq: (colonne: string, valeur: unknown) => {
            if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, valeur))
            return c
          },
          is: (colonne: string, valeur: null) => { predicats.push(predicatIs(colonne, valeur)); return c },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
          order: () => c,
          range: () => c,
          then: (suite: (r: unknown) => unknown) => {
            if (valeurMaj) {
              // Refusée, la mise à jour n'applique rien : la relecture montre la base telle qu'elle est restée.
              if (faux.refusMaj) return Promise.resolve({ data: null, error: { message: faux.refusMaj } }).then(suite)
              const maj = valeurMaj
              const visees = filtrer(faux.documents, predicats)
              faux.documents = faux.documents.map((d) => (visees.includes(d) ? { ...d, ...maj } : d))
              return Promise.resolve({ data: null, error: null }).then(suite)
            }
            const source: readonly unknown[] =
              table === 'cotisations_declarees' ? faux.cotisations : table === 'documents_divers' ? faux.documents : []
            const lignes = filtrer(source, predicats)
            return Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite)
          },
        })
        return c
      },
      storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
    },
  }
})

vi.mock('../../lib/extraction', () => ({
  extractPiece: () => Promise.resolve({}),
  fichierDejaPresent: () => Promise.resolve(false),
  hashFichier: () => Promise.resolve('empreinte-de-test'),
}))

function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-05', montant_appele: 420, montant_verse: null,
    montant_csg_crds: null, previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
  }
}

function avis(o: Partial<DocumentDivers> = {}): DocumentDivers {
  return {
    id: 'doc-avis', dossier_id: 'dossier-de-test', storage_path: 'dossier-de-test/avis.pdf', storage_hash: null,
    nom_fichier: 'avis.pdf', categorie: 'cotisation', sous_dossier_id: null, attached_to_cotisation_id: null, notes: null,
    created_at: '2026-01-05T09:00:00Z', ...o,
  }
}

const monter = () => render(
  <AvecExercicesValides annees={[]}><CotisationsTab dossierId="dossier-de-test" modele={{ mode: 'tresorerie', compteNotesDeFrais: '108000' }} /></AvecExercicesValides>,
)

beforeEach(() => {
  faux.cotisations = [cotisation()]
  faux.documents = [avis()]
  faux.refusMaj = null
})
afterEach(() => { vi.restoreAllMocks() })

async function attacher() {
  monter()
  const liste = await screen.findByDisplayValue('Attacher…')
  await act(async () => { fireEvent.change(liste, { target: { value: 'doc-avis' } }) })
}

describe('CotisationsTab — le document d’une échéance', () => {
  it('un rattachement refusé le dit avec la raison de la base, et l’échéance reste sans document', async () => {
    faux.refusMaj = 'permission denied for table documents_divers'
    await attacher()

    expect(await screen.findByText('Le document n’a pas pu être rattaché : permission denied for table documents_divers')).toBeTruthy()
    expect(faux.documents[0].attached_to_cotisation_id).toBeNull()
  })

  it('un rattachement accepté ne dit rien, et le document est joint', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « dit son refus » serait satisfait par un écran qui crie à chaque geste.
    await attacher()

    expect(await screen.findByRole('button', { name: 'Détacher' })).toBeTruthy()
    expect(faux.documents[0].attached_to_cotisation_id).toBe('cot-1')
    expect(screen.queryByText(/n’a pas pu être/)).toBeNull()
  })

  it('un détachement refusé le dit, et le document reste joint', async () => {
    faux.documents = [avis({ attached_to_cotisation_id: 'cot-1' })]
    faux.refusMaj = 'JWT expired'
    monter()
    const bouton = await screen.findByRole('button', { name: 'Détacher' })
    await act(async () => { bouton.click() })

    expect(await screen.findByText('Le document n’a pas pu être détaché : JWT expired')).toBeTruthy()
    expect(faux.documents[0].attached_to_cotisation_id).toBe('cot-1')
  })
})
