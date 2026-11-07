import { remplirModele } from './encaissementsFactures'
import { mentionTva } from './statutTva'
import type { ArticleExoneration, FactureEmise, StatutTva, TypeClient } from './types'

// CE QUE LA VALIDATION EXIGE D'UNE FACTURE, DEPUIS LA CORRECTION DE LA FACTURE (31/10/2026, reprise le 02/11/2026 pour
// FACTURE-Q1 ; migration `facture_dates_centimes_mention_tva`, en production depuis le 02/11/2026 (version 20261102112003) ;
// HISTORIQUE.md, « LA FACTURE : LA DATE DANS L'ORDRE DE SA SÉRIE, LE DEMI-CENTIME ET LA MENTION DE TVA, REPRISE POUR
// FACTURE-Q1 (PRÉPARÉE, PAS APPLIQUÉE) »).
// Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas l'horloge (le jour de Paris lui est donné) — qui
// redit les cinq refus que la garde des factures (`garder_factures_validees`) oppose à une validation, dans son ordre,
// sous ses mots et son code. Ils viennent après tous ceux d'`enregistrer_facture` — ceux d'hier, puis ceux de
// lib/mentionsFigees.ts (rangs 1 à 13), puis la numérotation sous le verrou de la série — et avant ceux de la source de
// la vente (lib/sourceDeLaVente.ts, le déclencheur qui suit la garde dans l'ordre des noms) :
//   14. une facture d'un dossier dont le statut de TVA est à préciser, pour un accès « Ventes » : la mention de TVA et le
//       numéro de TVA que la facture imprime en dépendent, et une facture validée ne se corrige que par un avoir ; le
//       cabinet la valide encore (FACTURE-Q1, la réponse du cabinet du 02/11/2026, contre la recommandation, qui la
//       refusait à tout auteur : « seulement depuis l'espace client »). Un avoir n'en est pas jugé : il défait une facture
//       telle qu'elle a été faite ;
//   15. une facture d'un dossier exonéré sans article d'exonération, pour un accès « Ventes » (FACTURE-Q2 ; le cabinet,
//       qui saisit la mention d'un article hors de la liste, valide encore) ;
//   16. des mentions légales sans la mention de TVA du statut — `mentionTva` (lib/statutTva.ts), au caractère près —,
//       d'une facture comme d'un avoir, pour tout auteur (FACTURE-Q3) ;
//   17. une date d'émission à venir, après le jour de Paris ;
//   18. une date d'émission antérieure à la plus récente des factures validées de sa série (même dossier, même lettre,
//       même année : CGI, ann. II, art. 242 nonies A, I, 7°, « une séquence chronologique et continue »).
// LES RANGS 17 ET 18 se disent désormais avant le clic par les deux formulaires (FactureFormModal, FactureAvoirModal), pour
// tout auteur, sur la date telle qu'elle part (`refusDeLaDateDEmission`) ; le 18 se tait sur une liste des factures lue en
// partie ou pas encore revenue, que la base juge alors au clic, le 17 ne dépendant d'aucune liste.
// validationDeLaFacture.test.ts confronte chaque refus au texte de la garde dans sa migration, où qu'elle soit (préparée
// ou dans l'export), et le texte de chaque mention au module des statuts.
//
// LES DEUX REFUS QUI DÉPENDENT DE L'AUTEUR (14 et 15) se disent avant le clic, selon l'espace : le formulaire de la facture
// (FactureFormModal) retient la validation dans l'espace du client (`refusDuStatutDeTva`), et dit au cabinet, qui valide
// encore, qu'un accès « Ventes » ne la validerait pas (`avisDuStatutDeTva`) — le patron des refus de la validation figée
// (lib/mentionsFigeesVue.ts). Seul un client les reçoit de la base : leurs mots ne renvoient à aucun onglet du cabinet.

