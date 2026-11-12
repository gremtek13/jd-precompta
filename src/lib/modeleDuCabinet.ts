// PC5 — LE MODÈLE DE PLAN DU CABINET (ligne 43 ; conception, HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA
// CONCEPTION », § 3.1, § 3.10, § 4.2 ; le récit : « 12/11/2026 — PC5 : LE MODÈLE DE PLAN DU CABINET (PRÉPARÉ, PAS
// APPLIQUÉ) » ; la migration : supabase/schema/20261112134459_modele_de_plan_du_cabinet.sql).
//
// Le plan est celui du dossier ; le modèle est l'habitude du cabinet, qu'il COPIE dans un dossier neuf (43-Q1 : « le
// modèle ne fait que semer ») — il ne s'hérite jamais, et un changement du modèle ne touche aucun dossier existant. Le chef
// du cabinet le règle (43-Q3) dans la page du cabinet ; « Nouveau dossier » l'applique au dossier créé.
//
// Pur : rien n'est lu ni écrit ici (la lecture et l'écriture : lib/modeleDuCabinetLecture.ts). Le module redit, AVANT le
// clic et sur la saisie TELLE QU'ELLE PART, les refus de `regler_modele_du_cabinet` dans leur ordre et sous leurs mots,
// que modeleDuCabinet.test.ts confronte au texte de la migration ; la base reste juge.
//
// DERRIÈRE `MODELE_DU_CABINET_PREVU`, baissé : la page du cabinet ne montre pas la carte, la carte du plan d'un dossier
// n'offre pas « Appliquer le modèle du cabinet » (PC5b), « Nouveau dossier » crée comme hier, l'export d'un cabinet ne lit pas le modèle, et la sauvegarde ne nomme pas la table. Le lever APRÈS l'application
// de la migration (ce qui s'ajoute, puis la bascule de l'application).
import {
  FORME_COMPTE_DE_ROLE,
  FORME_PREFIXE_AUXILIAIRE,
  ROLES_COMPTABLES,
  planDeLaReponse,
  sousUneRacineDuRole,
  type CleRoleComptable,
  type ReponseDuPlan,
  type RoleDeTiers,
} from './planComptable'
import type { LigneDuPlanReglee, PlanLu } from './planDepuisLaBalance'
import { nomDuRole } from './planDepuisLaBalanceVue'

// Le nom d'un rôle à l'écran, redonné ici : la carte du modèle ne lit pas les modules de la reprise (PC6), que seule la carte
// de la balance appelle, derrière son drapeau (planDepuisLaBalance.test.ts).
export { nomDuRole }

/** La migration `modele_de_plan_du_cabinet` est en base (12/11/2026) : la carte, l'application à la création, l'export. */
export const MODELE_DU_CABINET_PREVU: boolean = true

/** La table que la migration crée : une table du CABINET, hors de l'export d'un dossier (lib/sauvegarde.ts). */
export const TABLES_DU_MODELE_DU_CABINET = ['plan_comptable_cabinet'] as const

// ── La lecture ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le modèle tel que `modele_du_cabinet` le rend : entier (les 32 rôles, comme un plan), et les rôles qu'il RÈGLE — ceux
 *  qu'« appliquer » copiera dans un dossier —, ou rien, avec le motif. */
export type LectureDuModele =
  | { modele: PlanLu; regles: readonly CleRoleComptable[]; motif: null }
  | { modele: null; motif: string }

const ORIGINES_DU_MODELE = new Set(['modele_du_cabinet', 'application'])

/**
 * Le modèle depuis la réponse de `modele_du_cabinet`, qui a la forme de `plan_du_dossier` : le même examen
 * (`planDeLaReponse` : entier ou rien, chaque compte sous sa racine, chaque préfixe de sa forme), plus l'origine, qui dit
 * les rôles réglés — une origine inconnue rend le modèle illisible, jamais devinée.
 */
export function modeleDeLaReponse(reponse: ReponseDuPlan): LectureDuModele {
  const lu = planDeLaReponse(reponse)
  if (lu.plan === null) return { modele: null, motif: lu.motif.replace('plan comptable', 'modèle de plan') }
  const regles = new Set<string>()
  for (const ligne of reponse.data as Record<string, unknown>[]) {
    if (typeof ligne.origine !== 'string' || !ORIGINES_DU_MODELE.has(ligne.origine)) {
      return { modele: null, motif: `modèle de plan illisible : l’origine du rôle « ${String(ligne.role)} » n’est pas lue` }
    }
    if (ligne.origine === 'modele_du_cabinet') regles.add(String(ligne.role))
  }
  return {
    modele: { plan: lu.plan, libelles: lu.libelles, prefixes: lu.prefixes },
    regles: ROLES_COMPTABLES.filter((r) => regles.has(r.role)).map((r) => r.role),
    motif: null,
  }
}

