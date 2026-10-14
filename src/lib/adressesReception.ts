import { remplirModele } from './encaissementsFactures'
import { sirenDuDossier } from './factureElectronique'
import { dateAParis, formatDate } from './format'
import type { AdresseReception, FormeAdresseReception, VerificationAdresseReception } from './types'

// L'ADRESSE DE RÉCEPTION DES FACTURES ÉLECTRONIQUES D'UN DOSSIER (espace client, étape A6a ; conception : HISTORIQUE.md,
// « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6 ; MEG1-Q16, tranchée
// par le cabinet le 14/10/2026). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas l'horloge : le jour
// de Paris, l'appelant le DONNE — que les écrans de l'étape A6b liront : ce que `declarer_adresse_reception` refuserait,
// dans SON ordre et sous SES mots, dit avant le clic ; la version COURANTE d'un dossier, déduite de la chaîne ; les formes
// de l'identifiant d'adressage.
//
// POURQUOI DÉCLARÉE. L'annuaire de la facturation électronique publie l'identifiant d'adressage (« Ouvert »), mais réserve
// aux plateformes la date de prise d'effet et le matricule de la plateforme de réception (DGFiP, spécifications externes
// v3.2, annexe 3 v1.8, flux F14 : DT-7-5-1, DT-7-3-1, DT-7-6) ; son API n'est ouverte qu'aux partenaires habilités et
// raccordés, son portail se consulte sans authentification (dossier général v3.2, §3.5.4). L'adresse et sa prise d'effet
// sont donc déclarées par le cabinet ou le client « Ventes », vérifiées sur ce portail ou sur la plateforme ; rien ici
// n'appelle l'annuaire.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `adresses_reception` OUVRE une lecture au client qui porte la case « Ventes », et une fonction qui lit pour
// lui les deux tables des connexions : présentée au cabinet, elle a été appliquée sur son accord, et l'export
// (supabase/schema) la porte. Ce drapeau est donc levé : le plan de sauvegarde compte sa table (src/lib/sauvegarde.ts), la
// phrase de l'onglet Accès dit ce qu'elle ouvre (src/lib/droitsAcces.ts), et aucun écran ne la lit encore (l'encart
// viendra avec l'étape A6b). adressesReception.test.ts confronte ce drapeau à l'export, et les refus ci-dessous au texte
// même de la fonction comme à l'essai supabase/essais/etatFactureElectronique.sql. Un retour arrière de la migration ne
// viendrait qu'APRÈS le drapeau rebaissé en ligne.
export const ADRESSES_RECEPTION_EXPORTEES: boolean = true

// ── Qui déclare (MEG1-Q16, décision du cabinet du 14/10/2026) ────────────────────────────────────────────────────────
// Le cabinet du dossier OU le client qui porte « Ventes », par la même fonction, dont l'accès est `gere_les_ventes` ;
// chaque version dit qui l'a déclarée. adressesReception.test.ts confronte ce prédicat au texte de la fonction.
export const PREDICAT_DE_LA_DECLARATION = 'gere_les_ventes' as const

// ── Les mailles de l'annuaire et la forme de leur identifiant ───────────────────────────────────────────────────────
// L'identifiant d'adressage (annexe 3 v1.8, DT-7-5-1) « est obtenu en concaténant » le SIREN, le SIRET, l'identifiant de
// routage et le suffixe, « séparés par un '_' ». Le SIREN : neuf chiffres (annexe 7 v1.9, G1.89) ; le SIRET : quatorze
// (G2.07), qui commencent par le SIREN (G1.80) ; le routage, avec un SIRET seulement (G1.91), cent caractères au plus
// (DT-7-5-1-3) ; le suffixe, jamais avec un SIRET (G1.93), cent au plus (DT-7-5-1-4). Les caractères d'un routage et d'un
// suffixe sont ceux de l'API publique de l'annuaire (OpenAPI 1.11.0 de la même archive : `identifiantRoutage`,
// `suffixeAdressage`), que la base admet déjà pour l'adresse électronique d'un acheteur (src/lib/mentionsFacture.ts,
// `FORME_ADRESSE_ELECTRONIQUE`) : plus larges que G1.95 et G1.115 de l'annexe 7 (« / » et « @ »), et NON VÉRIFIÉ — laquelle
// des deux l'annuaire applique. Un identifiant seul ne dit pas toujours sa maille (« neuf chiffres _ quatorze chiffres »
// peut être un SIRET ou un suffixe) : la maille se DÉCLARE avec lui, et `maillesPossibles` dit lesquelles il admet.
export const MAILLES_ADRESSE: readonly { forme: FormeAdresseReception; libelle: string; motif: RegExp }[] = [
  { forme: 'siren', libelle: 'SIREN', motif: /^[0-9]{9}$/ },
  { forme: 'siren_siret', libelle: 'SIREN_SIRET', motif: /^[0-9]{9}_[0-9]{14}$/ },
  { forme: 'siren_siret_routage', libelle: 'SIREN_SIRET_routage', motif: /^[0-9]{9}_[0-9]{14}_[-_/@a-zA-Z0-9]{1,100}$/ },
  { forme: 'siren_suffixe', libelle: 'SIREN_suffixe', motif: /^[0-9]{9}_[-_.@a-zA-Z0-9]{1,100}$/ },
]
// Le nom de la plateforme : les 99 caractères que l'annuaire donne à la raison sociale et à l'appellation commerciale
// d'une plateforme (annexe 3 v1.8, DT-6-6 et DT-6-7).
export const PLATEFORME_MAX = 99
// Une date de l'annuaire (annexe 7 v1.9, G1.36) : entre le 1er janvier 2000 et le 31 décembre 2099.
export const PREMIER_JOUR = '2000-01-01'
export const DERNIER_JOUR = '2099-12-31'
export const VERIFICATIONS: readonly VerificationAdresseReception[] = ['portail_annuaire', 'plateforme', 'declaration']
// Les blancs que la base retire aux bords d'un nom (`btrim(…, E' \t\n\r')`, la convention des migrations du dépôt).
export const BLANCS = ' \t\n\r'

