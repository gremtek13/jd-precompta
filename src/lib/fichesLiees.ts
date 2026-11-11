import { ajouterJours } from './format'
import type { TypeClient } from './types'

// LA FICHE DE FACTURATION D'UN CLIENT DU CABINET, LIÉE À SON DOSSIER (ligne 47, lot LM3 ; LM-Q3 du 11/11/2026 : « son
// dossier est la source »). Dans le dossier du cabinet (LM1), une fiche de `contacts` se LIE au dossier de son client
// (`dossier_client_id`) : elle ne garde que ce qui est propre à la facturation — l'adresse de facturation électronique,
// l'e-mail, le délai de paiement, les observations — et AUCUNE identité ; le nom, l'adresse, le SIRET, le SIREN et le type
// se LISENT du dossier (`identites_des_fiches_liees`), au choix du client dans la facture, qui en garde la copie, figée à
// sa validation (A7a). La base tient la règle (la migration `fiche_liee_au_dossier_du_client`, PRÉPARÉE le 11/11/2026,
// supabase/preparees/) ; ce module la redit, pur — rien lu, rien écrit, pas d'horloge — pour la dire avant le clic : les
// refus du rang 4 bis d'`enregistrer_contact` dans leur ordre et à leurs mots, l'identité composée comme la base la
// compose (celle de `facturer_honoraires`, LM7), ce que le choix d'une fiche liée met dans la facture, et la saisie qui
// part. Rien ne s'en lit ni ne s'en écrit tant que le drapeau est baissé. Récit : HISTORIQUE.md, « 11/11/2026 — LM3 ».

/** Levé le jour où la migration `fiche_liee_au_dossier_du_client` est en production (son fichier dans supabase/schema/),
 *  et `types.ts` basculé avec elle (`contacts.nom` y devient facultatif, pour une fiche liée seulement). */
export const FICHES_LIEES_PREVUES: boolean = false

/**
 * Une ligne de `contacts` est-elle une fiche liée au dossier d'un client ? Une telle fiche n'a ni nom ni identité : les lecteurs
 * d'hier (la liste des clients, le choix dans une facture ou un devis, les clients sans activité, l'export) l'écartent par ce
 * prédicat. La colonne ABSENTE — la migration pas en base, le drapeau baissé — n'est pas un lien : rien ne change d'hier.
 */
export function estFicheLiee(c: object): boolean {
  return typeof (c as { dossier_client_id?: unknown }).dossier_client_id === 'string'
}

/** Les refus que le lien ajoute à `enregistrer_contact`, dans l'ordre de la fonction, à ses mots et à son code. Le rang 8
 *  (l'adresse de facturation électronique) garde ses mots d'hier, que `lib/contacts.ts` redit déjà. */
