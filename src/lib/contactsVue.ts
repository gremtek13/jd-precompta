import { nomDansUnRefus } from './articles'
import { estLeClient, PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import {
  dossierDeSoins, etatDuContact, refusEffacementContact, refusEnregistrementContact, refusRepriseContact, refusRetraitContact,
  regleDesSoins, saisieQuiPart,
  type CibleContact, type CleRefusEffacementContact, type CleRefusEnregistrementContact, type CleRefusRepriseContact,
  type CleRefusRetraitContact, type ContactPourSiret, type RefusContact, type SaisieContact,
} from './contacts'
import type { EspaceVentes } from './espaceVentes'
import type { ArticleExoneration, Contact, TypeClient } from './types'

// LA LISTE DES CONTACTS, SA SAISIE ET SES GESTES (espace client, étape A4b1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
// LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « Ce que voit le client »). Un module
// PUR — rien lu, rien écrit, pas d'horloge, aucun accès à la base — que l'écran `ContactsVue` appelle : ce que la liste
// montre dans l'ordre où elle le montre, ce que la saisie envoie, qui a fait quoi, ce que chaque geste refuserait, et les
// mots de chaque espace pour ce que la règle des soins a rangé avant le passage aux soins (A4-Q4).
//
// AUCUNE RÈGLE DE LA BASE N'EST RECOPIÉE ICI : les refus sont ceux de `lib/contacts.ts`, jugés sur la saisie TELLE QU'ELLE
// PART (`saisieQuiPart`, l'objet que l'écran envoie et que le module juge). Ce fichier ne dit que ce que l'écran en fait.
// Il n'importe pas `espaceVentes` à l'exécution (ce module lit la base) : les mots des deux espaces sont écrits ici, chacun
// à côté de l'autre, et les refus du module que le client lit se réécrivent à l'affichage (`pourLEspace`).

// ── Les quatre types, aux mots du formulaire de la facture ─────────────────────────────────────────────────────────────
// Ceux des quatre `<option>` de `FactureFormModal` (« Type de client »), au mot près : un client choisi dans la facture (étape
// A4b2) garde le type que ce fichier lui a donné, et personne ne doit y lire deux phrases pour une même chose.
// contactsVue.test.ts les confronte à la source du formulaire.
export const LIBELLES_TYPE_CONTACT: Readonly<Record<TypeClient, string>> = {
  assujetti: 'une entreprise établie en France',
  organisme_public: 'un organisme public (Chorus Pro)',
  non_assujetti: 'un particulier, ou un autre non-assujetti',
  etranger: 'établi hors de France',
}

// ── La saisie : tout en texte, comme les champs ───────────────────────────────────────────────────────────────────────
/** La saisie d'un contact neuf (aucun type choisi : « à préciser ») ou celle qui part du contact LU, champ pour champ. */
export function saisieInitialeContact(contact: Contact | null): SaisieContact {
  if (!contact) {
    return { nom: '', typeClient: '', adresse: '', siren: '', siret: '', adresseElectronique: '', codeService: '', email: '', delai: '', observations: '' }
  }
  return {
    nom: contact.nom,
    typeClient: contact.type_client ?? '',
    adresse: contact.adresse ?? '',
    siren: contact.siren ?? '',
    siret: contact.siret ?? '',
    adresseElectronique: contact.adresse_electronique ?? '',
    codeService: contact.code_service ?? '',
    email: contact.email ?? '',
    delai: contact.delai_paiement_jours == null ? '' : String(contact.delai_paiement_jours),
    observations: contact.observations ?? '',
  }
}

/** La saisie a-t-elle changé depuis son point de départ ? Un champ qu'on n'a pas touché ne s'accuse pas d'être vide. */
export function saisieContactTouchee(depart: SaisieContact, saisie: SaisieContact): boolean {
  return (Object.keys(depart) as (keyof SaisieContact)[]).some((k) => depart[k] !== saisie[k])
}

/**
 * Ce que l'enregistrement refuserait, dit avant le clic : le PREMIER refus du module sur la saisie telle qu'elle part, dans
 * l'ordre de la base et sous ses mots. `contacts` : la liste LUE EN ENTIER (l'unicité d'un SIRET s'y juge) ; l'écran n'ouvre
 * rien sur une lecture partielle.
 */
export function refusDeLaSaisieContact(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  cible: CibleContact,
  saisie: SaisieContact,
  contacts: readonly ContactPourSiret[],
): RefusContact<CleRefusEnregistrementContact> | null {
  return refusEnregistrementContact(dossierId, articleExoneration, cible, saisieQuiPart(saisie), contacts)
}

// ── Ce que la liste montre ───────────────────────────────────────────────────────────────────────────────────────────
/** Ce que la recherche lit d'une ligne : le nom, le SIREN et le SIRET (la conception, §A.4). */
export function champsDeRechercheContact(c: Pick<Contact, 'nom' | 'siren' | 'siret'>): (string | null)[] {
  return [c.nom, c.siren, c.siret]
}

/** Les contacts qui peuvent se montrer un jour : JAMAIS un contact effacé, dont la ligne n'est plus qu'un nom et des dates. */
export function contactsAffichables<T extends Pick<Contact, 'retire_le' | 'efface_le'>>(contacts: readonly T[]): T[] {
  return contacts.filter((c) => etatDuContact(c) !== 'efface')
}

const ordre = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/**
 * Les lignes affichées : jamais un effacé ; sans le filtre « Retirés », les retirés ne se montrent pas ; avec lui, ils suivent
 * les autres. Les contacts en cours d'abord, puis les retirés, chaque groupe par nom à la française, puis par identifiant — un
 * ordre TOTAL, que l'écran ne change pas d'un rendu à l'autre.
 */
export function contactsAffiches<T extends Pick<Contact, 'id' | 'nom' | 'retire_le' | 'efface_le'>>(
  contacts: readonly T[], avecLesRetires: boolean,
): T[] {
  return contactsAffichables(contacts)
    .filter((c) => avecLesRetires || c.retire_le == null)
    .sort((a, b) =>
      Number(a.retire_le != null) - Number(b.retire_le != null)
      || ordre.compare(a.nom, b.nom)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** L'identifiant que la liste montre : le SIRET (il commence par le SIREN), sinon le SIREN, sinon rien — avec son nom pour l'infobulle. */
export function identifiantAffiche(c: Pick<Contact, 'siren' | 'siret'>): { nom: 'SIRET' | 'SIREN'; valeur: string } | null {
  if (c.siret != null) return { nom: 'SIRET', valeur: c.siret }
  if (c.siren != null) return { nom: 'SIREN', valeur: c.siren }
  return null
}

/** Le délai de paiement tel que la liste le dit : « 30 jours », « 1 jour », « 0 jour » (le français met zéro au singulier) ; nul → rien. */
export function delaiAffiche(c: Pick<Contact, 'delai_paiement_jours'>): string | null {
  const n = c.delai_paiement_jours
  return n == null ? null : `${n} ${n <= 1 ? 'jour' : 'jours'}`
}

// ── Qui a fait quoi : « par le client » (cabinet seul) ───────────────────────────────────────────────────────────────
export const TITRES_CONTACT_PAR_LE_CLIENT = {
  cree: 'Contact créé par le client',
  modifie: 'Contact modifié par le client',
  retire: 'Contact retiré par le client',
} as const

export interface MentionParLeClient {
  libelle: string
  titre: string
}

/**
 * La mention d'une ligne : le DERNIER geste sur le contact — sa création, sa dernière modification (la reprise en est une) ou
 * son retrait, le plus récent des trois — est-il d'un compte qui porte un accès client du dossier ? Les accès doivent être
 * lus EN ENTIER (`estLeClient` ne reconnaît personne sinon) ; un auteur nul n'est personne, un accès retiré depuis n'est pas
 * deviné, et jamais « par le cabinet ». L'effacement n'en est pas un : un contact effacé ne se montre jamais. (Le jumeau, pour
 * les contacts, de `mentionParLeClient` des articles : les titres changent, les trois gestes et leur ordre sont les mêmes.)
 */
export function mentionContactParLeClient(
  acces: AccesDuDossier,
  c: Pick<Contact, 'cree_par' | 'cree_le' | 'modifie_par' | 'modifie_le' | 'retire_par' | 'retire_le'>,
): MentionParLeClient | null {
  const gestes: { geste: keyof typeof TITRES_CONTACT_PAR_LE_CLIENT; par: string | null; le: string | null }[] = [
    { geste: 'cree', par: c.cree_par, le: c.cree_le },
    { geste: 'modifie', par: c.modifie_par, le: c.modifie_le },
    { geste: 'retire', par: c.retire_par, le: c.retire_le },
  ]
  let dernier: (typeof gestes)[number] | null = null
  let instant = -Infinity
  for (const g of gestes) {
    if (g.le == null) continue
    const t = Date.parse(g.le)
    // À égalité, le geste qui vient plus loin dans la vie d'un contact l'emporte (retirer suit modifier suit créer).
    if (Number.isNaN(t) || t < instant) continue
    dernier = g
    instant = t
  }
  if (dernier == null || !estLeClient(acces, dernier.par)) return null
  return { libelle: PAR_LE_CLIENT, titre: TITRES_CONTACT_PAR_LE_CLIENT[dernier.geste] }
}

// ── Ce que chaque geste refuserait, dit avant le clic ────────────────────────────────────────────────────────────────
export type CleSoins = 'soins_particulier' | 'soins_etranger'

export interface GestesDuContact {
  // « Modifier » : ce que le module dit du contact tel qu'il est lu (retiré : le reprendre d'abord) — SAUF la règle des soins :
  // elle refuse de réécrire le contact TEL QUEL, pas de le changer (lui donner son SIREN, par exemple, le rend admissible) ;
  // la fenêtre la dit alors avant le clic, bouton grisé tant que la saisie reste celle d'avant (`soins`).
  modifier: RefusContact<CleRefusEnregistrementContact> | null
  // Le geste d'état offert : « Retirer » sur un contact en cours, « Reprendre » sur un retiré, jamais les deux.
  basculer:
    | { geste: 'retirer'; refus: RefusContact<CleRefusRetraitContact> | null }
    | { geste: 'reprendre'; refus: RefusContact<CleRefusRepriseContact> | null }
  // « Effacer » : offert aussi sur un retiré.
  effacer: RefusContact<CleRefusEffacementContact> | null
  // Ce que la règle des soins refuse de ce contact dans CE dossier (A4-Q4), ou null : un contact rangé avant le passage aux
  // soins reste, ne se modifie plus tel quel ni ne se reprend, et s'efface — l'écran le dit et le propose, jamais d'office.
  soins: CleSoins | null
}

const estSoins = (cle: string): cle is CleSoins => cle === 'soins_particulier' || cle === 'soins_etranger'

/** Ce que la règle des soins refuse de ce contact dans ce dossier : jamais pour un contact effacé (il n'a plus ni type ni SIREN). */
export function soinsDuContact(
  articleExoneration: ArticleExoneration | null, c: Pick<Contact, 'type_client' | 'siren' | 'efface_le' | 'retire_le'>,
): CleSoins | null {
  if (etatDuContact(c) === 'efface') return null
  return regleDesSoins(articleExoneration, c.type_client, c.siren)
}

export function gestesDuContact(
  dossierId: string, articleExoneration: ArticleExoneration | null, contact: Contact, contacts: readonly ContactPourSiret[],
): GestesDuContact {
  const refusModifier = refusEnregistrementContact(
    dossierId, articleExoneration, { nouveau: false, contact }, saisieQuiPart(saisieInitialeContact(contact)), contacts,
  )
  return {
    modifier: refusModifier != null && estSoins(refusModifier.cle) ? null : refusModifier,
    basculer: contact.retire_le == null
      ? { geste: 'retirer', refus: refusRetraitContact(dossierId, contact) }
      : { geste: 'reprendre', refus: refusRepriseContact(dossierId, articleExoneration, contact) },
    effacer: refusEffacementContact(dossierId, contact),
    soins: soinsDuContact(articleExoneration, contact),
  }
}

// ── Les mots de chaque espace : les soins, l'effacement ──────────────────────────────────────────────────────────────────
/** La ligne d'information d'un dossier de soins, au-dessus de la liste : ce que la règle refuse, et pourquoi. Nulle sinon. */
export function infoDesSoins(espace: EspaceVentes, articleExoneration: ArticleExoneration | null): string | null {
  if (!dossierDeSoins(articleExoneration)) return null
  const regle = 'ni particulier — un non-assujetti sans SIREN — ni client établi hors de France, qui pourraient être des patients. '
    + 'Un autre non-assujetti, une association par exemple, s’y range avec son SIREN.'
  return espace === 'client'
    ? `Ta société dispense des soins exonérés (art. 261, 4, 1° du CGI) : tu ne ranges ici ${regle}`
    : `Ce dossier dispense des soins exonérés (art. 261, 4, 1° du CGI) : il ne range ${regle}`
}

/** Le signalement d'un contact rangé avant le passage aux soins (A4-Q4) : ce qu'il ne peut plus, et ce qu'il peut. */
export function signalementDesSoins(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Rangé avant que ta société passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, tu peux l’effacer.'
    : 'Rangé avant que le dossier passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, il peut s’effacer.'
}

/** Ce que l'effacement vide, de CE contact : ses seules données renseignées, dans l'ordre de la fenêtre de saisie. */
export function cePartAvecLEffacement(c: Contact): string[] {
  const parts: string[] = ['son nom']
  if (c.adresse != null) parts.push('son adresse')
  if (c.siren != null) parts.push('son SIREN')
  if (c.siret != null) parts.push('son SIRET')
  if (c.adresse_electronique != null) parts.push('son adresse de facturation électronique')
  if (c.code_service != null) parts.push('son code service')
  if (c.email != null) parts.push('son e-mail')
  if (c.delai_paiement_jours != null) parts.push('son délai de paiement')
  if (c.observations != null) parts.push('ses observations')
  return parts
}

export interface ConfirmationDeLEffacement {
  titre: string
  // « Effacer ce client vide ses données — la ligne ne s'affichera plus nulle part : » ; puis la liste de ce qui part.
  chapeau: string
  partent: string[]
  // Ce que le geste ne touche pas, et qu'il ne se défait pas.
  reste: string
}

/**
 * La confirmation d'un effacement : elle NOMME le contact et ce qui part (ses données renseignées, rien d'autre), dit que les
 * factures qui le nomment gardent leur copie, dix ans (C. com., art. L123-22 ; RGPD.md), et que le geste ne se défait pas.
 */
export function confirmationDeLEffacement(espace: EspaceVentes, c: Contact): ConfirmationDeLEffacement {
  const client = espace === 'client'
  return {
    titre: `Effacer le client « ${nomDansUnRefus(c.nom)} » ?`,
    chapeau: 'Effacer un client vide ses données — la ligne ne s’affichera plus nulle part :',
    partent: cePartAvecLEffacement(c),
    reste: `${client ? 'Tes factures' : 'Les factures'} qui le nomment gardent leur copie, dix ans (C. com., art. L123-22) : `
      + 'l’effacement ne les touche pas. Le geste ne se défait pas.',
  }
}
