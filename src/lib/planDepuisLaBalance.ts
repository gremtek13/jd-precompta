// PC6 — LA REPRISE PROPOSE LE PLAN (ligne 43 ; conception, HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA
// CONCEPTION », § 3.8 et § 4.3 ; le récit : « 11/11/2026 — PC6 : LA REPRISE PROPOSE LE PLAN (PRÉPARÉE, PAS APPLIQUÉE) »).
//
// Un dossier venu d'un autre logiciel arrive avec sa balance, et sa balance dit le plan qu'il tenait : « L'entité établit
// un plan de comptes » (PCG, règlement ANC n° 2014-03 consolidé au 1er janvier 2026, art. 1011-5) — le sien, pas celui de
// l'application. Le plan d'abord, proposé depuis la balance, puis les à-nouveaux rangés sur ce plan (lib/aNouveaux.ts,
// `preparerANouveauxSurLePlanSelon`). Pur : rien n'est lu ni écrit ici ; rien ne s'enregistre sans le clic du cabinet
// (`regler_plan_du_dossier`, PC4, dans un dossier qui ne porte encore rien sur ses comptes).
//
// POUR CHAQUE RÔLE du catalogue, les comptes de la balance sous ses racines, toutes classes (le 6611… d'avant dit
// l'habitude du cabinet aussi bien que le 512…), ramenés à la forme d'un compte de rôle — six chiffres (PC4, Q5) « à des
// zéros près » (art. 1131-2 : 4455100 est le 445510) :
//   - un seul : PROPOSÉ, avec le libellé de la balance — le CompteLib du FEC continue (LPF, art. A47 A-1 ; BOI-CF-IOR-60-40-20,
//     § 150 : l'intitulé de la subdivision que l'entité a ouverte) ;
//   - plusieurs (deux 401…, deux 164…, deux 512…) : LISTÉS, le cabinet choisit ; la banque du plan est celle du compte
//     bancaire PRINCIPAL (MCB1 : il suit le rôle `banque`), les autres 512… de la balance sont les autres comptes bancaires
//     du dossier, que la reprise ouvre réunis sur la banque du plan et dont l'écriture qui éclate l'ouverture (MCB5g,
//     `ouverture_eclatee_par_compte`) détache le solde au relevé du 31 décembre ;
//   - aucun : le plan RESTE celui du dossier.
// ÉCARTÉS, et dits : un compte dont les chiffres significatifs passent six (il ne peut pas être un compte de rôle ; la
// reprise l'ouvre sous son numéro, et l'application n'y écrira pas) ; et, pour un rôle du bilan ou les indemnités
// kilométriques, le compte d'une catégorie que le dossier emploie — les refus 9 et 10 de `regler_plan_du_dossier`, redits
// ici pour qu'une proposition ne soit pas un refus (le 625100 de « Carburant / déplacements » dans la balance d'un BNC
// n'est pas le compte du barème : le barème et les frais réels restent séparés).
//
// DERRIÈRE `PLAN_DEPUIS_LA_BALANCE_PREVU`, baissé : la carte de la balance (pages/dossier/BalanceCard.tsx, son premier temps)
// ne l'appelle pas, et la reprise range comme hier. LE LEVER
// AVANT de coller la migration `plan_depuis_la_balance` (supabase/preparees/), qui fait refuser à `enregistrer_a_nouveaux`
// ce que le rangement d'hier envoie encore (un 4455100, un 4010000) : ce qui s'ajoute, puis le resserrement.

import type { LigneBalance } from './balanceImport'
import {
  memeCompteAuxZerosPres,
  rolesLusAuPlan,
  type CleRoleDuPlan,
  type DefinitionRoleComptable,
  type LibellesDuPlan,
  type PlanComptable,
  type PrefixesDuPlan,
  type RoleDeTiers,
} from './planComptable'

/** La reprise propose le plan depuis la balance, et range ses à-nouveaux sur lui (PC6). Baissé : la reprise d'hier. */
export const PLAN_DEPUIS_LA_BALANCE_PREVU = false

/** Un compte de rôle a six chiffres (PC4, Q5). */
const LONGUEUR_D_UN_COMPTE_DE_ROLE = 6

/**
 * La forme d'un compte de rôle d'un numéro de la balance, à des zéros près (art. 1131-2) : ses chiffres significatifs
 * complétés de zéros jusqu'à six ; nulle quand ils passent six (4011234 ne peut pas être un compte de rôle) ou que le
 * numéro n'est pas fait de chiffres.
 */
