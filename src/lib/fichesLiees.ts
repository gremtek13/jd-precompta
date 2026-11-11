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
