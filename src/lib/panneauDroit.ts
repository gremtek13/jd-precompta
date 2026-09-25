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
//
// Et une GARDE DE SORTIE, parce que le volet laisse le reste de l'écran cliquable — c'est tout son
// intérêt, et c'est ce que la fenêtre qu'il remplace interdisait. Une fiche de pièce en cours de
// saisie peut donc être chassée par un clic sur une autre ligne, sur « Assistant » ou sur la croix,
// et sa saisie partirait sans un mot. Le contenu affiché pose sa garde (`useGardePanneau`) ; elle est
// consultée avant qu'un AUTRE contenu prenne sa place ou qu'on le ferme, et peut refuser.
import { createContext, useCallback, useContext, useEffect, type Dispatch, type SetStateAction } from 'react'

// La garde du contenu qui occupe le volet. Tenue par le fournisseur, qui seul la possède : les contenus
// la posent et la retirent, les ouvertures la consultent.
export interface GardesPanneau {
  consulter: () => boolean
  poser: (garde: () => boolean) => void
  retirer: (garde: () => boolean) => void
}

export interface ContextePanneauDroit {
  cible: HTMLElement | null
  setCible: (element: HTMLElement | null) => void
  occupant: string | null
  setOccupant: Dispatch<SetStateAction<string | null>>
  gardes: GardesPanneau
}

// Pas de valeur par défaut qui ferait semblant : sans la coque, « Assistant » ne pourrait rien ouvrir,
// et un bouton qui ne fait rien a exactement la tête d'un bouton cassé. Mieux vaut lever tout de suite.
export const PanneauDroitContexte = createContext<ContextePanneauDroit | null>(null)

export function usePanneauDroitContexte(): ContextePanneauDroit {
  const contexte = useContext(PanneauDroitContexte)
  if (!contexte) throw new Error('Panneau de droite utilisé hors de la coque (FournisseurPanneauDroit).')
  return contexte
}

/**
 * Ouvrir, fermer ou basculer le contenu `nom`. Chacun rend `true` s'il a pu agir, `false` si la garde
 * du contenu affiché a refusé — l'appelant sait alors qu'il ne s'est rien passé.
 */
export function usePanneauDroit(nom: string) {
  const { occupant, setOccupant, gardes } = usePanneauDroitContexte()
  // Demande au contenu affiché s'il peut partir : sans garde posée, rien ne le retient.
  const peutQuitter = useCallback(() => gardes.consulter(), [gardes])
  // Prendre la place d'un AUTRE contenu passe par sa garde ; se rouvrir soi-même, non.
  const ouvrir = useCallback(() => {
    if (occupant !== nom && !peutQuitter()) return false
    setOccupant(nom)
    return true
  }, [nom, occupant, peutQuitter, setOccupant])
  // Ne ferme QUE s'il occupe encore le volet : un contenu remplacé entre-temps ne doit pas, en se
  // fermant, faire disparaître celui qui a pris sa place.
  const fermer = useCallback(() => {
    if (occupant === nom && !peutQuitter()) return false
    setOccupant((o) => (o === nom ? null : o))
    return true
  }, [nom, occupant, peutQuitter, setOccupant])
  const basculer = useCallback(() => (occupant === nom ? fermer() : ouvrir()), [nom, occupant, ouvrir, fermer])
  return { ouvert: occupant === nom, ouvrir, fermer, basculer, peutQuitter }
}

/**
 * Pose la garde de sortie du contenu `nom`, tant qu'il occupe le volet — `null` quand il n'y a rien
 * à protéger. Retirée d'elle-même quand il le quitte : la garde d'un contenu parti ne doit pas
 * retenir celui qui lui a succédé.
 */
export function useGardePanneau(nom: string, garde: (() => boolean) | null) {
  const { occupant, gardes } = usePanneauDroitContexte()
  useEffect(() => {
    if (occupant !== nom || !garde) return
    gardes.poser(garde)
    return () => gardes.retirer(garde)
  }, [occupant, nom, garde, gardes])
}