// ── La saisie ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un rôle tel que la carte le saisit : son compte, son libellé (vide : celui du catalogue), son préfixe (tiers seuls). */
export interface SaisieDUnRole {
  compte: string
  libelle: string
  prefixe: string
}

export type SaisieDuModele = Readonly<Record<CleRoleComptable, SaisieDUnRole>>

const estDeTiers = (role: CleRoleComptable): role is RoleDeTiers =>
  ROLES_COMPTABLES.some((r) => r.role === role && r.prefixeAuxiliaireDefaut !== null)

/** La saisie de départ : le modèle lu, rôle par rôle. */
export function saisieDuModele(lu: PlanLu): SaisieDuModele {
  return Object.fromEntries(ROLES_COMPTABLES.map(({ role }) => [role, {
    compte: lu.plan[role],
    libelle: lu.libelles[role] ?? '',
    prefixe: estDeTiers(role) ? lu.prefixes[role] : '',
  }])) as Record<CleRoleComptable, SaisieDUnRole>
}

/**
 * Le modèle ENTIER que le clic enverra à `regler_modele_du_cabinet` (qui remet au catalogue tout rôle absent) : les rôles
 * qui diffèrent du catalogue — compte, libellé ou préfixe —, chacun tel qu'il part : le compte et le libellé sans leurs
 * blancs de bord, un libellé vide ou égal au catalogue nul, un préfixe égal au catalogue nul, aucun préfixe hors des tiers.
 */
export function comptesDuModele(saisie: SaisieDuModele): LigneDuPlanReglee[] {
  return ROLES_COMPTABLES.flatMap((definition) => {
    const { role } = definition
    const s = saisie[role]
    const compte = s.compte.trim()
    const libelle = s.libelle.trim()
    const libelleRegle = libelle === '' || libelle === definition.libelleDefaut ? null : libelle
    const prefixe = s.prefixe.trim()
    const prefixeRegle = definition.prefixeAuxiliaireDefaut === null || prefixe === definition.prefixeAuxiliaireDefaut ? null : prefixe
    return compte !== definition.compteDefaut || libelleRegle !== null || prefixeRegle !== null
      ? [{ role, compte, libelle: libelleRegle, prefixe_auxiliaire: prefixeRegle }]
      : []
  })
}

// ── Les refus, avant le clic (ceux de `regler_modele_du_cabinet`, 6 à 12, dans leur ordre et sous leurs mots) ─────────

// « À des zéros près » (PCG, art. 1131-2) : `rtrim(compte, '0')`, comme la fonction.
const sansZerosDeFin = (compte: string) => compte.replace(/0+$/, '')