/** Les refus de la garde, dans son ordre. « % » : ce que la base y écrit (une date JJ/MM/AAAA, un numéro, une mention). */
export const REFUS_DE_LA_VALIDATION = [
  {
    cle: 'statut_tva_a_preciser', rang: 14, code: '22023',
    modele: "Le statut de TVA du dossier est à préciser : la mention de TVA et le numéro de TVA qu'une facture imprime en "
      + "dépendent. Le cabinet le précise avant qu'une facture se valide depuis l'espace client.",
  },
  {
    cle: 'article_a_choisir', rang: 15, code: '22023',
    modele: "Le dossier est exonéré de TVA sans article d'exonération : la mention qu'une facture porte en dépend. Le cabinet "
      + "choisit l'article avant qu'une facture se valide depuis l'espace client.",
  },
  {
    cle: 'mention_tva_absente', rang: 16, code: '22023',
    modele: 'Les mentions légales ne portent pas la mention de TVA du dossier, « % » : une facture ou un avoir qui ne '
      + 'facture pas de TVA la porte telle quelle (CGI, ann. II, art. 242 nonies A, I ; art. 293 B pour la franchise en base).',
  },
  {
    cle: 'date_a_venir', rang: 17, code: '22023',
    modele: "La date d'émission, le %, est à venir : nous sommes le % à Paris. Une facture ou un avoir se valide daté du jour "
      + "au plus tard, sa numérotation suivant l'ordre des dates d'émission (CGI, ann. II, art. 242 nonies A, I, 7°).",
  },
  {
    cle: 'date_avant_la_derniere', rang: 18, code: '22023',
    modele: "La date d'émission, le %, précède celle de % (le %), la plus récente de la même série : les numéros suivent "
      + "l'ordre des dates d'émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d'après se valide.",
  },
] as const

export type CleRefusDeLaValidation = (typeof REFUS_DE_LA_VALIDATION)[number]['cle']

export interface RefusDeLaValidation {
  cle: CleRefusDeLaValidation
  code: string
  message: string
}

function refus(cle: CleRefusDeLaValidation, ...valeurs: string[]): RefusDeLaValidation {
  const r = REFUS_DE_LA_VALIDATION.find((x) => x.cle === cle) as (typeof REFUS_DE_LA_VALIDATION)[number]
  return { cle, code: r.code, message: remplirModele(r.modele, valeurs) }
}

// Une date civile AAAA-MM-JJ écrite comme la base l'écrit dans ses messages (`to_char(…, 'DD/MM/YYYY')`).
const enClair = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/

/** Une facture ou un avoir du dossier, tel que la liste de l'onglet le lit. */
export type FactureDeLaSerie = Pick<FactureEmise, 'statut' | 'numero' | 'date_emission'>

/**
 * La plus récente des factures VALIDÉES de la série dans laquelle se numérotera une facture (ou un avoir) de cette date :
 * la lettre de son type, l'année de sa date — celle que la base lit sous le verrou de la série. La plus tardive des
 * dates ; à date égale, le plus grand numéro. Null quand la série est vide.
 */
export function plusRecenteDeLaSerie(
  type: 'facture' | 'avoir', dateEmission: string, factures: readonly FactureDeLaSerie[],
): { numero: string; date: string } | null {
  const serie = `${type === 'avoir' ? 'A' : 'F'}${dateEmission.slice(0, 4)}`
  const rang = (numero: string) => Number(numero.split('-')[1])
  let retenue: { numero: string; date: string } | null = null
  for (const f of factures) {
    if (f.statut !== 'validee' || f.numero == null || f.numero.split('-')[0] !== serie) continue
    if (retenue === null || f.date_emission > retenue.date || (f.date_emission === retenue.date && rang(f.numero) > rang(retenue.numero))) {
      retenue = { numero: f.numero, date: f.date_emission }
    }
  }
  return retenue
}

/** Ce que la garde juge de la date d'émission d'une facture (ou d'un avoir) qui se valide. */
export interface DateDEmissionAJuger {
  type: 'facture' | 'avoir'
  // La date d'émission, AAAA-MM-JJ, telle qu'elle part.
  dateEmission: string
  // Le jour de Paris (`aujourdHuiAParis`, lib/format.ts), que la base lit à la validation.
  aujourdhui: string
  // Les factures et les avoirs du dossier, LUS EN ENTIER : sur une liste partielle, l'appelant ne demande rien ici.
  factures: readonly FactureDeLaSerie[]
}

