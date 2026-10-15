import { nomDansUnRefus, sansBlancsAuxBords } from './articles'
import { enumeration } from './articlesFacture'
import { REFUS_ENREGISTREMENT_CONTACT, regleDesSoins, saisieQuiPart, type RefusContact, type SaisieContact } from './contacts'
import {
  LIBELLES_TYPE_CONTACT, champsDeRechercheContact, contactsAffiches, delaiAffiche, identifiantAffiche, soinsDuContact,
  type CleSoins,
} from './contactsVue'
import type { EspaceVentes } from './espaceVentes'
import { ajouterJours, formatDate } from './format'
import { sirenOuvert, versEntreprise, type SaisieMentions } from './mentionsFacture'
import { correspondALaRecherche } from './recherche'
import type { ArticleExoneration, Contact, TypeClient } from './types'

// UN CLIENT DANS LE FORMULAIRE D'UNE FACTURE (espace client, étape A4b2 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
// LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « L'usage » et « La règle des soins »).
// Un module PUR — rien lu, rien écrit, pas d'horloge — que `FactureFormModal` appelle : les contacts qu'on peut choisir, ce que
// le choix met dans la facture et ce qu'il y remplace, l'échéance que le délai du contact propose, l'information d'un dossier
// de soins, la saisie qu'« Enregistrer ce client » enverrait.
//
// AUCUNE RÈGLE N'EST RECOPIÉE ICI. La règle des soins est `regleDesSoins` (lib/contacts.ts) ; ce que l'enregistrement
// refuserait est `refusDeLaSaisieContact` (le module des contacts, dans l'ordre de la base, sous ses mots) et la saisie qui
// part est `saisieQuiPart` ; les états d'un contact sont ceux de `contactsAffiches` ; les quatre types ont les mots du formulaire
// (`LIBELLES_TYPE_CONTACT`). Ce fichier ne dit que ce qu'un FORMULAIRE de facture ajoute : le client y est fait de TEXTES de
// champ, et il garde sa COPIE du contact — aucune clé, aucune garde ne lit un contact (la provenance n'est qu'une mémoire d'écran
// jusqu'à l'étape A7).

/** Le client d'une facture tel que les champs du formulaire le portent : des textes, le type choisi ou non. */
export interface ClientEnSaisie {
  tiersNom: string
  tiersAdresse: string
  tiersSiret: string
  typeClient: TypeClient | ''
  siren: string
  adresseElectronique: string
  codeService: string
}

/** Le client du formulaire, depuis ses champs d'en-tête et ses mentions. */
export function clientEnSaisie(
  champs: Pick<ClientEnSaisie, 'tiersNom' | 'tiersAdresse' | 'tiersSiret'>, mentions: SaisieMentions,
): ClientEnSaisie {
  return {
    tiersNom: champs.tiersNom, tiersAdresse: champs.tiersAdresse, tiersSiret: champs.tiersSiret,
    typeClient: mentions.typeClient, siren: mentions.siren, adresseElectronique: mentions.adresseElectronique, codeService: mentions.codeService,
  }
}

/** Les mentions du formulaire, le client choisi mis dedans : le reste des mentions (nature, dates, livraison, engagement) ne bouge pas. */
export function mentionsAvecLeClient(mentions: SaisieMentions, client: ClientEnSaisie): SaisieMentions {
  return {
    ...mentions,
    typeClient: client.typeClient, siren: client.siren, adresseElectronique: client.adresseElectronique, codeService: client.codeService,
  }
}

// ── Les contacts qu'on peut choisir ─────────────────────────────────────────────────────────────────────────────────────
export interface ContactsAChoisir {
  // Ceux qu'on propose : en cours (jamais un retiré ni un effacé), que la règle des soins ne refuse pas, filtrés par la recherche.
  offerts: Contact[]
  // Les contacts EN COURS que la règle des soins refuse dans ce dossier (rangés avant son passage aux soins, A4-Q4) : ils ne se
  // proposent pas. Comptés sans la recherche, pour que la ligne qui le dit ne change pas à chaque lettre tapée.
  ecartesParLesSoins: Contact[]
}

