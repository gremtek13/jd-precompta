import { poids, type RefusDuDepot } from './bornesStockage'
import type { EspaceVentes } from './espaceVentes'
import { logoDeLaVersion, type LogoEnvoye, type LogoLu, type LogoPret, type TypeDuLogo } from './logoDesFactures'
import {
  jourEtHeureAParis, refusEnregistrementParametres, saisieQuiPart, type CleRefusEnregistrementParametres, type ParametresEnvoyes,
  type RefusParametres,
} from './parametresFacturation'
import { saisieDeLaVersion } from './parametresFacturationVue'
import type { ParametresFacturation } from './types'

// LE LOGO DES FACTURES, À L'ÉCRAN (espace client, étape A5c2a ; décisions du cabinet du 17/10/2026, A5C-Q1 à A5C-Q6). Un
// module PUR : il ne lit rien en base ni dans le seau, n'appelle personne, ne lit pas l'horloge. Il dit ce que le bloc
// « Logo des factures » de la vue « Paramètres » montre, et prépare ce que ses deux gestes envoient ; JAMAIS une règle de la
// base : ce que `enregistrer_parametres_facturation` refuserait du logo, c'est `lib/parametresFacturation.ts` (le huitième
// rang, `lib/logoDesFactures.ts`) qui le dit, sous les mots de la base.
//
// UN LOGO EST UN CHAMP D'UNE VERSION DES PARAMÈTRES : le poser ou le changer écrit UNE version nouvelle, qui reprend tous les
// autres champs de la courante tels qu'elle les porte ; le retirer, une version sans logo ; le fichier, lui, reste dans le
// seau (A5C-Q3). Le RIB d'une courante PROPOSÉE reste donc proposé, et celui d'une confirmée confirmé : la base le garde d'une
// version à l'autre quand l'IBAN, le BIC et le titulaire ne changent pas.
//
// AUJOURD'HUI AUCUNE FACTURE NE L'IMPRIME (étape A7) : chaque phrase qui parle du logo le dit, ou n'en dit pas plus que ce
// qu'une version désigne. Une phrase fixe du bloc évite « aucun » et « rien » : le bloc se monte avant la lecture de son fichier
// (ecransAvantLecture.test.tsx), et le vide ne s'y dit qu'après elle. Les mots du client : tutoiement, aucun onglet, jamais « le client » pour le titulaire
// (src/lib/espaceVentes.ts, `MOTS_DU_CABINET`) ; les phrases qui servent aux deux espaces sont écrites sans personne.

export const TITRE_DU_LOGO = 'Logo des factures'

/** Ce que le bloc dit de qui voit et change le logo — et que rien ne l'imprime encore. */
export function phraseDuLogo(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Ton cabinet voit ce logo et peut le changer, comme toi. Tes factures ne l’impriment pas encore : elles le feront avec '
      + 'une étape à venir.'
    : 'Le client qui porte la case « Ventes » voit ce logo et peut le changer, comme vous. Les factures ne l’impriment pas '
      + 'encore : elles le feront avec une étape à venir.'
}

/** Sans aucune version des paramètres, le logo ne s'offre pas : il est un champ d'une version. */
export function phraseSansVersion(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Le logo est un champ de tes paramètres de facturation : renseigne d’abord les paramètres, puis pose ton logo.'
    : 'Le logo est un champ d’une version des paramètres de facturation : renseignez d’abord les paramètres, puis posez le logo.'
}

/** Une version dont la lecture n'a pas rendu les colonnes du logo : rien n'en est dit, aucun geste n'est offert. */
export const PHRASE_LOGO_NON_LU = 'Le logo de cette version n’a pas été lu avec elle : rien n’en est dit, et aucun geste n’est offert.'

/** Une version sans logo — l'affirmation d'une version lue en entier. */
export const PHRASE_AUCUN_LOGO = 'Aucun logo n’est posé.'