/**
 * Le refus de la date d'une facture (ou d'un avoir) qui se valide, rangs 17 et 18 de la garde, dans son ordre et sous ses
 * mots ; null quand la date passe. Une date que la base ne lirait pas n'est pas jugée ici.
 */
export function refusDeLaDateDEmission(d: DateDEmissionAJuger): RefusDeLaValidation | null {
  if (!DATE_CIVILE.test(d.dateEmission)) return null
  if (d.dateEmission > d.aujourdhui) return refus('date_a_venir', enClair(d.dateEmission), enClair(d.aujourdhui))
  const derniere = plusRecenteDeLaSerie(d.type, d.dateEmission, d.factures)
  if (derniere !== null && d.dateEmission < derniere.date) {
    return refus('date_avant_la_derniere', enClair(d.dateEmission), derniere.numero, enClair(derniere.date), enClair(derniere.date))
  }
  return null
}

/** Ce que la garde juge du statut de TVA d'une facture (ou d'un avoir) qui se valide, et de qui la valide. */
export interface StatutDeTvaAJuger {
  type: 'facture' | 'avoir'
  // Le statut de TVA et l'article que la validation fige (`mentionsAFiger`, lib/mentionsFigees.ts) : ceux du dossier, ou,
  // pour un avoir qui la reprend, ceux de sa facture.
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  // Qui valide : le cabinet du dossier (`admin_du_dossier`), ou un accès « Ventes ». À l'écran, l'espace : le cabinet
  // dans le sien, le client « Ventes » dans « Mes ventes ».
  cabinet: boolean
}

/** Ce que la garde juge d'une facture (ou d'un avoir) qui se valide. */
export interface ValidationAJuger extends DateDEmissionAJuger, StatutDeTvaAJuger {
  // Les mentions légales telles qu'elles partent (la base juge celles qu'elle a écrites).
  mentionsLegales: string | null
}

/**
 * Les deux refus de la garde qui dépendent de l'auteur, rangs 14 et 15, dans son ordre : une FACTURE d'un dossier au
 * statut de TVA à préciser (FACTURE-Q1), ou exonéré sans article (FACTURE-Q2), validée par un accès « Ventes ». Null pour
 * le cabinet, qui la valide encore, et pour un avoir, qui n'en est pas jugé.
 */
export function refusDuStatutDeTva(v: StatutDeTvaAJuger): RefusDeLaValidation | null {
  if (v.type !== 'facture' || v.cabinet) return null
  if (v.statutTva == null) return refus('statut_tva_a_preciser')
  if (v.statutTva === 'exonere' && v.articleExoneration == null) return refus('article_a_choisir')
  return null
}

/**
 * Ce que le cabinet valide encore, et qu'un accès « Ventes » ne validerait pas (rangs 14 et 15) : dit au cabinet avant le
 * clic, comme les avis de la validation figée (lib/mentionsFigeesVue.ts). Null hors de l'espace du cabinet, pour un avoir,
 * et quand le client la validerait aussi.
 */
export function avisDuStatutDeTva(v: StatutDeTvaAJuger): string | null {
  if (!v.cabinet) return null
  const refuseAuClient = refusDuStatutDeTva({ ...v, cabinet: false })
  if (refuseAuClient === null) return null
  return refuseAuClient.cle === 'statut_tva_a_preciser' ? AVIS_STATUT_A_PRECISER : AVIS_ARTICLE_A_CHOISIR
}

export const AVIS_STATUT_A_PRECISER = 'Le cabinet valide encore cette facture ; un accès « Ventes » ne la validerait pas tant que '
  + 'le statut de TVA du dossier est à préciser.'
export const AVIS_ARTICLE_A_CHOISIR = 'Le cabinet valide encore cette facture ; un accès « Ventes » ne la validerait pas tant que '
  + 'l’article d’exonération du dossier n’est pas choisi.'