/**
 * Les contacts du choix, dans l'ordre de la liste d'A4b1 (en cours, par nom, puis identifiant), filtrés par la recherche commune
 * (nom, SIREN, SIRET). `contacts` : la liste LUE EN ENTIER, effacés compris — l'écran n'ouvre rien sur une lecture partielle.
 */
export function contactsAChoisir(
  contacts: readonly Contact[], articleExoneration: ArticleExoneration | null, recherche: string,
): ContactsAChoisir {
  const enCours = contactsAffiches(contacts, false)
  const ecartesParLesSoins = enCours.filter((c) => soinsDuContact(articleExoneration, c) != null)
  // Liée à un nom : le scanner des recherches (`recherchesEtTotaux.test.ts`) ne lit qu'un `const … = X.filter(…)`.
  const trouves = enCours
    .filter((c) => soinsDuContact(articleExoneration, c) == null)
    .filter((c) => correspondALaRecherche(champsDeRechercheContact(c), recherche))
  return { offerts: trouves, ecartesParLesSoins }
}

/** Combien de contacts EN COURS le dossier range (soins compris) : « Choisir un client » ne s'offre que s'il y en a. */
export function contactsEnCours(contacts: readonly Contact[]): Contact[] {
  return contactsAffiches(contacts, false)
}

// ── Ce que le choix met dans la facture ─────────────────────────────────────────────────────────────────────────────────
/** L'échéance que le délai du contact propose : le délai, et la date d'émission plus ce délai (nulle quand l'émission n'est pas une date). */
export interface EcheanceProposee {
  delai: number
  date: string | null
}

export interface ChoixDeContact {
  /** Le client ENTIER : un champ que le contact n'a pas est VIDÉ, jamais un reste du client précédent. */
  client: ClientEnSaisie
  /** Nulle quand le contact n'a pas de délai : l'échéance saisie reste. */
  echeance: EcheanceProposee | null
}

const UN_JOUR = /^\d{4}-\d{2}-\d{2}$/

/**
 * Ce que le choix de ce contact met dans la facture, en texte de champ : son nom, son adresse, son SIRET, son type, son SIREN,
 * son adresse de facturation électronique et son code service — chacun vide quand le contact ne l'a pas —, et l'échéance (la
 * date d'émission plus son délai, au calendrier civil). Les champs que le TYPE du contact n'ouvre pas sont nuls chez lui
 * (la base le tient) : ils repartent donc vides, et le formulaire, qui les cache, ne les envoie pas (`mentionsAEnregistrer`).
 * L'e-mail ne se recopie pas : la facture n'a pas de champ pour lui (A4B2-Q1).
 */
export function choixDeContact(contact: Contact, dateEmission: string): ChoixDeContact {
  const delai = contact.delai_paiement_jours
  return {
    client: {
      tiersNom: contact.nom,
      tiersAdresse: contact.adresse ?? '',
      tiersSiret: contact.siret ?? '',
      typeClient: contact.type_client ?? '',
      siren: contact.siren ?? '',
      adresseElectronique: contact.adresse_electronique ?? '',
      codeService: contact.code_service ?? '',
    },
    echeance: delai == null ? null : { delai, date: UN_JOUR.test(dateEmission) ? ajouterJours(dateEmission, delai) : null },
  }
}

// Deux textes d'identifiant se comparent sans leurs blancs (on les tape avec des espaces, ils partent sans).
const sansAucunBlanc = (texte: string) => texte.replace(/\s/g, '')
const dit = (texte: string) => `« ${nomDansUnRefus(sansBlancsAuxBords(texte))} »`

/**
 * Ce que le choix REMPLACERAIT dans le client déjà saisi, en groupes nominaux, dans l'ordre du formulaire. Une liste VIDE veut
 * dire que le choix remplit directement : rien n'est saisi, ou ce qui l'est dit déjà ce que le contact apporte. Un champ saisi
 * que le contact n'a pas est nommé aussi : il serait vidé. Seuls les champs que le formulaire MONTRE comptent — le SIREN hors de
 * France, l'adresse électronique d'un particulier, le code service d'une entreprise sont cachés, et ne partent jamais ; l'échéance
 * ne compte que si le contact en propose une (sans délai, la saisie reste, rien n'est remplacé).
 */