/** Les mailles qu'un identifiant admet, dans l'ordre de l'annuaire : aucune, une, ou deux qu'il faut alors choisir. */
export function maillesPossibles(identifiant: string): FormeAdresseReception[] {
  return MAILLES_ADRESSE.filter((m) => aLaFormeDeSaMaille(m.forme, identifiant)).map((m) => m.forme)
}

/** L'identifiant a-t-il la forme de sa maille — et, pour un SIRET, commence-t-il par son SIREN (G1.80) ? */
export function aLaFormeDeSaMaille(forme: FormeAdresseReception, identifiant: string): boolean {
  const maille = MAILLES_ADRESSE.find((m) => m.forme === forme)
  if (!maille || !maille.motif.test(identifiant)) return false
  return !siretDansLAdresse(forme) || siretDeLEntreprise(identifiant)
}

const siretDansLAdresse = (forme: string) => forme === 'siren_siret' || forme === 'siren_siret_routage'
// `substr(identifiant, 11, 9) = left(identifiant, 9)` : les neuf premiers chiffres du SIRET sont le SIREN.
const siretDeLEntreprise = (identifiant: string) => identifiant.slice(10, 19) === identifiant.slice(0, 9)

// ── La version courante ─────────────────────────────────────────────────────────────────────────────────────────────
// Une déclaration nouvelle REMPLACE la courante (`remplace_id`) : la base tient UNE chaîne par dossier — une seule
// première (`adresses_reception_une_premiere`), une seule suite par version (`adresses_reception_une_suite`), chaque
// version en remplaçant une de son dossier (la garde). La courante est celle qu'aucune ne remplace. Des lignes qui ne
// forment pas une telle chaîne ne sont pas celles de la table (une lecture tronquée, mêlée) : le module ne choisit pas,
// il dit `rompue`.

