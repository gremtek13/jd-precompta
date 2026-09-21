import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import VehiculesCard from './VehiculesCard'

// Premier test d'ÉCRAN du dépôt. Il existe parce que les défauts qu'il vise ne sont visibles dans
// aucun test de src/lib : la logique appelée derrière était juste dans les deux cas.
//
// Le faux client Supabase est déclaré par `vi.hoisted` et non par un simple `const` : `vi.mock` est
// remonté en tête de fichier, mais les imports ESM sont évalués AVANT le corps du module — la
// fabrique du mock lirait donc une variable encore en zone morte.
const faux = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  // La promesse de l'insertion est gardée en attente : c'est l'attente réseau réelle, celle
  // pendant laquelle un second clic arrive. La résoudre tout de suite supprimerait la fenêtre
  // même que le verrou est censé fermer.
  resoudreInsert: null as null | (() => void),
  // Les véhicules déjà enregistrés, pour exercer la LIGNE — donc son bouton « Retirer ».
  vehicules: [] as Record<string, unknown>[],
  suppressions: 0,
}))

// Une chaîne NEUVE par appel, et non une seule partagée par le module : un `delete()` laisserait
// sinon la chaîne en mode suppression pour tous les appels suivants, et la lecture qui suit
// rendrait un résultat de suppression.
vi.mock('../../lib/supabase', () => {
  const fabriquer = () => {
  const chaine: Record<string, unknown> = {}
  let suppression = false
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => (suppression ? Promise.resolve({ error: null }) : chaine),
    delete: () => { suppression = true; faux.suppressions += 1; return chaine },
    order: () => chaine,
    // `range` et le `count` annoncé sont indispensables depuis que la liste est lue par tranches
    // (voir lib/lectureComplete.ts) : sans `range` la chaîne casse, et sans compte annoncé toute
    // lecture se déclare INCOMPLÈTE — l'écran afficherait alors une erreur permanente.
    range: () => chaine,
    // Le chaînage est « thenable » : `await supabase.from(...).select(...)...` passe par ici.
    then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: faux.vehicules, error: null, count: faux.vehicules.length }).then(suite),
    insert: (valeur: Record<string, unknown>) => {
      faux.inserts.push(valeur)
      return new Promise((resoudre) => {
        faux.resoudreInsert = () => resoudre({ data: null, error: null })
      })
    },
  })
    return chaine
  }
  return { supabase: { from: () => fabriquer() } }
})

function monter(annee: number | 'toutes') {
  return render(
    <AnneeProvider defaut={annee}>
      <VehiculesCard dossierId="dossier-de-test" />
    </AnneeProvider>,
  )
}

describe('VehiculesCard', () => {
  it("n'ajoute qu'un véhicule quand le bouton est cliqué deux fois de suite", async () => {
    faux.inserts.length = 0
    monter(2025)
    const bouton = await screen.findByRole('button', { name: /Ajouter un véhicule sur 2025/ })

    // Les deux clics partent dans le MÊME `act`, et c'est tout l'enjeu du test. Deux
    // `fireEvent.click` de suite ne reproduisent PAS un double clic : chacun ouvre son propre `act`,
    // qui rend le composant en sortant — le second clic tombe donc sur un bouton déjà re-rendu, avec
    // un état à jour. Écrit ainsi, ce test restait vert en remettant le verrou dans un `useState`,
    // c'est-à-dire avec le défaut de production réinstallé. Vu par mutation, pas par relecture.
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.inserts).toHaveLength(1)
    expect(faux.inserts[0]).toEqual({ dossier_id: 'dossier-de-test', annee: 2025 })

    faux.resoudreInsert?.()
    await waitFor(() => expect(screen.getByRole('button', { name: /Ajouter un véhicule/ })).toBeDefined())
  })

  it("ne propose aucun ajout tant qu'aucun exercice n'est choisi", async () => {
    faux.inserts.length = 0
    monter('toutes')

    // La carte retombait sur l'année civile en cours : des kilomètres partaient alors sur un
    // exercice que personne n'avait demandé. Elle propose désormais les exercices au lieu d'en
    // choisir un — et n'écrit rien tant que le choix n'est pas fait.
    await screen.findByText(/Choisis l'exercice à renseigner/)
    expect(screen.queryByRole('button', { name: /Ajouter un véhicule/ })).toBeNull()
    expect(faux.inserts).toHaveLength(0)
  })
})

describe('retirer un véhicule : ce qui part se dit AVANT de partir', () => {
  // Le bouton « Retirer » vit dans la MÊME ligne que le champ des kilomètres qu'on vient d'éditer,
  // et il partait sans rien demander. Ces kilomètres sont saisis à la main et décident de la case
  // BJ de la 2035 : effacés par distraction, la déduction disparaît sans que personne ne la
  // cherche. C'était la seule suppression de données saisies du projet sans confirmation.
  function poserUnVehicule() {
    faux.vehicules = [{
      id: 'v1', dossier_id: 'dossier-de-test', annee: 2025, modele: 'Peugeot 308', type: 'voiture',
      puissance_fiscale: 6, bareme: 'bnc', motorisation: 'thermique', carburant: 'diesel',
      km_professionnel: 12000, inscrit_immobilisations: false, created_at: '2026-01-05T10:00:00Z',
    }]
    faux.suppressions = 0
  }

  it('ne supprime rien quand la confirmation est refusée', async () => {
    poserUnVehicule()
    window.confirm = () => false
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(faux.suppressions).toBe(0)
  })

  it('NOMME le véhicule et ses kilomètres dans la question posée', async () => {
    // « Êtes-vous sûr ? » se ferme en un clic aussi distrait que le premier : le message doit dire
    // ce qu'on perd, comme partout ailleurs dans ce projet.
    poserUnVehicule()
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })

    expect(question).toContain('Peugeot 308')
    expect(question).toContain('12000')
    expect(question).toContain('2025')
  })

  it('supprime quand la confirmation est acceptée', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « on ne supprime pas sans confirmation » serait satisfait par
    // un bouton qui ne supprime JAMAIS.
    poserUnVehicule()
    window.confirm = () => true
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(faux.suppressions).toBe(1)
  })
})
