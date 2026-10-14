import { CE_QUE_ETABLIT, direLaPriseEffet, direLaVerification, libelleMaille } from './adressesReceptionVue'
import { etatDeLaFactureElectronique } from './etatFactureElectronique'
import type { LectureDeLEtat } from './etatFactureElectroniqueLecture'
import { annuleeSurSaPlateforme } from './transmissionsFactures'
import { compterLesPastilles, type ListesDesVentes } from './tuilesVentes'
import type { EtatFactureElectroniqueLu, FactureEmise, StatutTva } from './types'
import type { StatutLu } from './statutsLus'

// L'ENCART « FACTURE ÉLECTRONIQUE » : CE QU'IL DIT (espace client, étape A6b2 ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6 ; A6-Q2, A6-Q3 et A6-Q4,
// décisions du cabinet du 14/10/2026). Un module PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — le
// jour de Paris, l'appelant le DONNE. L'encart de l'accueil du client et la carte de la Vue d'ensemble du cabinet le
// montrent, chacun dans ses mots (`EspaceEncart`).
//
// JAMAIS UNE RÈGLE RECOPIÉE. L'état (« active », « à compléter » et ce qui manque) est celui de `etatDeLaFactureElectronique` ;
// la prise d'effet, la vérification et ce que chaque source établit, ceux d'`adressesReceptionVue` ; les comptes de « ce qui
// attend », ceux des pastilles de l'onglet Factures (`compterLesPastilles`) et le refus de l'acheteur celui de
// `annuleeSurSaPlateforme`. Ce module ne dit que les PHRASES, et ne choisit rien.
//
// CE QU'IL NE COMPTE PAS : les factures validées qui relèvent de la facture électronique et attendent leur transmission.
// Aucun module ne dit aujourd'hui, sans recopier une règle, lesquelles en relèvent — un particulier, un client à
// l'étranger, un statut de TVA, une facture déjà transmise ailleurs : la question est posée au cabinet (A6B2-Q1).
//
// LE VIDE EST UNE AFFIRMATION. Rien ne se dit avant le retour de la lecture ; une valeur ILLISIBLE ou une lecture refusée ne
// se dit jamais « active » ni « à compléter » ; « ce qui attend » ne se compte que de listes TOUTES lues en entier — sinon,
// la phrase dit qu'il ne se compte pas, jamais un « 0 ».

/** Qui lit l'encart : les mots changent (le tutoiement, « ta société » chez le client ; « le client » au cabinet). */
export type EspaceEncart = 'client' | 'cabinet'

// ── Ce qui attend (l'accueil du client seulement) ────────────────────────────────────────────────────────────────────
export type AttenteDeLEncart =
  // Les ventes ne sont pas encore revenues.
  | { etat: 'en_cours' }
  // Une liste lue en partie, ou une lecture qui a échoué : aucun compte.
  | { etat: 'muette'; motif: string }
  | {
    etat: 'comptee'
    /** Les factures dont l'encaissement est « À déclarer » ou « Déclaration en retard » (les pastilles de l'onglet). */
    aDeclarer: number
    /** Parmi elles, celles dont une déclaration est en retard. */
    enRetard: number
    /** Les factures validées refusées (210) ou rejetées (213) sur leur plateforme. */
    refusees: number
  }

/**
 * Les factures validées refusées ou rejetées sur leur plateforme, d'après les statuts lus. C'est le jugement de
 * l'onglet Factures — son bouton « Avoir interne » —, qui ne propose cet avoir qu'à une facture (jamais à un avoir) validée.
 * Les listes doivent être lues EN ENTIER : l'appelant ne l'appelle que pour cela (`attenteDeLEncart`).
 */
export function refuseesSurLeurPlateforme(factures: readonly FactureEmise[], statutsLus: readonly StatutLu[]): number {
  return factures.filter((f) => f.statut === 'validee' && f.type === 'facture' && annuleeSurSaPlateforme(statutsLus, f.id)).length
}

/**
 * Ce qui attend, depuis LES MÊMES listes que les tuiles « À encaisser » et « À déclarer » (une seule lecture des ventes sur
 * l'accueil) : les encaissements à déclarer, comptés par `compterLesPastilles`, et les factures refusées sur leur plateforme.
 * Muet, avec le premier motif, dès qu'une des listes est partielle.
 */
export function attenteDeLEncart(
  dossierId: string,
  listes: ListesDesVentes,
  statutTva: StatutTva | null,
  aujourdhui: string,
): AttenteDeLEncart {
  const comptes = compterLesPastilles(dossierId, listes, statutTva, aujourdhui)
  if (comptes.etat === 'muettes') return { etat: 'muette', motif: comptes.motif }
  return {
    etat: 'comptee', aDeclarer: comptes.aDeclarer, enRetard: comptes.enRetard,
    refusees: refuseesSurLeurPlateforme(listes.factures, listes.statutsLus),
  }
}

// ── La ligne d'état, sous le titre ───────────────────────────────────────────────────────────────────────────────────
const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un)

/**
 * L'état en UNE ligne — ce que la tuile du téléphone montre —, au jour de Paris donné. Ni « active » ni « à compléter » tant
 * que la lecture n'est pas une valeur lue : « Chargement… », ou « Lecture impossible ».
 */
