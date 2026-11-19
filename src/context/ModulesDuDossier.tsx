import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { EN_LECTURE, etatDeLaLecture, ModulesFournis, useModulesOuverts, type EtatDesModules } from './ModulesOuverts'
import { OPTIONS_DES_CABINETS_PREVUES } from '../lib/modulesDuCabinet'
import { lireLesModulesDuDossier } from '../lib/optionsDuCabinetLecture'

// LES MODULES DU CABINET DU DOSSIER, À L'INTÉRIEUR D'UN DOSSIER (OPT3-Q1 (A), 19/11/2026). Côté cabinet, hors d'un dossier, les
// modules sont ceux du cabinet du compte (OptionsDuCabinetContext.tsx) ; dans un dossier — ses onglets, sa barre latérale, ses
// fiches, l'assistant —, ceux du cabinet AUQUEL LE DOSSIER APPARTIENT, lus par `modules_ouverts_du_dossier`, que la base ouvre à
// `admin_du_dossier` : le super-administrateur qui ouvre le dossier d'un autre cabinet y voit ce que ce cabinet voit.
//
// La réponse se garde AVEC l'identifiant du dossier lu : cette page ne se remonte pas d'un dossier à l'autre, et une réponse
// pour un dossier quitté — même arrivée la dernière — ne s'affiche pas (l'état repart en « lecture »). Illisible, le côté FERMÉ
// (le socle seul), que la page du dossier dit. Le drapeau baissé : AUCUNE lecture, l'état d'au-dessus passe tel quel (tout
// ouvert, comme hier).
//
// Une seule lecture par dossier ouvert : la coque (Layout.tsx) enveloppe la barre latérale et la page du dossier ; la page
// l'enveloppe aussi, pour se suffire à elle-même, et sous un fournisseur qui lit DÉJÀ ce dossier-là, elle ne relit rien.

const DossierEnLecture = createContext<string | null>(null)

/** `dossierId` nul : hors d'un dossier, rien ne change. `prevues` : le drapeau, en propriété pour que les tests jouent ses deux
 *  états. */
export function ModulesDuDossier({ dossierId, children, prevues = OPTIONS_DES_CABINETS_PREVUES }: {
  dossierId: string | null
  children: ReactNode
  prevues?: boolean
}) {
  const dejaLu = useContext(DossierEnLecture)
  const auDessus = useModulesOuverts()
  const aLire = prevues && dossierId !== null && dossierId !== dejaLu ? dossierId : null
  const [lu, setLu] = useState<{ dossierId: string; etat: EtatDesModules } | null>(null)

  useEffect(() => {
    if (aLire === null) return
    // Le drapeau d'annulation se pose avant toute écriture : une lecture plus lente d'un dossier quitté n'écrit rien.
    let annule = false
    void lireLesModulesDuDossier(aLire, true).then((resultat) => {
      if (!annule) setLu({ dossierId: aLire, etat: etatDeLaLecture(resultat) })
    })
    return () => { annule = true }
  }, [aLire])

  // Rien à lire ici (hors d'un dossier, le drapeau baissé, ou le dossier déjà lu au-dessus) : l'état d'au-dessus, tel quel.
  const etat = aLire === null ? auDessus : lu !== null && lu.dossierId === aLire ? lu.etat : EN_LECTURE
  // La même forme d'arbre dans tous les cas : passer de la liste à un dossier, ou d'un dossier à l'autre, ne remonte rien.
  return (
    <DossierEnLecture.Provider value={aLire ?? dejaLu}>
      <ModulesFournis etat={etat}>{children}</ModulesFournis>
    </DossierEnLecture.Provider>
  )
}
