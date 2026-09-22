import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinancementTab from './FinancementTab'
import type { Categorie, Immobilisation, Piece } from '../../lib/types'

// LE CALCUL EST DANS `lib/situationIntermediaire.ts`, TESTÉ — CE QUI SE JOUE ICI EST LA PÉRIODE.
//
// Cet état porte en tête « Période du 1er janvier au <date choisie> » et part dans un dossier
// bancaire. La ligne « Amortissements » y comptait une ANNÉE ENTIÈRE de dotation quelle que soit
// cette date : au 31 janvier, un bien de 12 000 € sur 5 ans suffisait à afficher un résultat
// négatif sur des recettes bien positives.
//
// Aucun test de `src/lib` ne garde ce que la MODALE passe comme période : le même écran appelle la
// même fonction sur une année civile complète pour préremplir le prévisionnel, donc les deux usages
// coexistent et rien n'empêche l'un de prendre les bornes de l'autre.
const faux = vi.hoisted(() => ({
  pieces: [] as unknown[],
  categories: [] as unknown[],
  immobilisations: [] as unknown[],
}))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c, eq: () => c, or: () => c, order: () => c, range: () => c,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (suite: (r: unknown) => unknown) => {
        const donnees = table === 'pieces' ? faux.pieces
          : table === 'categories' ? faux.categories
          : table === 'immobilisations' ? faux.immobilisations : []
        return Promise.resolve({ data: donnees, error: null, count: donnees.length }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// Typé sans `as` : le compilateur vérifie chaque champ contre la table (voir CLAUDE.md, quatre
// écrans où cette contrainte a mordu avant qu'un test n'ait tourné).
function recette(o: Partial<Piece> = {}): Piece {
  return {
    id: 'v1', dossier_id: 'd', uploaded_by: null, source: 'upload',
    storage_path: 'd/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-05-10', tiers: 'CPAM', montant_ht: 10000, montant_tva: null,
    montant_ttc: 10000, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: 'cat-recettes', sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null,
    superpdp_invoice_id: null, created_at: '2026-05-10T09:00:00Z', updated_at: '2026-05-10T09:00:00Z',
    ...o,
  }
}

const CATEGORIE: Categorie = {
  id: 'cat-recettes', dossier_id: null, code: '706', libelle: 'Recettes', ordre: 1,
  compte_comptable: '706000', poste_2035: 'Recettes',
}

function immobilisation(o: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: 'i1', dossier_id: 'd', piece_id: null, nature_id: null, libelle: 'Matériel',
    valeur: 12000, duree_annees: 5, date_acquisition: '2026-01-05', ...o,
  } as Immobilisation
}

async function ouvrirLaSituation(au: string) {
  render(<FinancementTab dossierId="d" />)
  const titre = await screen.findByRole('heading', { name: 'Situation intermédiaire', level: 3 })
  await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
  // La date par défaut est « aujourd'hui » : on la fixe, sinon le test dirait autre chose chaque mois.
  await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: au } }) })
  return screen.getByRole('heading', { name: 'Situation intermédiaire', level: 2 }).closest('.card') as HTMLElement
}

// Le montant lu sur la LIGNE du poste, pas n'importe où dans la modale : les tuiles « Charges » et
// « Résultat » portent les mêmes chiffres, donc une recherche globale trouve plusieurs éléments et
// ne dit pas lequel elle a vu.
function totalDuPoste(modale: HTMLElement, poste: string): string | null {
  const cellule = within(modale).queryAllByRole('cell', { name: poste })[0]
  return cellule ? (cellule.nextElementSibling?.textContent ?? null) : null
}

afterEach(() => { vi.useRealTimers() })

describe('FinancementTab — situation intermédiaire', () => {
  it('rapporte la dotation à la période de l’état, pas à l’année', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation()]

    const modale = await ouvrirLaSituation('2026-06-30')

    // 12 000 € / 5 ans = 2 400 € par an, donc 1 200 € sur un premier semestre — et non 2 400.
    expect(totalDuPoste(modale, 'Amortissements')).toMatch(/^-1\s?200,00\s€$/)
    // Résultat 10 000 − 1 200, et non 10 000 − 2 400.
    expect(within(modale).getByText(/^8\s?800,00\s€$/)).toBeTruthy()
  })

  it('part du 1er janvier de l’exercice, pas plus tôt', async () => {
    // L'autre borne de la période. Trouvé par mutation : faire démarrer l'état un an plus tôt
    // laissait les cas ci-dessus entièrement verts, faute d'une pièce de l'année précédente dans le
    // jeu d'essai. Une période qui déborde sur l'exercice d'avant gonfle les recettes d'un état
    // qu'une banque lit comme « depuis le 1er janvier ».
    faux.pieces = [recette(), recette({ id: 'v-2025', date_piece: '2025-11-10', montant_ttc: 4000, montant_ht: 4000 })]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []

    const modale = await ouvrirLaSituation('2026-06-30')

    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^10\s?000,00\s€$/)
  })

  it('n’amortit pas un bien acquis après la date de l’état', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation({ date_acquisition: '2026-12-15' })]

    const modale = await ouvrirLaSituation('2026-06-30')

    expect(totalDuPoste(modale, 'Amortissements')).toBeNull()
    expect(within(modale).getAllByText(/^10\s?000,00\s€$/).length).toBeGreaterThan(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la dotation est plus petite » serait satisfait par un écran qui
  // n'affiche jamais d'amortissement du tout.
  it('affiche bien la dotation entière sur une année civile complète', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation()]

    const modale = await ouvrirLaSituation('2026-12-31')

    expect(totalDuPoste(modale, 'Amortissements')).toMatch(/^-2\s?400,00\s€$/)
  })

  // LE DIVISEUR QUI ANNUALISE LA CAF, et l'étiquette qui l'annonce.
  //
  // L'écran lisait `new Date().getMonth() + 1` — le NUMÉRO du mois courant — et l'écrivait tel quel
  // sous les ratios : « sur 9 mois écoulés cette année » un 1er septembre, quand huit le sont. Le
  // nombre n'est exact que le DERNIER jour de chaque mois, et il DIVISE la CAF : au 1er février, la
  // valeur annoncée valait la moitié de la juste, sur un chiffre montré à une banque.
  //
  // Le temps est FIXÉ ici : lu sur l'horloge, ce test dirait autre chose chaque jour — et serait
  // juste par hasard le 30 du mois, c'est-à-dire précisément le jour où l'ancien calcul l'était.
  it('annonce les mois réellement écoulés, pas le numéro du mois', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026, midi (heure locale)
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []

    render(<FinancementTab dossierId="d" />)

    // Le libellé est coupé en plusieurs nœuds par le `<strong>` du montant : on lit le texte du
    // paragraphe entier plutôt qu'un nœud, sinon le test échoue pour une raison qui n'est pas la
    // sienne.
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })

    // Le libellé est coupé en plusieurs nœuds par le `<strong>` du montant : on lit le texte du
    // paragraphe entier plutôt qu'un nœud, sinon le test échoue pour une raison qui n'est pas la
    // sienne.
    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/sur 8,0 mois écoulés cette année/)
    expect(ligne).not.toMatch(/sur 9,0/)
  })
})