export function ligneDEtat(lecture: LectureDeLEtat, aujourdhui: string): string {
  if (lecture.etat === 'en_cours') return 'Chargement…'
  if (lecture.etat !== 'lue') return 'Lecture impossible'
  const etat = etatDeLaFactureElectronique(lecture.lu, aujourdhui)
  return etat.etat === 'active'
    ? 'Active'
    : `À compléter : ${etat.manque.length} ${pluriel(etat.manque.length, 'point', 'points')}`
}

/** Ce qui manque, nommé, un libellé du module mis en phrase (« Aucune plateforme de réception reliée… »). */
export function phrasesDeCeQuiManque(lu: EtatFactureElectroniqueLu, aujourdhui: string): string[] {
  const etat = etatDeLaFactureElectronique(lu, aujourdhui)
  if (etat.etat === 'active') return []
  return etat.manque.map((m) => `${m.libelle.charAt(0).toLocaleUpperCase('fr-FR')}${m.libelle.slice(1)}.`)
}

// ── Les phrases de chaque ligne ──────────────────────────────────────────────────────────────────────────────────────
export interface PhraseAdresse {
  /** L'adresse, sa maille, sa plateforme, sa prise d'effet (« Reçoit depuis le… » ou « À venir… »), sa vérification. */
  texte: string
  /** Ce que sa source de vérification établit — et n'établit pas (A6-Q4) ; une simple déclaration n'établit rien (A6-Q3). */
  etablit: string
}

/** L'adresse de réception COURANTE, dans les phrases de la fenêtre de l'adresse (`adressesReceptionVue`), jamais réécrites. */
export function phraseDeLAdresse(adresse: NonNullable<EtatFactureElectroniqueLu['adresse']>, aujourdhui: string): PhraseAdresse {
  return {
    texte: `${adresse.identifiant} (${libelleMaille(adresse.forme)}), chez ${adresse.plateforme}. `
      + `${direLaPriseEffet(adresse.prise_effet, aujourdhui)}. ${direLaVerification(adresse)}.`,
    etablit: CE_QUE_ETABLIT[adresse.verification],
  }
}

export function phraseSansAdresse(espace: EspaceEncart): string {
  return espace === 'client'
    ? 'Tu n’as pas encore déclaré d’adresse de réception.'
    : 'Aucune adresse de réception déclarée pour le client.'
}

/** Les deux connexions, reliées ou non — le nom de la plateforme agréée quand elle l'est. Pas d'identifiant, pas d'adresse. */
export function phrasesDesPlateformes(lu: EtatFactureElectroniqueLu): string[] {
  return [
    lu.plateforme.reliee ? `Plateforme agréée : reliée (${lu.plateforme.nom ?? ''}).` : 'Plateforme agréée : non reliée.',
    lu.superpdp.relie ? 'Super PDP : relié.' : 'Super PDP : non relié.',
  ]
}

/** Ce qui attend, en phrases : un compte ne se dit que de listes lues en entier. */
export function phrasesDeLAttente(attente: AttenteDeLEncart, lecture: LectureDeLEtat): string[] {
  if (attente.etat === 'en_cours') return ['Chargement…']
  if (attente.etat === 'muette') {
    return ['Ce qui t’attend ne se compte pas ici : tes ventes n’ont pas pu être toutes lues.']
  }
  const phrases: string[] = []
  if (attente.aDeclarer === 0) {
    phrases.push('Aucun encaissement à déclarer.')
  } else {
    phrases.push(
      `${attente.aDeclarer} ${pluriel(attente.aDeclarer, 'facture dont l’encaissement est', 'factures dont l’encaissement est')} à déclarer`
      + `${attente.enRetard > 0 ? `, dont ${attente.enRetard} en retard` : ''}.`,
    )
  }
  if (attente.refusees > 0) {
    phrases.push(
      `${attente.refusees} ${pluriel(attente.refusees, 'facture refusée ou rejetée', 'factures refusées ou rejetées')} sur ta plateforme.`,
    )
  } else if (lecture.etat === 'lue' && lecture.lu.plateforme.statuts_lus_le === null) {
    // Aucun relevé n'a jamais eu lieu : l'absence de refus ne dit rien, et le dire « aucun » serait une affirmation.
    phrases.push('Les statuts de ta plateforme n’ont pas encore été relevés : un refus de l’acheteur ne se verrait pas ici.')
  } else {
    phrases.push('Aucune facture refusée ou rejetée parmi les statuts relevés sur ta plateforme.')
  }
  return phrases
}

// ── Quand l'état ne se lit pas ───────────────────────────────────────────────────────────────────────────────────────
/** La phrase d'une lecture qui n'est pas une valeur lue : illisible, ou refusée avec son motif. Rien d'autre ne se dit. */
export function phraseDeLaLectureRatee(espace: EspaceEncart, lecture: Exclude<LectureDeLEtat, { etat: 'en_cours' | 'lue' }>): string {
  const de = espace === 'client' ? 'ta facture électronique' : 'la facture électronique du client'
  const suite = 'Recharger la page permet de réessayer.'
  return lecture.etat === 'illisible'
    ? `L’état de ${de} n’a pas pu être lu : la base a répondu sous une forme que l’écran ne sait pas lire, et rien n’en est dit. ${suite}`
    : `L’état de ${de} n’a pas pu être lu (${lecture.motif}). ${suite}`
}
