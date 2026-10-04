import type { ReactNode } from 'react'
import type { ValeurAnnee } from '../components/AnneeTabs'
import { AnneeProvider } from '../context/AnneeContext'
import { ExercicesValidesProvider } from '../context/ExercicesValidesContext'
import { exerciceValide } from './exerciceValide'

// Les exercices validés que la page d'un dossier fournit à ses onglets (DossierDetail) : un test d'onglet les
// fournit lui-même, comme il fournit l'exercice choisi.
export function AvecExercicesValides({ annees = [], relire = async () => {}, children }: {
  annees?: readonly number[]
  relire?: () => Promise<void>
  children: ReactNode
}) {
  return (
    <ExercicesValidesProvider exercices={annees.map((a) => exerciceValide(a))} relire={relire}>
      {children}
    </ExercicesValidesProvider>
  )
}

// Ce que la page d'un dossier fournit à un onglet qui partage l'exercice ET lit les exercices validés : les deux
// contextes, dans l'ordre où la page les pose.
export function ContexteDossier({ annee, valides, relire, children }: {
  annee: ValeurAnnee
  valides?: readonly number[]
  relire?: () => Promise<void>
  children: ReactNode
}) {
  return (
    <AvecExercicesValides annees={valides} relire={relire}>
      <AnneeProvider defaut={annee}>{children}</AnneeProvider>
    </AvecExercicesValides>
  )
}