export const REFUS_DE_LA_FICHE_LIEE = [
  { cle: 'identifiant', code: '22023', modele: 'Le dossier du client se désigne par son identifiant.' },
  { cle: 'horsDuDossierDuCabinet', code: '22023', modele: 'Une fiche ne se lie au dossier d’un client que dans le dossier du cabinet.' },
  {
    cle: 'lienFixe', code: '22023',
    modele: 'Le lien d’une fiche au dossier de son client se pose à sa création et ne change plus : une autre fiche se crée.',
  },
  { cle: 'dossier', code: '22023', modele: 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.' },
  { cle: 'dejaLiee', code: '23505', modele: 'Ce dossier a déjà sa fiche de facturation.' },
  { cle: 'dejaLieeRetiree', code: '23505', modele: 'Ce dossier a déjà sa fiche de facturation (retirée : la reprendre).' },
  {
    cle: 'identite', code: '22023',
    modele: 'Une fiche liée au dossier d’un client ne porte ni nom, ni adresse, ni type, ni SIREN, ni SIRET, ni code service : ils se lisent de son dossier.',
  },
] as const

export type RefusDeLaFicheLiee = (typeof REFUS_DE_LA_FICHE_LIEE)[number]['cle']

/** Le refus de la lecture des identités hors du dossier du cabinet (22023), après celui de l'accès (42501). */
export const REFUS_LECTURE_HORS_DU_DOSSIER_DU_CABINET = 'Les fiches liées au dossier d’un client vivent dans le dossier du cabinet.'

/** Ce que l'écran sait avant le clic, lu en entier. */
export interface EtatDeLaFicheLiee {
  /** Le dossier où la fiche s'écrit est le dossier du cabinet (LM1). */
  estDossierDuCabinet: boolean
  /** Le dossier du cabinet, que la fiche ne peut pas désigner. */
  dossierDuCabinetId: string
  /** Les dossiers du MÊME cabinet que le compte lit, le dossier du cabinet compris. */
  dossiersDuCabinet: readonly string[]
  /** Les fiches du dossier, retirées comprises (une fiche effacée n'a plus de lien). */
  fiches: readonly { id: string; dossier_client_id: string | null; retire_le: string | null }[]
  /** Nul pour une fiche neuve ; sinon la fiche réécrite et son lien d'aujourd'hui. */
  ficheReecrite: { id: string; dossier_client_id: string | null } | null
}

const UN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Le premier refus du lien, dans l'ordre de la fonction (rang 4 bis), ou nul. `dossierClientId` : la valeur qui part (nulle :
 * aucune clé). `porteUneIdentite` : la saisie porte un nom, une adresse, un type, un SIREN, un SIRET ou un code service.
 */
export function refusDeLaFicheLiee(
  e: EtatDeLaFicheLiee, dossierClientId: string | null, porteUneIdentite: boolean,
): RefusDeLaFicheLiee | null {
  if (dossierClientId != null && !UN_UUID.test(dossierClientId)) return 'identifiant'
  const lien = dossierClientId == null ? null : dossierClientId.toLowerCase()
  if (lien != null && !e.estDossierDuCabinet) return 'horsDuDossierDuCabinet'
  if (e.ficheReecrite != null && lien !== (e.ficheReecrite.dossier_client_id?.toLowerCase() ?? null)) return 'lienFixe'
  if (lien == null) return null
  if (lien === e.dossierDuCabinetId.toLowerCase() || !e.dossiersDuCabinet.some((d) => d.toLowerCase() === lien)) return 'dossier'
  const autre = e.fiches.find((f) => f.dossier_client_id?.toLowerCase() === lien && f.id !== e.ficheReecrite?.id)
  if (autre != null) return autre.retire_le != null ? 'dejaLieeRetiree' : 'dejaLiee'
  return porteUneIdentite ? 'identite' : null
}

/** Les mots d'un refus, ceux de la base. */
export function motsDuRefusDeLaFicheLiee(cle: RefusDeLaFicheLiee): string {
  return (REFUS_DE_LA_FICHE_LIEE.find((r) => r.cle === cle) as { modele: string }).modele
}

// ── L'identité que le dossier donne ─────────────────────────────────────────────────────────────────────────────────────
/** Ce que la base lit du dossier du client : rien d'autre ne s'en lit. */
export interface DossierDuClient {
  nom: string
  denomination_imprimee: string | null
  adresse: string | null
  siret: string | null
}

/** L'identité qu'un dossier donne à la facture, champ par champ — celle que `identites_des_fiches_liees` rend. */
export interface IdentiteDuDossier {
  tiersNom: string
  tiersAdresse: string | null
  tiersSiret: string | null
  tiersSiren: string | null
  typeClient: Extract<TypeClient, 'assujetti' | 'non_assujetti'>
}

const QUATORZE_CHIFFRES = /^[0-9]{14}$/

