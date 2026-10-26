import type { ReglageDuDossier } from './droitsAcces'
import { anneeDe, dateAParis, formatDate } from './format'
import { refusDuReglage, type CleRefusSourceDeLaVente, type FacturePourReglage } from './sourceDeLaVente'
import type { FactureEmise, Membership } from './types'

// LA BASCULE DES VENTES, À L'ÉCRAN (chantier EC-Q3, étape VF8b ; HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (b),
// § 5 et § 6, et « LA BASCULE DES VENTES, À L'ÉCRAN »). Un module PUR : ce que la carte « Source des ventes » de l'onglet
// Informations dit d'un dossier — son état (« par ses pièces » ; « par ses factures depuis le … »), ce que la bascule change,
// ce qui la rend irréversible, le moment conseillé —, le geste qu'elle offre et sa confirmation, qui NOMME les chiffres lus,
// ou la raison qui le retient. La lecture vit à part (lib/basculeDesVentesLecture.ts).
//
// Ce module NE JUGE PAS LA COLONNE : le réglage lui arrive jugé par `reglageDuDossier` (lib/droitsAcces.ts, étape VF8d) —
// une colonne absente, nulle ou d'un autre type est illisible, jamais « par ses pièces » —, et les refus de l'écriture sont
// ceux de la garde du réglage, redits par `refusDuReglage` (lib/sourceDeLaVente.ts, étape VF8a), dans son ordre : la facture
// source (irréversible), la personne (VF8-Q1 : le chef du cabinet seul, ou le super-administrateur), l'accès « Ventes ».
// Rien n'en est recopié ici.

// LA BASCULE N'EST PAS ENCORE OFFERTE À L'ÉCRAN. La conception la retenait jusqu'à VF5h2, VF7a, VF7b et VF7e, appliquées le
// 26/10/2026. Deux conditions restent, et la session lèvera ce drapeau elle-même quand elles seront remplies :
//   1. la petite migration de VF5H2-Q1 (« Oui, la fermer », tranchée le 26/10/2026) appliquée — l'insertion directe d'un
//      encaissement sur un mouvement classé par ses encaissements refusée pour toute facture, la restauration exceptée ;
//      le cabinet l'a voulue avant la première bascule réelle ;
//   2. VF8e en ligne — « Ma simulation » d'un client « Banque » reçoit les ventes facturées d'un dossier basculé (VF8-Q2) ;
//      sans elle, sa simulation compterait l'exemplaire d'une facture source comme une pièce, et la vente qu'elle ne lit pas.
// Faux, la carte dit l'état et pourquoi la source des ventes ne se change pas encore d'ici, sans aucun geste, dans les deux
// sens ; l'onglet Accès dit de même que le réglage « ne s'offre pas encore » (`raisonDuDossierNonBascule`). Chaque fonction
// de ce module reçoit le drapeau en paramètre : ses deux états s'éprouvent sans toucher à cette constante.
export const BASCULE_OFFERTE: boolean = false

/** Une facture du dossier telle que la carte la lit : ce que la garde du réglage lit, sa date et son statut. */
export type FactureDeLaBascule = FacturePourReglage & Pick<FactureEmise, 'statut' | 'date_emission'>

/** Ce que la carte lit en plus du réglage : les factures, les accès clients et les pièces de vente à valider, EN ENTIER. */
export type ListesDeLaBascule =
  | {
    etat: 'lues'
    factures: readonly FactureDeLaBascule[]
    acces: readonly Pick<Membership, 'droit_ventes'>[]
    /** Le nombre des pièces de vente du dossier à valider. */
    piecesDeVenteAValider: number
  }
  | { etat: 'partielles'; motif: string }

/** Ce que la lecture rend (lib/basculeDesVentesLecture.ts) : le dossier lu, son réglage jugé, la date telle que lue. */
export interface LectureDeLaBascule {
  dossierId: string
  reglage: ReglageDuDossier
  /** `dossiers.ventes_par_les_factures_depuis` TELLE QUE LUE : absente (`undefined`), nulle, ou ce que la base a rendu. */
  depuis: unknown
  listes: ListesDeLaBascule
}

