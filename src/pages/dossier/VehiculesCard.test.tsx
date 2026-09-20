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
}))

vi.mock('../../lib/supabase', () => {
  const chaine: Record<string, unknown> = {}
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    // `range` et le `count` annoncé sont indispensables depuis que la liste est lue par tranches
    // (voir lib/lectureComplete.ts) : sans `range` la chaîne casse, et sans compte annoncé toute
    // lecture se déclare INCOMPLÈTE — l'écran afficherait alors une erreur permanente.
    range: () => chaine,
    // Le chaînage est « thenable » : `await supabase.from(...).select(...)...` passe par ici.
    then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
    insert: (valeur: Record<string, unknown>) => {
      faux.inserts.push(valeur)
      return new Promise((resoudre) => {
        faux.resoudreInsert = () => resoudre({ data: null, error: null })
      })
    },
  })
  return { supabase: { from: () => chaine } }
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
