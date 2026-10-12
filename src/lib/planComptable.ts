// LE CATALOGUE DES RÔLES COMPTABLES ET LE PLAN PAR DÉFAUT D'UN DOSSIER (ligne 43, étape PC1, 10/10/2026).
//
// « L'entité établit un plan de comptes » (PCG, règlement ANC n° 2014-03 consolidé au 1er janvier 2026, art. 1011-5) :
// le plan est celui du DOSSIER. Les vingt-six comptes que l'application tient elle-même (lib/comptes.ts) y sont des
// RÔLES — la banque, la TVA, les tiers, le compte de l'exploitant… — que la base décrit dans `roles_comptables`
// (migration plan_comptable_des_dossiers) et qu'un dossier réglera dans `plan_comptable_dossier` (étape PC4) ; un rôle
// qu'il ne règle pas prend son compte par défaut, celui d'aujourd'hui.
//
// Ce module est la copie de ce catalogue côté application, PURE : il ne lit rien et n'importe pas le client Supabase.
// `planComptable.test.ts` le confronte au texte de la migration, à lib/comptes.ts (le plan par défaut EST les
// constantes d'aujourd'hui), aux préfixes des comptes auxiliaires de lib/engagement.ts et à des défauts ÉPINGLÉS :
// changer le défaut d'un rôle existant changerait, sans un mot, les comptes de tout dossier qui ne le règle pas.
//
// LA BASE LE LIT depuis l'étape PC2 : les quatorze fonctions qui écrivent ou vérifient un compte de rôle le prennent par
// `compte_du_role` et `compte_du_dirigeant`. L'APPLICATION LE LIT depuis l'étape PC3 : la page d'un dossier lit son plan
// effectif avec lui (`plan_du_dossier`, `lireLePlanDuDossier` ci-dessous), et toute écriture qu'elle compose y prend ses
// comptes — par le modèle comptable du dossier (lib/engagement.ts), qui le porte, ou par un paramètre `plan` obligatoire.
// Sous le plan vide d'aujourd'hui, chaque rôle s'y lit à son défaut : rien ne change pour personne.

import { messageErreur } from './messageErreur'

/** Un rôle du catalogue, tel que `roles_comptables` le porte. */
export interface DefinitionRoleComptable {
  /** La clé du rôle (`roles_comptables.role`). */
  readonly role: string
  /** Les racines du PCG sous lesquelles son compte se tient : « Le numéro de chaque compte divisionnaire commence
   *  toujours par le numéro du compte ou sous-compte dont il constitue une subdivision » (art. 1131-1). */
  readonly racines: readonly string[]
  /** Le compte par défaut : la constante d'aujourd'hui. */
  readonly compteDefaut: string
  /** Le libellé par défaut, celui que l'application donne aujourd'hui (`LIBELLES_COMPTES`) ; NUL pour le capital et
   *  les deux comptes du résultat, que le report des soldes nomme lui-même. */
  readonly libelleDefaut: string | null
  /** Le préfixe des comptes auxiliaires (F, FI, C : lib/engagement.ts), pour les trois rôles de tiers seulement. */
  readonly prefixeAuxiliaireDefaut: string | null
  /** L'ordre d'affichage, de dix en dix. */
  readonly ordre: number
}