// Les blancs que la fonction retire au bord d'un libellé, et les caractères de contrôle qu'elle refuse ([[:cntrl:]]).
const estUnBlanc = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const estUnControle = (c: string) => {
  const code = c.codePointAt(0)!
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

function libelleRefuse(libelle: string): boolean {
  const caracteres = [...libelle]
  return caracteres.every(estUnBlanc) || caracteres.length > 200 || caracteres.some(estUnControle)
}

/** L'ordre des octets, celui du `collate "C"` de la fonction, pour nommer la même catégorie qu'elle. */
const parOctets = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Le premier refus que `regler_modele_du_cabinet` opposerait à ces comptes, ou `null`. `comptesDesCategoriesCommunes` :
 * les comptes des catégories communes à tous les dossiers (`dossier_id` nul), lus EN ENTIER (refus 9 et 10).
 */
export function refusDuModele(comptes: readonly LigneDuPlanReglee[], comptesDesCategoriesCommunes: readonly string[]): string | null {
  const definition = (role: CleRoleComptable) => ROLES_COMPTABLES.find((r) => r.role === role)!
  // 6. Six chiffres.
  for (const l of comptes) {
    if (!FORME_COMPTE_DE_ROLE.test(l.compte)) return `Le compte du rôle « ${l.role} » s'écrit en six chiffres : « ${l.compte} » n'en est pas un.`
  }
  // 7. La racine du rôle.
  for (const l of comptes) {
    if (!sousUneRacineDuRole(l.role, l.compte)) {
      return `Le compte du rôle « ${l.role} » commence par sa racine du plan comptable (${definition(l.role).racines.join(' ou ')}) : « ${l.compte} » n'en est pas un.`
    }
  }
  // 8. Deux rôles du modèle effectif sur le même compte, à des zéros près (dans l'ordre du catalogue).
  const effectif = [...ROLES_COMPTABLES].sort((a, b) => a.ordre - b.ordre)
    .map((r) => ({ role: r.role, compte: comptes.find((l) => l.role === r.role)?.compte ?? r.compteDefaut }))
  for (let i = 0; i < effectif.length; i++) {
    for (let j = i + 1; j < effectif.length; j++) {
      if (sansZerosDeFin(effectif[i].compte) === sansZerosDeFin(effectif[j].compte)) {
        return `Les rôles « ${effectif[i].role} » et « ${effectif[j].role} » se tiendraient sur le même compte (« ${effectif[i].compte} »), à des zéros près : un compte ne tient qu'un rôle.`
      }
    }
  }
  const categorieDe = (compte: string) => comptesDesCategoriesCommunes
    .filter((c) => sansZerosDeFin(c) === sansZerosDeFin(compte)).sort(parOctets)[0]
  // 9. Un rôle du bilan changé vers le compte d'une catégorie commune.
  for (const l of comptes) {
    const d = definition(l.role)
    if (!/^[1-5]/.test(d.compteDefaut) || l.compte === d.compteDefaut) continue
    const categorie = categorieDe(l.compte)
    if (categorie !== undefined) {
      return `Le compte « ${l.compte} » du rôle « ${l.role} » est celui d'une catégorie commune à tous les dossiers (« ${categorie} »), à des zéros près : un compte de bilan que l'application écrit ne se partage pas avec une catégorie.`
    }
  }
  // 10. Les indemnités kilométriques changées vers le compte d'une catégorie commune.
  for (const l of comptes) {
    if (l.role !== 'indemnites_kilometriques' || l.compte === definition(l.role).compteDefaut) continue
    const categorie = categorieDe(l.compte)
    if (categorie !== undefined) {
      return `Le compte des indemnités kilométriques (« ${l.compte} ») est celui d'une catégorie commune à tous les dossiers (« ${categorie} »), à des zéros près : le barème et les frais réels restent séparés.`
    }
  }
  // 11. Le libellé.
  for (const l of comptes) {
    if (l.libelle !== null && libelleRefuse(l.libelle)) {
      return `Le libellé du rôle « ${l.role} » tient sur une ligne, d'un à deux cents caractères ; nul, c'est celui du catalogue.`
    }
  }
  // 12. Le préfixe : sur les tiers seuls, de sa forme, jamais partagé par deux tiers du modèle effectif.
  for (const l of comptes) {
    if (l.prefixe_auxiliaire !== null && !estDeTiers(l.role)) {
      return `Seuls les comptes de tiers (fournisseurs, fournisseurs d'immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « ${l.role} ».`
    }
  }
  for (const l of comptes) {
    if (l.prefixe_auxiliaire !== null && !FORME_PREFIXE_AUXILIAIRE.test(l.prefixe_auxiliaire)) {
      return `Le préfixe des comptes auxiliaires du rôle « ${l.role} » s'écrit d'une à cinq lettres majuscules ou chiffres : « ${l.prefixe_auxiliaire} » n'en est pas un.`
    }
  }
  const tiers = effectif.filter((e) => estDeTiers(e.role)).map((e) => ({
    role: e.role,
    prefixe: comptes.find((l) => l.role === e.role)?.prefixe_auxiliaire ?? definition(e.role).prefixeAuxiliaireDefaut!,
  }))
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      if (tiers[i].prefixe === tiers[j].prefixe) {
        return `Les rôles « ${tiers[i].role} » et « ${tiers[j].role} » partageraient le préfixe de comptes auxiliaires « ${tiers[i].prefixe} » : deux natures de tiers ne partagent pas un compte auxiliaire.`
      }
    }
  }
  return null
}

// ── Ce qui change, et la confirmation qui le NOMME ───────────────────────────────────────────────────────────────────

export interface RoleTenu {
  compte: string
  libelle: string | null
  prefixe: string | null
}

