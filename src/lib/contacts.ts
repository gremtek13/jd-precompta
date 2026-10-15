import { BLANCS, nomDansUnRefus, sansBlancsAuxBords } from './articles'
import { remplirModele } from './encaissementsFactures'
import { sirenValide, siretValide } from './factureCii'
import { formatDate } from './format'
import { FORME_ADRESSE_ELECTRONIQUE, FORME_SIREN, FORME_SIRET, LONGUEUR_CODE_SERVICE, sirenOuvert, versEntreprise } from './mentionsFacture'
import type { ArticleExoneration, Contact, GenreContact, TypeClient } from './types'

// LES CONTACTS D'UN DOSSIER — LES CLIENTS DE SON CLIENT (espace client, étape A4a ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4). Un module PUR — il ne lit rien
// en base, n'appelle personne, ne lit pas l'horloge — que les écrans de l'étape A4b liront : ce que les quatre fonctions de
// la base refuseraient, dans LEUR ordre et sous LEURS mots, dit avant le clic ; la saisie telle qu'elle part ; la règle des
// soins ; le nom d'un contact effacé.
//
// CE QU'UN CONTACT EST. Un client du client, tel qu'une facture le désigne : un contact PRÉ-REMPLIRA le client d'une
// facture, qui en garde sa COPIE — jamais un renvoi : changer le contact ne change aucune facture, et l'effacer non plus.
// Ses formes sont celles que la facture accepte (src/lib/mentionsFacture.ts, ses contraintes recopiées par la migration) ;
// ses clés, celles que la facture exige avant sa transmission (src/lib/factureCii.ts, `sirenValide`, `siretValide`) :
// le module les EMPRUNTE, il n'en recopie aucune.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `contacts` OUVRE une lecture au client qui porte la case « Ventes », et quatre fonctions dont l'effacement :
// présentée au cabinet, elle a été appliquée sur son accord, et l'export (supabase/schema) la porte. Ce drapeau est donc
// levé : le plan de sauvegarde compte la table (src/lib/sauvegarde.ts), la phrase de l'onglet Accès dit ce que la case
// « Ventes » ouvre de plus (src/lib/droitsAcces.ts) ; la vue « Clients » de l'onglet Factures les offre depuis l'étape A4b1
// (c'est ce drapeau qui la montre), et le formulaire d'une facture, depuis l'étape A4b2, lit les contacts sous le même drapeau
// pour offrir « Choisir un client » et « Enregistrer ce client ». contacts.test.ts
// confronte ce drapeau à l'export, et les refus ci-dessous au texte même des fonctions comme à l'essai
// supabase/essais/contacts.sql. Un retour arrière de la migration ne viendrait qu'APRÈS le drapeau rebaissé en ligne :
// sinon chaque sauvegarde lirait une table absente.
export const CONTACTS_EXPORTES: boolean = true

// ── Les hypothèses nommées (MEG1-Q9 à Q11, et les lectures de la base, A4-Q1 à A4-Q4) ──────────────────────────────────
// Les recommandations de la conception, prises en attendant la réponse du cabinet ; contacts.test.ts confronte chacune au
// texte de la migration et à l'essai. Ce qui changerait si le cabinet répondait autrement est dit pour chacune.
export const HYPOTHESES_DES_CONTACTS = {
  // Les clients seulement ; les fournisseurs, avec les achats (partie B) : une migration élargirait `contacts_genre_check`.
  'MEG1-Q9': 'les clients seulement',
  // Un dossier qui dispense des soins exonérés ne range pas de particulier ; sinon, la règle partirait des quatre fonctions.
  'MEG1-Q10': 'un dossier de soins ne range aucun particulier',
  // Le client répond des données de ses clients, le cabinet agit pour lui ; un contact s'efface, la ligne gardée ; la liste
  // des contacts sans activité depuis trois ans est un écran (A4b), jamais un effacement d'office.
  'MEG1-Q11': 'un contact s’efface, ses factures gardent leur copie',
  // La règle suit l'ARTICLE des soins, que la base admet aussi pour un dossier redevable d'une activité en partie exonérée ;
  // « l'exonéré seulement » ne lirait que le statut `exonere`.
  'A4-Q1': 'la règle suit l’article des soins, exonéré ou redevable',
  // Un particulier est un non-assujetti SANS SIREN : une association s'y range avec le sien.
  'A4-Q2': 'un non-assujetti qui a son SIREN n’est pas un particulier',
  // Un client établi hors de France peut être un particulier : il ne s'y range pas.
  'A4-Q3': 'un client établi hors de France ne s’y range pas',
  // Un contact rangé avant que le dossier passe aux soins reste ; il ne se modifie ni ne se reprend plus, il se retire et
  // s'efface — l'écran (A4b) le proposera à l'effacement, jamais d'office.
  'A4-Q4': 'la fonction ne réécrit rien d’elle-même',
} as const

