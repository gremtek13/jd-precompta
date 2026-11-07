// LA DOUBLE AUTHENTIFICATION EXIGÉE (espace client, partie C, étape C7, second temps ; ligne 51.5) : la règle et les mots,
// sans JSX ni lecture. La base : migration `deux_facteurs_exiges` (PRÉPARÉE, PAS APPLIQUÉE), qui exige le second facteur
// compte par compte (SEC-Q3) — une policy restrictive sur chaque table, la pré-requête de PostgREST pour les fonctions — et
// porte les fonctions du cabinet (SEC-Q4). Le récit : HISTORIQUE.md, « LA DOUBLE AUTHENTIFICATION, SECOND TEMPS ».
//
// LE DRAPEAU, baissé : tant que la migration n'est pas en base, aucun écran n'appelle ses fonctions (elles n'existent pas)
// et la porte de l'application reste celle du premier temps. Il se lève avec la migration, après la simulation.

import type { EtatDuCompte, Niveau } from './doubleAuthentification'

export const DEUX_FACTEURS_EXIGES_EXPORTE = false

export type GenreDuCompte = 'chef' | 'membre' | 'client'

/** Une ligne de `deux_facteurs_des_comptes` : jamais le nom, le type ni la clé d'un facteur. */
export interface CompteDeuxFacteurs {
  userId: string
  email: string | null
  genre: GenreDuCompte
  aUnFacteur: boolean
  exigeeDepuis: string | null
  dernierRetrait: string | null
  peutExiger: boolean
  peutLever: boolean
  peutRetirer: boolean
}

function texteOuNul(v: unknown): string | null | undefined {
  return v === null ? null : typeof v === 'string' ? v : undefined
}

/** Une ligne lue, ou nul si sa forme n'est pas celle que la fonction rend : la liste entière se dit alors illisible. */
export function compteLu(brut: unknown): CompteDeuxFacteurs | null {
  if (typeof brut !== 'object' || brut === null) return null
  const r = brut as Record<string, unknown>
  const email = texteOuNul(r.email)
  const exigeeDepuis = texteOuNul(r.exigee_depuis)
  const dernierRetrait = texteOuNul(r.dernier_retrait)
  const booleens = [r.a_un_facteur, r.peut_exiger, r.peut_lever, r.peut_retirer]
  if (typeof r.user_id !== 'string' || email === undefined || exigeeDepuis === undefined || dernierRetrait === undefined
    || (r.genre !== 'chef' && r.genre !== 'membre' && r.genre !== 'client') || booleens.some((b) => typeof b !== 'boolean')) {
    return null
  }
  return {
    userId: r.user_id, email, genre: r.genre, aUnFacteur: r.a_un_facteur as boolean, exigeeDepuis, dernierRetrait,
    peutExiger: r.peut_exiger as boolean, peutLever: r.peut_lever as boolean, peutRetirer: r.peut_retirer as boolean,
  }
}

export type GesteDesDeuxFacteurs = 'exiger' | 'lever' | 'retirer'

/** Les gestes que la ligne offre : ceux que la base dit permis à l'appelant, et que l'état du compte rend utiles. */
export function gestesDuCompte(c: CompteDeuxFacteurs): GesteDesDeuxFacteurs[] {
  const gestes: GesteDesDeuxFacteurs[] = []
  if (c.peutExiger && c.aUnFacteur && c.exigeeDepuis === null) gestes.push('exiger')
  if (c.peutLever && c.exigeeDepuis !== null) gestes.push('lever')
  if (c.peutRetirer && c.aUnFacteur) gestes.push('retirer')
  return gestes
}

/** Les cases d'un accès client qui recommandent l'exigence (SEC-Q2, MEG3-Q4) : « Caisse » seule n'y suffit pas. */
export const CASES_QUI_RECOMMANDENT: readonly string[] = ['ventes', 'banque', 'achats', 'documents']

/**
 * SEC-Q1 et SEC-Q2 : le chef, l'équipe et le super-administrateur, toujours ; un accès client qui porte « Ventes »,
 * « Banque », « Achats » ou « Documents ». Une recommandation : rien n'est posé sans le geste du cabinet (SEC-Q3).
 */
