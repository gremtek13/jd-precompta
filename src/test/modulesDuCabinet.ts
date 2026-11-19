import { TOUS_LES_MODULES } from '../lib/modulesDuCabinet'

// LA LECTURE DES MODULES DU CABINET D'UN DOSSIER (OPT1, en production depuis le 19/11/2026 ; `OPTIONS_DES_CABINETS_PREVUES`
// levé), pour les faux clients des tests qui montent un fournisseur (App.tsx, ou la coque dans un dossier) : la fonction
// `modules_ouverts_du_dossier` rend tous les modules, comme la base pour un cabinet existant le jour de la migration. Un test qui
// joue un module fermé répond lui-même.

/** La réponse de `modules_ouverts_du_dossier`, ou nul pour toute autre fonction (le faux client répond alors comme avant). */
export function reponseDesModules(nom: string): { data: string[]; error: null } | null {
  return nom === 'modules_ouverts_du_dossier' ? { data: [...TOUS_LES_MODULES], error: null } : null
}

