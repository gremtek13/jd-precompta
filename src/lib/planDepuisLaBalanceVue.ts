import type { LigneANouveau } from './aNouveaux'
import { formatMoney } from './format'
import { ROLES_COMPTABLES, rolesLusAuPlan, type CleRoleComptable, type CleRoleDuPlan } from './planComptable'
import {
  planRetenu,
  type ChoixDuPlan,
  type EcarteDuRole,
  type LigneDuPlanReglee,
  type PlanLu,
  type PropositionDuRole,
} from './planDepuisLaBalance'

// LES MOTS ET L'ÉTAT DE LA CARTE DE LA BALANCE QUAND LA REPRISE PROPOSE LE PLAN (ligne 43, étape PC6 ; derrière
// `PLAN_DEPUIS_LA_BALANCE_PREVU`). Pur : la règle est celle de lib/planDepuisLaBalance.ts, jamais recopiée ici — l'écran
// en dit l'état (à choisir, à régler, à jour) et ce qui change, la lecture et l'écriture vivent dans
// lib/planDepuisLaBalanceLecture.ts.

// Les trois rôles sans libellé au catalogue (le report des soldes les nomme lui-même) : l'écran les nomme quand même.
const NOMS_SANS_LIBELLE: Partial<Record<CleRoleComptable, string>> = {
  capital_individuel: 'Capital individuel',
  resultat_benefice: 'Résultat de l’exercice (bénéfice)',
  resultat_perte: 'Résultat de l’exercice (perte)',
}

/** Le nom d'un rôle à l'écran : son libellé du catalogue. */
export function nomDuRole(role: CleRoleDuPlan): string {
  const definition = rolesLusAuPlan().find((r) => r.role === role)
  return definition?.libelleDefaut ?? NOMS_SANS_LIBELLE[role as CleRoleComptable] ?? role
}

/** Un compte et son libellé, tels qu'un rôle les tient. */
export interface CompteTenu {
  compte: string
  libelle: string | null
}

export interface ChangementDuPlan {
  role: CleRoleComptable
  avant: CompteTenu
  apres: CompteTenu
}

/**
 * Ce que le plan ENTIER du clic change au plan lu, rôle par rôle : un rôle absent de `comptes` revient au catalogue (c'est
 * ce que fait `regler_plan_du_dossier`), un libellé nul est celui du catalogue. Le préfixe des auxiliaires, que
 * `planRetenu` garde tel qu'il est lu, ne change pas.
 */
export function changementsDuPlan(comptes: readonly LigneDuPlanReglee[], lu: PlanLu): ChangementDuPlan[] {
  return ROLES_COMPTABLES.flatMap((definition) => {
    const ligne = comptes.find((c) => c.role === definition.role)
    const apres: CompteTenu = { compte: ligne?.compte ?? definition.compteDefaut, libelle: ligne?.libelle ?? definition.libelleDefaut }
    const avant: CompteTenu = { compte: lu.plan[definition.role], libelle: lu.libelles[definition.role] }
    return apres.compte === avant.compte && apres.libelle === avant.libelle ? [] : [{ role: definition.role, avant, apres }]
  })
}

export type EtatDuPlanPropose =
  /** Un choix que le module refuse : sa phrase, dite avant le clic. */
  | { etat: 'refus'; refus: string }
  /** Des rôles où la balance porte plusieurs comptes et où le cabinet n'a pas encore choisi. */
  | { etat: 'a_choisir'; roles: CleRoleComptable[] }
  /** Le plan retenu diffère du plan lu : le clic l'envoie. */
  | { etat: 'a_regler'; comptes: LigneDuPlanReglee[]; changements: ChangementDuPlan[] }
  /** Le plan lu tient déjà ce que le cabinet retient : les à-nouveaux se rangent sur lui. */
  | { etat: 'a_jour' }

