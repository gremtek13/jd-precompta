import { AUTRES_IMPOTS_DES_COTISATIONS_PREVUS, ROLE_AUTRES_IMPOTS } from '../lib/autresImpotsDesCotisations'
import { ROLES_COMPTABLES } from '../lib/planComptable'
import { ECARTS_DE_REGLEMENT_PREVUS, ROLES_DU_CHANGE } from '../lib/rolesDuChange'

// LES RÔLES QUE `plan_du_dossier` REND EN PRODUCTION : le catalogue de l'application et, depuis la migration
// `ecarts_de_reglement` (en production le 12/11/2026, ligne 31), les deux rôles du change, au catalogue de la base
// (`roles_comptables`) — la lecture du plan les exige le drapeau `ECARTS_DE_REGLEMENT_PREVUS` levé et les ignore baissé ;
// depuis la migration `autres_impots_des_cotisations` (en production le 19/11/2026, EXP58-Q6), le rôle des autres impôts,
// exigé le drapeau `AUTRES_IMPOTS_DES_COTISATIONS_PREVUS` levé et ignoré baissé. Trente-cinq rôles.
// Un faux `plan_du_dossier` (ou `modele_du_cabinet`) part d'ici, comme la base, jamais de `ROLES_COMPTABLES` seul.
export const ROLES_DE_LA_BASE = [...ROLES_COMPTABLES, ...ROLES_DU_CHANGE, ROLE_AUTRES_IMPOTS] as const

/** Les comptes du change que la lecture ajoute au plan, à leur défaut : le drapeau levé seulement (lu à l'appel, qu'un
 *  test peut baisser par un accesseur). */
export function changeAuDefaut(): Readonly<Record<string, string>> {
  return ECARTS_DE_REGLEMENT_PREVUS ? Object.fromEntries(ROLES_DU_CHANGE.map((r) => [r.role, r.compteDefaut])) : {}
}

/** Leurs libellés du catalogue, le drapeau levé seulement. */
export function libellesDuChange(): Readonly<Record<string, string>> {
  return ECARTS_DE_REGLEMENT_PREVUS ? Object.fromEntries(ROLES_DU_CHANGE.map((r) => [r.role, r.libelleDefaut])) : {}
}

/** Le compte des autres impôts que la lecture ajoute au plan, à son défaut : le drapeau de sa migration levé seulement (lu à
 *  l'appel, qu'un test peut baisser par un accesseur). */
export function autresImpotsAuDefaut(): Readonly<Record<string, string>> {
  return AUTRES_IMPOTS_DES_COTISATIONS_PREVUS ? { [ROLE_AUTRES_IMPOTS.role]: ROLE_AUTRES_IMPOTS.compteDefaut } : {}
}

/** Son libellé du catalogue, le drapeau levé seulement. */
export function libelleDesAutresImpots(): Readonly<Record<string, string>> {
  return AUTRES_IMPOTS_DES_COTISATIONS_PREVUS ? { [ROLE_AUTRES_IMPOTS.role]: ROLE_AUTRES_IMPOTS.libelleDefaut } : {}
}
