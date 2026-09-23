import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImmobilisationsTab from './ImmobilisationsTab'
import type { Immobilisation } from '../../lib/types'

// LA COLONNE « DOTATION ANNUELLE » A TOUTES LES APPARENCES D'UNE ANNUITÉ CALCULÉE.
//
// Elle affiche `valeur / duree_annees`, pleine dès l'année d'acquisition, là où l'amortissement
// fiscal se calcule prorata temporis depuis la mise en service. La simplification est assumée et
// écrite dans `types.ts` ; ce qui ne l'était pas, c'est le silence. Le commentaire d'en-tête de cet
// écran renvoyait à « le bandeau » — lequel est le rappel générique « Brouillon », affiché sur tous
// les écrans du projet et muet sur la première annuité. La réserve ne vivait donc que dans une
// source que personne n'ouvre en remplissant une déclaration.
//
// Ce que ce test garde et qu'aucun test de `src/lib` ne peut garder : que l'écran APPELLE le calcul,
// et sur quel ensemble il l'appelle.
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]> }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, Math.min(debut + (fin - debut + 1), toutes.length)),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// Typé `Partial<Immobilisation> => Immobilisation` SANS `as` : le compilateur vérifie alors chaque
// champ contre la table, exhaustivement. C'est ce qui a trouvé, sur trois autres écrans, des jeux
// d'essai qui posaient des valeurs que la production ne produit jamais.
//
// ET SON DÉFAUT ÉTAIT INFIDÈLE : `piece_id: null`, alors que cet écran n'a qu'UN chemin de création
// et qu'il pose toujours le lien — un `piece_id` nul ne peut venir que d'une pièce supprimée. C'était
// INERTE tant que rien ne lisait ce champ ; depuis `immobilisationSansJustificatif`, chaque ligne du
// jeu d'essai porterait la pastille « Justificatif supprimé ». Même famille que le `devise: null` de
// ChecklistTab : un jeu d'essai infidèle ne fait pas qu'affaiblir un test, il lui fait prouver autre
// chose.
const immobilisation = (o: Partial<Immobilisation> = {}): Immobilisation => ({
  id: 'i-1', dossier_id: 'dossier-de-test', piece_id: 'piece-1', nature_id: null,
  libelle: 'Ordinateur', valeur: 12000, date_acquisition: '2025-01-01', duree_annees: 5,
  created_at: '2025-01-01T09:00:00Z', ...o,
})

function poser(immos: Immobilisation[]) {
  faux.parTable = { pieces: [], immobilisations: immos, natures_immobilisation: [] }
}

const monter = () => render(<ImmobilisationsTab dossierId="dossier-de-test" />)

const TITRE = /Première annuité à reprendre/