/**
 * L'état du plan proposé : un rôle « au choix » demande un choix explicite (un des comptes de la balance, ou `null` pour
 * garder le plan), puis le refus de `planRetenu`, puis ce qui change. Les à-nouveaux ne se rangent que sur un plan à jour.
 */
export function etatDuPlanPropose(propositions: readonly PropositionDuRole[], choix: ChoixDuPlan, lu: PlanLu): EtatDuPlanPropose {
  const roles = propositions.filter((p) => p.etat === 'au_choix' && !(p.role in choix)).map((p) => p.role)
  if (roles.length > 0) return { etat: 'a_choisir', roles }
  const retenu = planRetenu(propositions, choix, lu)
  if (retenu.refus !== null) return { etat: 'refus', refus: retenu.refus }
  const changements = changementsDuPlan(retenu.comptes, lu)
  return changements.length === 0 ? { etat: 'a_jour' } : { etat: 'a_regler', comptes: retenu.comptes, changements }
}

const compteEtLibelle = ({ compte, libelle }: CompteTenu) => (libelle ? `${compte} « ${libelle} »` : compte)

/** La ligne d'un changement : « Banque : 512000 « Banque » → 512100 « Banque principale » ». */
export function texteDUnChangement(c: ChangementDuPlan): string {
  return `${nomDuRole(c.role)} : ${compteEtLibelle(c.avant)} → ${compteEtLibelle(c.apres)}`
}

/** La confirmation du clic, qui NOMME chaque compte qui change. */
export function confirmationDuReglage(changements: readonly ChangementDuPlan[]): string {
  return `Régler le plan comptable du dossier sur ${changements.length > 1 ? `ces ${changements.length} comptes` : 'ce compte'} ?\n`
    + changements.map((c) => `– ${texteDUnChangement(c)}`).join('\n')
    + '\nLe plan ne se change plus dès que le dossier porte une écriture ou un à-nouveau.'
}

/** Pourquoi un compte de la balance ne peut pas tenir le rôle sous la racine duquel il se trouve. */
export function texteDUnEcarte(e: EcarteDuRole): string {
  const compte = `${e.compteOrigine}${e.libelle ? ` ${e.libelle}` : ''}`
  return e.motif === 'hors_forme'
    ? `${compte} : plus de six chiffres significatifs, il ne peut pas tenir ce rôle ; la reprise l’ouvre sous son numéro, et l’application n’y écrira pas.`
    : `${compte} : c’est, à des zéros près, le compte d’une catégorie du dossier (${e.categorie}) ; un compte que l’application écrit ne se partage pas avec une catégorie.`
}

/**
 * Les banques de la balance, toutes ouvertes sur la banque du plan (lib/aNouveaux.ts, `compteRangeSurLePlan`) : la phrase
 * qui les dit, et, s'il y en a plusieurs, qui renvoie à la carte « Comptes bancaires » pour les autres comptes — l'écriture
 * qui éclate l'ouverture (MCB5g) en détache le solde au relevé du 31 décembre. Nulle sans banque à l'ouverture.
 */
export function phraseDesBanquesReunies(lignes: readonly LigneANouveau[], banque: string): string | null {
  const banques = lignes.filter((l) => l.compte === banque && l.compteOrigine !== null)
  if (banques.length === 0) return null
  const solde = banques.reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100), 0) / 100
  const liste = banques.map((l) => `${l.compteOrigine}${l.libelle ? ` ${l.libelle}` : ''}`).join(', ')
  if (banques.length === 1) {
    return `La banque de la balance (${liste}) s’ouvre sur la banque du plan (${banque}).`
  }
  return `Les ${banques.length} comptes bancaires de la balance (${liste}) s’ouvrent réunis sur la banque du plan (${banque}), `
    + `pour un solde de ${formatMoney(solde)}. Les autres comptes bancaires du dossier se déclarent dans la carte « Comptes `
    + 'bancaires » : leur solde au relevé du 31 décembre se détache alors de la banque du plan.'
}