/** Ce que l'écran sait de qui regarde, et du jour. */
export interface ContexteDeLaCarte {
  /** La session est-elle celle du chef du cabinet du dossier, ou du super-administrateur (VF8-Q1, `est_chef_du_cabinet`) ? */
  chefDuCabinet: boolean
  /** `BASCULE_OFFERTE`, passé par l'écran : un paramètre, pour que ses deux états s'éprouvent. */
  offerte: boolean
  /** Aujourd'hui, date civile À PARIS (AAAA-MM-JJ) : la base juge les exercices à Paris. */
  aujourdhui: string
}

/** Le geste de la carte : le réglage visé, le libellé du bouton, la phrase de la confirmation. */
export interface GesteDeLaBascule {
  apres: boolean
  libelle: string
  confirmation: string
}

/** Ce que la carte montre. */
export interface CarteDeLaBascule {
  /** L'état, toujours dit. */
  etat: string
  /** Avant le clic, ce que la bascule change (un dossier qui n'a pas basculé, listes lues et geste possible ou non). */
  ceQuiChange: readonly string[]
  /** Ce qui rend le réglage irréversible ; nul quand il l'est déjà (la raison le dit) ou que rien ne se juge. */
  irreversibilite: string | null
  /** Le moment conseillé (VF8-Q3) ; nul sur un dossier basculé. */
  momentConseille: string | null
  /** Le geste offert ; nul quand une raison le retient. */
  geste: GesteDeLaBascule | null
  /** Pourquoi aucun geste ne s'offre ; nulle quand le geste est offert, ou que l'état illisible dit déjà tout. */
  raison: string | null
  /** Le refus de la garde redit avant le clic, quand c'est lui qui retient le geste (pour les tests et les mutations). */
  refus: CleRefusSourceDeLaVente | null
}

// ── Les phrases ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** L'état d'un dossier dont les ventes se comptent par leurs pièces. */
export const ETAT_PAR_SES_PIECES = 'Les ventes de ce dossier se comptent par leurs pièces : une facture émise dans '
  + 'l’application ne compte que par la pièce de vente qui la porte au dossier (son PDF déposé, ou la facture qui revient '
  + 'de la plateforme).'

/** Le jour d'une bascule, tel que la base l'a daté : un instant, dit au jour de Paris ; nul s'il ne se lit pas. */
export function jourDeLaBascule(depuis: unknown): string | null {
  if (typeof depuis !== 'string' || Number.isNaN(new Date(depuis).getTime())) return null
  return formatDate(dateAParis(depuis))
}

/** L'état d'un dossier dont les factures sont la source de leurs ventes, avec le jour de la bascule quand il se lit. */
export function etatParSesFactures(depuis: unknown): string {
  const debut = 'Les factures de ce dossier sont la source de leurs ventes'
  const jour = jourDeLaBascule(depuis)
  if (jour != null) return `${debut} depuis le ${jour}.`
  // Une date nulle : la base n'en a pas gardé (un dossier basculé avant la garde datée, ou rendu tel par une restauration).
  if (depuis === null) return `${debut} (la base n’a pas gardé la date de la bascule).`
  return `${debut} (la date de la bascule ne se lit pas).`
}

/** L'état d'un réglage illisible : rien ne se juge, rien ne s'offre. */
export function etatIllisible(motif: string): string {
  return `La source des ventes de ce dossier ne se lit pas (${motif}) : elle ne se change pas d’ici. Recharge la page pour `
    + 'la relire.'
}

/** Pourquoi rien ne s'offre tant que le drapeau est baissé — dans les deux sens. */
export const BASCULE_PAS_ENCORE_OFFERTE = 'La source des ventes ne se change pas encore d’ici : deux étapes de l’application '
  + 'doivent précéder la première bascule — la fermeture de l’enregistrement direct d’un encaissement sur un mouvement déjà '
  + 'classé, et « Ma simulation » de tes clients, qui comptera les ventes facturées.'