/** La version courante des adresses d'un dossier : nulle sans déclaration, `rompue` quand les lignes ne font pas une chaîne. */
export function versionCourante(adresses: readonly AdresseReception[], dossierId: string): AdresseReception | null | 'rompue' {
  const duDossier = adresses.filter((a) => a.dossier_id === dossierId)
  if (duDossier.length === 0) return null
  const parId = new Map(duDossier.map((a) => [a.id, a]))
  const premieres = duDossier.filter((a) => a.remplace_id === null)
  const suites = new Map<string, AdresseReception>()
  for (const a of duDossier) {
    if (a.remplace_id === null) continue
    if (!parId.has(a.remplace_id) || suites.has(a.remplace_id)) return 'rompue'
    suites.set(a.remplace_id, a)
  }
  if (premieres.length !== 1 || parId.size !== duDossier.length) return 'rompue'
  // De la première, suite après suite : toutes les lignes doivent être atteintes, une fois.
  let courante = premieres[0]
  let vues = 1
  for (let suite = suites.get(courante.id); suite; suite = suites.get(courante.id)) {
    courante = suite
    vues += 1
    if (vues > duDossier.length) return 'rompue'
  }
  return vues === duDossier.length ? courante : 'rompue'
}

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// La liste des `raise exception` de `declarer_adresse_reception`, dans l'ordre de son texte, avec son code
// (adressesReception.test.ts la confronte aux messages que l'essai supabase/essais/etatFactureElectronique.sql exige de la
// base, et au texte exporté quand `ADRESSES_RECEPTION_EXPORTEES` est levé). Sept RANGS, dix-neuf messages : l'ordre de la
// conception — l'accès, la forme de l'identifiant, le SIREN du dossier en tête, la date de prise d'effet, la version
// remplacée encore courante —, et ce que l'état réel y ajoute à sa place : un dossier sans SIREN (le SIREN se tire de son
// SIRET), la plateforme, la vérification. Le refus d'accès, seule la base le juge : l'écran n'existe que pour qui le peut.
export const REFUS_DECLARATION_ADRESSE = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  {
    cle: 'maille_inconnue', rang: 2, code: '22023',
    modele: "La maille de l'adresse est l'une des quatre de l'annuaire : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou SIREN_suffixe.",
  },
  { cle: 'forme_siren', rang: 2, code: '22023', modele: 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.' },
  {
    cle: 'forme_siren_siret', rang: 2, code: '22023',
    modele: "Une adresse à la maille SIREN_SIRET s'écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET.",
  },
  {
    cle: 'forme_siren_siret_routage', rang: 2, code: '22023',
    modele: "Une adresse à la maille SIREN_SIRET_routage s'écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET, « _ », "
      + "puis un code de routage d'un à cent caractères — lettres sans accent, chiffres, « - », « _ », « / » ou « @ ».",
  },
  {
    cle: 'forme_siren_suffixe', rang: 2, code: '22023',
    modele: "Une adresse à la maille SIREN_suffixe s'écrit : les neuf chiffres du SIREN, « _ », puis un suffixe d'un à cent "
      + 'caractères — lettres sans accent, chiffres, « - », « _ », « . » ou « @ ».',
  },
  {
    cle: 'siret_d_une_autre_entreprise', rang: 2, code: '22023',
    modele: "Dans l'adresse, le SIRET ne commence pas par le SIREN : l'établissement doit être de cette entreprise.",
  },
  {
    cle: 'dossier_sans_siren', rang: 3, code: '22023',
    modele: "Le dossier n'a pas de SIREN : renseigner son SIRET avant de déclarer son adresse de réception.",
  },
  { cle: 'siren_du_dossier', rang: 3, code: '22023', modele: "L'adresse doit commencer par le SIREN du dossier, %." },
  { cle: 'prise_effet_absente', rang: 4, code: '22023', modele: "La date de prise d'effet de l'adresse est à renseigner." },
  { cle: 'prise_effet_hors_bornes', rang: 4, code: '22023', modele: "La date de prise d'effet de l'adresse est comprise entre 2000 et 2099." },
  { cle: 'plateforme_absente', rang: 5, code: '22023', modele: 'Le nom de la plateforme de réception est à renseigner.' },
  { cle: 'plateforme_longue', rang: 5, code: '22023', modele: 'Le nom de la plateforme de réception tient en 99 caractères au plus.' },
  {
    cle: 'verification_inconnue', rang: 6, code: '22023',
    modele: "La vérification se fait sur le portail de l'annuaire ou sur la plateforme, ou l'adresse est déclarée sans vérification.",
  },
  { cle: 'verification_datee', rang: 6, code: '22023', modele: "Une adresse déclarée sans vérification n'a pas de jour de vérification." },
  { cle: 'verification_sans_jour', rang: 6, code: '22023', modele: 'Le jour de la vérification est à renseigner.' },
  {
    cle: 'verification_hors_bornes', rang: 6, code: '22023',
    modele: "Le jour de la vérification est compris entre le 01/01/2000 et aujourd'hui.",
  },
  {
    cle: 'remplacee_d_un_autre_dossier', rang: 7, code: '22023',
    modele: "L'adresse à remplacer n'est pas une adresse de réception de ce dossier.",
  },
  {
    cle: 'remplacee_pas_courante', rang: 7, code: '22023',
    modele: 'Une autre adresse a été déclarée entre-temps (« % », le %) : relire avant de déclarer.',
  },
] as const

export type CleRefusDeclarationAdresse = (typeof REFUS_DECLARATION_ADRESSE)[number]['cle']

export interface RefusAdresse {
  cle: CleRefusDeclarationAdresse
  message: string
}

function refus(cle: CleRefusDeclarationAdresse, ...valeurs: string[]): RefusAdresse {
  const { modele } = REFUS_DECLARATION_ADRESSE.find((r) => r.cle === cle) as (typeof REFUS_DECLARATION_ADRESSE)[number]
  return { cle, message: remplirModele(modele, valeurs) }
}

/** Ce que l'écran envoie, champ pour champ comme les paramètres de la fonction ; une date est une date civile AAAA-MM-JJ. */
export interface SaisieAdresseReception {
  forme: string | null
  identifiant: string | null
  plateforme: string | null
  prise_effet: string | null
  verification: string | null
  verifiee_le: string | null
  remplace_id: string | null
}

const JOUR_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/

