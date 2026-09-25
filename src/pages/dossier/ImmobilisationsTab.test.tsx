import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImmobilisationsTab from './ImmobilisationsTab'
import type { Immobilisation, Piece } from '../../lib/types'

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
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // L'erreur que rend la base à une insertion — telle que supabase-js la rend : un objet NU, jamais
  // une instance d'`Error` (voir lib/messageErreur.ts).
  refusInsertion: null as Record<string, unknown> | null,
  insertions: 0,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      let insertion = false
      Object.assign(chaine, {
        select: () => chaine,
        insert: () => { insertion = true; faux.insertions++; return chaine },
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number }) => unknown) => {
          if (insertion) return Promise.resolve({ data: null, error: faux.refusInsertion, count: 0 }).then(suite)
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

function poser(immos: Immobilisation[], pieces: unknown[] = []) {
  faux.parTable = { pieces, immobilisations: immos, natures_immobilisation: [] }
  faux.refusInsertion = null
  faux.insertions = 0
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

// LA CONFIRMATION DE RETRAIT PROMETTAIT UNE PIÈCE QUI N'EXISTE PLUS.
//
// « La pièce redevient une charge courante ordinaire » suppose qu'il RESTE une pièce. Sur une
// immobilisation dont le justificatif a été supprimé — l'état que `immobilisationSansJustificatif`
// signale, et dont l'action recommandée par la Checklist EST ce bouton — la phrase est fausse dans
// le sens qui rassure : rien ne redevient une charge, et le retrait efface la DERNIÈRE trace
// comptable de la dépense, l'amortissement quittant la case CH sans qu'aucune charge le remplace.
//
// L'opérateur qui suit le conseil de mon propre contrôle lisait donc un mensonge. Même famille que
// l'alerte de `PiecesTab`, qui inventait une cause de blocage impossible : une mise en garde se
// vérifie contre ce que le code fait, pas contre ce qu'elle a voulu dire.
describe('ImmobilisationsTab — ce que la confirmation de retrait promet', () => {
  function cliquerRetirer(libelle: string) {
    const ligne = screen.getByText(libelle).closest('tr')!
    fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' }))
  }

  it('annonce le retour en charge courante quand le justificatif est là', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la confirmation dit le cas détaché » serait satisfait par un
    // écran qui annoncerait TOUJOURS la disparition de la dépense, y compris sur le cas normal.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    poser([immobilisation({ libelle: 'Ordinateur' })])
    monter()
    await screen.findByText('Ordinateur')

    cliquerRetirer('Ordinateur')
    expect(confirm.mock.calls[0][0]).toMatch(/redevient une charge courante ordinaire/)
    confirm.mockRestore()
  })

  it('dit que la dépense ne sera plus comptée nulle part quand le justificatif a été supprimé', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    poser([immobilisation({ libelle: 'Ordinateur', piece_id: null })])
    monter()
    await screen.findByText('Ordinateur')

    cliquerRetirer('Ordinateur')
    const message = String(confirm.mock.calls[0][0])
    expect(message).toMatch(/justificatif a déjà été supprimé/)
    expect(message).toMatch(/plus comptée nulle part/)
    // Et surtout : la phrase FAUSSE ne doit plus être là. C'est elle le défaut, pas l'absence de
    // la nouvelle — un message qui dirait les deux rassurerait encore.
    expect(message).not.toMatch(/redevient une charge courante ordinaire/)
    confirm.mockRestore()
  })
})

// UN MESSAGE QUI NE POUVAIT PAS S'AFFICHER. La pièce déjà immobilisée — deux onglets, un double clic,
// ou une liste lue à moitié qui la remet parmi les candidates — se heurte à la contrainte unique sur
// `piece_id`. L'écran prévoyait une phrase pour ce cas, derrière `err instanceof Error` : or l'erreur
// arrive en objet Postgrest NU, donc la phrase n'a jamais paru, et l'opérateur lisait « duplicate key
// value violates unique constraint ».
describe('ImmobilisationsTab — une pièce déjà enregistrée', () => {
  // Typée sans `as`, comme les autres jeux d'essai d'écran : le compilateur confronte chaque champ
  // à la table.
  const candidate: Piece = {
    id: 'piece-2', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2025-04-02', tiers: 'MATÉRIEL MÉDICAL', montant_ht: 1500, montant_tva: 300,
    montant_ttc: 1800, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-04-02T09:00:00Z', updated_at: '2025-04-02T09:00:00Z',
  }

  it('le dit en clair, à la place du message de Postgres', async () => {
    poser([], [candidate])
    faux.refusInsertion = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "immobilisations_piece_id_unique"',
      details: 'Key (piece_id)=(piece-2) already exists.',
      hint: null,
    }
    monter()

    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await screen.findByText('Cette pièce a déjà été enregistrée comme immobilisation.')
    expect(screen.queryByText(/duplicate key value/)).toBeNull()
  })

  it('laisse passer telle quelle une autre erreur', async () => {
    // Le garde symétrique : sans lui, « la phrase amicale s'affiche » serait satisfait par un écran
    // qui l'afficherait sur N'IMPORTE QUEL refus — et un refus de droits se lirait « déjà enregistrée ».
    poser([], [candidate])
    faux.refusInsertion = { code: '42501', message: 'new row violates row-level security policy for table "immobilisations"', details: null, hint: null }
    monter()

    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await screen.findByText(/row-level security/)
    expect(screen.queryByText('Cette pièce a déjà été enregistrée comme immobilisation.')).toBeNull()
  })
})