// Dans l'ordre du catalogue. Le dirigeant non associé n'a que le 467 pour racine : permettre le 468 est la question Q7
// au cabinet, que l'étape PC1 ne tranche pas.
export const ROLES_COMPTABLES = [
  { role: 'banque', racines: ['512'], compteDefaut: '512000', libelleDefaut: 'Banque', prefixeAuxiliaireDefaut: null, ordre: 10 },
  { role: 'tva_deductible', racines: ['44566'], compteDefaut: '445660', libelleDefaut: 'TVA déductible', prefixeAuxiliaireDefaut: null, ordre: 20 },
  { role: 'tva_immobilisations', racines: ['44562'], compteDefaut: '445620', libelleDefaut: 'TVA déductible sur immobilisations', prefixeAuxiliaireDefaut: null, ordre: 30 },
  { role: 'tva_collectee', racines: ['44571'], compteDefaut: '445710', libelleDefaut: 'TVA collectée', prefixeAuxiliaireDefaut: null, ordre: 40 },
  { role: 'tva_a_decaisser', racines: ['44551'], compteDefaut: '445510', libelleDefaut: 'TVA à décaisser', prefixeAuxiliaireDefaut: null, ordre: 50 },
  { role: 'credit_tva_a_reporter', racines: ['44567'], compteDefaut: '445670', libelleDefaut: 'Crédit de TVA à reporter', prefixeAuxiliaireDefaut: null, ordre: 60 },
  { role: 'remboursement_tva_demande', racines: ['44583'], compteDefaut: '445830', libelleDefaut: "Remboursement de taxes sur le chiffre d'affaires demandé", prefixeAuxiliaireDefaut: null, ordre: 70 },
  { role: 'arrondi_charge', racines: ['658'], compteDefaut: '658000', libelleDefaut: 'Pénalités et autres charges', prefixeAuxiliaireDefaut: null, ordre: 80 },
  { role: 'arrondi_produit', racines: ['758'], compteDefaut: '758000', libelleDefaut: 'Indemnités et autres produits', prefixeAuxiliaireDefaut: null, ordre: 90 },
  { role: 'fournisseurs', racines: ['401'], compteDefaut: '401000', libelleDefaut: 'Fournisseurs', prefixeAuxiliaireDefaut: 'F', ordre: 100 },
  { role: 'fournisseurs_immobilisations', racines: ['404'], compteDefaut: '404000', libelleDefaut: "Fournisseurs d'immobilisations", prefixeAuxiliaireDefaut: 'FI', ordre: 110 },
  { role: 'clients', racines: ['411'], compteDefaut: '411000', libelleDefaut: 'Clients', prefixeAuxiliaireDefaut: 'C', ordre: 120 },
  { role: 'exploitant', racines: ['108'], compteDefaut: '108000', libelleDefaut: "Compte de l'exploitant", prefixeAuxiliaireDefaut: null, ordre: 130 },
  { role: 'associe', racines: ['455'], compteDefaut: '455000', libelleDefaut: 'Associés — comptes courants', prefixeAuxiliaireDefaut: null, ordre: 140 },
  { role: 'autres_debiteurs_crediteurs', racines: ['467'], compteDefaut: '467000', libelleDefaut: 'Divers comptes débiteurs et produits à recevoir', prefixeAuxiliaireDefaut: null, ordre: 150 },
  { role: 'emprunt', racines: ['164'], compteDefaut: '164000', libelleDefaut: 'Emprunts auprès des établissements de crédit', prefixeAuxiliaireDefaut: null, ordre: 160 },
  { role: 'interets_emprunt', racines: ['6611'], compteDefaut: '661100', libelleDefaut: 'Intérêts des emprunts et dettes', prefixeAuxiliaireDefaut: null, ordre: 170 },
  { role: 'assurance_emprunt', racines: ['616'], compteDefaut: '616800', libelleDefaut: 'Assurance des emprunts', prefixeAuxiliaireDefaut: null, ordre: 180 },
  { role: 'cotisations_exploitant', racines: ['646'], compteDefaut: '646000', libelleDefaut: "Cotisations sociales personnelles de l'exploitant", prefixeAuxiliaireDefaut: null, ordre: 190 },
  { role: 'dotations_amortissements', racines: ['6811'], compteDefaut: '681100', libelleDefaut: 'Dotations aux amortissements des immobilisations', prefixeAuxiliaireDefaut: null, ordre: 200 },
  { role: 'indemnites_kilometriques', racines: ['6251'], compteDefaut: '625110', libelleDefaut: 'Indemnités kilométriques (barème)', prefixeAuxiliaireDefaut: null, ordre: 210 },
  { role: 'virements_internes', racines: ['58'], compteDefaut: '580000', libelleDefaut: 'Virements internes', prefixeAuxiliaireDefaut: null, ordre: 220 },
  { role: 'depots_cautionnements_verses', racines: ['275'], compteDefaut: '275000', libelleDefaut: 'Dépôts et cautionnements versés', prefixeAuxiliaireDefaut: null, ordre: 230 },
  { role: 'capital_individuel', racines: ['101'], compteDefaut: '101000', libelleDefaut: null, prefixeAuxiliaireDefaut: null, ordre: 240 },
  { role: 'resultat_benefice', racines: ['120'], compteDefaut: '120000', libelleDefaut: null, prefixeAuxiliaireDefaut: null, ordre: 250 },
  { role: 'resultat_perte', racines: ['129'], compteDefaut: '129000', libelleDefaut: null, prefixeAuxiliaireDefaut: null, ordre: 260 },
] as const satisfies readonly DefinitionRoleComptable[]

export type CleRoleComptable = (typeof ROLES_COMPTABLES)[number]['role']

/** Un plan comptable : le compte de chaque rôle. */
export type PlanComptable = Readonly<Record<CleRoleComptable, string>>

/** Les trois rôles de tiers, les seuls qui portent un préfixe de comptes auxiliaires. */
export type RoleDeTiers = Extract<(typeof ROLES_COMPTABLES)[number], { prefixeAuxiliaireDefaut: string }>['role']

// LE PLAN PAR DÉFAUT : celui de tout dossier qui ne règle rien, c'est-à-dire de tous aujourd'hui — `compte_du_role` le
// rend en base pour un rôle sans ligne.
export const PLAN_PAR_DEFAUT: PlanComptable = Object.freeze(
  Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, r.compteDefaut])),
) as PlanComptable

