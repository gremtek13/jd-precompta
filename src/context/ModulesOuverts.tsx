import { createContext, useContext, type ReactNode } from 'react'
import { OPTIONS_DES_CABINETS_PREVUES, TOUS_LES_MODULES, type ModuleOptionnel } from '../lib/modulesDuCabinet'

// LES MODULES OUVERTS, CE QUE LES ÉCRANS LISENT (conception 56, § 2.3, lot OPT3). Le fournisseur qui les lit vit à part
// (OptionsDuCabinetContext.tsx, qui lit la session et la base) : un écran qui ne fait que les lire — la barre d'onglets d'un
// dossier, la barre latérale — n'importe ni le client Supabase ni la session.
//
// Trois états. `lecture` : rien n'est encore revenu, aucun module optionnel ne s'affiche et la porte de l'application dit
// « Chargement… » (App.tsx). `lus` : les modules ouverts. `illisibles` : le côté FERMÉ, le socle seul, et un bandeau le dit
// (`MOTS_DU_REFUS.optionsIllisibles`, Layout.tsx). Le drapeau baissé : `lus`, tous ouverts, SANS AUCUNE LECTURE.

export type EtatDesModules =
  | { readonly etat: 'lecture'; readonly ouverts: readonly ModuleOptionnel[] }
  | { readonly etat: 'lus'; readonly ouverts: readonly ModuleOptionnel[] }
  | { readonly etat: 'illisibles'; readonly ouverts: readonly ModuleOptionnel[]; readonly motif: string }

export const TOUT_OUVERT_SANS_LECTURE: EtatDesModules = { etat: 'lus', ouverts: TOUS_LES_MODULES }

/** Rien n'est encore revenu : aucun module optionnel. */
export const EN_LECTURE: EtatDesModules = { etat: 'lecture', ouverts: [] }

/** Ce que l'état devient d'une lecture revenue (`ModulesDuCabinetLus`, lib/optionsDuCabinetLecture.ts, décrit par sa forme :
 *  ce module n'importe pas le lecteur) : illisible, le côté fermé. */
export function etatDeLaLecture(
  lu: { readonly etat: 'lus'; readonly ouverts: readonly ModuleOptionnel[] } | { readonly etat: 'illisibles'; readonly motif: string },
): EtatDesModules {
  return lu.etat === 'lus' ? { etat: 'lus', ouverts: lu.ouverts } : { etat: 'illisibles', ouverts: [], motif: lu.motif }
}

export const ModulesOuvertsContext = createContext<EtatDesModules | null>(null)

/** Sans fournisseur : tout ouvert tant que le drapeau est baissé (les écrans d'hier, rendus seuls par leurs tests) ; le
 *  drapeau levé, le côté fermé. */
export function etatSansFournisseur(prevues: boolean): EtatDesModules {
  return prevues ? { etat: 'illisibles', ouverts: [], motif: 'aucun fournisseur des options' } : TOUT_OUVERT_SANS_LECTURE
}

/** Les modules ouverts et l'état de leur lecture. */
export function useModulesOuverts(): EtatDesModules {
  return useContext(ModulesOuvertsContext) ?? etatSansFournisseur(OPTIONS_DES_CABINETS_PREVUES)
}

/** Fournit un état donné, sans lecture : le fournisseur de l'application, et les tests d'écran qui jouent un cabinet au
 *  socle seul ou un module seul. */
export function ModulesFournis({ etat, children }: { etat: EtatDesModules; children: ReactNode }) {
  return <ModulesOuvertsContext.Provider value={etat}>{children}</ModulesOuvertsContext.Provider>
}