/** Une date civile AAAA-MM-JJ qui existe au calendrier (ni un 31 juin, ni un mois 13). */
export function estUnJourCivil(valeur: string): boolean {
  const m = JOUR_CIVIL.exec(valeur)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

// Une date que le champ ne donne pas n'est pas une saisie : PostgREST la refuserait avant la fonction, sous ses propres
// mots. Le module ne la juge pas — il lève, comme sur un jour d'aujourd'hui qui n'en est pas un.
function jour(valeur: string | null, quoi: string): string | null {
  if (valeur === null) return null
  if (!estUnJourCivil(valeur)) throw new Error(`${quoi} n'est pas une date civile AAAA-MM-JJ : ${valeur}`)
  return valeur
}

const BLANCS_SEULS = new RegExp(`^[${BLANCS}]*$`)
const caracteres = (texte: string) => Array.from(texte).length

/**
 * Ce que `declarer_adresse_reception` refuserait de cette saisie : le PREMIER refus, dans l'ordre de la base et sous son
 * message ; null quand elle l'accepterait ; `rompue` quand les adresses lues ne font pas une chaîne — le module ne dit
 * alors rien (voir `versionCourante`). `siretDuDossier` : la colonne `siret` du dossier, telle que lue ; `adressesDuDossier` :
 * ses adresses LUES EN ENTIER — la version courante s'y juge ; sur une lecture partielle, l'appelant ne demande rien à ce
 * module. `aujourdhui` : le jour à Paris (AAAA-MM-JJ), que l'appelant donne.
 */
export function refusDeclarationAdresse(
  dossierId: string,
  siretDuDossier: string | null,
  saisie: SaisieAdresseReception,
  adressesDuDossier: readonly AdresseReception[],
  aujourdhui: string,
): RefusAdresse | null | 'rompue' {
  const priseEffet = jour(saisie.prise_effet, 'La date de prise d’effet')
  const verifieeLe = jour(saisie.verifiee_le, 'Le jour de la vérification')
  const ceJour = jour(aujourdhui, 'Aujourd’hui') as string
  // 2. La maille, puis l'identifiant à sa forme, puis le SIRET de l'identifiant, qui commence par son SIREN.
  const maille = MAILLES_ADRESSE.find((m) => m.forme === saisie.forme)
  if (!maille) return refus('maille_inconnue')
  const identifiant = saisie.identifiant
  if (identifiant === null || !maille.motif.test(identifiant)) return refus(`forme_${maille.forme}`)
  if (siretDansLAdresse(maille.forme) && !siretDeLEntreprise(identifiant)) return refus('siret_d_une_autre_entreprise')
  // 3. Le SIREN du dossier, tiré de son SIRET comme l'application le tire ; puis l'identifiant, qui commence par lui.
  const siren = sirenDuDossier(siretDuDossier)
  if (siren === null) return refus('dossier_sans_siren')
  if (identifiant.slice(0, 9) !== siren) return refus('siren_du_dossier', siren)
  // 4. La date de prise d'effet.
  if (priseEffet === null) return refus('prise_effet_absente')
  if (priseEffet < PREMIER_JOUR || priseEffet > DERNIER_JOUR) return refus('prise_effet_hors_bornes')
  // 5. La plateforme de réception.
  if (saisie.plateforme === null || BLANCS_SEULS.test(saisie.plateforme)) return refus('plateforme_absente')
  if (caracteres(saisie.plateforme) > PLATEFORME_MAX) return refus('plateforme_longue')
  // 6. La vérification : sa source, puis son jour, qui n'est pas dans l'avenir à Paris.
  if (!VERIFICATIONS.includes(saisie.verification as VerificationAdresseReception)) return refus('verification_inconnue')
  if (saisie.verification === 'declaration' && verifieeLe !== null) return refus('verification_datee')
  if (saisie.verification !== 'declaration' && verifieeLe === null) return refus('verification_sans_jour')
  if (verifieeLe !== null && (verifieeLe < PREMIER_JOUR || verifieeLe > ceJour)) return refus('verification_hors_bornes')
  // 7. La version remplacée : une adresse de ce dossier, et la courante.
  const duDossier = adressesDuDossier.filter((a) => a.dossier_id === dossierId)
  if (saisie.remplace_id !== null && !duDossier.some((a) => a.id === saisie.remplace_id)) return refus('remplacee_d_un_autre_dossier')
  const courante = versionCourante(duDossier, dossierId)
  if (courante === 'rompue') return 'rompue'
  if (saisie.remplace_id !== (courante?.id ?? null)) {
    // Toujours une courante ici : une version remplacée nommée est du dossier, et une première manquée suppose la sienne.
    const nommee = courante as AdresseReception
    return refus('remplacee_pas_courante', nommee.identifiant, formatDate(dateAParis(nommee.cree_le)))
  }
  return null
}
