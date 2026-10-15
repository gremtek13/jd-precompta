import { CHAMPS_DANS_L_ORDRE, LIBELLES_DES_CHAMPS, type ChampDUnContact } from './contactsImportFichier'
import type { SaisieContact } from './contacts'
import { LIBELLES_TYPE_CONTACT, saisieInitialeContact } from './contactsVue'
import type { EspaceVentes } from './espaceVentes'
import type { Contact } from './types'

// LA FICHE D'UN CLIENT, EN UN FICHIER (espace client, étape A4b3c ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE
// GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4 et son point RGPD « §6 » ; RGPD.md §1 et §6). Le client est
// responsable des données de SES clients : une personne qui lui demande ce qu'il garde sur elle (accès, art. 15 ; portabilité,
// art. 20) reçoit la fiche COMPLÈTE de son contact, et c'est ce fichier. Un module PUR — il ne lit rien en base, n'appelle
// personne, ne lit pas l'horloge (le jour de Paris vient de l'appelant) — que la vue « Clients » appelle sur une ligne DÉJÀ LUE.
//
// LE FICHIER NE PART NULLE PART : composé dans le navigateur, téléchargé sur un clic, ni stockage ni journal.
//
// UN CSV QUE L'IMPORT RELIT TEL QUEL (`contactsImportFichier.ts`) : marque d'ordre UTF-8, séparateur « ; », fins de ligne CRLF, une
// ligne d'en-tête aux libellés de l'import (donc TOUTES les colonnes lui sont proposées), puis la fiche. L'aller-retour est la
// preuve (contactsExport.test.ts) : ce que l'import tire du fichier est ce que la saisie à la main enverrait pour ce contact.
//
// UNE COPIE FIDÈLE : la valeur rangée, telle que la saisie la montre (`saisieInitialeContact`), rien d'arrondi, de raccourci ni de
// « nettoyé ». Les retours à la ligne d'un champ (les observations en portent) sont GARDÉS : c'est pourquoi `champCsv`
// (pisteAudit.ts), qui les aplatit en espaces, n'est pas employé ici.

/** Le champ tel qu'il s'écrit dans le fichier : entre guillemets, ceux du champ doublés, s'il porte « ; », « " », CR ou LF. */
export function champDeLaFiche(valeur: string): string {
  return /[;"\r\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur
}

// La valeur d'un champ, telle que la saisie la montre ; le type sous le libellé du formulaire de la facture, vide s'il n'est pas
// choisi (« à préciser » : un contact rangé en a toujours un, la base le refuse sans — mais `Contact.type_client` peut être nul).
function valeurDuChamp(saisie: SaisieContact, champ: ChampDUnContact): string {
  switch (champ) {
    case 'nom': return saisie.nom
    case 'type_client': return saisie.typeClient === '' ? '' : LIBELLES_TYPE_CONTACT[saisie.typeClient]
    case 'adresse': return saisie.adresse
    case 'siren': return saisie.siren
    case 'siret': return saisie.siret
    case 'adresse_electronique': return saisie.adresseElectronique
    case 'code_service': return saisie.codeService
    case 'email': return saisie.email
    case 'delai_paiement_jours': return saisie.delai
    case 'observations': return saisie.observations
  }
}

/** La fiche d'un contact : l'en-tête (les libellés de l'import, dans l'ordre de la saisie), puis UNE ligne — marque UTF-8, « ; », CRLF. */
export function ficheDuContactCsv(contact: Contact): string {
  const saisie = saisieInitialeContact(contact)
  const enTete = CHAMPS_DANS_L_ORDRE.map((c) => champDeLaFiche(LIBELLES_DES_CHAMPS[c])).join(';')
  const fiche = CHAMPS_DANS_L_ORDRE.map((c) => champDeLaFiche(valeurDuChamp(saisie, c))).join(';')
  return '\uFEFF' + enTete + '\r\n' + fiche
}

// Ce que NFD ne décompose pas et que le français écrit en deux lettres.
const LIGATURES: Readonly<Record<string, string>> = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss' }
const NOM_DU_FICHIER_MAX = 40

/**
 * Le nom d'un client pour un nom de fichier : minuscules ASCII (accents retirés, œ, æ et ß en deux lettres), lettres et chiffres
 * séparés par des tirets seuls, quarante caractères au plus, jamais un tiret au bord ; « sans-nom » s'il ne reste rien.
 */
export function nomSimplifiePourUnFichier(nom: string): string {
  const simple = nom.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[œæß]/g, (c) => LIGATURES[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, NOM_DU_FICHIER_MAX).replace(/-+$/, '')
  return simple === '' ? 'sans-nom' : simple
}

/** « fiche-client-<nom simplifié>-AAAA-MM-JJ.csv » : le jour de Paris que l'appelant donne, jamais l'horloge du module. */
export function nomFichierDeLaFiche(nom: string, aujourdHui: string): string {
  return `fiche-client-${nomSimplifiePourUnFichier(nom)}-${aujourdHui}.csv`
}

/**
 * La phrase, UNE pour la liste, qui dit avant le clic ce que contient le fichier : toute la fiche, observations comprises, pour
 * répondre à la demande de la personne (RGPD.md §6 : accès, art. 15 ; portabilité, art. 20) — et ce qu'il ne contient pas, les
 * factures qui la nomment, qui gardent leur copie et ne sont reliées à aucun contact. Les mots du client : tutoiement, jamais
 * « le client » pour lui, aucun mot du cabinet (`motsDuCabinet`, éprouvé dans ContactsVue.test.tsx). Au cabinet, la fiche est
 * celle d'un « contact », et « le client » est le titulaire du dossier, comme dans la fenêtre de l'import : jamais deux
 * personnes sous le même mot dans une phrase.
 */
export function phraseDeLExportDeLaFiche(espace: EspaceVentes): string {
  return espace === 'client'
    ? '« Exporter la fiche » télécharge toute la fiche d’un de tes clients, observations comprises, dans un fichier CSV, pour répondre '
      + 'à la personne qui te demande ce que tu gardes sur elle (RGPD, art. 15 et 20). Tes factures qui la nomment gardent leur '
      + 'copie et n’y sont pas.'
    : '« Exporter la fiche » télécharge toute la fiche d’un contact, observations comprises, dans un fichier CSV, pour que le '
      + 'client réponde à la personne qui lui demande ce qu’il garde sur elle (RGPD, art. 15 et 20). Les factures qui la nomment '
      + 'gardent leur copie et n’y sont pas.'
}

/** Ce que la vue dit après l'export : le nom du client et celui du fichier, pour le retrouver dans les téléchargements. */
export function messageDeLExportDeLaFiche(nomDuClient: string, nomDuFichier: string): string {
  return `Fiche de « ${nomDuClient} » exportée : ${nomDuFichier}.`
}