/** Pourquoi rien ne s'offre quand une liste n'a pas été lue en entier. */
export function listesPartielles(motif: string): string {
  return `Les factures, les accès clients ou les pièces de vente du dossier n’ont pas été lus en entier (${motif}) : la `
    + 'source des ventes ne se change pas d’ici, ses refus ne se diraient pas avant le clic. Recharge la page pour les relire.'
}

/** Les factures et avoirs VALIDÉS dont la date tombe dans l'exercice en cours : ils resteront comptés par leurs pièces. */
export function facturesValideesDeLExercice(factures: readonly FactureDeLaBascule[], annee: number): number {
  return factures.filter((f) => f.statut === 'validee' && anneeDe(f.date_emission) === annee).length
}

/** Ce que l'exercice en cours garde de ses factures déjà validées (VF8-Q3 : la bascule en cours d'exercice, dite). */
export function phraseDeLExercice(validees: number, annee: number): string {
  return validees === 0
    ? `aucune facture n’est validée en ${annee} : cet exercice ne mêlera pas les deux façons de compter.`
    : `en ${annee}, ${validees === 1 ? '1 facture validée (avoirs compris) le restera' : `${validees} factures validées (avoirs compris) le resteront`}, `
      + 'et cet exercice comptera ses ventes des deux façons.'
}

/** Ce que la bascule change, dit avant le clic (conception, § 3 b ; VF6, § 7 : aucune pièce reprise). */
export function ceQueLaBasculeChange(validees: number, annee: number, piecesAValider: number): string[] {
  return [
    'Chaque facture validée ensuite devient la source de sa vente : elle compte dans la 2035, la CA3 et les états du dossier '
      + 'dès son encaissement (à sa date, dans un dossier tenu en engagement), et son exemplaire déposé ne la compte pas une '
      + 'seconde fois.',
    `Les factures déjà validées restent comptées par leurs pièces : ${phraseDeLExercice(validees, annee)}`,
    'Aucune pièce n’est reprise : une pièce de vente se désigne comme l’exemplaire de sa facture, ou se déclare hors des '
      + `factures, à sa validation — ${piecesAValider === 0
        ? 'aucune n’attend la sienne aujourd’hui.'
        : piecesAValider === 1 ? '1 attend la sienne aujourd’hui.' : `${piecesAValider} attendent la leur aujourd’hui.`}`,
    'Un crédit du relevé qui paie une facture source est réservé à ses encaissements : il ne se classe que par eux, depuis sa '
      + 'fiche.',
    'La case « Ventes » des accès clients s’ouvre (onglet Accès).',
  ]
}

/** Ce qui rend la bascule irréversible, dit avant elle. */
export const IRREVERSIBLE_A_LA_PREMIERE_FACTURE = 'La première facture validée ensuite rend ce réglage irréversible ; '
  + 'd’ici là, il se défait.'

/** Un dossier basculé sans facture source : le réglage se défait encore. */
export const SE_DEFAIT_ENCORE = 'Aucune facture n’a été validée depuis : le réglage se défait encore, et la première '
  + 'facture validée le rendra irréversible.'

/** Le moment conseillé (VF8-Q3, tranchée « La permettre, et le dire avant le clic »). */
export const MOMENT_CONSEILLE = 'Le moment conseillé : avant la première facture du dossier, ou le premier jour d’un exercice.'

/** Les libellés des deux gestes. */
export const LIBELLE_BASCULER = 'Compter les ventes par les factures'
export const LIBELLE_REVENIR = 'Revenir aux pièces'

/** La confirmation de la bascule : elle NOMME les chiffres lus. */
export function confirmationDeLaBascule(validees: number, annee: number, piecesAValider: number): string {
  const factures = validees === 0
    ? `Aucune facture n’est validée en ${annee}`
    : validees === 1
      ? `1 facture validée en ${annee} (avoirs compris) restera comptée par sa pièce`
      : `${validees} factures validées en ${annee} (avoirs compris) resteront comptées par leurs pièces`
  const pieces = piecesAValider === 0
    ? 'aucune pièce de vente n’attend sa validation'
    : piecesAValider === 1
      ? '1 pièce de vente à valider se désignera ou se déclarera à sa validation'
      : `${piecesAValider} pièces de vente à valider se désigneront ou se déclareront à leur validation`
  return `Les factures de ce dossier deviendront la source de leurs ventes. ${factures}, et ${pieces}. `
    + 'La première facture validée ensuite rendra ce réglage irréversible. Continuer ?'
}