// UN PLAN FICTIF où chaque rôle se tient sur un autre sous-compte que son défaut (conception, §5.1) : la banque au 512100,
// la TVA déductible au 445661… Les étapes suivantes feront tourner sous lui chaque test d'un module qui compose ou lit un
// compte de rôle : une constante oubliée y écrirait un 512000 que le test refuserait. Chaque compte y est un compte que
// la garde du plan accepte (six chiffres sous une racine du rôle), aucun n'égale son défaut, et deux rôles n'y partagent
// jamais un compte, même à des zéros près (art. 1131-2) — `planComptable.test.ts` le vérifie,
// supabase/essais/planComptable.sql le fait écrire et relire par la base, et supabase/essais/laBaseLitLePlan.sql le pose
// pour éprouver les quatorze fonctions de la base que l'étape PC2 fait lire dans le plan d'un dossier.
export const PLAN_DECALE: PlanComptable = Object.freeze({
  banque: '512100',
  tva_deductible: '445661',
  tva_immobilisations: '445621',
  tva_collectee: '445711',
  tva_a_decaisser: '445511',
  credit_tva_a_reporter: '445671',
  remboursement_tva_demande: '445831',
  arrondi_charge: '658100',
  arrondi_produit: '758100',
  fournisseurs: '401100',
  fournisseurs_immobilisations: '404100',
  clients: '411100',
  exploitant: '108100',
  associe: '455100',
  autres_debiteurs_crediteurs: '467100',
  emprunt: '164100',
  interets_emprunt: '661110',
  assurance_emprunt: '616810',
  cotisations_exploitant: '646100',
  dotations_amortissements: '681110',
  indemnites_kilometriques: '625111',
  virements_internes: '580100',
  depots_cautionnements_verses: '275100',
  capital_individuel: '101100',
  resultat_benefice: '120100',
  resultat_perte: '129100',
})

/** Les préfixes des comptes auxiliaires du plan fictif, distincts entre eux et de ceux du catalogue. */
export const PREFIXES_DECALES: Readonly<Record<RoleDeTiers, string>> = Object.freeze({
  fournisseurs: 'FO',
  fournisseurs_immobilisations: 'IM',
  clients: 'CL',
})

// CE QUE LA GARDE DU PLAN EXIGE d'une ligne, recopié de `garder_plan_comptable_dossier` et confronté à son texte par le
// test : un compte de SIX chiffres (hypothèse Q5 : une autre réponse du cabinet remplacerait la garde et cette forme
// ensemble) qui commence par une racine du rôle, un préfixe d'une à cinq lettres majuscules ou chiffres. L'étape PC4 en
// tirera les refus qu'elle dira avant le clic.
export const FORME_COMPTE_DE_ROLE = /^[0-9]{6}$/
export const FORME_PREFIXE_AUXILIAIRE = /^[A-Z0-9]{1,5}$/

/** Le rôle du catalogue, ou `undefined` pour une clé qu'il ne connaît pas. */
export function definitionDuRole(role: string): DefinitionRoleComptable | undefined {
  return ROLES_COMPTABLES.find((r) => r.role === role)
}

/** Vrai quand `compte` commence par l'une des racines que le catalogue donne au rôle. */
export function sousUneRacineDuRole(role: CleRoleComptable, compte: string): boolean {
  return (definitionDuRole(role)?.racines ?? []).some((racine) => compte.startsWith(racine))
}

/** Deux numéros qui ne diffèrent que par leurs zéros de fin désignent le même compte global (PCG, art. 1131-2). */
export function memeCompteAuxZerosPres(a: string, b: string): boolean {
  return a.replace(/0+$/, '') === b.replace(/0+$/, '')
}

// ── Le plan lu avec le dossier (étape PC3) ────────────────────────────────────────────────────────────────────────────

/** Ce que rend la fonction `plan_du_dossier` de la base : une ligne par rôle (rôle, compte, libellé, préfixe, origine). */
export interface ReponseDuPlan {
  data: unknown
  error: unknown
}

/** Le plan d'un dossier tel que l'application le lit : entier, ou rien, avec le motif. */
export type LectureDuPlan = { plan: PlanComptable; motif: null } | { plan: null; motif: string }