export function formeDUnCompteDeRole(numero: string): string | null {
  const compte = numero.trim()
  if (!/^[0-9]+$/.test(compte)) return null
  const significatif = compte.replace(/0+$/, '')
  if (significatif.length === 0 || significatif.length > LONGUEUR_D_UN_COMPTE_DE_ROLE) return null
  return significatif.padEnd(LONGUEUR_D_UN_COMPTE_DE_ROLE, '0')
}

/** Un compte de la balance proposable pour un rôle : sa forme à six chiffres, les numéros qui la portent, le libellé lu. */
export interface CandidatDuRole {
  compte: string
  comptesOrigine: string[]
  /** Le libellé de la balance, s'il est un CompteLib que le plan accepte ; nul sinon (celui du catalogue). */
  libelle: string | null
}

/** Un compte de la balance sous les racines d'un rôle, qui ne peut pas le tenir. */
export interface EcarteDuRole {
  compteOrigine: string
  libelle: string
  motif: 'hors_forme' | 'compte_d_une_categorie'
  /** Le compte de la catégorie, pour `compte_d_une_categorie`. */
  categorie: string | null
}

export type PropositionDuRole =
  | { role: CleRoleDuPlan; etat: 'propose'; candidat: CandidatDuRole; change: boolean; ecartes: EcarteDuRole[] }
  | { role: CleRoleDuPlan; etat: 'au_choix'; candidats: CandidatDuRole[]; ecartes: EcarteDuRole[] }
  | { role: CleRoleDuPlan; etat: 'reste'; ecartes: EcarteDuRole[] }

/** Le plan du dossier tel que la page le lit (`LectureDuPlan` sans son motif). */
export interface PlanLu {
  plan: PlanComptable
  libelles: LibellesDuPlan
  prefixes: PrefixesDuPlan
}