/** La confirmation du retour aux pièces. */
export const CONFIRMATION_DU_RETOUR = 'Les ventes de ce dossier se compteront de nouveau par leurs pièces, et la case '
  + '« Ventes » des accès clients ne se cochera plus. Aucune facture n’a été validée depuis la bascule. Continuer ?'

/** L'écriture n'a rendu aucune ligne : rien n'est écrit. */
export const REGLAGE_NON_ENREGISTRE = 'La source des ventes n’a pas été enregistrée : la base n’a rendu aucune ligne du '
  + 'dossier. Recharge la page pour relire son état.'

/** Le repli d'un refus sans message. */
export const REPLI_DU_REGLAGE = 'La source des ventes n’a pas pu être enregistrée.'

// ── La carte ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const RIEN: Omit<CarteDeLaBascule, 'etat'> = {
  ceQuiChange: [], irreversibilite: null, momentConseille: null, geste: null, raison: null, refus: null,
}

/**
 * Ce que la carte montre, dans cet ordre de ce qui retient le geste :
 *   1. le réglage illisible — l'état le dit, rien d'autre ;
 *   2. le drapeau baissé (`offerte`) — l'état, et pourquoi rien ne s'offre encore ;
 *   3. une liste lue en partie, refusée ou rompue — l'état, et pourquoi rien ne se change d'ici ;
 *   4. le refus de la garde (`refusDuReglage`, dans son ordre) — dit avant le clic, à la place du geste ;
 *   5. sinon, le geste : basculer, ou revenir aux pièces.
 * Un dossier qui n'a pas basculé dit, listes lues, ce que la bascule change, ce qui la rend irréversible et le moment
 * conseillé — au chef comme au membre de l'équipe, qui voit l'état et la raison, jamais le geste (VF8-Q1).
 */
export function carteDeLaBascule(lecture: LectureDeLaBascule, contexte: ContexteDeLaCarte): CarteDeLaBascule {
  const { reglage, listes } = lecture
  if (reglage.etat === 'illisible') return { etat: etatIllisible(reglage.motif), ...RIEN }
  const bascule = reglage.etat === 'bascule'
  const etat = bascule ? etatParSesFactures(lecture.depuis) : ETAT_PAR_SES_PIECES
  if (!contexte.offerte) return { etat, ...RIEN, raison: BASCULE_PAS_ENCORE_OFFERTE }
  if (listes.etat === 'partielles') return { etat, ...RIEN, raison: listesPartielles(listes.motif) }

  const annee = anneeDe(contexte.aujourdhui)
  const validees = facturesValideesDeLExercice(listes.factures, annee)
  const refus = refusDuReglage(bascule, !bascule, listes.factures, {
    chefDuCabinet: contexte.chefDuCabinet, acces: listes.acces,
  })
  const parties = bascule
    ? {
      ceQuiChange: [],
      // Irréversible déjà : le refus le dit, avec la facture qui l'a rendu tel.
      irreversibilite: refus?.cle === 'reglage_irreversible' ? null : SE_DEFAIT_ENCORE,
      momentConseille: null,
    }
    : {
      ceQuiChange: ceQueLaBasculeChange(validees, annee, listes.piecesDeVenteAValider),
      irreversibilite: IRREVERSIBLE_A_LA_PREMIERE_FACTURE,
      momentConseille: MOMENT_CONSEILLE,
    }
  if (refus) return { etat, ...parties, geste: null, raison: refus.message, refus: refus.cle }
  const geste: GesteDeLaBascule = bascule
    ? { apres: false, libelle: LIBELLE_REVENIR, confirmation: CONFIRMATION_DU_RETOUR }
    : {
      apres: true,
      libelle: LIBELLE_BASCULER,
      confirmation: confirmationDeLaBascule(validees, annee, listes.piecesDeVenteAValider),
    }
  return { etat, ...parties, geste, raison: null, refus: null }
}