export function ceQueLeChoixDeContactRemplace(actuel: ClientEnSaisie, dateEcheance: string, choix: ChoixDeContact): string[] {
  const apporte = choix.client
  const remplace: string[] = []
  const saisi = (texte: string) => sansBlancsAuxBords(texte) !== ''
  if (saisi(actuel.tiersNom) && sansBlancsAuxBords(actuel.tiersNom) !== sansBlancsAuxBords(apporte.tiersNom)) {
    remplace.push(`le nom ${dit(actuel.tiersNom)}`)
  }
  if (actuel.typeClient !== '' && actuel.typeClient !== apporte.typeClient) {
    remplace.push(`le type ${dit(LIBELLES_TYPE_CONTACT[actuel.typeClient])}`)
  }
  if (sirenOuvert(actuel.typeClient) && saisi(actuel.siren) && sansAucunBlanc(actuel.siren) !== sansAucunBlanc(apporte.siren)) {
    remplace.push(`le SIREN ${sansAucunBlanc(actuel.siren)}`)
  }
  if (saisi(actuel.tiersSiret) && sansAucunBlanc(actuel.tiersSiret) !== sansAucunBlanc(apporte.tiersSiret)) {
    remplace.push(`le SIRET ${sansAucunBlanc(actuel.tiersSiret)}`)
  }
  if (saisi(actuel.tiersAdresse) && sansBlancsAuxBords(actuel.tiersAdresse) !== sansBlancsAuxBords(apporte.tiersAdresse)) {
    remplace.push(`l’adresse ${dit(actuel.tiersAdresse)}`)
  }
  if (versEntreprise(actuel.typeClient) && saisi(actuel.adresseElectronique)
    && sansAucunBlanc(actuel.adresseElectronique) !== sansAucunBlanc(apporte.adresseElectronique)) {
    remplace.push(`l’adresse de facturation électronique ${sansAucunBlanc(actuel.adresseElectronique)}`)
  }
  if (actuel.typeClient === 'organisme_public' && saisi(actuel.codeService)
    && sansBlancsAuxBords(actuel.codeService) !== sansBlancsAuxBords(apporte.codeService)) {
    remplace.push(`le code service ${dit(actuel.codeService)}`)
  }
  if (choix.echeance?.date != null && dateEcheance !== '' && dateEcheance !== choix.echeance.date) {
    remplace.push(`l’échéance du ${formatDate(dateEcheance)}`)
  }
  return remplace
}

// ── L'échéance : calculée AU CHOIX, jamais recalculée en silence ─────────────────────────────────────────────────────────
/** Ce que le choix a retenu de l'échéance : le contact (son nom, pour le dire), son délai, et la date d'émission d'alors. */
export interface SuiviDeLEcheance {
  nom: string
  delai: number
  emission: string
}

/** Le suivi que laisse un choix : nul quand le contact n'a pas de délai (l'échéance saisie reste, rien ne la suit). */
export function suiviDeLEcheance(contact: Pick<Contact, 'nom'>, choix: ChoixDeContact, dateEmission: string): SuiviDeLEcheance | null {
  return choix.echeance == null ? null : { nom: contact.nom, delai: choix.echeance.delai, emission: dateEmission }
}

export interface EcheanceARecalculer {
  nom: string
  delai: number
  // L'échéance que le délai donnerait à la date d'émission d'aujourd'hui.
  date: string
}

/**
 * La date d'émission a changé depuis le choix : l'échéance que le délai du contact donnerait maintenant, pour que le formulaire le
 * DISE et l'offre d'un clic — jamais appliquée seule. Nulle quand rien n'a changé, quand l'émission n'est pas (encore) une date, ou
 * quand l'échéance du formulaire est déjà celle que le délai donnerait.
 */
export function echeanceARecalculer(suivi: SuiviDeLEcheance | null, dateEmission: string, dateEcheance: string): EcheanceARecalculer | null {
  if (suivi == null || !UN_JOUR.test(dateEmission) || dateEmission === suivi.emission) return null
  const date = ajouterJours(dateEmission, suivi.delai)
  return date === dateEcheance ? null : { nom: suivi.nom, delai: suivi.delai, date }
}

