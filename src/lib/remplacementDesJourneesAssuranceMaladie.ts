import type { EspaceVentes } from './espaceVentes'
import { formatDate, formatMoney } from './format'
import { cleDUnPaiement, refusDeLImport, type ImportAEnvoyer, type PaiementAgrege } from './paiementsAssuranceMaladie'

// LE REMPLACEMENT D'UNE JOURNÉE COMPTABLE NON ASSOCIÉE PAR UN NOUVEL EXPORT DES PAIEMENTS DE L'ASSURANCE MALADIE (conception 53,
// § 14.2 ; NOE4R-Q2 (B), réponse du cabinet du 27/11/2026 ; la base : supabase/preparees/
// 20261127215500_remplacement_des_journees_assurance_maladie.sql, préparée, à coller APRÈS celle de NOE4R-Q1). PUR : ni base,
// ni horloge, ni fichier ; ce que l'écran d'import (`components/PaiementsAssuranceMaladie.tsx`) nomme avant le clic, et les mots
// de la base, redits sous les mêmes mots et dans le même ordre (remplacementDesJourneesAssuranceMaladie.test.ts les relit dans
// le texte de la migration).
//
// LA RÈGLE (le cabinet : « jamais en silence, jamais une journée associée, la trace, tout ou rien ») : un nouvel export qui porte
// une journée avec d'autres chiffres en REMPLACE les paiements qui diffèrent — la journée TELLE QUE L'EXPORT LA PORTE : un
// paiement de même clé et d'autres chiffres remplace celui de la base ; un paiement d'une clé neuve entre ; un paiement égal est
// passé ; un paiement en base que le fichier ne porte pas RESTE (un fichier lu sur une seule part ne dit pas que l'autre est
// partie). L'écran nomme chaque journée, son total en base et son total après, avant le clic, puis une confirmation ; une
// journée dont un paiement est associé à un crédit du relevé ne se remplace pas, et l'écran le dit ; la base vérifie la version
// lue — les identifiants de TOUS les paiements en base de ces journées, que ce module rend (`paiementsLus`).
//
// Rien ici ne s'offre tant que `REMPLACEMENT_DES_JOURNEES_PREVU` est baissé : la fonction et la trace n'existent pas encore, et
// un paiement en base avec d'autres chiffres refuse l'import, comme hier.

/** Le drapeau de la migration `remplacement_des_journees_assurance_maladie` (NOE4R-Q2, préparée, pas appliquée) : levé, l'écran
 *  offre le remplacement d'une journée, la lecture des paiements lit la trace, et le plan de sauvegarde la porte. Baissé (son
 *  état tant que la migration n'est pas en base), rien de cela : un conflit refuse l'import sous les mots d'hier. */
export const REMPLACEMENT_DES_JOURNEES_PREVU = false

/** La table de la trace, telle que le plan de sauvegarde la déclare derrière le drapeau. */
export const TABLES_DES_REMPLACEMENTS_ASSURANCE_MALADIE: readonly string[] = ['remplacements_assurance_maladie']

// ── Les mots de la base ────────────────────────────────────────────────────────────────────────────────────────────────
// Les constantes de `remplacer_journees_assurance_maladie`, au caractère près, puis le refus d'une journée associée.
export const REFUS_DU_REMPLACEMENT = {
  forme: 'Le remplacement est mal formé : les paiements en base des journées à remplacer, chacun une fois, de 1 à 5 000.',
  rien: 'Aucune journée de l\'import ne porte d\'autres chiffres que la base : rien à remplacer.',
  change: 'Les journées à remplacer ont changé depuis leur lecture : rien n\'est remplacé.',
  trace: 'Un paiement remplacé ne se retrouve pas dans l\'import qui le remplace : rien n\'est remplacé.',
} as const

/** Le refus d'une journée dont un paiement est associé à un crédit du relevé, la journée nommée en JJ/MM/AAAA. */
export function refusDeLaJourneeAssociee(journee: string): string {
  const [a, m, j] = journee.split('-')
  return `La journée comptable du ${j}/${m}/${a} porte un paiement associé à un crédit du relevé : elle ne se remplace pas tant `
    + 'que cette association n\'est pas défaite.'
}