/**
 * L'identité composée comme la base la compose (`identites_des_fiches_liees`, et `facturer_honoraires` de LM7) : le nom
 * imprimé — sans ses blancs de bord, ignoré s'il n'en reste rien — ou le nom du dossier ; son adresse ; son SIRET quand il a
 * quatorze chiffres, et le SIREN qui le commence ; une entreprise établie en France quand il a un SIRET, sinon un
 * non-assujetti. `btrim` de PostgreSQL, sans second argument, ne retire que des espaces : la même chose ici.
 */
export function identiteDuDossier(d: DossierDuClient): IdentiteDuDossier {
  const imprime = d.denomination_imprimee == null ? '' : d.denomination_imprimee.replace(/^ +| +$/g, '')
  const siret = d.siret != null && QUATORZE_CHIFFRES.test(d.siret) ? d.siret : null
  return {
    tiersNom: imprime !== '' ? imprime : d.nom,
    tiersAdresse: d.adresse,
    tiersSiret: siret,
    tiersSiren: siret == null ? null : siret.slice(0, 9),
    typeClient: siret != null ? 'assujetti' : 'non_assujetti',
  }
}

// ── Ce que la lecture rend, et ce que le choix met dans la facture ─────────────────────────────────────────────────────────
/** Une ligne de `identites_des_fiches_liees`. */
export interface IdentiteLue {
  contact_id: string
  dossier_client_id: string
  dossier_present: boolean
  tiers_nom: string | null
  tiers_adresse: string | null
  tiers_siret: string | null
  tiers_siren: string | null
  type_client: 'assujetti' | 'non_assujetti' | null
}

/** Une fiche liée, telle que la table la porte : ce qui est propre à la facturation. */
export interface FicheLiee {
  id: string
  dossier_client_id: string
  adresse_electronique: string | null
  email: string | null
  delai_paiement_jours: number | null
  observations: string | null
  retire_le: string | null
  efface_le: string | null
  /** La version lue (`modifie_le`), que le déliement retient (LM3-Q1 (B)). */
  modifie_le?: string | null
}

/** Le client d'une facture en texte de champ, comme `ClientEnSaisie` (lib/contactsFacture.ts) le porte. */
export interface ClientDUneFicheLiee {
  tiersNom: string
  tiersAdresse: string
  tiersSiret: string
  typeClient: 'assujetti' | 'non_assujetti'
  siren: string
  adresseElectronique: string
  codeService: string
}

export type ChoixDeFicheLiee =
  | { etat: 'choisi'; client: ClientDUneFicheLiee; echeance: { delai: number; date: string | null } | null }
  | { etat: 'dossierParti' }
  | { etat: 'illisible' }

const UN_JOUR = /^\d{4}-\d{2}-\d{2}$/

/**
 * Ce que le choix d'une fiche liée met dans la facture : l'identité que la LECTURE a rendue pour elle (jamais une copie
 * gardée), l'adresse de facturation électronique de la fiche quand le dossier est une entreprise, aucun code service, et
 * l'échéance que son délai propose. `identites` : la lecture entière ; une fiche qu'elle ne rend pas est « illisible » (rien
 * ne se remplit), un dossier parti se dit — jamais une identité devinée.
 */
export function choixDeFicheLiee(fiche: FicheLiee, identites: readonly IdentiteLue[], dateEmission: string): ChoixDeFicheLiee {
  const lue = identites.find((i) => i.contact_id === fiche.id && i.dossier_client_id === fiche.dossier_client_id)
  if (lue == null || (lue.dossier_present && (lue.tiers_nom == null || lue.type_client == null))) return { etat: 'illisible' }
  if (!lue.dossier_present) return { etat: 'dossierParti' }
  const typeClient = lue.type_client as 'assujetti' | 'non_assujetti'
  const delai = fiche.delai_paiement_jours
  return {
    etat: 'choisi',
    client: {
      tiersNom: lue.tiers_nom as string,
      tiersAdresse: lue.tiers_adresse ?? '',
      tiersSiret: lue.tiers_siret ?? '',
      typeClient,
      siren: lue.tiers_siren ?? '',
      adresseElectronique: typeClient === 'assujetti' ? (fiche.adresse_electronique ?? '') : '',
      codeService: '',
    },
    echeance: delai == null ? null : { delai, date: UN_JOUR.test(dateEmission) ? ajouterJours(dateEmission, delai) : null },
  }
}

