import type { ModeleComptable, PlanLu } from '../lib/engagement'
import {
  PLAN_DECALE, PLAN_PAR_DEFAUT, PREFIXES_DECALES, ROLES_COMPTABLES, type LibellesDuPlan, type PlanComptable, type PrefixesDuPlan,
  type RoleDeTiers,
} from '../lib/planComptable'
import { libellesDuChange } from './rolesDeLaBase'
import type { ModeComptable } from '../lib/types'

// LE PLAN LU, TEL QUE LES TESTS LE DONNENT AU MODÈLE (ligne 43, étape PC3) : les comptes, les libellés et les préfixes
// d'auxiliaire que `planDeLaReponse` rend pour un dossier qui ne règle rien — le catalogue —, et ceux du plan décalé.
// Une fabrique de test, hors de la source que comptesEnDur.test.ts relève : l'application ne prend jamais ces valeurs
// par défaut, elle les lit avec le plan du dossier.

/** Les libellés du catalogue, ceux que la base rend pour un rôle sans réglage — ceux du change, le drapeau levé. */
export const LIBELLES_PAR_DEFAUT: LibellesDuPlan = Object.freeze(
  { ...Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, r.libelleDefaut])), ...libellesDuChange() } as LibellesDuPlan,
)

/** Les préfixes du catalogue : F, FI et C. */
export const PREFIXES_PAR_DEFAUT: PrefixesDuPlan = Object.freeze(Object.fromEntries(
  ROLES_COMPTABLES.flatMap((r) => (r.prefixeAuxiliaireDefaut === null ? [] : [[r.role, r.prefixeAuxiliaireDefaut]])),
) as Record<RoleDeTiers, string>)

/** Le plan d'un dossier qui ne règle rien, tel que la lecture le rend. */
export const PLAN_LU_PAR_DEFAUT: PlanLu = { plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

/** Le plan décalé, ses préfixes décalés, ses libellés ceux du catalogue (le dossier ne règle que ses comptes). */
export const PLAN_LU_DECALE: PlanLu = { plan: PLAN_DECALE, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_DECALES }

/** Le plan lu d'un plan quelconque : ses libellés ceux du catalogue, ses préfixes décalés s'il est le plan décalé, sinon
 *  ceux du catalogue (la base les rend ainsi pour un dossier qui ne règle que ses comptes). */
export function planLuDe(plan: PlanComptable): PlanLu {
  return { plan, libelles: LIBELLES_PAR_DEFAUT, prefixes: plan === PLAN_DECALE ? PREFIXES_DECALES : PREFIXES_PAR_DEFAUT }
}

/** Un modèle sous le plan par défaut : le dirigeant au 108 en trésorerie, au 455 en engagement. */
export function modeleDeTest(mode: ModeComptable): ModeleComptable {
  return { mode, compteNotesDeFrais: mode === 'tresorerie' ? '108000' : '455000', ...PLAN_LU_PAR_DEFAUT }
}

/** Le même, sous le plan décalé et ses préfixes. */
export function modeleDecale(mode: ModeComptable): ModeleComptable {
  return { mode, compteNotesDeFrais: mode === 'tresorerie' ? PLAN_DECALE.exploitant : PLAN_DECALE.associe, ...PLAN_LU_DECALE }
}