/** Le premier des cinq refus de la garde, dans son ordre ; null quand elle laisse la validation se faire. */
export function refusDeLaValidation(v: ValidationAJuger): RefusDeLaValidation | null {
  const statut = refusDuStatutDeTva(v)
  if (statut !== null) return statut
  // `mentionTva` ne donne aucune mention à un redevable : celle de l'article d'une ligne à 0 % se dit avant le clic
  // (FactureFormModal), la base ne la juge pas.
  const mention = mentionTva(v.statutTva, v.articleExoneration)
  if (mention !== null && !(v.mentionsLegales ?? '').includes(mention)) return refus('mention_tva_absente', mention)
  return refusDeLaDateDEmission(v)
}

// ── L'ADRESSE DU CLIENT (JJ-Q4, la réponse du cabinet du 07/11/2026 : « Oui, refuser à la validation ») ──────────────
// La migration `adresse_du_client_exigee`, PRÉPARÉE, PAS APPLIQUÉE (supabase/preparees/20261107200000_adresse_du_client_exigee.sql ;
// son essai : supabase/essais/adresseDuClientExigee.sql ; HISTORIQUE.md, « JJ-Q4 : UNE FACTURE À UNE ENTREPRISE SANS
// ADRESSE NE SE VALIDE PAS (PRÉPARÉE, PAS APPLIQUÉE) »). Un déclencheur à lui, qui suit la garde des factures dans l'ordre
// des noms (`factures_emises_figees_adresse_du_client`) : son refus vient après les cinq de la garde (et le bloc d'e7a,
// lib/factureInternationale.ts, quand sa migration est en base), et avant ceux de la source de la vente — le rang 19. Une
// FACTURE (une facture d'acompte et la finale d'un devis comprises) dont le type de client, tel qu'il part, est une
// entreprise établie en France ou un organisme public (`versEntreprise`, lib/mentionsFacture.ts), sans l'adresse de son
// client — nulle, ou faite des seuls blancs que `trim` retire, ceux de la base —, se refuse, pour tout auteur. Un avoir
// reprend le client de sa facture et n'en est pas jugé ; un particulier, un client établi hors de France ou un type à
// préciser se valident comme hier. Sources : CGI, ann. II, art. 242 nonies A, I, 1° ; code de commerce, art. L441-9, I.

// Baissé tant que la migration n'est pas en base : l'écran ne retient pas une validation que la base accepte encore.
export const ADRESSE_DU_CLIENT_EXIGEE: boolean = false

/** Le refus du déclencheur, sous ses mots et son code (validationDeLaFacture.test.ts le confronte à la migration). */
export const REFUS_ADRESSE_DU_CLIENT = {
  cle: 'adresse_du_client', rang: 19, code: '22023',
  modele: "L'adresse du client manque : une facture à une entreprise ou à un organisme public porte le nom complet et "
    + "l'adresse de son client (CGI, ann. II, art. 242 nonies A, I, 1° ; code de commerce, art. L441-9, I). Elle se "
    + 'renseigne avant la validation : une facture validée ne se corrige que par un avoir.',
} as const

/** Ce que le déclencheur juge d'une facture (ou d'un avoir) qui se valide, telle qu'elle part. */
export interface AdresseDuClientAJuger {
  type: 'facture' | 'avoir'
  // Le type du client de l'en-tête (`type_client`) : nul quand il est à préciser.
  typeClient: TypeClient | null
  // L'adresse du client de l'en-tête (`tiers_adresse`).
  tiersAdresse: string | null
}

export interface RefusDeLAdresseDuClient {
  cle: typeof REFUS_ADRESSE_DU_CLIENT.cle
  code: string
  message: string
}

/** Le refus du rang 19 ; null quand le déclencheur laisse la validation se faire. */
export function refusDeLAdresseDuClient(v: AdresseDuClientAJuger): RefusDeLAdresseDuClient | null {
  if (v.type !== 'facture') return null
  if (v.typeClient !== 'assujetti' && v.typeClient !== 'organisme_public') return null
  if ((v.tiersAdresse ?? '').trim() !== '') return null
  return { cle: REFUS_ADRESSE_DU_CLIENT.cle, code: REFUS_ADRESSE_DU_CLIENT.code, message: REFUS_ADRESSE_DU_CLIENT.modele }
}