describe('ImmobilisationsTab — la première annuité à reprendre', () => {
  it('chiffre l’écart d’un bien acquis en cours d’année', async () => {
    poser([immobilisation({ date_acquisition: '2025-07-01' })])
    monter()

    const titre = await screen.findByText(/Première annuité à reprendre \(1\)/)
    // Borné à la carte : la dotation comptée figure AUSSI dans la colonne « Dotation annuelle » du
    // registre, juste en dessous — c'est d'ailleurs exactement le chiffre que la réserve qualifie.
    const carte = within(titre.closest('.card')!)
    carte.getByText(/prorata temporis/)
    // `\s` : `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable (U+202F).
    carte.getByText(/^2\s400,00\s€$/)
    carte.getByText(/^1\s200,00\s€$/)
  })

  it('se tait sur un registre entièrement acquis le 1er janvier', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran avertit » serait satisfait par un écran qui avertit
    // TOUJOURS, et une mise en garde permanente cesse d'être lue avant d'emporter ses voisines.
    poser([immobilisation()])
    monter()

    // Ancré sur une ligne que ce jeu de données produit forcément : sans ancre, un écran encore en
    // chargement rendrait le test vert pour une raison fausse.
    await screen.findByText('Ordinateur')
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it('NE FAIT PAS DISPARAÎTRE la réserve quand une recherche masque le bien', async () => {
    // Le point du test, et la moitié de la règle du projet qu'on oublie : « une recherche filtre
    // l'affichage, jamais un total » a été violée deux fois, dans les deux sens — la Balance des
    // comptes fabriquait une ALERTE, la liste des dossiers une BONNE nouvelle. La seconde est pire,
    // personne n'allant vérifier une bonne nouvelle. Calculer la réserve sur l'ensemble d'APRÈS la
    // recherche la ferait disparaître d'un mot tapé, sur un écran qui alimente une 2035 signée.
    poser([
      immobilisation({ id: 'a', libelle: 'Véhicule', date_acquisition: '2025-07-01' }),
      immobilisation({ id: 'b', libelle: 'Bureau', date_acquisition: '2025-01-01' }),
    ])
    monter()

    await screen.findByText(/Première annuité à reprendre \(1\)/)

    const recherche = screen.getByPlaceholderText(/Rechercher un libellé/)
    fireEvent.change(recherche, { target: { value: 'Bureau' } })

    // Le registre ne montre plus que « Bureau »…
    expect(screen.queryAllByText('Véhicule')).toHaveLength(1) // seulement dans la carte de réserve
    // …et la réserve, elle, tient toujours, en NOMMANT le bien à retrouver.
    const titre = screen.getByText(/Première annuité à reprendre \(1\)/)
    within(titre.closest('.card')!).getByText('Véhicule')
  })

  it('suit en revanche le filtre d’exercice, qui est un cadrage choisi et visible', async () => {
    // La différence avec la recherche : l'exercice est sélectionné dans un onglet affiché juste
    // au-dessus, et le registre n'en montre que cette année-là. Une réserve qui parlerait d'un
    // exercice absent du tableau enverrait chercher un bien qu'on ne voit pas.
    poser([
      immobilisation({ id: 'a', libelle: 'Véhicule', date_acquisition: '2025-07-01' }),
      immobilisation({ id: 'b', libelle: 'Bureau', date_acquisition: '2024-03-01' }),
    ])
    monter()

    await screen.findByText(/Première annuité à reprendre \(2\)/)

    fireEvent.click(screen.getByRole('tab', { name: '2024' }))
    const titre = await screen.findByText(/Première annuité à reprendre \(1\)/)
    within(titre.closest('.card')!).getByText('Bureau')
  })
})

// LA TROISIÈME CLÉ EN `ON DELETE SET NULL` DE `pieces`. Supprimer une pièce immobilisée détache son
// immobilisation sans un mot, et le registre affichait la dotation comme si de rien n'était — alors
// que `calculerDeclaration2035` la totalise en case CH d'une 2035 signée, et que la piste d'audit
// ne couvre pas les immobilisations.
describe('ImmobilisationsTab — une immobilisation dont le justificatif a été supprimé', () => {
  it('le dit sur la ligne', async () => {
    poser([immobilisation({ piece_id: null, libelle: 'Ordinateur' })])
    monter()

    await screen.findByText('Justificatif supprimé')
  })

  // GARDE SYMÉTRIQUE : sans elle, « la ligne le dit » serait satisfait par un écran qui le dit de
  // TOUTES les lignes — et le registre entier deviendrait rouge sur un dossier en ordre.
  //
  // ET ELLE S'APPUIE SUR LE DÉFAUT DE LA FABRIQUE, délibérément : sans cela, corriger ce défaut
  // n'était gardé par rien — la mutation qui le remet à `null` laissait les 100 tests VERTS, parce
  // que les autres tests du fichier n'assertent rien sur la pastille. Un jeu d'essai infidèle
  // redevient alors inerte, ce qui est exactement la forme du défaut d'origine.
  it('se tait sur une immobilisation qui désigne bien sa pièce', async () => {
    poser([immobilisation({ libelle: 'Ordinateur' })])
    monter()

    await screen.findByText('Ordinateur')
    expect(screen.queryAllByText('Justificatif supprimé')).toHaveLength(0)
  })
})