/**
 * Le plan effectif d'un dossier, depuis la réponse de `plan_du_dossier` (migration plan_comptable_des_dossiers) : la
 * fonction de la base qui dit, rôle par rôle, la ligne que le dossier règle, sinon le défaut du catalogue — le même
 * `coalesce` que `compte_du_role`, que les quatorze fonctions qui vérifient une écriture lisent depuis l'étape PC2.
 * L'application compose donc avec le plan que la base vérifiera, jamais avec une copie.
 *
 * LE PLAN EST ENTIER OU IL N'EST PAS : une écriture composée sur un rôle qu'on n'a pas lu partirait à son défaut, peut-être
 * un autre compte que celui du dossier. Un refus, une réponse illisible, un rôle du catalogue de l'application absent (la
 * réponse vide comprise : le vide ne s'affirme pas), un rôle deux fois, un compte hors de la forme que la garde du plan
 * exige ou hors des racines de son rôle ne rendent AUCUN plan, et leur motif. Un rôle que la base connaît et que
 * l'application ignore (un catalogue plus récent qu'elle) est sans conséquence : elle n'y écrit pas.
 *
 * Deux rôles ne peuvent pas y partager un compte : chacun se tient sous ses racines, et aucune racine du catalogue n'en
 * commence une autre (`planComptable.test.ts`).
 */
export function planDeLaReponse(reponse: ReponseDuPlan): LectureDuPlan {
  if (reponse.error) {
    return { plan: null, motif: `plan comptable refusé : ${messageErreur(reponse.error, 'raison inconnue')}` }
  }
  if (!Array.isArray(reponse.data)) return { plan: null, motif: 'plan comptable illisible' }
  const lus = new Map<string, string>()
  for (const ligne of reponse.data as unknown[]) {
    if (ligne === null || typeof ligne !== 'object') return { plan: null, motif: 'plan comptable illisible' }
    const { role, compte } = ligne as Record<string, unknown>
    if (typeof role !== 'string' || typeof compte !== 'string') return { plan: null, motif: 'plan comptable illisible' }
    if (lus.has(role)) return { plan: null, motif: `plan comptable illisible : le rôle « ${role} » y paraît deux fois` }
    lus.set(role, compte)
  }
  const absents = ROLES_COMPTABLES.filter((r) => !lus.has(r.role)).map((r) => r.role)
  if (absents.length > 0) {
    return {
      plan: null,
      motif: `plan comptable incomplet : ${absents.length} rôle(s) sur ${ROLES_COMPTABLES.length} absent(s) (${absents.join(', ')})`,
    }
  }
  for (const { role } of ROLES_COMPTABLES) {
    const compte = lus.get(role)!
    if (!FORME_COMPTE_DE_ROLE.test(compte) || !sousUneRacineDuRole(role, compte)) {
      return { plan: null, motif: `plan comptable illisible : « ${compte} » n’est pas un compte du rôle « ${role} »` }
    }
  }
  const plan = Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, lus.get(r.role)!])) as PlanComptable
  return { plan: Object.freeze(plan), motif: null }
}

/**
 * Le plan tel que la page d'un dossier le lit : `lireLePlanDuDossier(supabase.rpc('plan_du_dossier', { p_dossier_id }))`.
 * La requête est ATTENDUE ici, et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture
 * possible, et nomme ce consommateur) ; une requête qui lève tombe du côté signalé, comme un refus — jamais un plan par
 * défaut supposé. Ce module reste pur : il reçoit la requête, il n'importe pas le client.
 */
export async function lireLePlanDuDossier(requete: PromiseLike<ReponseDuPlan>): Promise<LectureDuPlan> {
  try {
    return planDeLaReponse(await requete)
  } catch (erreur) {
    return planDeLaReponse({ data: null, error: erreur })
  }
}

// ── Le compte du dirigeant (conception, § 3.6) ────────────────────────────────────────────────────────────────────────

/**
 * Les rôles qu'un dossier en ENGAGEMENT peut choisir pour son dirigeant (`dossiers.compte_notes_de_frais`) : le compte
 * courant d'associé, le compte de l'exploitant, ou le 467 d'un dirigeant non associé (PCG, art. 1211-10 et 1214-46). En
 * trésorerie, le dirigeant est toujours le rôle `exploitant`.
 */
export const ROLES_DU_DIRIGEANT = ['associe', 'exploitant', 'autres_debiteurs_crediteurs'] as const satisfies readonly CleRoleComptable[]

export type RoleDuDirigeant = (typeof ROLES_DU_DIRIGEANT)[number]

/**
 * Le rôle du dirigeant dont `compte` est le compte DANS CE PLAN, ou null. Le compte du dirigeant d'un dossier n'est plus
 * l'un de trois numéros écrits dans l'application : c'est le compte de l'un de ces trois rôles du plan du dossier, et un
 * compte qu'aucun ne porte n'est pas un compte du dirigeant (lib/engagement.ts, `modeleDuDossier`). La base le borne
 * encore aux trois défauts (`dossiers_compte_notes_de_frais_check`) : l'étape PC4 remplacera cette contrainte (Q4).
 */
export function roleDuDirigeant(plan: PlanComptable, compte: string): RoleDuDirigeant | null {
  return ROLES_DU_DIRIGEANT.find((role) => plan[role] === compte) ?? null
}