/** La phrase du formulaire qui dit pourquoi l'échéance se recalculerait. */
export function phraseDeLEcheanceARecalculer(r: EcheanceARecalculer): string {
  return `La date d’émission a changé depuis le choix du client ${dit(r.nom)} : son délai de paiement `
    + `(${delaiAffiche({ delai_paiement_jours: r.delai })}) donnerait une échéance au ${formatDate(r.date)}.`
}

// ── La provenance : le contact qui a rempli le client, EN MÉMOIRE seulement ─────────────────────────────────────────────────
// Rien ne s'enregistre avant l'étape A7 : une facture rouverte n'en a aucune. C'est l'identifiant du contact, que la liste lue en
// entier retrouve — un contact retiré ou effacé depuis ne se montre pas comme provenance.
export function contactDeLaProvenance(contactId: string | null, contacts: readonly Contact[] | null): Contact | null {
  if (contactId == null || contacts == null) return null
  const contact = contacts.find((c) => c.id === contactId)
  return contact != null && contact.efface_le == null ? contact : null
}

// ── « Enregistrer ce client » ───────────────────────────────────────────────────────────────────────────────────────────
/** Un client saisi à la main qui porte un nom peut devenir un contact. */
export function peutEnregistrerCommeContact(client: ClientEnSaisie): boolean {
  return sansBlancsAuxBords(client.tiersNom) !== ''
}

/**
 * La saisie de départ d'un contact neuf tiré du client de la facture : ses sept champs, tels que le formulaire les porte ; l'e-mail,
 * le délai et les observations vides — la facture n'en a pas. Elle compte comme le point de départ de la fenêtre : le refus qu'elle
 * porte déjà (l'adresse que la facture laisse facultative et que le contact exige) se dit sans alerte.
 */
export function saisieDuClient(client: ClientEnSaisie): SaisieContact {
  return {
    nom: client.tiersNom,
    typeClient: client.typeClient,
    adresse: client.tiersAdresse,
    siren: client.siren,
    siret: client.tiersSiret,
    adresseElectronique: client.adresseElectronique,
    codeService: client.codeService,
    email: '',
    delai: '',
    observations: '',
  }
}

/**
 * Ce que la RÈGLE DES SOINS refuse de ce client dans ce dossier, sous les mots de la base — nul quand elle ne le refuse pas.
 * C'est le seul refus qui grise le bouton de la facture : tous les autres (l'adresse à renseigner, une clé de SIREN, un SIRET déjà
 * pris, nommé) se corrigent ou se disent dans la fenêtre de saisie, qui les juge tous, dans l'ordre de la base. Le SIREN et le
 * type sont lus sur la saisie TELLE QU'ELLE PART (`saisieQuiPart`), comme la base les lit.
 */
export function refusDesSoinsDuClient(
  articleExoneration: ArticleExoneration | null, client: ClientEnSaisie,
): RefusContact<CleSoins> | null {
  const envoye = saisieQuiPart(saisieDuClient(client))
  const cle = regleDesSoins(articleExoneration, envoye.type_client, envoye.siren)
  if (cle == null) return null
  // Le message est celui de la fonction, par sa clé : jamais recopié.
  const { modele } = REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === cle) as { modele: string }
  return { cle, message: modele }
}

// ── Les mots de chaque espace ──────────────────────────────────────────────────────────────────────────────────────────
// Le client de l'espace n'est jamais « le client » de son propre dossier, aucun onglet du cabinet ne lui est désigné, et on le
// tutoie : les deux espaces ont leur phrase à côté de l'autre (les refus du module que le client lit, eux, se réécrivent à
// l'affichage : `pourLEspace`). « Le client » qui désigne l'ACHETEUR reste permis.

/**
 * L'information d'un dossier de soins dans la facture : pourquoi la règle des soins vise ce client, et ce qu'il en est de la
 * facture. Une INFORMATION, jamais un refus. Le refus d'« Enregistrer ce client » se lit sous le bouton, aux mots de la base :
 * l'information ne le redit pas (deux paragraphes de suite disaient la même règle sur un téléphone).
 */