// ── Les valeurs de la base, confrontées au texte de la migration par le test ─────────────────────────────────────────
export const GENRES_CONTACT: readonly GenreContact[] = ['client']
// Les quatre types de la facture (`factures_emises_type_client_check`), dans l'ordre du formulaire de la facture.
export const TYPES_CLIENT_CONTACT: readonly TypeClient[] = ['assujetti', 'organisme_public', 'non_assujetti', 'etranger']
// Des bornes TECHNIQUES : aucun texte ne borne un nom, une adresse ou des observations.
export const NOM_CONTACT_MAX = 200
export const ADRESSE_CONTACT_MAX = 1000
export const OBSERVATIONS_CONTACT_MAX = 1000
// Une adresse de 254 caractères au plus (RFC 5321, §4.5.3.1.3 : un chemin de 256 octets, chevrons compris).
export const EMAIL_CONTACT_MAX = 254
// Le plafond du délai convenu entre professionnels (C. com., art. L441-10, I : soixante jours après l'émission de la
// facture) ; celui de la commande publique ne le dépasse pas (art. R2192-10 et R2192-11 : trente, cinquante ou soixante
// jours) ; aucun texte ne borne celui d'un particulier ni d'un client établi hors de France — la même borne vaut, puisqu'un
// contact ne fait que PROPOSER l'échéance d'une facture, qui se saisit librement.
export const DELAI_CONTACT_MAX_JOURS = 60
// Une adresse e-mail valable au sens du WHATWG (« valid e-mail address », HTML Living Standard) : celle qu'un champ
// `type="email"` admet, et que la fonction juge avec la même expression.
export const FORME_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
// L'article d'exonération des soins (CGI, art. 261, 4, 1°), que la règle des soins lit (MEG1-Q10, A4-Q1).
export const ARTICLE_DES_SOINS: ArticleExoneration = 'cgi_261_4_1'
// Le nom que prend un contact effacé, suivi du jour de Paris de l'effacement.
export const PREFIXE_DU_NOM_EFFACE = 'Contact effacé le '
export { BLANCS }

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// Chaque liste est celle des `raise exception` d'une fonction, dans l'ordre de son texte, avec son code (contacts.test.ts la
// confronte aux messages que l'essai supabase/essais/contacts.sql exige de la base, et au texte exporté quand
// `CONTACTS_EXPORTES` est levé). Douze RANGS pour `enregistrer_contact`, vingt-sept messages. Le refus d'accès, seule la
// base le juge : l'écran n'existe que pour qui lit le dossier. Les rangs 3 et 4 ne se rencontrent jamais ensemble : retiré
// et effacé s'excluent (`contacts_retire_ou_efface`).
const MESSAGE_SOINS_PARTICULIER = 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans '
  + "ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s'y range avec son SIREN."
const MESSAGE_SOINS_ETRANGER = 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi '
  + 'hors de France dans ses contacts : il pourrait être un particulier, donc un patient.'

