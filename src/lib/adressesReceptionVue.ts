import { formatDate, dateLocaleDe } from './format'
import {
  BLANCS, MAILLES_ADRESSE, estUnJourCivil, maillesPossibles, refusDeclarationAdresse, versionCourante,
  type RefusAdresse, type SaisieAdresseReception,
} from './adressesReception'
import { estLeClient, PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import type { LectureAdressesDuDossier, LectureDesAdresses } from './adressesReceptionLecture'
import type { AdresseReception, FormeAdresseReception, VerificationAdresseReception } from './types'

// L'ADRESSE DE RÉCEPTION, À L'ÉCRAN (espace client, étape A6b1 ; MEG1-Q16, A6-Q2, A6-Q3 et A6-Q4, décisions du cabinet du
// 14/10/2026). Un module PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — le jour de Paris, l'appelant
// le DONNE. Il dit ce que la fenêtre et le bloc de « Tes plateformes » montrent, et prépare ce qu'ils envoient ; JAMAIS une
// règle de la base : ce que `declarer_adresse_reception` refuserait, c'est `refusDeclarationAdresse` (lib/adressesReception.ts)
// qui le dit, sous les mots de la base.

// ── Le portail de l'annuaire ──────────────────────────────────────────────────────────────────────────────────────────
// Le portail PUBLIC de l'annuaire de la facturation électronique, que le dossier général des spécifications externes de la
// DGFiP (« Dossier de spécifications externes FE — Dossier général », v3.2, § 3.5.4, figure 26) donne pour la consultation
// de l'annuaire sans authentification ; son interface est réservée aux partenaires raccordés. L'application n'y envoie rien
// et ne l'appelle pas : le lien s'ouvre sur un clic, dans un autre onglet du navigateur de qui le clique.
export const LIEN_PORTAIL_ANNUAIRE = 'https://facturation.chorus-pro.gouv.fr/annuaire/#/'

// ── Ce que chaque source de vérification établit (A6-Q4) ─────────────────────────────────────────────────────────────
// Le portail ne montre que l'IDENTIFIANT et sa maille : jamais la plateforme qui reçoit, ni la date de prise d'effet, que
// l'annuaire réserve aux plateformes. Et une entreprise nouvellement assujettie y a une ligne par défaut, à la maille du
// SIREN, rattachée à une plateforme FICTIVE (matricule 9998) : y trouver l'identifiant ne prouve pas qu'une vraie plateforme
// reçoit dessus. Seule la plateforme qui reçoit peut le confirmer ; une simple déclaration n'établit rien.
export const CE_QUE_ETABLIT: Record<VerificationAdresseReception, string> = {
  portail_annuaire:
    'Le portail de l’annuaire n’établit que l’identifiant et sa maille : il ne montre jamais la plateforme qui reçoit. '
    + 'Une entreprise nouvellement assujettie y a une ligne par défaut, à la maille du SIREN, rattachée à une plateforme fictive '
    + '(matricule 9998) : trouver l’identifiant sur le portail ne prouve donc pas qu’une vraie plateforme reçoit dessus.',
  plateforme: 'La plateforme qui reçoit les factures a confirmé cette adresse.',
  declaration: 'Une simple déclaration n’établit rien : ni le portail de l’annuaire ni la plateforme ne l’ont confirmée.',
}

export const LIBELLE_VERIFICATION: Record<VerificationAdresseReception, string> = {
  portail_annuaire: 'Vérifiée sur le portail de l’annuaire',
  plateforme: 'Vérifiée sur la plateforme',
  declaration: 'Non vérifiée : simple déclaration',
}

// Ce que la source se nomme dans le choix du formulaire (le jour de vérification s'y demande ensuite).
export const CHOIX_DE_VERIFICATION: Record<VerificationAdresseReception, string> = {
  portail_annuaire: 'Vérifiée sur le portail de l’annuaire',
  plateforme: 'Confirmée par la plateforme',
  declaration: 'Déclarée sans vérification',
}

export function libelleMaille(forme: FormeAdresseReception): string {
  return MAILLES_ADRESSE.find((m) => m.forme === forme)?.libelle ?? forme
}

// ── Ce que dit une version ──────────────────────────────────────────────────────────────────────────────────────────
/** « À venir » : la prise d'effet est après aujourd'hui, à Paris (A6-Q2) ; le jour même, elle est en vigueur. */
export function estAVenir(priseEffet: string, aujourdhui: string): boolean {
  return priseEffet > aujourdhui
}

export function direLaPriseEffet(priseEffet: string, aujourdhui: string): string {
  return estAVenir(priseEffet, aujourdhui)
    ? `À venir : à partir du ${formatDate(priseEffet)}`
    : `Reçoit depuis le ${formatDate(priseEffet)}`
}

/** La vérification d'une version : sa source et son jour, ou « non vérifiée » (A6-Q3 : elle compte, et l'écran le dit). */
export function direLaVerification(a: Pick<AdresseReception, 'verification' | 'verifiee_le'>): string {
  return a.verifiee_le == null ? LIBELLE_VERIFICATION[a.verification] : `${LIBELLE_VERIFICATION[a.verification]} le ${formatDate(a.verifiee_le)}`
}

/** Le jour où la version a été déclarée : `cree_le` est un INSTANT, son jour est celui de qui le regarde. */
export function jourDeLaDeclaration(a: Pick<AdresseReception, 'cree_le'>): string {
  return formatDate(dateLocaleDe(a.cree_le))
}

export const TITRE_PAR_LE_CLIENT = 'Adresse déclarée par le client'

/**
 * « Par le client » d'une version : son AUTEUR est-il un compte qui porte un accès client du dossier ? Les accès doivent
 * être lus EN ENTIER (`estLeClient` ne reconnaît personne sinon) ; jamais « par le cabinet » (voir lib/auteursVentes.ts).
 */
export function mentionParLeClient(acces: AccesDuDossier, a: Pick<AdresseReception, 'auteur'>): { libelle: string; titre: string } | null {
  return estLeClient(acces, a.auteur) ? { libelle: PAR_LE_CLIENT, titre: TITRE_PAR_LE_CLIENT } : null
}

// ── Ce que la lecture permet de dire ────────────────────────────────────────────────────────────────────────────────
export type ResumeAdresse =
  // Lue en entier, sans déclaration : la seule fois où « aucune adresse » se dit.
  | { etat: 'aucune' }
  | { etat: 'courante'; adresse: AdresseReception; aVenir: boolean }
  // Lue en partie ou refusée : le motif, tel que la lecture le donne ; ni adresse ni vide ne se disent.
  | { etat: 'incomplete'; motif: string }
  // Lue en entier, mais les lignes ne font pas une chaîne : rien ne se choisit.
  | { etat: 'rompue' }

export function resumeDesAdresses(lecture: LectureDesAdresses, dossierId: string, aujourdhui: string): ResumeAdresse {
  if (!lecture.complete) return { etat: 'incomplete', motif: lecture.motif ?? 'lecture incomplète' }
  const courante = versionCourante(lecture.lignes, dossierId)
  if (courante === 'rompue') return { etat: 'rompue' }
  if (courante === null) return { etat: 'aucune' }
  return { etat: 'courante', adresse: courante, aVenir: estAVenir(courante.prise_effet, aujourdhui) }
}

/**
 * Les versions de la chaîne, la plus récente d'abord, de la courante à la première ; `rompue` quand les lignes ne font pas
 * une chaîne (le module ne choisit pas, voir `versionCourante`). Vide sans déclaration.
 */
export function historiqueDesVersions(adresses: readonly AdresseReception[], dossierId: string): AdresseReception[] | 'rompue' {
  const courante = versionCourante(adresses, dossierId)
  if (courante === 'rompue') return 'rompue'
  if (courante === null) return []
  const parId = new Map(adresses.filter((a) => a.dossier_id === dossierId).map((a) => [a.id, a]))
  const versions: AdresseReception[] = [courante]
  for (let a: AdresseReception | undefined = courante; a?.remplace_id != null;) {
    a = parId.get(a.remplace_id)
    if (a) versions.push(a)
  }
  return versions
}

/**
 * Le moindre geste — déclarer, remplacer — n'est offert que sur des adresses lues EN ENTIER qui font une chaîne, et un
 * SIRET lu : le refus du SIREN du dossier en dépend, et la version remplacée se juge sur la liste entière.
 */
export function peutDeclarer(lecture: LectureAdressesDuDossier, dossierId: string): boolean {
  return lecture.adresses.complete && lecture.siret.lu && versionCourante(lecture.adresses.lignes, dossierId) !== 'rompue'
}

// ── La saisie du formulaire ──────────────────────────────────────────────────────────────────────────────────────────
// Des textes, comme les champs les donnent. La maille est CHOISIE par la personne ; elle n'est proposée que si l'identifiant
// n'en admet qu'une seule — deux (« SIREN_SIRET » ou « SIREN_suffixe » pour un SIREN, « _ » et quatorze chiffres) : elle
// choisit, jamais à sa place.
export interface SaisieFormulaire {
  forme: FormeAdresseReception | ''
  identifiant: string
  plateforme: string
  prise_effet: string
  verification: VerificationAdresseReception | ''
  verifiee_le: string
}

export const SAISIE_VIDE: SaisieFormulaire = { forme: '', identifiant: '', plateforme: '', prise_effet: '', verification: '', verifiee_le: '' }

// Les blancs aux bords d'un nom ou d'un identifiant collé : ceux que la base retire elle-même pour juger un nom vide.
function sansBlancsAuxBords(texte: string): string {
  let debut = 0
  let fin = texte.length
  while (debut < fin && BLANCS.includes(texte[debut])) debut += 1
  while (fin > debut && BLANCS.includes(texte[fin - 1])) fin -= 1
  return texte.slice(debut, fin)
}

/** Les mailles que l'identifiant saisi admet (aucune, une ou deux). */
export function maillesDeLaSaisie(s: SaisieFormulaire): FormeAdresseReception[] {
  return maillesPossibles(sansBlancsAuxBords(s.identifiant))
}

/** La maille de la saisie : celle qu'on a choisie ; à défaut, la seule que l'identifiant admet ; sinon aucune. */
export function formeDeLaSaisie(s: SaisieFormulaire): FormeAdresseReception | '' {
  if (s.forme !== '') return s.forme
  const possibles = maillesDeLaSaisie(s)
  return possibles.length === 1 ? possibles[0] : ''
}

/** La maille a-t-elle été PROPOSÉE (et non choisie) ? C'est ce que l'écran dit sous le champ. */
export function formeProposee(s: SaisieFormulaire): boolean {
  return s.forme === '' && formeDeLaSaisie(s) !== ''
}

/** Ce qui part : la maille effective, les blancs des bords retirés, une date ou un nom absents en `null`. */
export function saisieEnvoyee(s: SaisieFormulaire, remplaceId: string | null): SaisieAdresseReception {
  const identifiant = sansBlancsAuxBords(s.identifiant)
  const plateforme = sansBlancsAuxBords(s.plateforme)
  const forme = formeDeLaSaisie(s)
  return {
    forme: forme === '' ? null : forme,
    identifiant: identifiant === '' ? null : identifiant,
    plateforme: plateforme === '' ? null : plateforme,
    prise_effet: s.prise_effet === '' ? null : s.prise_effet,
    verification: s.verification === '' ? null : s.verification,
    // Une déclaration sans vérification n'a pas de jour : le jour d'un choix abandonné ne part jamais.
    verifiee_le: s.verification === '' || s.verification === 'declaration' || s.verifiee_le === '' ? null : s.verifiee_le,
    remplace_id: remplaceId,
  }
}

/** La saisie a-t-elle changé depuis son point de départ ? Un champ qu'on n'a pas touché ne s'accuse pas d'être vide. */
export function saisieTouchee(depart: SaisieFormulaire, s: SaisieFormulaire): boolean {
  return (Object.keys(depart) as (keyof SaisieFormulaire)[]).some((k) => depart[k] !== s[k])
}

// Une date que le champ ne rend pas en AAAA-MM-JJ (un calendrier qui admet six chiffres d'année) : PostgREST la refuserait
// avant la fonction, et `refusDeclarationAdresse` lève sur elle — on la dit avant, sous un mot de l'écran, pas de la base.
export const DATE_ILLISIBLE = 'Une date saisie n’est pas une date du calendrier (JJ/MM/AAAA).'

export type RefusDeLaSaisie = { cle: string; message: string }

/**
 * Le premier refus de la saisie TELLE QU'ELLE PART : une date illisible, puis ce que `declarer_adresse_reception` refuserait,
 * dans son ordre et sous ses mots ; null quand elle l'accepterait ; `rompue` quand les adresses lues ne font pas une chaîne.
 * `remplaceId` : la courante lue à l'ouverture du formulaire (nulle pour une première) ; `adresses` : la liste LUE EN ENTIER,
 * relue après chaque écriture — une autre version déclarée depuis fait refuser, avant le clic, sous les mots de la base.
 */
export function refusDeLaSaisie(
  dossierId: string,
  siret: string | null,
  s: SaisieFormulaire,
  remplaceId: string | null,
  adresses: readonly AdresseReception[],
  aujourdhui: string,
): RefusDeLaSaisie | null | 'rompue' {
  const envoyee = saisieEnvoyee(s, remplaceId)
  for (const date of [envoyee.prise_effet, envoyee.verifiee_le]) {
    if (date !== null && !estUnJourCivil(date)) return { cle: 'date_illisible', message: DATE_ILLISIBLE }
  }
  const refus: RefusAdresse | null | 'rompue' = refusDeclarationAdresse(dossierId, siret, envoyee, adresses, aujourdhui)
  return refus
}