// ── Ce que l'écran calcule ───────────────────────────────────────────────────────────────────────────────────────────────

/** Un paiement en base tel que l'écran le lit : sa forme, et son identifiant (la version que la base vérifie). */
export type PaiementLuEnBase = PaiementAgrege & { readonly id: string }

/** Une journée que l'export remplace, ce que la confirmation nomme. Les totaux sont des nets, en centimes. */
export interface JourneeARemplacer {
  readonly journee: string
  /** Le total de la journée en base, tous ses paiements. */
  readonly totalEnBase: number
  /** Le total de la journée après le remplacement : ce qui diffère remplacé, ce qui est neuf ajouté, le reste gardé. */
  readonly totalApres: number
  /** Les paiements de la journée que le fichier remplace (même clé, d'autres chiffres). */
  readonly remplaces: number
  /** Ceux qu'il ajoute (une clé que la base n'a pas pour cette journée). */
  readonly ajoutes: number
  /** Ceux de la base que le fichier ne porte pas : ils restent. */
  readonly gardes: number
  /** Un paiement de la journée est associé à un crédit du relevé : la journée ne se remplace pas. */
  readonly associee: boolean
}

export interface RemplacementCalcule {
  /** Les journées à remplacer, dans l'ordre des dates. Vide : aucun paiement du fichier ne diffère de la base. */
  readonly journees: readonly JourneeARemplacer[]
  /** Les identifiants de TOUS les paiements en base de ces journées, triés : la version que la base vérifie. */
  readonly paiementsLus: readonly string[]
  /** Les identifiants des paiements que le remplacement retire, triés. */
  readonly remplaces: readonly string[]
}

const differe = (a: PaiementAgrege, b: PaiementAgrege) => a.montant_centimes !== b.montant_centimes
  || a.regularisations_centimes !== b.regularisations_centimes || a.nombre_de_factures !== b.nombre_de_factures
const somme = (ps: readonly { montant_centimes: number }[]) => ps.reduce((s, p) => s + p.montant_centimes, 0)

/**
 * Le remplacement que la base ferait de cet import, sur les paiements en base lus EN ENTIER et les associations lues en entier
 * (`associes` : les identifiants des paiements associés à un crédit du relevé) : le calcul de `remplacer_journees_assurance_maladie`
 * — les paiements en base qu'un paiement du fichier porte sous la même clé avec d'autres chiffres, leurs journées, et pour chacune
 * ce que le remplacement en ferait.
 */
export function remplacementDesJournees(imp: ImportAEnvoyer, enBase: readonly PaiementLuEnBase[], associes: ReadonlySet<string>):
  RemplacementCalcule {
  const fichierParCle = new Map(imp.paiements.map((p) => [cleDUnPaiement(p), p]))
  const enBaseParCle = new Map(enBase.map((p) => [cleDUnPaiement(p), p]))
  const differents = enBase.filter((p) => {
    const f = fichierParCle.get(cleDUnPaiement(p))
    return f !== undefined && differe(p, f)
  })
  const journees = [...new Set(differents.map((p) => p.date_journee_comptable))].sort()
  const parJournee = journees.map((journee): JourneeARemplacer => {
    const duJourEnBase = enBase.filter((p) => p.date_journee_comptable === journee)
    const duJourAuFichier = imp.paiements.filter((p) => p.date_journee_comptable === journee)
    const remplaces = duJourEnBase.filter((p) => differents.includes(p))
    const ajoutes = duJourAuFichier.filter((p) => !enBaseParCle.has(cleDUnPaiement(p)))
    const gardes = duJourEnBase.filter((p) => !fichierParCle.has(cleDUnPaiement(p)))
    const remplacants = remplaces.map((p) => fichierParCle.get(cleDUnPaiement(p)) as PaiementAgrege)
    const totalEnBase = somme(duJourEnBase)
    return {
      journee,
      totalEnBase,
      totalApres: totalEnBase - somme(remplaces) + somme(remplacants) + somme(ajoutes),
      remplaces: remplaces.length,
      ajoutes: ajoutes.length,
      gardes: gardes.length,
      associee: duJourEnBase.some((p) => associes.has(p.id)),
    }
  })
  const lus = enBase.filter((p) => journees.includes(p.date_journee_comptable)).map((p) => p.id).sort()
  return { journees: parJournee, paiementsLus: lus, remplaces: differents.map((p) => p.id).sort() }
}