export const REFUS_ENREGISTREMENT_CONTACT = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Contact introuvable dans ce dossier.' },
  { cle: 'retire', rang: 3, code: '22023', modele: 'Ce contact est retiré : le reprendre avant de le modifier.' },
  { cle: 'efface', rang: 4, code: '22023', modele: 'Ce contact est effacé : il ne se modifie plus.' },
  { cle: 'nom_absent', rang: 5, code: '22023', modele: 'Le nom du contact est à renseigner.' },
  { cle: 'nom_long', rang: 5, code: '22023', modele: 'Le nom du contact tient en deux cents caractères au plus.' },
  { cle: 'adresse_absente', rang: 5, code: '22023', modele: "L'adresse du contact est à renseigner." },
  { cle: 'adresse_longue', rang: 5, code: '22023', modele: "L'adresse du contact tient en mille caractères au plus." },
  {
    cle: 'type_inconnu', rang: 6, code: '22023',
    modele: "Le type du contact est l'un des quatre de la facture : une entreprise établie en France, un organisme public, "
      + 'un particulier ou un autre non-assujetti, un client établi hors de France.',
  },
  { cle: 'etranger_identifiants', rang: 7, code: '22023', modele: "Un client établi hors de France n'a ni SIREN ni SIRET." },
  { cle: 'siren_forme', rang: 7, code: '22023', modele: "Le SIREN du contact s'écrit en neuf chiffres." },
  { cle: 'siren_cle', rang: 7, code: '22023', modele: 'Le SIREN du contact ne passe pas sa clé de contrôle.' },
  { cle: 'siret_forme', rang: 7, code: '22023', modele: "Le SIRET du contact s'écrit en quatorze chiffres." },
  { cle: 'siret_cle', rang: 7, code: '22023', modele: 'Le SIRET du contact ne passe pas sa clé de contrôle.' },
  {
    cle: 'siret_sans_siren', rang: 7, code: '22023',
    modele: "Un SIRET se donne avec le SIREN qu'il commence : renseigner aussi le SIREN du contact.",
  },
  { cle: 'siret_autre_siren', rang: 7, code: '22023', modele: 'Le SIRET du contact ne commence pas par son SIREN.' },
  {
    cle: 'siret_pris', rang: 7, code: '23505',
    modele: "Le SIRET « % » est déjà celui du contact « % »% : un établissement ne se range qu'une fois par dossier.",
  },
  {
    cle: 'adresse_electronique_type', rang: 8, code: '22023',
    modele: "Une adresse de facturation électronique ne se donne qu'à une entreprise établie en France ou à un organisme public.",
  },
  {
    cle: 'adresse_electronique_forme', rang: 8, code: '22023',
    modele: "L'adresse de facturation électronique s'écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, "
      + 'sans espace ni accent.',
  },
  {
    cle: 'adresse_electronique_siren', rang: 8, code: '22023',
    modele: "L'adresse de facturation électronique du contact ne commence pas par son SIREN.",
  },
  { cle: 'code_service_type', rang: 8, code: '22023', modele: "Un code service ne se donne qu'à un organisme public." },
  { cle: 'code_service_forme', rang: 8, code: '22023', modele: 'Le code service est à renseigner en cent caractères au plus.' },
  {
    cle: 'email_invalide', rang: 9, code: '22023',
    modele: "L'e-mail du contact n'est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.",
  },
  {
    cle: 'delai_invalide', rang: 10, code: '22023',
    modele: 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.',
  },
  {
    cle: 'observations_longues', rang: 11, code: '22023',
    modele: 'Les observations du contact sont un texte de mille caractères au plus.',
  },
  { cle: 'soins_particulier', rang: 12, code: '22023', modele: MESSAGE_SOINS_PARTICULIER },
  { cle: 'soins_etranger', rang: 12, code: '22023', modele: MESSAGE_SOINS_ETRANGER },
] as const

export const REFUS_RETRAIT_CONTACT = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Contact introuvable dans ce dossier.' },
  { cle: 'efface', rang: 3, code: '22023', modele: 'Ce contact est effacé : il ne se retire plus.' },
  { cle: 'deja_retire', rang: 4, code: '22023', modele: 'Ce contact est déjà retiré.' },
] as const

