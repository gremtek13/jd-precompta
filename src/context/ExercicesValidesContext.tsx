import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ExerciceValide } from '../lib/types'
import { frontiereDeValidation } from '../lib/validationExercice'

// LES EXERCICES VALIDÉS D'UN DOSSIER, partagés entre ses onglets (ligne 26.6, étape d). La validation fige
// tout ce qui précède le 31 décembre du dernier exercice validé — la FRONTIÈRE (lib/validationExercice.ts).
// Chaque écran qui écrit, ou qui compare le brouillon à ce qu'il devrait être, doit la connaître : sans elle,
// il proposerait un geste que la base refuse, ou crierait « à régénérer » sur une écriture validée que rien ne
// réécrira plus. Lus UNE fois par la page du dossier, avec son identité et ses années (DossierDetail), et
// relus après chaque validation (`relire`) : la table porte une ligne par exercice validé, et un onglet qui la
// lirait lui-même ne l'apprendrait qu'à son prochain montage.
export interface ExercicesValides {
  exercices: readonly ExerciceValide[]
  anneesValidees: readonly number[]
  // Le 31 décembre du dernier exercice validé, ou rien.
  frontiere: string | null
  relire: () => Promise<void>
}

const Contexte = createContext<ExercicesValides | null>(null)

export function ExercicesValidesProvider({ exercices, relire, children }: {
  exercices: readonly ExerciceValide[]
  relire: () => Promise<void>
  children: ReactNode
}) {
  const valeur = useMemo(() => {
    const anneesValidees = exercices.map((e) => e.annee)
    return { exercices, anneesValidees, frontiere: frontiereDeValidation(anneesValidees), relire }
  }, [exercices, relire])
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

// Hors de la page d'un dossier, il n'y a rien à lire : lever vaut mieux que de supposer qu'aucun exercice n'est
// validé — l'écran proposerait alors de modifier ce que la validation a figé.
export function useExercicesValides(): ExercicesValides {
  const valeur = useContext(Contexte)
  if (!valeur) throw new Error("useExercicesValides() doit être utilisé à l'intérieur d'un <ExercicesValidesProvider> (voir DossierDetail).")
  return valeur
}
