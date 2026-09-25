import { act, fireEvent, render, screen } from '@testing-library/react'
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
  // Le serveur qui cesse de rendre au-delà de N échéances en annonçant le vrai total : la panne
  // qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts).
  muetCotisations: null as number | null,
  insertions: [] as { table: string; valeur: unknown }[],
  // Ce que « lit » la fausse extraction d'un avis d'appel : son échéancier.
  echeancesLues: [] as { date: string; montant: number; previsionnel: boolean }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let operation = 'select'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { operation = 'delete'; return chaine },
        insert: (valeur: unknown) => { operation = 'insert'; faux.insertions.push({ table, valeur }); return chaine },
        update: () => chaine,
        eq: (colonne: string, valeur: unknown) => {
          if (operation === 'delete' && colonne === 'id') faux.suppressions.push(valeur)
          return chaine
        },
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          if (operation === 'delete' || operation === 'insert') return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
          const lignes = table === 'cotisations_declarees' ? faux.cotisations : []
          if (table === 'cotisations_declarees' && faux.muetCotisations != null) {
            const rendu = lignes.slice(debut, Math.min(fin + 1, faux.muetCotisations))
            return Promise.resolve({ data: rendu, error: null, count: lignes.length }).then(suite)
          }
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
  extractPiece: () => Promise.resolve({ lecture_cotisation: { echeances: faux.echeancesLues } }),
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

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. La création d'un échéancier lu sur un avis d'appel
// écarte les échéances déjà enregistrées — celles qu'on a LUES. Sur une liste tronquée, une échéance
// déjà créée l'était une seconde fois, et la cotisation comptait double dans la 2035 (case BK).
describe('CotisationsTab — créer l’échéancier lu sur un avis d’appel', () => {
  async function deposerAvis() {
    faux.echeancesLues = [
      { date: '2026-03-05', montant: 420, previsionnel: false },
      { date: '2026-04-05', montant: 420, previsionnel: false },
    ]
    render(<CotisationsTab dossierId="dossier-de-test" />)
    const champ = document.querySelector('input[type=file][accept=".pdf,.jpg,.jpeg,.png"]') as HTMLInputElement
    await screen.findByText(/Ajouter une échéance/)
    const fichier = new File(['%PDF'], 'avis-urssaf.pdf', { type: 'application/pdf' })
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Créer ces 2 échéance\(s\)/ })
  }

  function reinitialiser() {
    faux.cotisations = [cotisation({ id: 'cot-1', echeance: '2026-03-05' })]
    faux.suppressions = []
    faux.insertions = []
    faux.muetCotisations = null
  }

  it('se suspend sur des échéances lues à moitié, et ne crée rien', async () => {
    reinitialiser()
    // L'échéance du 05/03 est en base, mais la lecture n'en rend rien : elle paraîtrait nouvelle.
    faux.muetCotisations = 0
    const bouton = await deposerAvis()

    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Création suspendue/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'cotisations_declarees')).toHaveLength(0)
  })

  it('crée, sur une lecture complète, la seule échéance qui manque', async () => {
    // Le garde symétrique : sans lui, « la création se suspend » serait satisfait par un bouton qui
    // ne crée JAMAIS.
    reinitialiser()
    const bouton = await deposerAvis()
    expect(screen.queryByText(/Création suspendue/)).toBeNull()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    await act(async () => { bouton.click() })

    const creees = faux.insertions.filter((i) => i.table === 'cotisations_declarees')
    expect(creees).toHaveLength(1)
    expect(creees[0].valeur).toEqual([expect.objectContaining({ echeance: '2026-04-05', montant_appele: 420 })])
  })

  it("trois clics rapprochés ne créent l'échéancier qu'une fois", async () => {
    reinitialiser()
    const bouton = await deposerAvis()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions.filter((i) => i.table === 'cotisations_declarees')).toHaveLength(1)
  })
})