/**
 * Le refus que la base opposerait au remplacement, dit avant le clic, ou nul, dans son ordre : la forme de l'import (les mots
 * de la base), puis rien à remplacer, puis la plus ancienne journée associée. Ni la forme des paiements lus (ce module la
 * fait), ni la version (la base seule la juge, au clic), ni les exercices validés (le client ne les lit pas, `ANNEES_ILLISIBLES` ;
 * la base seule en juge, sous les mots de l'import), ne se disent ici.
 */
export function refusDuRemplacementAvantLEnvoi(imp: ImportAEnvoyer, jour: string, r: RemplacementCalcule): string | null {
  const forme = refusDeLImport(imp, jour)
  if (forme) return forme
  if (r.journees.length === 0) return REFUS_DU_REMPLACEMENT.rien
  const associee = r.journees.find((j) => j.associee)
  return associee ? refusDeLaJourneeAssociee(associee.journee) : null
}

// ── Les mots de l'écran ──────────────────────────────────────────────────────────────────────────────────────────────────
const pluriel = (n: number, mot: string, marque = 's') => `${n} ${mot}${n > 1 ? marque : ''}`
const montantDit = (centimes: number) => formatMoney(centimes / 100)

/** Ce que l'aperçu dit avant les journées : le fichier porte des journées déjà importées avec d'autres chiffres. */
export function presentationDuRemplacement(n: number, espace: EspaceVentes): string {
  const journees = n > 1 ? `${n} journées comptables déjà importées` : 'une journée comptable déjà importée'
  return espace === 'client'
    ? `Ce fichier porte ${journees} avec d’autres chiffres. Tu peux les remplacer : pour chacune, ce qui diffère remplace ce `
      + 'qui est en base, ce qui est neuf s’ajoute, et ce que ton fichier ne porte pas reste. Rien ne se remplace sans ta confirmation.'
    : `Ce fichier porte ${journees} avec d’autres chiffres. Elles peuvent être remplacées : pour chacune, ce qui diffère remplace `
      + 'ce qui est en base, ce qui est neuf s’ajoute, et ce que le fichier ne porte pas reste. Rien ne se remplace sans confirmation.'
}

/** Une journée, en mots : son total en base, son total après, et ce qui change. */
export function journeeARemplacerDite(j: JourneeARemplacer): string {
  const s = (n: number) => (n > 1 ? 's' : '')
  const quoi = [
    `${j.remplaces} paiement${s(j.remplaces)} remplacé${s(j.remplaces)}`,
    j.ajoutes > 0 ? `${j.ajoutes} ajouté${s(j.ajoutes)}` : null,
    j.gardes > 0 ? `${j.gardes} gardé${s(j.gardes)} (que le fichier ne porte pas)` : null,
  ].filter((x): x is string => x !== null).join(', ')
  return `Journée comptable du ${formatDate(j.journee)} : ${montantDit(j.totalEnBase)} en base, ${montantDit(j.totalApres)} `
    + `après le remplacement — ${quoi}.`
}

/** Pourquoi une journée associée ne se remplace pas, dit avant le clic : les mots de la base au cabinet, et le geste ; au
 * praticien, à qui s'adresser (il ne défait rien lui-même). */
export function refusDeLaJourneeAssocieeDit(journee: string, espace: EspaceVentes): string {
  return espace === 'client'
    ? `La journée comptable du ${formatDate(journee)} porte un paiement associé à un virement de ton relevé : elle ne se remplace `
      + 'pas. Ton cabinet doit d’abord défaire cette association ; demande-le-lui si ce fichier est le bon.'
    : `${refusDeLaJourneeAssociee(journee)} Ouvrir la fiche du crédit dans le relevé, puis « Défaire l’association ».`
}

