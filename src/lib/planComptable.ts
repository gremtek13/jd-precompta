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
// RIEN NE LE LIT ENCORE : les modules et les écrans prendront le plan du dossier en paramètre à l'étape PC3.

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
// jamais un compte, même à des zéros près (art. 1131-2) — `planComptable.test.ts` le vérifie, et
// supabase/essais/planComptable.sql le fait écrire et relire par la base.
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