export function infoDesSoinsDansLaFacture(espace: EspaceVentes, cle: CleSoins): string {
  const pourquoi = cle === 'soins_particulier'
    ? 'une facture à un particulier y nomme un patient'
    : 'une facture à un client établi hors de France peut nommer un particulier, donc un patient'
  return espace === 'client'
    ? `Ta société dispense des soins exonérés (art. 261, 4, 1° du CGI) : ${pourquoi}. La facture reste possible — elle `
      + 's’enregistre et se valide —, mais ce client ne se range pas dans ton fichier de clients.'
    : `Ce dossier dispense des soins exonérés (art. 261, 4, 1° du CGI) : ${pourquoi}. La facture reste possible — elle `
      + 's’enregistre et se valide —, mais ce client ne se range pas dans le fichier des clients du dossier.'
}

/** Ce que la fenêtre du choix dit en tête. */
export function introDuChoixDeClient(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Le client choisi remplit la facture : son nom, son type, ses identifiants, son adresse, et l’échéance quand il a un délai de '
      + 'paiement. La facture en garde une copie : la changer ensuite ne change pas ton fichier de clients.'
    : 'Le client choisi remplit la facture : son nom, son type, ses identifiants, son adresse, et l’échéance quand il a un délai de '
      + 'paiement. La facture en garde une copie : la changer ensuite ne change pas le fichier des clients du dossier.'
}

/** La ligne du choix pour les contacts que la règle des soins ne propose pas : combien, pourquoi, et où ils s'effacent. */
export function ligneDesClientsEcartes(espace: EspaceVentes, n: number): string {
  const plusieurs = n > 1
  const combien = plusieurs ? `${n} clients rangés` : 'Un client rangé'
  const propose = plusieurs ? 'ne sont pas proposés' : 'n’est pas proposé'
  const refuse = plusieurs ? 'les refuse' : 'le refuse'
  if (espace === 'client') {
    return `${combien} avant que ta société passe aux soins exonérés ${propose} : la règle des soins ${refuse}. `
      + `Tu peux ${plusieurs ? 'les ' : 'l’'}effacer dans « Mes ventes › Clients ».`
  }
  return `${combien} avant que le dossier passe aux soins exonérés ${propose} : la règle des soins ${refuse}. `
    + `${plusieurs ? 'Ils s’effacent' : 'Il s’efface'} dans la vue « Clients » de l’onglet Factures.`
}

/** Ce que le fichier dit quand il n'a aucun client en cours. */
export function phraseDuFichierVide(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Tu n’as encore aucun client en cours : « Enregistrer ce client », sous un client saisi, en crée un.'
    : 'Le fichier des clients du dossier n’a encore aucun client en cours : « Enregistrer ce client », sous un client saisi, en crée un.'
}

export interface ConfirmationDuChoix {
  titre: string
  phrase: string
  reste: string
}

/** La confirmation d'un remplacement : elle NOMME le contact choisi et ce qui part de la facture, et dit que la facture garde sa copie. */
export function confirmationDuChoixDeContact(espace: EspaceVentes, contact: Pick<Contact, 'nom'>, remplace: readonly string[]): ConfirmationDuChoix {
  return {
    titre: 'Remplacer le client de la facture ?',
    phrase: `Choisir le client ${dit(contact.nom)} remplace ${enumeration(remplace)} de cette facture.`,
    reste: espace === 'client'
      ? 'La facture garde sa copie du client : la modifier ensuite ne change pas ton fichier de clients.'
      : 'La facture garde sa copie du client : la modifier ensuite ne change pas le fichier des clients du dossier.',
  }
}

/** La ligne d'un contact dans le choix : son identifiant, son type, son délai. */
export function detailDUnContact(c: Contact, dateEmission: string): string {
  const identifiant = identifiantAffiche(c)
  const delai = delaiAffiche(c)
  const echeance = c.delai_paiement_jours != null && UN_JOUR.test(dateEmission)
    ? ` (échéance le ${formatDate(ajouterJours(dateEmission, c.delai_paiement_jours))})`
    : ''
  return [
    identifiant ? `${identifiant.nom} ${identifiant.valeur}` : null,
    c.type_client ? LIBELLES_TYPE_CONTACT[c.type_client] : null,
    delai ? `délai ${delai}${echeance}` : null,
  ].filter((p): p is string => p != null).join(' · ')
}