export const PHRASE_LOGO_EN_LECTURE = 'Chargement du logo…'

/** Pourquoi le fichier que la version désigne n'est pas montré ; null quand il l'est. */
export function ditLeLogoNonMontre(lu: LogoLu): string | null {
  switch (lu.etat) {
    case 'verifie':
      return null
    case 'absent':
      return 'Le fichier du logo que la version désigne n’est pas (ou plus) rendu par le stockage du dossier : il n’est pas montré.'
    case 'refuse':
      return `Le stockage n’a pas rendu le fichier du logo (${lu.motif}) : il n’est pas montré.`
    case 'illisible':
      return 'Le fichier du logo a été rendu, mais il n’a pas pu être lu comme une image PNG ou JPEG : il n’est pas montré.'
    case 'autre_empreinte':
      return 'Le fichier rendu n’est pas celui que la version désigne (son empreinte diffère) : il n’est pas montré.'
  }
}

export function libelleDuTypeDuLogo(type: TypeDuLogo): string {
  return type === 'image/jpeg' ? 'JPEG' : 'PNG'
}

/** La légende de l'image montrée : son type, son poids, et que son empreinte a été recalculée. */
export function legendeDuLogo(lu: Extract<LogoLu, { etat: 'verifie' }>): string {
  return `${libelleDuTypeDuLogo(lu.type)} · ${poids(lu.taille)} · empreinte vérifiée`
}

// ── Le fichier choisi ────────────────────────────────────────────────────────────────────────────────────────────────
/** Le refus du seau (format, poids) dit dès le choix du fichier, comme celui du logo d'un cabinet. */
export function refusDuFichierChoisi(refus: RefusDuDepot): string {
  return `Ce logo n’est pas pris : ${refus.message}.`
}

/** Le fichier choisi, jugé et prêt : son type et son poids, et que rien n'est enregistré avant le geste. */
export function legendeDuChoix(pret: Pick<LogoPret, 'type' | 'taille'>, geste: string): string {
  return `Logo choisi : ${libelleDuTypeDuLogo(pret.type)} · ${poids(pret.taille)}. Rien n’est enregistré avant « ${geste} ».`
}

export const PHRASE_LOGO_IDENTIQUE = 'Ce fichier est déjà le logo en cours : il n’y a rien à poser.'

/** Le fichier choisi est-il celui que la version courante désigne déjà ? Rien ne part alors. */
export function estLeLogoCourant(courante: Pick<ParametresFacturation, 'logo_chemin' | 'logo_sha256'>, pret: Pick<LogoPret, 'chemin' | 'empreinte'>): boolean {
  const logo = logoDeLaVersion(courante)
  return logo !== 'non lu' && logo !== null && logo.chemin === pret.chemin && logo.empreinte === pret.empreinte
}

/** Le libellé du geste : poser s'il n'y a pas de logo, changer sinon. */
export function gesteDuLogo(courante: Pick<ParametresFacturation, 'logo_chemin' | 'logo_sha256'>): 'Poser ce logo' | 'Changer le logo' {
  const logo = logoDeLaVersion(courante)
  return logo === null || logo === 'non lu' ? 'Poser ce logo' : 'Changer le logo'
}

// ── Ce qui part ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Les paramètres d'une version nouvelle qui ne change QUE le logo : tous les autres champs de la courante, tels qu'elle les
 * porte (sa saisie, `saisieQuiPart`), et le logo donné. Un RIB inchangé garde son état et sa confirmation (la base le
 * décide), un RIB proposé reste proposé.
 */
export function parametresAvecLogo(courante: ParametresFacturation, logo: Required<LogoEnvoye>): ParametresEnvoyes & LogoEnvoye {
  return { ...saisieQuiPart(saisieDeLaVersion(courante)), logo_chemin: logo.logo_chemin, logo_sha256: logo.logo_sha256 }
}

