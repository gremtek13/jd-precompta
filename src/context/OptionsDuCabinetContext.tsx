import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { droitsSur, type DroitsAcces } from '../lib/droitsAcces'
import { droitsMasques, OPTIONS_DES_CABINETS_PREVUES, TOUS_LES_MODULES, type ModuleOptionnel } from '../lib/modulesDuCabinet'
import { lireLesModulesDuCabinet, lireLesModulesDuDossier, type ModulesDuCabinetLus } from '../lib/optionsDuCabinetLecture'

// LES MODULES OUVERTS, POUR TOUTE LA COQUE (conception 56, § 2.3, lot OPT3), sur le patron d'`AuthContext` : une lecture au
// changement d'IDENTIFIANT de ce qu'elle lit — le cabinet du compte du cabinet, la société affichée du client —, jamais à
// chaque retour sur l'onglet. La réponse se garde avec sa clé : une réponse pour une autre clé ne s'affiche pas, l'état
// repart en lecture.
//
// Trois états. `lecture` : rien n'est encore revenu, aucun module optionnel ne s'affiche et la porte de l'application dit
// « Chargement… » (App.tsx). `lus` : les modules ouverts. `illisibles` : le côté FERMÉ, le socle seul, et un bandeau le dit
// (`MOTS_DU_REFUS.optionsIllisibles`). Le drapeau baissé : `lus`, tous ouverts, SANS AUCUNE LECTURE.

export type EtatDesModules =
  | { readonly etat: 'lecture'; readonly ouverts: readonly ModuleOptionnel[] }
  | { readonly etat: 'lus'; readonly ouverts: readonly ModuleOptionnel[] }
  | { readonly etat: 'illisibles'; readonly ouverts: readonly ModuleOptionnel[]; readonly motif: string }

export const TOUT_OUVERT_SANS_LECTURE: EtatDesModules = { etat: 'lus', ouverts: TOUS_LES_MODULES }
const EN_LECTURE: EtatDesModules = { etat: 'lecture', ouverts: [] }
const AUCUN: readonly ModuleOptionnel[] = []

/** Sans fournisseur : tout ouvert tant que le drapeau est baissé (les écrans d'hier, rendus seuls par leurs tests) ; le drapeau
 *  levé, le côté fermé. */
function etatSansFournisseur(prevues: boolean): EtatDesModules {
  return prevues ? { etat: 'illisibles', ouverts: AUCUN, motif: 'aucun fournisseur des options' } : TOUT_OUVERT_SANS_LECTURE
}

const OptionsDuCabinetContext = createContext<EtatDesModules | null>(null)

/** Ce que l'état devient d'une lecture revenue. */
function etatDeLaLecture(lu: ModulesDuCabinetLus): EtatDesModules {
  return lu.etat === 'lus' ? { etat: 'lus', ouverts: lu.ouverts } : { etat: 'illisibles', ouverts: AUCUN, motif: lu.motif }
}

/** La clé de ce que la coque lit : `cabinet:<id>` ou `dossier:<id>`, ou nul quand rien n'est à lire. */
export function cleDesOptions(role: 'cabinet' | 'client' | null, cabinetId: string | null, dossierId: string | null): string | null {
  if (role === 'cabinet') return cabinetId ? `cabinet:${cabinetId}` : null
  if (role === 'client') return dossierId ? `dossier:${dossierId}` : null
  return null
}

/** `prevues` : le drapeau, en propriété pour que les tests jouent ses deux états. */
export function OptionsDuCabinetProvider({ children, prevues = OPTIONS_DES_CABINETS_PREVUES }: { children: ReactNode; prevues?: boolean }) {
  const { role, monCabinetId, dossierActifId } = useAuth()
  const cle = cleDesOptions(role, monCabinetId, dossierActifId)
  const [lu, setLu] = useState<{ cle: string; etat: EtatDesModules } | null>(null)

  useEffect(() => {
    // Le drapeau baissé : aucune lecture, jamais.
    if (!prevues || cle === null) return
    let annule = false
    const [nature, id] = [cle.slice(0, cle.indexOf(':')), cle.slice(cle.indexOf(':') + 1)]
    const lecture = nature === 'cabinet' ? lireLesModulesDuCabinet(id, prevues) : lireLesModulesDuDossier(id, prevues)
    void lecture.then((resultat) => {
      if (!annule) setLu({ cle, etat: etatDeLaLecture(resultat) })
    })
    return () => { annule = true }
  }, [cle, prevues])

  let valeur: EtatDesModules
  if (!prevues) valeur = TOUT_OUVERT_SANS_LECTURE
  else if (cle === null) {
    // Un compte du cabinet sans cabinet ne se juge pas : fermé. Un client sans société affichée n'a rien à ouvrir.
    valeur = role === 'cabinet' ? { etat: 'illisibles', ouverts: AUCUN, motif: 'le cabinet du compte n’est pas connu' } : { etat: 'lus', ouverts: AUCUN }
  } else valeur = lu !== null && lu.cle === cle ? lu.etat : EN_LECTURE

  return <OptionsDuCabinetContext.Provider value={valeur}>{children}</OptionsDuCabinetContext.Provider>
}

/** Les modules ouverts et l'état de leur lecture. */
export function useModulesOuverts(): EtatDesModules {
  return useContext(OptionsDuCabinetContext) ?? etatSansFournisseur(OPTIONS_DES_CABINETS_PREVUES)
}

/** Les droits de la société AFFICHÉE du client, chaque case masquée par son module (`droitsMasques`) : ce que les routes, les
 *  entrées et les tuiles lisent. Tous les modules ouverts, ce sont les droits d'hier, champ par champ. */
export function useDroitsAffiches(): DroitsAcces {
  const { droitsParDossier, dossierActifId } = useAuth()
  const { ouverts } = useModulesOuverts()
  return droitsMasques(droitsSur(droitsParDossier ?? {}, dossierActifId), ouverts)
}

/** Fournit un état donné, sans lecture : pour les tests d'écran qui jouent un cabinet au socle seul ou un module seul. */
export function ModulesFournis({ etat, children }: { etat: EtatDesModules; children: ReactNode }) {
  return <OptionsDuCabinetContext.Provider value={etat}>{children}</OptionsDuCabinetContext.Provider>
}
