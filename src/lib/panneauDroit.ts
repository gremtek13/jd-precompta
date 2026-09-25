// Le panneau contextuel de droite (voir components/PanneauDroit.tsx) : UN seul emplacement dans la
// coque, où un écran affiche ce qui accompagne le travail en cours — l'assistant d'abord, puis la
// fiche d'une pièce et le rapprochement bancaire (étape 2 de l'interface d'ordinateur).
//
// Deux choses sont partagées, et seulement deux. L'élément du volet, où les contenus se rendent par un
// PORTAIL : ils restent dans l'arbre React de l'écran qui les ouvre, donc gardent son état et ses
// contextes (l'exercice sélectionné, par exemple), ce qu'un contenu confié à la coque perdrait. Et le
// NOM de celui qui l'occupe : un seul contenu à la fois, comme dans la maquette validée — ouvrir la
// fiche d'une pièce pendant que l'assistant est ouvert la met à sa place, deux contenus empilés dans
// 440 pixels ne se liraient ni l'un ni l'autre.
import { createContext, useCallback, useContext, type Dispatch, type SetStateAction } from 'react'

export interface ContextePanneauDroit {
  cible: HTMLElement | null
  setCible: (element: HTMLElement | null) => void
  occupant: string | null
  setOccupant: Dispatch<SetStateAction<string | null>>
}

// Pas de valeur par défaut qui ferait semblant : sans la coque, « Assistant » ne pourrait rien ouvrir,
// et un bouton qui ne fait rien a exactement la tête d'un bouton cassé. Mieux vaut lever tout de suite.
export const PanneauDroitContexte = createContext<ContextePanneauDroit | null>(null)

export function usePanneauDroitContexte(): ContextePanneauDroit {
  const contexte = useContext(PanneauDroitContexte)
  if (!contexte) throw new Error('Panneau de droite utilisé hors de la coque (FournisseurPanneauDroit).')
  return contexte
}

export function usePanneauDroit(nom: string) {
  const { occupant, setOccupant } = usePanneauDroitContexte()
  const ouvrir = useCallback(() => setOccupant(nom), [nom, setOccupant])
  // Ne ferme QUE s'il occupe encore le volet : un contenu remplacé entre-temps ne doit pas, en se
  // fermant, faire disparaître celui qui a pris sa place.
  const fermer = useCallback(() => setOccupant((o) => (o === nom ? null : o)), [nom, setOccupant])
  const basculer = useCallback(() => setOccupant((o) => (o === nom ? null : nom)), [nom, setOccupant])
  return { ouvert: occupant === nom, ouvrir, fermer, basculer }
}