/** Ce qu'une saisie de fiche liée envoie à `enregistrer_contact` : le lien et ce qui est propre à la facturation, aucune
 *  clé d’identité (la base les refuserait). Un texte vide part nul ; l’adresse électronique, sans ses blancs. */
export function saisieDeLaFicheLiee(s: {
  dossierClientId: string; adresseElectronique: string; email: string; delai: string; observations: string
}): Record<string, string | number | null> {
  const texte = (v: string) => (v.trim() === '' ? null : v.trim())
  const delai = s.delai.trim() === '' ? null : Number(s.delai.trim())
  return {
    dossier_client_id: s.dossierClientId,
    adresse_electronique: texte(s.adresseElectronique)?.replace(/\s/g, '') ?? null,
    email: texte(s.email),
    delai_paiement_jours: delai != null && Number.isFinite(delai) ? delai : null,
    observations: s.observations === '' ? null : s.observations,
  }
}

// ── Délier une fiche (LM3-Q1 (B), réponse du cabinet du 11/11/2026) ───────────────────────────────────────────────────────
// `delier_fiche_liee` : au cabinet seul, la fiche redevient saisie à la main, l'identité que son dossier donne À CE MOMENT
// recopiée dans la même transaction, ce qui est propre à la facturation gardé ; elle ne se relie plus. Ses refus, dans l'ordre
// de la fonction, à ses mots et à ses codes ; le SIRET déjà rangé porte ses valeurs (« % »).
export const REFUS_DU_DELIEMENT = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', code: 'P0002', modele: 'Contact introuvable dans ce dossier.' },
  { cle: 'retiree', code: '22023', modele: 'Ce contact est retiré : le reprendre avant de le modifier.' },
  { cle: 'pasLiee', code: '22023', modele: 'Cette fiche n’est pas liée au dossier d’un client : rien ne se délie.' },
  { cle: 'version', code: '22023', modele: 'La fiche a changé depuis sa lecture : relire avant de la délier.' },
  {
    cle: 'dossierParti', code: '22023',
    modele: 'Le dossier de ce client n’est plus dans ce cabinet : rien ne se recopie. La fiche se retire ou s’efface.',
  },
  {
    cle: 'nom', code: '22023',
    modele: 'Le nom que donne le dossier de ce client est vide ou dépasse deux cents caractères : le corriger dans son identité avant de délier la fiche.',
  },
  {
    cle: 'adresse', code: '22023',
    modele: 'Le dossier de ce client n’a pas d’adresse (ou une de plus de mille caractères) : la renseigner dans son identité avant de délier la fiche.',
  },
  {
    cle: 'adresseElectronique', code: '22023',
    modele: 'L’adresse de facturation électronique de la fiche ne va plus avec l’identité du dossier (une entreprise, son SIREN en tête) : la corriger ou la retirer avant de délier la fiche.',
  },
  {
    cle: 'siret', code: '23505',
    modele: 'Le SIRET « % » est déjà celui du contact « % »% : un établissement ne se range qu’une fois par dossier.',
  },
] as const

export type RefusDuDeliement = (typeof REFUS_DU_DELIEMENT)[number]['cle']

const mots = (cle: RefusDuDeliement) => (REFUS_DU_DELIEMENT.find((r) => r.cle === cle) as { modele: string }).modele
const blanc = (v: string) => v.replace(/[ \t\n\r]/g, '') === ''