/**
 * La confirmation du remplacement, qui NOMME chaque journée, son total en base et son total après, et dit ce que le geste ne
 * défera pas : les paiements remplacés quittent l'import qui les avait apportés, leurs chiffres restent dans la trace, et retirer
 * le nouvel import ne les rend pas. La confirmation de l'import (`confirmationDeLImport`) la suit : ce qui part, et ce qui reste
 * dans le fichier.
 */
export function confirmationDuRemplacement(r: RemplacementCalcule, espace: EspaceVentes): string {
  const n = r.journees.length
  const journees = r.journees.map((j) => `le ${formatDate(j.journee)}, ${montantDit(j.totalEnBase)} en base, `
    + `${montantDit(j.totalApres)} après`).join(' ; ')
  const tete = `Remplacer ${n > 1 ? `${n} journées comptables` : 'une journée comptable'} — ${journees}. `
  const plusieurs = r.remplaces.length > 1
  const suite = `${pluriel(r.remplaces.length, 'paiement')} en base `
    + (plusieurs ? 'quittent l’import qui les avait apportés pour celui-ci ; leurs anciens chiffres restent'
      : 'quitte l’import qui l’avait apporté pour celui-ci ; ses anciens chiffres restent')
    + ` dans la trace des remplacements. Retirer ce nouvel import ne ${plusieurs ? 'les' : 'le'} rendra pas : `
  return tete + suite + (espace === 'client' ? 'il faudrait réimporter ton ancien fichier.' : 'il faudrait réimporter l’ancien fichier.')
}

/** Le bouton du remplacement, avec son compte de journées. */
export const boutonDuRemplacement = (n: number) => `Remplacer ${n > 1 ? `${n} journées` : 'la journée'} et importer`

// ── La trace, à l'écran ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne de la trace telle que l'écran la lit (`remplacements_assurance_maladie`). */
export interface TraceDUnRemplacement {
  readonly id: string
  readonly import_id: string
  readonly ancien_import_id: string
  readonly date_journee_comptable: string
  readonly ancien_montant_centimes: number
  readonly nouveau_montant_centimes: number
  readonly remplace_le: string
}

/** Une journée remplacée par un import, ce que la liste montre : la journée, quand, combien, le net d'avant et d'après des
 * paiements remplacés. */
export interface JourneeRemplacee {
  readonly importId: string
  readonly journee: string
  readonly le: string
  readonly paiements: number
  readonly avant: number
  readonly apres: number
}

/** La trace, regroupée par import qui a remplacé et par journée, les plus récentes d'abord. */
export function journeesRemplacees(traces: readonly TraceDUnRemplacement[]): JourneeRemplacee[] {
  const groupes = new Map<string, JourneeRemplacee>()
  for (const t of traces) {
    const cle = `${t.import_id}|${t.date_journee_comptable}`
    const g = groupes.get(cle)
    groupes.set(cle, {
      importId: t.import_id, journee: t.date_journee_comptable, le: g && g.le > t.remplace_le ? g.le : t.remplace_le,
      paiements: (g?.paiements ?? 0) + 1, avant: (g?.avant ?? 0) + t.ancien_montant_centimes, apres: (g?.apres ?? 0) + t.nouveau_montant_centimes,
    })
  }
  return [...groupes.values()].sort((a, b) => (a.le < b.le ? 1 : a.le > b.le ? -1 : a.journee < b.journee ? -1 : a.journee > b.journee ? 1 : 0))
}

/** Ce que la confirmation du retrait d'un import ajoute quand il a remplacé des paiements : ils ne reviennent pas. */
export function retraitDUnImportQuiARemplaceDit(remplaces: number, espace: EspaceVentes): string {
  return ` Il avait remplacé ${pluriel(remplaces, 'paiement')} d’un import antérieur : ${remplaces > 1 ? 'ils ne reviendront' : 'il ne reviendra'} `
    + `pas (${remplaces > 1 ? 'leurs' : 'ses'} anciens chiffres restent dans la trace des remplacements) ; `
    + (espace === 'client' ? 'réimporte ton ancien fichier pour les retrouver.' : 'l’ancien fichier se réimporte pour les retrouver.')
}
