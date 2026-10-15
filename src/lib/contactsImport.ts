import { nomDansUnRefus } from './articles'
import {
  REFUS_ENREGISTREMENT_CONTACT,
  commeLaBaseLaRecoit,
  refusEnregistrementContact,
  type CleRefusEnregistrementContact,
  type ContactEnvoye,
  type ContactPourSiret,
} from './contacts'
import { remplirModele } from './encaissementsFactures'
import type { ArticleExoneration } from './types'

// L'IMPORT D'UN FICHIER DE CLIENTS (espace client, étape A4b3a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE
// GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « L'usage » : « Importer mes contacts » — un aperçu,
// ligne par ligne, avec les refus de la fonction redits ; rien ne s'écrit avant le clic, et tout ou rien). Un module PUR —
// il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — que l'écran de l'étape A4b3b lira : ce que la
// fonction `importer_contacts` refuserait d'un import, dans SON ordre et sous SES mots, dit avant le clic.
//
// LA FONCTION. `importer_contacts(p_dossier_id, p_contacts)` range chaque ligne par `enregistrer_contact` ELLE-MÊME, dans
// l'ordre du fichier et dans la même transaction : le premier refus annule tout et se dit avec son numéro de ligne
// (« Ligne 3 : » suivi du message d'`enregistrer_contact`, sous son code). Le module fait de même : chaque ligne est jugée
// par `refusEnregistrementContact` (src/lib/contacts.ts) contre la liste des contacts du dossier lue EN ENTIER, AUGMENTÉE
// des lignes qui la précèdent — le SIRET d'une ligne déjà rangée compte, et c'est son nom que le refus cite. Aucune règle
// d'un contact n'est recopiée ici : seuls les refus PROPRES de l'import le sont — le tableau, le vide, la borne, la ligne
// qui n'est pas un objet, le champ qu'un contact n'a pas.
//
// CE QUE LE MODULE NE JUGE PAS. L'accès (seule la base le juge : l'écran n'existe que pour qui lit le dossier). Ce que
// PostgreSQL refuse avant d'appeler la fonction : un texte qui porte le caractère U+0000 fait refuser le JSON ENTIER
// (22P05, « unsupported Unicode escape sequence ») — l'écran qui lit le fichier (A4b3b) s'en charge, en lisant son encodage.
// Le délai d'une instruction (8 s pour un compte connecté) : la borne le tient à distance (mille lignes, une seconde au
// plus sur la réplique, le cas le plus lourd).

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `importer_contacts` OUVRE un geste nouveau au client qui porte la case « Ventes » (importer) : présentée au
// cabinet, elle a été appliquée sur son accord, et l'export (supabase/schema) la porte. Ce drapeau est donc levé : la
// phrase de l'onglet Accès nomme l'import (src/lib/droitsAcces.ts) ; l'écran qui l'offrira vient avec l'étape A4b3b.
// contactsImport.test.ts confronte ce drapeau à l'export, et les refus ci-dessous au texte même de la fonction comme à
// l'essai supabase/essais/importContacts.sql. Un retour arrière de la migration ne viendrait qu'APRÈS le drapeau rebaissé
// en ligne : sinon l'écran offrirait un geste que la base n'a plus.
export const IMPORT_CONTACTS_EXPORTE: boolean = true

// ── Les valeurs de la base, confrontées à l'essai par le test ───────────────────────────────────────────────────────
// La borne d'un import (A4B3-Q1, tranchée par le cabinet le 15/10/2026). Mesurée sur une réplique de la
// production : mille lignes courantes en une demi-seconde, mille lignes dont chaque champ est à sa borne en une seconde et
// une requête de 5 Mo — sous le délai de huit secondes d'un compte connecté, avec de la marge pour une production plus
// lente. Un fichier plus long se partage en plusieurs imports.
export const LIGNES_PAR_IMPORT_MAX = 1000

// Les champs d'une ligne : ceux de la saisie telle qu'elle part (`ContactEnvoye`), qu'`enregistrer_contact` lit — ni plus,
// ni moins (le test le confronte à l'essai et au texte de la fonction). Le type les tient tous : un champ ajouté à la
// saisie sans l'être ici ne compile pas.
const CHAMPS: Record<keyof ContactEnvoye, true> = {
  nom: true, adresse: true, type_client: true, siren: true, siret: true, adresse_electronique: true, code_service: true,
  email: true, delai_paiement_jours: true, observations: true,
}
export const CHAMPS_D_UNE_LIGNE = Object.keys(CHAMPS) as readonly (keyof ContactEnvoye)[]

