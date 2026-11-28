import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { CotisationDeclaree, DocumentDivers } from '../../lib/types'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

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
  // Posées par un test (audit des courses du 28/11/2026) : la n-ième lecture des documents qui suit attend la n-ième porte, et
  // rend la base telle qu'elle était À SA DEMANDE — une relecture lente, donc périmée quand une plus récente l'a devancée.
  portes: [] as Promise<void>[],
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
          // Une échéance ajoutée entre en base, et la relecture qui suit la rend (audit des courses du 28/11/2026).
          insert: (valeur: Partial<CotisationDeclaree>) => {
            faux.cotisations = [...faux.cotisations, {
              id: `ins-${faux.cotisations.length}`, dossier_id: 'dossier-de-test', echeance: '', montant_appele: 0, montant_verse: null,
              montant_csg_crds: null, previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...valeur,
            } as CotisationDeclaree]
            return { then: (suite: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(suite) }
          },
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
            const porte = table === 'documents_divers' ? faux.portes.shift() : undefined
            const reponse = { data: lignes, error: null, count: lignes.length }
            return (porte ? porte.then(() => reponse) : Promise.resolve(reponse)).then(suite)
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
    nom_fichier: 'avis.pdf', categorie: 'cotisation', sous_dossier_id: null, attached_to_cotisation_id: null, 
    created_at: '2026-01-05T09:00:00Z', ...o,
  }
}

const monter = () => render(
  <AvecExercicesValides annees={[]}><CotisationsTab dossierId="dossier-de-test" modele={{ mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }} /></AvecExercicesValides>,
)

beforeEach(() => {
  faux.cotisations = [cotisation()]
  faux.documents = [avis()]
  faux.refusMaj = null
  faux.portes = []
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

// UNE RELECTURE PLUS LENTE N'ÉCRIT PLUS EN DERNIER (audit des courses du 28/11/2026, lib/derniereLecture.ts). Rattacher un avis
// relit l'onglet sans attendre la relecture, et le formulaire « Ajouter une échéance » reste offert pendant qu'elle court : la
// relecture du rattachement, partie AVANT l'ajout, revenait APRÈS celle de l'ajout — et l'échéance ajoutée, écrite en base,
// disparaissait de l'écran (on la ressaisissait : un doublon). Rouge sur le code d'avant.
describe('CotisationsTab — deux relectures qui se chevauchent', () => {
  it('la relecture partie la première, revenue la dernière, n’écrit rien', async () => {
    monter()
    const liste = await screen.findByDisplayValue('Attacher…')
    let ouvrirLaPremiere = () => {}
    let ouvrirLaSeconde = () => {}
    faux.portes = [new Promise((r) => { ouvrirLaPremiere = r }), new Promise((r) => { ouvrirLaSeconde = r })]
    await act(async () => { fireEvent.change(liste, { target: { value: 'doc-avis' } }) })
    fireEvent.change(screen.getByLabelText('Échéance'), { target: { value: '2026-09-05' } })
    fireEvent.change(screen.getByLabelText('Montant appelé'), { target: { value: '300' } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('Échéance').closest('form')!) })
    expect(faux.portes).toHaveLength(0)
    // La plus récente revient d'abord : l'avis est joint, et l'échéance ajoutée paraît.
    await act(async () => { ouvrirLaSeconde() })
    expect(await screen.findByText('05/09/2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Détacher' })).toBeTruthy()
    // La plus ancienne revient ensuite : elle ne connaissait pas l'échéance ajoutée, et ne remplace rien.
    await act(async () => { ouvrirLaPremiere() })
    expect(screen.getByText('05/09/2026')).toBeTruthy()
    expect(faux.cotisations).toHaveLength(2)
  })
})
