import type { DefinitionRoleComptable } from './planComptable'

// LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE DE COTISATION : LA CFP ET LA CURPS EN BS (lot L2, point 6 ; EXP58-Q6 (A) et
// EXP58-Q7 (A), décisions du cabinet du 19/11/2026 ; conception 58, § 4.2 et § 12).
//
// L'Urssaf appelle avec les cotisations sociales personnelles deux contributions qui n'en sont pas : la contribution à la
// formation professionnelle des travailleurs indépendants (C. trav., art. L. 6331-48) et la CURPS (CSP, art. L. 4031-4).
// L'expert-comptable les range « dans un sous-compte des autres impôts » (2035E-9) : en BS (2035-A, ligne 13, « Autres
// impôts »), et non en BK. La migration `autres_impots_des_cotisations` (supabase/preparees/20261119120000…, préparée, pas
// appliquée) pose la part sur l'échéance (`cotisations_declarees.montant_autres_impots`, le patron de `montant_csg_crds`),
// le rôle `autres_impots` au catalogue, et les deux fonctions qui recomposent l'écriture d'une échéance avec une ligne de
// plus. Ce module porte le drapeau, le rôle et la lecture d'une part tapée ; la composition est dans
// lib/cotisationRapprochee.ts et lib/cotisationPersonnelle.ts, la 2035 dans lib/declaration2035.ts.
//
// LE DRAPEAU BAISSÉ, RIEN NE CHANGE, À L'OCTET PRÈS : la part ne se lit pas (`partAutresImpotsSelon`), l'écriture et la 2035
// sont celles d'hier, la lecture du plan ignore le rôle (comme les deux du change, lib/rolesDuChange.ts), et l'onglet
// Cotisations ne la saisit pas. Il ne se lève qu'APRÈS la migration : levé avant, chaque plan lu serait incomplet — aucun
// onglet ne se monterait — et l'écran écrirait une colonne absente. La constante de même nom de l'assistant
// (`agent-comptable`, bloc COTISATION) se lève avec lui, et l'assistant se redéploie.
export const AUTRES_IMPOTS_DES_COTISATIONS_PREVUS: boolean = false

// LE RÔLE DU PLAN (EXP58-Q7). Aucun FEC du logiciel de l'expert-comptable ne dit son numéro dans le dépôt : le plan comptable
// général (règlement ANC n° 2014-03, version consolidée au 1er janvier 2026, art. 1121-1, classe 63) range les autres impôts
// sous le 635 « Autres impôts, taxes et versements assimilés (administrations des impôts) » et le 637 « … (autres
// organismes) », dont le 6378 « Taxes diverses ». L'Urssaf, qui recouvre la CFP et la CURPS, n'est pas l'administration des
// impôts : 637800 par défaut, sous l'intitulé du 6378 (le CompteLib d'un compte du plan, BOI-CF-IOR-60-40-20, § 150) ; le 635
// parmi les racines, qu'un dossier choisit dans son plan. Rang 660 : après ceux que les migrations préparées réservent.
export const ROLE_AUTRES_IMPOTS = {
  role: 'autres_impots', racines: ['635', '637'], compteDefaut: '637800', libelleDefaut: 'Taxes diverses',
  prefixeAuxiliaireDefaut: null, ordre: 660,
} as const satisfies DefinitionRoleComptable

export type CleRoleAutresImpots = typeof ROLE_AUTRES_IMPOTS.role

/**
 * Le compte de la part dans un plan : celui que le plan porte, sinon le défaut du catalogue — ce que `compte_du_role` rend
 * pour un rôle que le dossier ne règle pas. Le drapeau levé, un plan LU le porte toujours (`planDeLaReponse` l'exige) ; un
 * plan écrit à la main (un test, un plan par défaut) le prend à son défaut.
 */
export function compteDesAutresImpots(plan: { readonly autres_impots?: string }): string {
  return plan.autres_impots ?? ROLE_AUTRES_IMPOTS.compteDefaut
}

/**
 * La part d'une échéance, en valeur absolue, telle que l'écriture et la 2035 la comptent : saisie, le drapeau levé ; nulle
 * sinon — non saisie, ou le drapeau baissé (la colonne n'existe pas encore, ou personne ne l'a saisie). Comme la CSG-CRDS, le
 * signe vient de l'échéance, jamais de la saisie (la base prend sa valeur absolue).
 */
export function partAutresImpotsSelon(prevus: boolean, c: { readonly montant_autres_impots?: number | null }): number | null {
  if (!prevus || c.montant_autres_impots == null) return null
  return Math.abs(c.montant_autres_impots)
}

/** La part d'une échéance selon le drapeau du module. */
export function partAutresImpots(c: { readonly montant_autres_impots?: number | null }): number | null {
  return partAutresImpotsSelon(AUTRES_IMPOTS_DES_COTISATIONS_PREVUS, c)
}

const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

export type PartLue = { ok: true; valeur: number | null } | { ok: false; message: string }

/**
 * Une part tapée dans l'onglet Cotisations : vide, aucune ; sinon un montant POSITIF au centime, la virgule admise — le sens
 * est celui de l'échéance (un remboursement la rend comme il rend la cotisation). Zéro se laisse vide : une part nulle n'en
 * est pas une, et l'écriture n'aurait pas de ligne. Jamais arrondie en silence.
 */
export function lireLaPartAutresImpots(texte: string): PartLue {
  const t = texte.trim().replace(',', '.')
  if (t === '') return { ok: true, valeur: null }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, message: 'La part « autres impôts » n’est pas un montant.' }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, message: 'La part « autres impôts » n’est pas un montant.' }
  if (n < 0) return { ok: false, message: 'La part « autres impôts » se saisit en positif : son sens est celui de l’échéance.' }
  if (n === 0) return { ok: false, message: 'Une part « autres impôts » de zéro se laisse vide.' }
  if (!auCentime(n)) return { ok: false, message: 'La part « autres impôts » n’est pas au centime.' }
  return { ok: true, valeur: n }
}

/** Ce que l'onglet dit de la part, sous la saisie : ce qu'elle est, d'où elle vient, où elle va, et ce qu'elle n'est jamais. */
export const AIDE_DE_LA_PART = 'La part de l’échéance que l’échéancier ou l’avis de l’Urssaf attribue à la contribution à la '
  + 'formation professionnelle et à la CURPS : elle va au compte des autres impôts et en BS sur la 2035, la cotisation en BK '
  + 'baisse d’autant. L’estimation de l’onglet Clôture n’en donne que le total de l’année, jamais la part d’une échéance.'