// La reprise suit la règle des soins, comme une écriture : un contact rangé avant que le dossier passe aux soins ne
// revient pas dans les choix (A4-Q4).
export const REFUS_REPRISE_CONTACT = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Contact introuvable dans ce dossier.' },
  { cle: 'efface', rang: 3, code: '22023', modele: 'Ce contact est effacé : il ne se reprend plus.' },
  { cle: 'pas_retire', rang: 4, code: '22023', modele: "Ce contact n'est pas retiré." },
  { cle: 'soins_particulier', rang: 5, code: '22023', modele: MESSAGE_SOINS_PARTICULIER },
  { cle: 'soins_etranger', rang: 5, code: '22023', modele: MESSAGE_SOINS_ETRANGER },
] as const

export const REFUS_EFFACEMENT_CONTACT = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Contact introuvable dans ce dossier.' },
  { cle: 'deja_efface', rang: 3, code: '22023', modele: 'Ce contact est déjà effacé.' },
] as const

export type CleRefusEnregistrementContact = (typeof REFUS_ENREGISTREMENT_CONTACT)[number]['cle']
export type CleRefusRetraitContact = (typeof REFUS_RETRAIT_CONTACT)[number]['cle']
export type CleRefusRepriseContact = (typeof REFUS_REPRISE_CONTACT)[number]['cle']
export type CleRefusEffacementContact = (typeof REFUS_EFFACEMENT_CONTACT)[number]['cle']

export interface RefusContact<C extends string> {
  cle: C
  message: string
}

function refusDe<C extends string>(liste: readonly { cle: C; modele: string }[], cle: C, valeurs: string[]): RefusContact<C> {
  const { modele } = liste.find((r) => r.cle === cle) as { cle: C; modele: string }
  return { cle, message: remplirModele(modele, valeurs) }
}

// ── Lire la saisie comme la fonction la lit ─────────────────────────────────────────────────────────────────────────
// La saisie part en JSON : une clé `undefined` disparaît, NaN et l'infini deviennent `null`. Le module la juge donc APRÈS
// cet aller-retour, telle que la base la reçoit, champ par champ et par son TYPE JSON d'abord ; il compte les caractères
// comme `char_length` (par point de code) et ne retire aux bords que les quatre blancs de `BLANCS`.