// Le libellé (CompteLib) que `regler_plan_du_dossier` accepte (refus 11) : une ligne, d'un à deux cents caractères, sans
// caractère de contrôle. Un libellé de la balance qui n'en est pas un laisse celui du catalogue — jamais tronqué.
const estUnControle = (caractere: string) => {
  const code = caractere.codePointAt(0)!
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

function libelleAccepte(libelle: string): string | null {
  const l = libelle.trim()
  return l !== '' && l.length <= 200 && ![...l].some(estUnControle) ? l : null
}

// Un rôle du bilan (son compte du catalogue en classe 1 à 5) ou les indemnités kilométriques, changés vers le compte d'une
// catégorie que le dossier emploie : `regler_plan_du_dossier` le refuse (refus 9 et 10), sauf au compte du catalogue.
// Les deux rôles du change (656/666, 756/766) sont des comptes de résultat : jamais refusés sur une catégorie.
function refuseSurUneCategorie(definition: DefinitionRoleComptable, compte: string): boolean {
  if (compte === definition.compteDefaut) return false
  return /^[1-5]/.test(definition.compteDefaut) || definition.role === 'indemnites_kilometriques'
}

/**
 * LES RÔLES QUE LA REPRISE PROPOSE, RETIENT ET COMPARE : ceux que la lecture du plan porte aujourd'hui (`rolesLusAuPlan` :
 * les deux du change le drapeau de leur migration levé — ligne 31), et que le plan lu porte. `regler_plan_du_dossier`
 * REMET AU CATALOGUE tout rôle absent de sa liste : un rôle de la base que la reprise oublierait (un 666000 choisi pour les
 * pertes de change) repartirait à son défaut sans que la confirmation le dise. Un rôle que le plan lu ne porte pas (un
 * plan d'avant le drapeau) n'a ni compte connu ni rien à comparer : il n'est ni proposé ni envoyé, comme dans
 * `changementsDuModele` (lib/modeleDuCabinet.ts) ; la lecture du plan les exige, le drapeau levé.
 */
export function rolesDuPlanLu(lu: PlanLu): readonly (DefinitionRoleComptable & { readonly role: CleRoleDuPlan })[] {
  return rolesLusAuPlan().filter((r) => lu.plan[r.role] !== undefined)
}

/**
 * Le plan que la balance propose, rôle par rôle, dans l'ordre du catalogue. `comptesDesCategories` : les comptes des
 * catégories que le dossier emploie (les siennes et les communes), que la base compare à des zéros près.
 */
export function planDepuisLaBalance(balance: readonly LigneBalance[], lu: PlanLu,
  comptesDesCategories: readonly string[]): PropositionDuRole[] {
  return rolesDuPlanLu(lu).map((definition) => {
    const { role, libelleDefaut } = definition
    const candidats: CandidatDuRole[] = []
    const ecartes: EcarteDuRole[] = []
    for (const ligne of balance) {
      const origine = ligne.compte.trim()
      if (!definition.racines.some((racine) => origine.startsWith(racine))) continue
      const compte = formeDUnCompteDeRole(origine)
      if (compte === null) {
        ecartes.push({ compteOrigine: origine, libelle: ligne.libelle, motif: 'hors_forme', categorie: null })
        continue
      }
      const categorie = refuseSurUneCategorie(definition, compte)
        ? comptesDesCategories.find((c) => memeCompteAuxZerosPres(c, compte)) ?? null
        : null
      if (categorie !== null) {
        ecartes.push({ compteOrigine: origine, libelle: ligne.libelle, motif: 'compte_d_une_categorie', categorie })
        continue
      }
      // Le capital et les deux comptes du résultat n'ont pas de libellé au catalogue : le report des soldes les nomme.
      const libelle = libelleDefaut === null ? null : libelleAccepte(ligne.libelle)
      const deja = candidats.find((c) => c.compte === compte)
      if (deja) {
        deja.comptesOrigine.push(origine)
        deja.libelle ??= libelle
      } else {
        candidats.push({ compte, comptesOrigine: [origine], libelle })
      }
    }
    if (candidats.length === 0) return { role, etat: 'reste', ecartes }
    if (candidats.length > 1) return { role, etat: 'au_choix', candidats, ecartes }
    const [candidat] = candidats
    const change = candidat.compte !== lu.plan[role] || (candidat.libelle !== null && candidat.libelle !== (lu.libelles[role] ?? null))
    return { role, etat: 'propose', candidat, change, ecartes }
  })
}

/** Une ligne de `p_comptes`, telle que `regler_plan_du_dossier` la lit. */
export interface LigneDuPlanReglee {
  role: CleRoleDuPlan
  compte: string
  libelle: string | null
  prefixe_auxiliaire: string | null
}

/**
 * Ce que le cabinet a retenu, rôle par rôle : le compte choisi parmi les candidats d'un rôle « au choix » ; `null` refuse la
 * proposition d'un rôle « proposé ». Un rôle absent : la proposition s'applique, un rôle au choix reste.
 */
export type ChoixDuPlan = Readonly<Partial<Record<CleRoleDuPlan, string | null>>>

/**
 * Le plan ENTIER que le clic enverra à `regler_plan_du_dossier` (qui remet au catalogue tout rôle absent) : pour chaque
 * rôle, la proposition retenue, sinon le plan lu du dossier ; seuls les rôles qui diffèrent du catalogue — compte, libellé
 * ou préfixe — y figurent. Un choix qui n'est pas l'un des candidats du rôle rend un refus, jamais un plan deviné.
 */
export function planRetenu(propositions: readonly PropositionDuRole[], choix: ChoixDuPlan, lu: PlanLu):
  { comptes: LigneDuPlanReglee[]; refus: null } | { comptes: null; refus: string } {
  const comptes: LigneDuPlanReglee[] = []
  for (const definition of rolesDuPlanLu(lu)) {
    const { role } = definition
    const proposition = propositions.find((p) => p.role === role)
    let compte = lu.plan[role]!
    let libelle: string | null = lu.libelles[role] ?? null
    const voulu = choix[role]
    if (proposition?.etat === 'propose' && voulu !== null) {
      if (voulu !== undefined && voulu !== proposition.candidat.compte) {
        return { comptes: null, refus: `Le compte « ${voulu} » n’est pas celui que la balance propose pour le rôle « ${role} ».` }
      }
      compte = proposition.candidat.compte
      libelle = proposition.candidat.libelle ?? (compte === lu.plan[role] ? libelle : definition.libelleDefaut)
    } else if (proposition?.etat === 'au_choix' && voulu != null) {
      const candidat = proposition.candidats.find((c) => c.compte === voulu)
      if (!candidat) {
        return { comptes: null, refus: `Le compte « ${voulu} » n’est pas l’un des comptes de la balance proposés pour le rôle « ${role} ».` }
      }
      compte = candidat.compte
      libelle = candidat.libelle ?? (compte === lu.plan[role] ? libelle : definition.libelleDefaut)
    } else if (voulu !== undefined && voulu !== null && proposition?.etat !== 'au_choix') {
      return { comptes: null, refus: `La balance ne propose aucun compte pour le rôle « ${role} ».` }
    }
    const prefixe = definition.prefixeAuxiliaireDefaut === null ? null : lu.prefixes[role as RoleDeTiers]
    const libelleRegle = libelle === definition.libelleDefaut ? null : libelle
    const prefixeRegle = prefixe === definition.prefixeAuxiliaireDefaut ? null : prefixe
    if (compte !== definition.compteDefaut || libelleRegle !== null || prefixeRegle !== null) {
      comptes.push({ role, compte, libelle: libelleRegle, prefixe_auxiliaire: prefixeRegle })
    }
  }
  return { comptes, refus: null }
}
