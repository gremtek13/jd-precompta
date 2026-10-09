import type { CodeStatutRecu } from './cdarRecu'
import type { EtatTransmission, StatutFactureRecu, TransmissionFacture } from './types'

// LES TRANSMISSIONS D'UNE FACTURE, TELLES QUE L'ÉCRAN LES DIT (ligne 28.5, étape c4 ; table `transmissions_factures`).
// Une facture validée part par la plateforme agréée du client (plateforme-agreee, « déposer ») ou par Super PDP
// (superpdp-emit) ; chaque envoi laisse sa transmission, et une seule reste ACTIVE par facture, tous canaux confondus —
// la base le garantit (transmissions_factures_une_active). Ce module ne lit rien : il dit l'état d'une facture depuis
// ses transmissions, que l'onglet Factures et la fenêtre de transmission ont lues.

// Les états qui empêchent un nouvel envoi : partie sans issue connue, déposée, acceptée. Les échecs s'accumulent, et la
// facture repart après eux : rien n'était parti. UNE FACTURE REJETÉE, elle, ne repart pas : elle s'annule par un avoir
// interne, qui ne se transmet pas, puis une nouvelle facture (spécifications externes de la DGFiP, § 3.6.4) — la base
// le garantit (garder_transmission_facture, migration avoir_interne_d_une_facture_rejetee).
export const ETATS_ACTIFS: readonly EtatTransmission[] = ['envoi', 'depose', 'accepte']

// Les statuts d'une facture, dans l'historique de Super PDP, qui l'annulent par un avoir interne : 210 « Refusée » par
// l'acheteur, 213 « Rejetée » par une plateforme (DGFiP, § 3.6.4). Les mêmes que la base lit.
export const STATUTS_ANNULATION_SUPERPDP: readonly string[] = ['fr:210', 'fr:213']

// Les mêmes, lus sur la plateforme du client (`statuts_factures_recus`, étape d7) : la base les lit aux quatre endroits
// où un refus de Super PDP fait refuser — l'encaissement, la déclaration hors application et sa garde, la transmission
// de la facture et celle de l'avoir qui l'annule (migration cycle_de_vie_des_factures_emises).
export const STATUTS_ANNULATION_PLATEFORME: readonly CodeStatutRecu[] = ['210', '213']

/** Un statut lu sur la plateforme du client, tel que les refus le lisent. */
export type StatutPlateformeLu = Pick<StatutFactureRecu, 'facture_id' | 'code'>

/**
 * La facture a-t-elle été refusée (210) ou rejetée (213) sur sa plateforme ? Les statuts sont ceux du DOSSIER, lus en
 * entier : le filtre sur la facture se fait ici, comme la base le fait.
 */
export function annuleeSurSaPlateforme(statuts: readonly StatutPlateformeLu[], factureId: string): boolean {
  return statuts.some((s) => s.facture_id === factureId && STATUTS_ANNULATION_PLATEFORME.includes(s.code))
}

// La référence que l'écran cite, et que la base suit.
export const REGLE_AVOIR_INTERNE = 'spécifications externes de la DGFiP, § 3.6.4'

export const estActive = (t: Pick<TransmissionFacture, 'etat'>) => ETATS_ACTIFS.includes(t.etat)

export interface InfoEtat {
  libelle: string
  // Une classe de badge d'index.css : la couleur dit le statut, le libellé le nomme.
  badge: 'badge-ok' | 'badge-warning' | 'badge-danger'
  // Ce que l'état veut dire pour qui regarde la facture, et ce qu'il permet.
  explication: string
}

export const ETATS_TRANSMISSION: Record<EtatTransmission, InfoEtat> = {
  envoi: {
    libelle: 'Issue inconnue',
    badge: 'badge-warning',
    explication: 'Elle est partie sans réponse lisible : la plateforme l’a peut-être reçue. Elle ne repart pas tant que '
      + 'ce n’est pas tranché — la renvoyer pourrait la transmettre deux fois.',
  },
  depose: {
    libelle: 'Déposée',
    badge: 'badge-warning',
    explication: 'La plateforme l’a reçue ; son accusé dira si elle l’accepte.',
  },
  accepte: {
    libelle: 'Acceptée',
    badge: 'badge-ok',
    explication: 'La plateforme l’a acceptée.',
  },
  rejete: {
    libelle: 'Rejetée',
    badge: 'badge-danger',
    explication: 'La plateforme l’a rejetée, et dit pourquoi. Elle ne repart pas : elle s’annule par un avoir interne, '
      + `qui ne se transmet pas, puis une nouvelle facture (${REGLE_AVOIR_INTERNE}).`,
  },
  echec: {
    libelle: 'Refusée au dépôt',
    badge: 'badge-danger',
    explication: 'La plateforme a refusé le dépôt : rien n’est parti.',
  },
}

export function libelleCanal(t: Pick<TransmissionFacture, 'canal' | 'hote'>): string {
  return t.canal === 'superpdp' ? 'Super PDP' : `la plateforme du client (${t.hote})`
}

// Pour un badge, court : « Plateforme du client », « Super PDP ».
export function libelleCourtCanal(t: Pick<TransmissionFacture, 'canal'>): string {
  return t.canal === 'superpdp' ? 'Super PDP' : 'Plateforme du client'
}

const instant = (t: Pick<TransmissionFacture, 'cree_le'>) => Date.parse(t.cree_le)

// Le délai avant qu'une transmission sans issue connue s'abandonne : celui que la base exige (`abandonner_transmission`)
// et que le suivi de plateforme-agreee observe — le dépôt part sous vingt-cinq secondes, et une facture transmise deux
// fois coûte plus qu'une attente.
export const DELAI_AVANT_ABANDON_MS = 15 * 60 * 1000

// Une transmission partie sans issue connue, depuis plus que ce délai : le cabinet peut l'abandonner, vérification faite
// sur la plateforme. Un instant illisible ne s'abandonne pas — la base, elle, en juge sur le sien.
export function abandonnable(t: Pick<TransmissionFacture, 'etat' | 'cree_le'>, maintenantMs: number): boolean {
  const depart = instant(t)
  return t.etat === 'envoi' && Number.isFinite(depart) && maintenantMs - depart > DELAI_AVANT_ABANDON_MS
}

// Les transmissions d'une facture, de la plus récente à la plus ancienne ; à instant égal, dans l'ordre de leurs
// identifiants, pour qu'un même jeu se lise toujours dans le même ordre.
export function transmissionsDe(toutes: TransmissionFacture[], factureId: string): TransmissionFacture[] {
  return toutes
    .filter((t) => t.facture_id === factureId)
    .sort((a, b) => instant(b) - instant(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// La transmission qui dit où en est une facture : l'active s'il y en a une — la base n'en admet qu'une —, sinon la plus
// récente ; nulle pour une facture qui n'est jamais partie.
export function transmissionCourante(toutes: TransmissionFacture[], factureId: string): TransmissionFacture | null {
  const siennes = transmissionsDe(toutes, factureId)
  return siennes.find(estActive) ?? siennes[0] ?? null
}