/** Les paramètres d'une version nouvelle SANS logo : les autres champs de la courante, aucune clé de logo (« aucun logo »). */
export function parametresSansLogo(courante: ParametresFacturation): ParametresEnvoyes {
  return saisieQuiPart(saisieDeLaVersion(courante))
}

/**
 * Le refus de la base sur le logo qu'on s'apprête à poser, AVANT le clic : `enregistrer_parametres_facturation` sur ce qui
 * partira, le fichier compté comme il sera dans le seau une fois déposé (son chemin, son type, son poids). Null quand elle
 * l'accepterait ; `rompue` sur des versions qui ne font pas une chaîne.
 */
export function refusDuNouveauLogo(
  dossierId: string, courante: ParametresFacturation, versions: readonly ParametresFacturation[],
  pret: Pick<LogoPret, 'chemin' | 'empreinte' | 'type' | 'taille'>,
): RefusParametres<CleRefusEnregistrementParametres> | null | 'rompue' {
  return refusEnregistrementParametres(
    dossierId, courante.id, parametresAvecLogo(courante, { logo_chemin: pret.chemin, logo_sha256: pret.empreinte }), versions,
    [{ chemin: pret.chemin, type: pret.type, taille: pret.taille }],
  )
}

/** De même pour le retrait : une version sans logo, aucun fichier du seau à connaître. */
export function refusDuRetraitDuLogo(
  dossierId: string, version: ParametresFacturation, versions: readonly ParametresFacturation[],
): RefusParametres<CleRefusEnregistrementParametres> | null | 'rompue' {
  return refusEnregistrementParametres(dossierId, version.id, parametresSansLogo(version), versions, [])
}

// ── Ce que les gestes disent ─────────────────────────────────────────────────────────────────────────────────────────
/** Le message d'un logo posé ou changé : le jour et l'heure de Paris de la version écrite, et un fichier déjà là dit tel. */
export function messageDuLogoPose(geste: 'pose' | 'change', enregistreLe: string, dejaLa: boolean): string {
  const quoi = geste === 'pose' ? 'Logo posé' : 'Logo changé'
  return `${quoi} le ${jourEtHeureAParis(enregistreLe)}.${dejaLa ? ' Le fichier était déjà dans l’espace du dossier : son empreinte a été vérifiée, aucun nouveau dépôt n’a eu lieu.' : ''}`
}

export function messageDuLogoRetire(enregistreLe: string): string {
  return `Logo retiré le ${jourEtHeureAParis(enregistreLe)}.`
}

/** Un fichier déposé dont la version est refusée : le fichier reste dans le seau (A5C-Q3), les paramètres ne sont pas écrits. */
export function messageFichierDeposeSansVersion(espace: EspaceVentes, refusDeLaBase: string): string {
  const refus = /[.!?]$/.test(refusDeLaBase.trim()) ? refusDeLaBase.trim() : `${refusDeLaBase.trim()}.`
  return `Le fichier du logo est déposé dans l’espace du dossier, mais les paramètres n’ont pas été enregistrés : ${refus} `
    + (espace === 'client' ? 'Le fichier y reste ; tu peux réessayer.' : 'Le fichier y reste ; vous pouvez réessayer.')
}

/** Ce que la confirmation du retrait dit avant le clic : ce qui change, ce qui reste, ce que les factures ne font pas encore. */
export function confirmationDuRetraitDuLogo(): { titre: string; paragraphes: string[] } {
  return {
    titre: 'Retirer le logo',
    paragraphes: [
      'Une version nouvelle des paramètres est enregistrée, sans logo ; les autres champs ne changent pas.',
      'Le fichier reste dans l’espace du dossier : il n’est pas supprimé, et l’historique des paramètres garde la trace de ce '
      + 'retrait (« Logo retiré »).',
      'Aucune facture n’imprime encore ce logo : elles le feront avec une étape à venir.',
    ],
  }
}