export interface ChangementDuModele {
  role: CleRoleComptable
  avant: RoleTenu
  apres: RoleTenu
}

/** Ce que le modèle ENTIER du clic change au modèle lu, rôle par rôle : compte, libellé et préfixe des tiers. */
export function changementsDuModele(comptes: readonly LigneDuPlanReglee[], lu: PlanLu): ChangementDuModele[] {
  return ROLES_COMPTABLES.flatMap((d) => {
    const ligne = comptes.find((c) => c.role === d.role)
    const tiers = estDeTiers(d.role)
    const apres: RoleTenu = {
      compte: ligne?.compte ?? d.compteDefaut,
      libelle: ligne?.libelle ?? d.libelleDefaut,
      prefixe: tiers ? ligne?.prefixe_auxiliaire ?? d.prefixeAuxiliaireDefaut : null,
    }
    const avant: RoleTenu = { compte: lu.plan[d.role], libelle: lu.libelles[d.role], prefixe: tiers ? lu.prefixes[d.role as RoleDeTiers] : null }
    return apres.compte === avant.compte && apres.libelle === avant.libelle && apres.prefixe === avant.prefixe
      ? [] : [{ role: d.role, avant, apres }]
  })
}

const roleTenu = ({ compte, libelle, prefixe }: RoleTenu) =>
  `${compte}${libelle ? ` « ${libelle} »` : ''}${prefixe ? ` (auxiliaires ${prefixe}…)` : ''}`

/** La ligne d'un changement : « Banque : 512000 « Banque » → 512100 « Banque principale » ». */
export function texteDUnChangementDuModele(c: ChangementDuModele): string {
  return `${nomDuRole(c.role)} : ${roleTenu(c.avant)} → ${roleTenu(c.apres)}`
}

/** La confirmation du clic, qui NOMME chaque compte qui change, et dit ce que le modèle ne touche pas. */
export function confirmationDuModele(changements: readonly ChangementDuModele[]): string {
  return `Régler le modèle de plan du cabinet sur ${changements.length > 1 ? `ces ${changements.length} changements` : 'ce changement'} ?\n`
    + changements.map((c) => `– ${texteDUnChangementDuModele(c)}`).join('\n')
    + '\nLe modèle ne change aucun dossier existant : il se copie dans un dossier à sa création.'
}

// ── « Nouveau dossier » : ce qui sera appliqué, dit avant le clic ───────────────────────────────────────────────────

export interface ModeleALaCreation {
  /** Le clic appliquera le modèle au dossier créé. */
  applique: boolean
  phrase: string
}

/** Ce que « Créer » fera du modèle, selon ce qui en a été lu (`null` : la lecture n'est pas revenue). */
export function modeleALaCreation(lecture: LectureDuModele | null): ModeleALaCreation {
  if (lecture === null) return { applique: false, phrase: 'Lecture du modèle de plan du cabinet…' }
  if (lecture.modele === null) {
    return {
      applique: false,
      phrase: `Le modèle de plan du cabinet n'a pas pu être lu (${lecture.motif}) : le dossier sera créé avec le plan de l'application, sans le modèle.`,
    }
  }
  if (lecture.regles.length === 0) {
    return { applique: false, phrase: 'Le cabinet n’a pas de modèle de plan : le dossier prendra le plan de l’application.' }
  }
  const nommes = lecture.regles.slice(0, 3).map((role) => `${nomDuRole(role)} ${lecture.modele.plan[role]}`)
  const reste = lecture.regles.length > 3 ? `, et ${lecture.regles.length - 3} autre(s)` : ''
  return {
    applique: true,
    phrase: `Le modèle de plan du cabinet s’appliquera au dossier créé : ${lecture.regles.length} rôle(s) réglé(s) (${nommes.join(', ')}${reste}).`,
  }
}

/** Ce que dit la fenêtre quand le dossier est créé mais que le modèle ne s'est pas appliqué. */
export function phraseDuModeleNonApplique(refus: string): string {
  return `Le dossier est créé, mais le modèle de plan du cabinet ne lui a pas été appliqué : ${refus} Son plan reste celui de l’application.`
}

// ── « Appliquer le modèle du cabinet » sur un dossier existant (PC5b) : ce que la carte du plan dit AVANT le clic ─────────

/** Ce que la carte du plan d'un dossier offre du modèle : la lecture qui n'est pas revenue, un refus dit en clair, ou le
 *  geste, avec ce qu'il change. */