function commeLaBaseLaRecoit(saisie: unknown): unknown {
  try {
    const texte = JSON.stringify(saisie)
    return texte === undefined ? null : JSON.parse(texte)
  } catch {
    return null
  }
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const champ = (objet: unknown, cle: string): unknown => (estObjet(objet) ? objet[cle] : undefined)
const absent = (v: unknown) => v === undefined || v === null
const caracteres = (texte: string) => Array.from(texte).length
const estUnType = (v: unknown): v is TypeClient => typeof v === 'string' && (TYPES_CLIENT_CONTACT as readonly string[]).includes(v)

/** Le contact que l'écriture vise : un contact neuf, ou celui de l'identifiant envoyé — nul quand l'écran ne l'a pas lu. */
export type CibleContact =
  | { nouveau: true }
  | { nouveau: false; contact: Pick<Contact, 'id' | 'dossier_id' | 'retire_le' | 'efface_le'> | null }

/** Ce qu'il faut savoir des contacts du dossier pour juger l'unicité d'un SIRET : la liste LUE EN ENTIER. */
export type ContactPourSiret = Pick<Contact, 'id' | 'dossier_id' | 'siret' | 'nom' | 'retire_le'>

// ── La règle des soins (MEG1-Q10, A4-Q1 à A4-Q3, hypothèses) ────────────────────────────────────────────────────────
/** Le dossier dispense-t-il des soins exonérés ? Son ARTICLE le dit, qu'il soit exonéré ou redevable (A4-Q1). */
export function dossierDeSoins(articleExoneration: ArticleExoneration | null): boolean {
  return articleExoneration === ARTICLE_DES_SOINS
}

/**
 * Ce que la règle des soins refuse d'un contact de ce type et de ce SIREN dans ce dossier, ou null. Un particulier — un
 * non-assujetti SANS SIREN (A4-Q2) — ou un client établi hors de France (A4-Q3) ; l'écran (A4b) s'en sert aussi pour
 * dire quels contacts, rangés avant que le dossier passe aux soins, ne se modifient ni ne se reprennent plus (A4-Q4).
 */
export function regleDesSoins(
  articleExoneration: ArticleExoneration | null,
  typeClient: TypeClient | null,
  siren: string | null,
): 'soins_particulier' | 'soins_etranger' | null {
  if (!dossierDeSoins(articleExoneration)) return null
  if (typeClient === 'non_assujetti' && siren == null) return 'soins_particulier'
  if (typeClient === 'etranger') return 'soins_etranger'
  return null
}

/**
 * Ce qu'`enregistrer_contact` refuserait de cette saisie : le PREMIER refus, dans l'ordre de la base et sous son message,
 * ou null quand elle l'accepterait. `articleExoneration` : celui du dossier, que la règle des soins lit. `contactsDuDossier` :
 * la liste des contacts du dossier LUE EN ENTIER — l'unicité d'un SIRET s'y juge ; sur une lecture partielle, l'appelant ne
 * demande rien à ce module (il ne dirait pas « libre » un SIRET qu'il n'a pas vu).
 */
export function refusEnregistrementContact(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  cible: CibleContact,
  saisie: unknown,
  contactsDuDossier: readonly ContactPourSiret[],
): RefusContact<CleRefusEnregistrementContact> | null {
  const refus = (cle: CleRefusEnregistrementContact, ...valeurs: string[]) => refusDe(REFUS_ENREGISTREMENT_CONTACT, cle, valeurs)
  // 2, 3 et 4. Le contact, dans ce dossier ; retiré, il se reprend avant de se modifier ; effacé, il ne se modifie plus.
  if (!cible.nouveau) {
    if (!cible.contact || cible.contact.dossier_id !== dossierId) return refus('introuvable')
    if (cible.contact.retire_le != null) return refus('retire')
    if (cible.contact.efface_le != null) return refus('efface')
  }
  const recue = commeLaBaseLaRecoit(saisie)
  // 5. Le nom, puis l'adresse.
  const nom = champ(recue, 'nom')
  if (typeof nom !== 'string' || sansBlancsAuxBords(nom) === '') return refus('nom_absent')
  if (caracteres(nom) > NOM_CONTACT_MAX) return refus('nom_long')
  const adresse = champ(recue, 'adresse')
  if (typeof adresse !== 'string' || sansBlancsAuxBords(adresse) === '') return refus('adresse_absente')
  if (caracteres(adresse) > ADRESSE_CONTACT_MAX) return refus('adresse_longue')
  // 6. Le type, l'un des quatre de la facture.
  const type = champ(recue, 'type_client')
  if (!estUnType(type)) return refus('type_inconnu')
  // 7. Les identifiants, dans l'ordre de la facture : le SIREN, puis le SIRET — aucun pour un client établi hors de France.
  const siren = champ(recue, 'siren')
  const siret = champ(recue, 'siret')
  if (!sirenOuvert(type) && (!absent(siren) || !absent(siret))) return refus('etranger_identifiants')
  if (!absent(siren)) {
    if (typeof siren !== 'string' || !FORME_SIREN.test(siren)) return refus('siren_forme')
    if (!sirenValide(siren)) return refus('siren_cle')
  }
  const sirenDonne = typeof siren === 'string' ? siren : null
  if (!absent(siret)) {
    if (typeof siret !== 'string' || !FORME_SIRET.test(siret)) return refus('siret_forme')
    if (!siretValide(siret)) return refus('siret_cle')
    if (sirenDonne == null) return refus('siret_sans_siren')
    if (siret.slice(0, 9) !== sirenDonne) return refus('siret_autre_siren')
    const cibleId = cible.nouveau ? null : cible.contact?.id ?? null
    const autre = contactsDuDossier.find((c) => c.dossier_id === dossierId && c.siret === siret && c.id !== cibleId)
    if (autre) return refus('siret_pris', siret, nomDansUnRefus(autre.nom), autre.retire_le != null ? ' (retiré)' : '')
  }
  // 8. L'adresse de facturation électronique — à une entreprise ou à un organisme public, à la forme de l'annuaire, le SIREN
  // du contact en tête quand il est donné —, puis le code service, à un organisme public.
  const adresseElectronique = champ(recue, 'adresse_electronique')
  if (!absent(adresseElectronique)) {
    if (!versEntreprise(type)) return refus('adresse_electronique_type')
    if (typeof adresseElectronique !== 'string' || !FORME_ADRESSE_ELECTRONIQUE.test(adresseElectronique)) {
      return refus('adresse_electronique_forme')
    }
    if (sirenDonne != null && adresseElectronique.slice(0, 9) !== sirenDonne) return refus('adresse_electronique_siren')
  }
  const codeService = champ(recue, 'code_service')
  if (!absent(codeService)) {
    if (type !== 'organisme_public') return refus('code_service_type')
    if (typeof codeService !== 'string' || sansBlancsAuxBords(codeService) === '' || caracteres(codeService) > LONGUEUR_CODE_SERVICE) {
      return refus('code_service_forme')
    }
  }
  // 9. L'e-mail ; 10. le délai, un nombre entier de jours ; 11. les observations.
  const email = champ(recue, 'email')
  if (!absent(email) && (typeof email !== 'string' || caracteres(email) > EMAIL_CONTACT_MAX || !FORME_EMAIL.test(email))) {
    return refus('email_invalide')
  }
  const delai = champ(recue, 'delai_paiement_jours')
  if (!absent(delai) && (typeof delai !== 'number' || !Number.isInteger(delai) || delai < 0 || delai > DELAI_CONTACT_MAX_JOURS)) {
    return refus('delai_invalide')
  }
  const observations = champ(recue, 'observations')
  if (!absent(observations) && (typeof observations !== 'string' || caracteres(observations) > OBSERVATIONS_CONTACT_MAX)) {
    return refus('observations_longues')
  }
  // 12. La règle des soins.
  const soins = regleDesSoins(articleExoneration, type, sirenDonne)
  return soins ? refus(soins) : null
}

/** Ce que `retirer_contact` refuserait ; null quand elle retirerait le contact. */
export function refusRetraitContact(
  dossierId: string,
  contact: Pick<Contact, 'dossier_id' | 'retire_le' | 'efface_le'> | null,
): RefusContact<CleRefusRetraitContact> | null {
  const refus = (cle: CleRefusRetraitContact) => refusDe(REFUS_RETRAIT_CONTACT, cle, [])
  if (!contact || contact.dossier_id !== dossierId) return refus('introuvable')
  if (contact.efface_le != null) return refus('efface')
  if (contact.retire_le != null) return refus('deja_retire')
  return null
}

/** Ce que `reprendre_contact` refuserait ; null quand elle reprendrait le contact. */
export function refusRepriseContact(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  contact: Pick<Contact, 'dossier_id' | 'retire_le' | 'efface_le' | 'type_client' | 'siren'> | null,
): RefusContact<CleRefusRepriseContact> | null {
  const refus = (cle: CleRefusRepriseContact) => refusDe(REFUS_REPRISE_CONTACT, cle, [])
  if (!contact || contact.dossier_id !== dossierId) return refus('introuvable')
  if (contact.efface_le != null) return refus('efface')
  if (contact.retire_le == null) return refus('pas_retire')
  const soins = regleDesSoins(articleExoneration, contact.type_client, contact.siren)
  return soins ? refus(soins) : null
}

/** Ce que `effacer_contact` refuserait ; null quand elle effacerait le contact. */
export function refusEffacementContact(
  dossierId: string,
  contact: Pick<Contact, 'dossier_id' | 'efface_le'> | null,
): RefusContact<CleRefusEffacementContact> | null {
  const refus = (cle: CleRefusEffacementContact) => refusDe(REFUS_EFFACEMENT_CONTACT, cle, [])
  if (!contact || contact.dossier_id !== dossierId) return refus('introuvable')
  if (contact.efface_le != null) return refus('deja_efface')
  return null
}

// ── L'état d'un contact, le nom d'un effacé ─────────────────────────────────────────────────────────────────────────
/** Actif, retiré ou effacé : les deux derniers s'excluent, et la base le tient. */
export function etatDuContact(contact: Pick<Contact, 'retire_le' | 'efface_le'>): 'actif' | 'retire' | 'efface' {
  if (contact.efface_le != null) return 'efface'
  return contact.retire_le != null ? 'retire' : 'actif'
}

/**
 * Le nom que la base donne à un contact effacé ce jour-là : « Contact effacé le JJ/MM/AAAA ». `jour` est le jour de Paris
 * (AAAA-MM-JJ), que l'appelant donne — le module ne lit pas l'horloge.
 */
export function nomDUnContactEfface(jour: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new Error(`Un jour s'écrit AAAA-MM-JJ : ${jour}`)
  return PREFIXE_DU_NOM_EFFACE + formatDate(jour)
}

// ── La saisie telle qu'elle part ────────────────────────────────────────────────────────────────────────────────────
/** Ce que le formulaire d'un contact (étape A4b) saisit, chaque champ en texte, le type choisi ou non. */
export interface SaisieContact {
  nom: string
  typeClient: TypeClient | ''
  adresse: string
  siren: string
  siret: string
  adresseElectronique: string
  codeService: string
  email: string
  delai: string
  observations: string
}

/** La saisie telle que la base la reçoit (`p_contact`). */
export interface ContactEnvoye {
  nom: string
  type_client: TypeClient | null
  adresse: string
  siren: string | null
  siret: string | null
  adresse_electronique: string | null
  code_service: string | null
  email: string | null
  // Un nombre lu tel qu'écrit ; le texte tel quel quand il n'en est pas un — la base le refuse alors, et le module avec elle.
  delai_paiement_jours: number | string | null
  observations: string | null
}

// Un identifiant se tape avec ses espaces (« 123 456 782 ») : ils partent, comme la facture les retire
// (src/lib/mentionsFacture.ts, `mentionsAEnregistrer`).
const sansAucunBlanc = (texte: string) => texte.replace(/\s/g, '')
const texteOuNul = (texte: string) => {
  const t = sansBlancsAuxBords(texte)
  return t === '' ? null : t
}

/**
 * La saisie telle qu'elle part : les blancs des bords retirés (ceux de la base, `BLANCS`), ceux d'un identifiant retirés
 * tous, un champ vide envoyé nul ; un champ que le type ne lui ouvre pas repart à nul, comme sur la facture — ni SIREN ni
 * SIRET hors de France, l'adresse électronique à une entreprise ou à un organisme public, le code service à un organisme
 * public. Le délai part en nombre quand il en est un, écrit en chiffres ; sinon tel quel, et la base le refuse.
 */
export function saisieQuiPart(s: SaisieContact): ContactEnvoye {
  const type = s.typeClient === '' ? null : s.typeClient
  const ouvert = (condition: boolean, valeur: string) => (condition ? sansAucunBlanc(valeur) || null : null)
  const delai = sansBlancsAuxBords(s.delai)
  return {
    nom: sansBlancsAuxBords(s.nom),
    type_client: type,
    adresse: sansBlancsAuxBords(s.adresse),
    siren: ouvert(type == null || sirenOuvert(type), s.siren),
    siret: ouvert(type == null || sirenOuvert(type), s.siret),
    adresse_electronique: ouvert(type != null && versEntreprise(type), s.adresseElectronique),
    code_service: type === 'organisme_public' ? texteOuNul(s.codeService) : null,
    email: texteOuNul(s.email),
    delai_paiement_jours: delai === '' ? null : /^\d+$/.test(delai) ? Number(delai) : delai,
    observations: texteOuNul(s.observations),
  }
}