/**
 * Ce que la base refuserait AVANT le clic, à ses mots, ou nul : la fiche telle que la liste l'a lue, l'identité que la lecture
 * des fiches liées a rendue pour elle (nulle : pas rendue — rien ne se recopie, l'identité illisible se dit), et les contacts
 * du dossier, lus en entier (le SIRET recopié ne s'y range qu'une fois). L'accès, la fiche introuvable et la version lue ne se
 * jugent qu'en base. `char_length` compte des caractères : la longueur se compte ici en points de code.
 */
export function refusDuDeliement(e: {
  fiche: { id: string; dossier_client_id: string | null; retire_le: string | null; adresse_electronique: string | null }
  identite: IdentiteLue | null
  contacts: readonly { id: string; nom: string | null; siret: string | null; retire_le: string | null }[]
}): string | null {
  if (e.fiche.retire_le != null) return mots('retiree')
  if (e.fiche.dossier_client_id == null) return mots('pasLiee')
  if (e.identite == null) return 'L’identité de ce client ne s’est pas lue de son dossier : rien ne se recopie.'
  if (!e.identite.dossier_present) return mots('dossierParti')
  const nom = e.identite.tiers_nom
  if (nom == null || blanc(nom) || [...nom].length > 200) return mots('nom')
  const adresse = e.identite.tiers_adresse
  if (adresse == null || blanc(adresse) || [...adresse].length > 1000) return mots('adresse')
  const siren = e.identite.tiers_siren
  if (e.fiche.adresse_electronique != null && (siren == null || e.fiche.adresse_electronique.slice(0, 9) !== siren)) {
    return mots('adresseElectronique')
  }
  const siret = e.identite.tiers_siret
  const autre = siret == null ? undefined : e.contacts.find((c) => c.id !== e.fiche.id && c.siret === siret)
  if (autre != null && siret != null) {
    const n = autre.nom ?? ''
    return `Le SIRET « ${siret} » est déjà celui du contact « ${[...n].length > 80 ? [...n].slice(0, 79).join('') + '…' : n} »`
      + `${autre.retire_le != null ? ' (retiré)' : ''} : un établissement ne se range qu’une fois par dossier.`
  }
  return null
}

/**
 * La confirmation du déliement : elle NOMME les valeurs du dossier qui se recopient, à ce jour, ce que la fiche garde, et ce
 * que le geste change — la fiche redevient saisie à la main, ne suit plus le dossier et ne se relie plus.
 */
export function confirmationDuDeliement(i: IdentiteLue, fiche: FicheLiee): { titre: string; recopie: string[]; garde: string[]; regle: string } {
  const garde: string[] = []
  if (fiche.adresse_electronique) garde.push(`L’adresse de facturation électronique : ${fiche.adresse_electronique}`)
  if (fiche.email) garde.push(`L’e-mail de facturation : ${fiche.email}`)
  if (fiche.delai_paiement_jours != null) garde.push(`Le délai de paiement : ${fiche.delai_paiement_jours} jours`)
  if (fiche.observations) garde.push('Les observations')
  return {
    titre: `Délier la fiche de « ${i.tiers_nom ?? ''} » du dossier de son client ?`,
    recopie: [
      `Nom : ${i.tiers_nom ?? ''}`,
      `Adresse : ${i.tiers_adresse ?? ''}`,
      i.tiers_siret != null ? `SIRET : ${i.tiers_siret} (SIREN ${i.tiers_siren ?? ''})` : 'Aucun SIRET',
      i.type_client === 'assujetti' ? 'Une entreprise établie en France' : 'Un particulier ou un autre non-assujetti',
    ],
    garde,
    regle: 'La fiche redevient saisie à la main, avec les valeurs du dossier à ce jour : elle ne suivra plus son identité. '
      + 'Les factures déjà faites gardent leur provenance et leur copie. Elle ne se relie plus à aucun dossier ; le dossier, '
      + 'lui, pourra recevoir une nouvelle fiche liée.',
  }
}