// Le préfixe d'un refus de ligne : « Ligne N : » puis le message, N compté depuis un, dans le tableau envoyé (l'écran qui
// saute une ligne d'en-tête dit, lui, la ligne du FICHIER).
export const PREFIXE_D_UNE_LIGNE = 'Ligne % : '

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// Ceux de l'import entier, puis ceux d'une ligne, avant ceux d'`enregistrer_contact` (REFUS_ENREGISTREMENT_CONTACT, rangs
// 2 à 12 : une ligne crée, elle ne vise aucun contact — « introuvable », « retiré » et « effacé » ne s'y rencontrent pas).
export const REFUS_DE_L_IMPORT = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'pas_un_tableau', code: '22023', modele: 'Un import de contacts est un tableau JSON de lignes.' },
  { cle: 'vide', code: '22023', modele: "L'import ne porte aucune ligne." },
  {
    cle: 'trop_de_lignes', code: '22023',
    modele: 'Un import range mille lignes au plus ; celui-ci en porte % : le partager en plusieurs fichiers.',
  },
] as const

export const REFUS_D_UNE_LIGNE = [
  { cle: 'pas_un_objet', code: '22023', modele: "Une ligne de l'import est un objet JSON aux champs d'un contact." },
  { cle: 'champ_inconnu', code: '22023', modele: "« % » n'est pas un champ d'un contact." },
] as const

export type CleRefusDeLImport = (typeof REFUS_DE_L_IMPORT)[number]['cle']
export type CleRefusDUneLigne = (typeof REFUS_D_UNE_LIGNE)[number]['cle'] | CleRefusEnregistrementContact

/** Un refus que la base opposerait à l'import : sa clé, sa ligne (depuis un ; nulle pour l'import entier), son code, et
 * son message tel que la base l'écrit — « Ligne N : » compris. */
export interface RefusImportContacts {
  cle: CleRefusDeLImport | CleRefusDUneLigne
  ligne: number | null
  code: string
  message: string
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const CHAMPS_ADMIS: ReadonlySet<string> = new Set(CHAMPS_D_UNE_LIGNE)

// L'ordre des OCTETS de la base (« C », en UTF-8) est celui des POINTS DE CODE : une comparaison de chaînes JavaScript, qui
// compare des unités UTF-16, rangerait un caractère hors du plan de base avant U+E000 à U+FFFF.
function avantEnPointsDeCode(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const ecart = (x[i].codePointAt(0) as number) - (y[i].codePointAt(0) as number)
    if (ecart !== 0) return ecart
  }
  return x.length - y.length
}

function refusDeLImport(cle: CleRefusDeLImport, ...valeurs: string[]): RefusImportContacts {
  const r = REFUS_DE_L_IMPORT.find((x) => x.cle === cle) as (typeof REFUS_DE_L_IMPORT)[number]
  return { cle, ligne: null, code: r.code, message: remplirModele(r.modele, valeurs) }
}

function refusDeLaLigne(numero: number, cle: CleRefusDUneLigne, code: string, message: string): RefusImportContacts {
  return { cle, ligne: numero, code, message: remplirModele(PREFIXE_D_UNE_LIGNE, [String(numero)]) + message }
}

/**
 * Ce qu'`importer_contacts` refuserait de la ligne de rang `numero` (depuis un), jugée contre `contactsVus` — les contacts
 * du dossier lus EN ENTIER, augmentés des lignes de l'import rangées avant elle —, ou null quand elle la rangerait : la
 * ligne est un objet ; ses champs sont ceux d'un contact (la première clé inconnue dans l'ordre des points de code,
 * nommée, son nom coupé comme celui d'un contact dans un refus) ; puis ce qu'`enregistrer_contact` refuserait d'un contact
 * NEUF, sous son message et son code. La ligne est jugée telle que la base la reçoit, après l'aller-retour JSON.
 */