export type ModeleAUnDossier =
  | { etat: 'lecture'; phrase: string }
  | { etat: 'refus'; phrase: string }
  | { etat: 'a_appliquer'; regles: number; changements: ChangementDuModele[] }

/**
 * Le geste que le modèle offre à CE dossier, selon ce qui en a été lu (`null` : la lecture n'est pas revenue) et le plan
 * lu du dossier. Le modèle copié est celui que `appliquer_modele_du_cabinet` copie : les rôles qui s'écartent du catalogue
 * (`comptesDuModele` du modèle lu, le même calcul que la carte du modèle), et ce que l'application en change se juge sur
 * le plan lu — jamais une règle recopiée. Sont dits avant le clic : le modèle illisible (l'accès refusé s'y lit, la base
 * le refusant à qui n'est pas du cabinet), le modèle vide, un exercice validé (le plan se fige avec les écritures) et un
 * plan qui tient déjà le modèle. Ce que la base seule voit — une écriture au brouillon, un à-nouveau — se dit à son refus.
 */
export function modeleAUnDossier(lecture: LectureDuModele | null, lu: PlanLu, exerciceValide: boolean): ModeleAUnDossier {
  if (lecture === null) return { etat: 'lecture', phrase: 'Lecture du modèle de plan du cabinet…' }
  if (lecture.modele === null) {
    return { etat: 'refus', phrase: `Le modèle de plan du cabinet n’a pas pu être lu (${lecture.motif}) : il ne s’applique pas à ce dossier.` }
  }
  if (lecture.regles.length === 0) {
    return { etat: 'refus', phrase: 'Le cabinet n’a pas de modèle de plan : il n’y a rien à appliquer à ce dossier.' }
  }
  if (exerciceValide) {
    return { etat: 'refus', phrase: 'Un exercice de ce dossier est validé : son plan ne change plus, le modèle ne peut pas lui être appliqué.' }
  }
  const changements = changementsDuModele(comptesDuModele(saisieDuModele(lecture.modele)), lu)
  if (changements.length === 0) {
    return { etat: 'refus', phrase: 'Le plan de ce dossier tient déjà le modèle du cabinet : il n’y a rien à appliquer.' }
  }
  return { etat: 'a_appliquer', regles: lecture.regles.length, changements }
}

/** La confirmation du clic : le nombre de rôles que le modèle règle, et chaque compte qui change dans CE dossier. */
export function confirmationDeLApplication(regles: number, changements: readonly ChangementDuModele[]): string {
  return `Appliquer le modèle de plan du cabinet à ce dossier ? ${regles > 1 ? `${regles} rôles s’écartent` : 'Un rôle s’écarte'} du plan de l’application ; `
    + `${changements.length > 1 ? `ces ${changements.length} comptes changent` : 'ce compte change'} dans ce dossier :\n`
    + changements.map((c) => `– ${texteDUnChangementDuModele(c)}`).join('\n')
    + '\nLe plan ne se change plus dès que le dossier porte une écriture ou un à-nouveau.'
}

// ── L'export d'un cabinet (conception, § 3.10 : « L'export d'un cabinet porte son modèle ») ──────────────────────────

// Comme les autres exports de l'application (la piste d'audit, lib/contactsExport.ts) : BOM UTF-8, point-virgule, un champ
// qui porte un point-virgule ou un guillemet entre guillemets, un saut de ligne ramené à une espace.
const champ = (valeur: string) => {
  const propre = valeur.replace(/[\r\n]+/g, ' ').trim()
  return propre.includes(';') || propre.includes('"') ? `"${propre.replace(/"/g, '""')}"` : propre
}

/** Le modèle effectif en CSV : une ligne par rôle, et s'il est réglé par le modèle ou tenu du catalogue. */
export function csvDuModele(lecture: { modele: PlanLu; regles: readonly CleRoleComptable[] }): string {
  const lignes = [['Rôle', 'Code du rôle', 'Compte', 'Libellé', 'Préfixe des auxiliaires', 'Origine']]
  for (const { role } of ROLES_COMPTABLES) {
    lignes.push([nomDuRole(role), role, lecture.modele.plan[role], lecture.modele.libelles[role] ?? '',
      estDeTiers(role) ? lecture.modele.prefixes[role] : '', lecture.regles.includes(role) ? 'modèle du cabinet' : 'application'])
  }
  return '﻿' + lignes.map((l) => l.map(champ).join(';')).join('\r\n') + '\r\n'
}