export function exigenceRecommandee(c: Pick<CompteDeuxFacteurs, 'genre'>, cases: Readonly<Record<string, boolean>> | null): boolean {
  if (c.genre !== 'client') return true
  return cases !== null && CASES_QUI_RECOMMANDENT.some((k) => cases[k] === true)
}

/** L'état d'un compte en une phrase, au vous du cabinet. */
export function etatDuCompteEnMots(c: CompteDeuxFacteurs, date: (iso: string) => string): string {
  const facteur = c.aUnFacteur ? 'application d’authentification inscrite' : 'aucune application d’authentification'
  const exigence = c.exigeeDepuis !== null ? `double authentification exigée depuis le ${date(c.exigeeDepuis)}` : 'non exigée'
  const retrait = c.dernierRetrait !== null ? ` ; second facteur retiré le ${date(c.dernierRetrait)}` : ''
  return `${facteur} ; ${exigence}${retrait}`
}

/** La confirmation d'un geste : elle nomme le compte et dit ce qui change pour lui. */
export function confirmationDuGeste(geste: GesteDesDeuxFacteurs, c: CompteDeuxFacteurs): string {
  const qui = c.email ?? 'ce compte'
  if (geste === 'exiger') {
    return `Exiger la double authentification de ${qui} ? À chaque connexion, ce compte donnera le code de son application `
      + 'd’authentification ; sans lui, il n’ouvre plus rien de l’application.'
  }
  if (geste === 'lever') {
    return `Ne plus exiger la double authentification de ${qui} ? Le compte pourra de nouveau tout ouvrir avec son seul mot `
      + 'de passe.'
  }
  return `Retirer le second facteur de ${qui} (appareil perdu) ? Toutes ses applications d’authentification sont retirées et `
    + 'toutes ses sessions fermées, sur chaque appareil. '
    + (c.exigeeDepuis !== null
      ? 'L’exigence reste : à sa prochaine connexion, il inscrira un nouvel appareil avant tout écran. '
      : 'Il se connectera ensuite avec son seul mot de passe. ')
    + 'Le retrait est tracé.'
}

/** Ce que la porte de l'application lit d'un compte (`ma_double_authentification`). */
export interface MonExigence { exigee: boolean; satisfaite: boolean; espace: 'cabinet' | 'client' | null }

export function monExigenceLue(brut: unknown): MonExigence | null {
  if (typeof brut !== 'object' || brut === null) return null
  const r = brut as Record<string, unknown>
  if (typeof r.exigee !== 'boolean' || typeof r.satisfaite !== 'boolean'
    || (r.espace !== null && r.espace !== 'cabinet' && r.espace !== 'client')) return null
  return { exigee: r.exigee, satisfaite: r.satisfaite, espace: r.espace }
}

export type ExigenceLue = { etat: 'lecture' } | { etat: 'illisible' } | { etat: 'lue'; valeur: MonExigence }

export type PorteDeLExigence = 'ouverte' | 'lecture' | 'illisible' | 'inscription'

/**
 * La porte du second temps, AVANT tout écran (SEC-Q3) : un compte exigé sans facteur vérifié est mené à l'inscription ;
 * un compte exigé qui a un facteur passe par la porte du code (premier temps, `porteDeLApplication`). Une session `aal2`
 * passe sans lecture ; une lecture pas encore revenue attend ; illisible, rien ne s'ouvre (le côté fermé : la base
 * refuserait tout de toute façon à un compte exigé). Le drapeau baissé : la porte du premier temps, seule.
 */
export function porteDeLExigence(exporte: boolean, niveau: Niveau | null, lue: ExigenceLue, etat: EtatDuCompte): PorteDeLExigence {
  if (!exporte || niveau === 'aal2') return 'ouverte'
  if (lue.etat === 'lecture') return 'lecture'
  if (lue.etat === 'illisible') return 'illisible'
  return lue.valeur.exigee && !lue.valeur.satisfaite && etat === 'sans-facteur' ? 'inscription' : 'ouverte'
}