export function refusDUneLigne(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  ligne: unknown,
  numero: number,
  contactsVus: readonly ContactPourSiret[],
): RefusImportContacts | null {
  const recue = commeLaBaseLaRecoit(ligne)
  if (!estObjet(recue)) {
    return refusDeLaLigne(numero, 'pas_un_objet', REFUS_D_UNE_LIGNE[0].code, REFUS_D_UNE_LIGNE[0].modele)
  }
  const inconnue = Object.keys(recue).filter((k) => !CHAMPS_ADMIS.has(k)).sort(avantEnPointsDeCode)[0]
  if (inconnue !== undefined) {
    return refusDeLaLigne(numero, 'champ_inconnu', REFUS_D_UNE_LIGNE[1].code, remplirModele(REFUS_D_UNE_LIGNE[1].modele, [nomDansUnRefus(inconnue)]))
  }
  const refus = refusEnregistrementContact(dossierId, articleExoneration, { nouveau: true }, recue, contactsVus)
  if (!refus) return null
  const { code } = REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === refus.cle) as (typeof REFUS_ENREGISTREMENT_CONTACT)[number]
  return refusDeLaLigne(numero, refus.cle, code, refus.message)
}

// Une ligne rangée, telle que la suivante la voit : son SIRET (nul s'il n'en a pas) et son nom, tels qu'envoyés — la base
// les écrit tels quels. Son identifiant n'existe pas encore : un nom qui ne peut pas être celui d'un contact lu.
function ligneRangee(dossierId: string, ligne: unknown, numero: number): ContactPourSiret {
  const recue = commeLaBaseLaRecoit(ligne) as Record<string, unknown>
  const siret = recue.siret
  return {
    id: `ligne ${numero} de l’import`, dossier_id: dossierId, siret: typeof siret === 'string' ? siret : null,
    nom: recue.nom as string, retire_le: null,
  }
}

/**
 * Le PREMIER refus qu'`importer_contacts` opposerait à cet import, dans son ordre et sous ses mots, ou null quand elle le
 * rangerait en entier : un tableau, d'au moins une ligne, de `LIGNES_PAR_IMPORT_MAX` lignes au plus ; puis chaque ligne,
 * dans l'ordre, contre `contactsDuDossier` — la liste LUE EN ENTIER (sur une lecture partielle, l'appelant ne demande rien
 * à ce module : il ne dirait pas « libre » un SIRET qu'il n'a pas vu) — augmentée des lignes qui la précèdent.
 */
export function refusImportContacts(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  lignes: unknown,
  contactsDuDossier: readonly ContactPourSiret[],
): RefusImportContacts | null {
  const recu = commeLaBaseLaRecoit(lignes)
  if (!Array.isArray(recu)) return refusDeLImport('pas_un_tableau')
  if (recu.length === 0) return refusDeLImport('vide')
  if (recu.length > LIGNES_PAR_IMPORT_MAX) return refusDeLImport('trop_de_lignes', String(recu.length))
  const vus = [...contactsDuDossier]
  for (let i = 0; i < recu.length; i++) {
    const refus = refusDUneLigne(dossierId, articleExoneration, recu[i], i + 1, vus)
    if (refus) return refus
    vus.push(ligneRangee(dossierId, recu[i], i + 1))
  }
  return null
}

/**
 * Pour l'aperçu de l'écran (étape A4b3b) : chaque ligne avec le refus que la base lui opposerait si les lignes qui la
 * précèdent ET qu'elle accepterait étaient rangées — une ligne refusée ne compte pas pour les suivantes, comme si on
 * l'ôtait du fichier. Le premier refus de la liste est celui de l'import (`refusImportContacts`) ; les suivants disent ce
 * qui resterait à reprendre. Les refus de l'import entier (le tableau, le vide, la borne) ne sont pas les siens.
 */
export function refusDesLignes(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  lignes: readonly unknown[],
  contactsDuDossier: readonly ContactPourSiret[],
): (RefusImportContacts | null)[] {
  const vus = [...contactsDuDossier]
  return lignes.map((ligne, i) => {
    const refus = refusDUneLigne(dossierId, articleExoneration, ligne, i + 1, vus)
    if (!refus) vus.push(ligneRangee(dossierId, ligne, i + 1))
    return refus
  })
}
