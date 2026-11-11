import { REFUS_AVOIR_D_UNE_REPRISE } from './encaissementsDesReprises'
import { remplirModele } from './encaissementsFactures'
import { estUneFactureReprise } from './facturesReprises'
import { formatDate } from './format'
import { numeroDuModele } from './numerotationContinue'
import type { EspaceVentes } from './espaceVentes'
import type { SerieDeLaValidation } from './validationDeLaFacture'

// ── L'AVOIR D'UNE FACTURE REPRISE (étape A8c6, ligne 51.5) ────────────────────────────────────────────────────────────────
//
// Une facture reprise de l'ancien logiciel (`statut = 'importee'`, A8a) se corrige par un avoir de l'APPLICATION, un document
// neuf (A.3.4 de la conception d'A8 ; la migration `factures_reprises_encaissements`, A8b, en production depuis le
// 10/11/2026). `enregistrer_facture` l'accepte, et juge en plus d'un avoir d'hier, dans cet ordre, après « Un avoir ne précède
// pas la facture qu'il corrige » : la reprise qui mêle biens et services (A8B-Q1), puis la date de reprise des factures du
// dossier (A8-Q2) ; son plafond déduit aussi les avoirs REPRIS qui la citent (`factures_importees.origine_id`) ; son émetteur
// est celui que le dossier pose (A8B-Q2), et le cabinet le numérote dans la série de son mandataire (A9a).
//
// CE MODULE, PUR, dit ce que ce chemin demande de plus : ce que la lecture rend (lib/avoirDUneFactureRepriseLecture.ts), les
// deux refus aux mots de la base (lib/encaissementsDesReprises.ts, confrontés au texte exporté), ce que les autres avoirs ont
// crédité, et ce que la fenêtre dit avant le clic. `refusAvoir` (lib/factures.ts) et sa copie (lib/acomptesDesFactures.ts)
// l'appellent au même rang ; le drapeau `FACTURES_IMPORTEES_PREVUES` baissé, rien ne reconnaît une reprise
// (`estUneFactureReprise`) et ces fonctions rendent ce qu'elles rendaient.

/** Ce que l'avoir d'une facture reprise demande de lire, pour CETTE facture : jamais celui d'une autre. */
export type LectureDeLaRepriseDeLOrigine =
  | {
    etat: 'lue'
    factureId: string
    /** `dossiers.reprise_des_factures_le`, AAAA-MM-JJ ; nulle quand le dossier n'en a pas posé. */
    repriseLe: string | null
    /**
     * Ce que les avoirs repris qui citent la facture ont déjà crédité, en euros positifs ; nul quand la session ne les lit
     * pas (le client « Ventes » : `factures_importees` ne s'ouvre qu'au cabinet, et une lecture refusée y rendrait ZÉRO ligne,
     * qu'on prendrait pour « rien de crédité ») — la base juge alors seule du plafond.
     */
    crediteParLesRepris: number | null
  }
  | { etat: 'illisible'; factureId: string; motif: string }

export const RETENUE_REPRISE_EN_LECTURE = 'La facture est reprise de l’ancien logiciel : la date de reprise des factures du '
  + 'dossier et ses avoirs repris se lisent encore — l’avoir attend.'

export function retenueRepriseIllisible(motif: string): string {
  return `La facture est reprise de l’ancien logiciel, et ce que son avoir demande n’a pas pu être lu (${motif}) : l’avoir `
    + 'ne se crée pas sur ce qu’on ne sait pas. Réessaie.'
}

type OrigineDeLAvoir = { readonly id: string; readonly statut: string; readonly numero: string | null }

/**
 * Ce qui RETIENT l'avoir d'une facture reprise : sa lecture pas encore revenue, d'une autre facture, ou illisible. Null pour
 * toute autre facture, et pour une reprise lue.
 */
export function retenueDeLaReprise(origine: OrigineDeLAvoir, lecture: LectureDeLaRepriseDeLOrigine | null): string | null {
  if (!estUneFactureReprise(origine)) return null
  if (lecture === null || lecture.factureId !== origine.id) return RETENUE_REPRISE_EN_LECTURE
  return lecture.etat === 'illisible' ? retenueRepriseIllisible(lecture.motif) : null
}

const [MIXTE, AVANT_LA_REPRISE] = REFUS_AVOIR_D_UNE_REPRISE

/**
 * Les refus neufs d'`enregistrer_facture` pour l'avoir d'une facture reprise, à leur rang (après « Un avoir ne précède pas la
 * facture qu'il corrige »), sous ses mots : la reprise mixte, puis — la lecture revenue, sinon la retenue — la date de
 * reprise. Null pour toute autre facture.
 */
export function refusDeLaReprise(
  origine: OrigineDeLAvoir & { readonly nature_operation: string | null },
  dateEmission: string,
  lecture: LectureDeLaRepriseDeLOrigine | null,
): string | null {
  if (!estUneFactureReprise(origine)) return null
  if (origine.nature_operation === 'mixte') return remplirModele(MIXTE.modele, [origine.numero ?? ''])
  const retenue = retenueDeLaReprise(origine, lecture)
  if (retenue !== null || lecture?.etat !== 'lue') return retenue ?? RETENUE_REPRISE_EN_LECTURE
  // La base : `v_reprise is null or v_date_emission < v_reprise` ; `to_char` d'une date nulle ne dit rien.
  if (lecture.repriseLe === null || dateEmission < lecture.repriseLe) {
    return remplirModele(AVANT_LA_REPRISE.modele, [origine.numero ?? '', lecture.repriseLe === null ? '' : formatDate(lecture.repriseLe)])
  }
  return null
}

/**
 * Ce que les autres avoirs ont déjà crédité de la facture, comme la base le somme : ceux de l'application (`credite`,
 * lib/montantsFacture.ts:dejaCredite) et, d'une facture reprise, ses avoirs repris. Null dès qu'une part n'est pas sue : la
 * base juge alors seule du plafond, plutôt qu'un plafond calculé sur ce qu'on n'a pas lu.
 */
export function crediteDeLOrigine(
  origine: OrigineDeLAvoir,
  credite: number | null,
  lecture: LectureDeLaRepriseDeLOrigine | null,
): number | null {
  if (!estUneFactureReprise(origine)) return credite
  if (credite === null || lecture === null || lecture.factureId !== origine.id || lecture.etat !== 'lue') return null
  if (lecture.crediteParLesRepris === null) return null
  return (Math.round(credite * 100) + Math.round(lecture.crediteParLesRepris * 100)) / 100
}

/** Ce que la fenêtre dit quand ce que les autres avoirs ont crédité d'une reprise n'est pas su (l'espace client). */
export const CREDITE_D_UNE_REPRISE_INCONNU = 'Ce que les avoirs repris de l’ancien logiciel ont déjà crédité de cette facture '
  + 'ne se lit pas ici : la base refusera un avoir qui créditerait plus que ce qui reste.'

/** La série où la base numérotera l'avoir, en clair : son préfixe quand l'écran la connaît, sinon celle de qui valide. */
function laSerie(espace: EspaceVentes, serie: SerieDeLaValidation | null, annee: number): string {
  const qui = espace === 'cabinet' ? 'la série des avoirs du cabinet, mandataire du dossier' : 'ta série d’avoirs'
  if (serie === null) return qui
  return `${qui} (${numeroDuModele(serie.modele, annee, 1).split('-')[0]}-…)`
}

/**
 * Ce que la fenêtre de l'avoir dit AVANT LE CLIC sur une facture reprise : un document de l'application sur une facture de
 * l'ancien logiciel, la série qui le numérote (A9a : le cabinet, la série de son mandataire, MA par défaut ; le client, la
 * sienne), ce que sa validation fige (l'émetteur du dossier, A8B-Q2) et ce qu'elle juge (le plafond net des avoirs repris,
 * la date de reprise). Null pour toute autre facture.
 */
export function avisDeLAvoirDUneReprise(
  origine: OrigineDeLAvoir,
  espace: EspaceVentes,
  serie: SerieDeLaValidation | null,
  annee: number,
  lecture: LectureDeLaRepriseDeLOrigine | null,
): string | null {
  if (!estUneFactureReprise(origine)) return null
  const repriseLe = lecture?.etat === 'lue' && lecture.factureId === origine.id && lecture.repriseLe !== null
    ? ` (le ${formatDate(lecture.repriseLe)})` : ''
  return `La facture ${origine.numero ?? ''} est reprise de l’ancien logiciel : cet avoir est un document de l’application, `
    + `qui la corrige sans la rouvrir. Il se numérote dans ${laSerie(espace, serie, annee)}, et sa validation fige l’émetteur `
    + 'du dossier — son nom, son SIRET, son adresse —, son identité légale, ses paramètres de facturation et son RIB confirmé '
    + 'du jour : la facture reprise n’en porte aucun, son original reste dans l’ancien logiciel. Il crédite ce qui reste de '
    + `la facture, net de ses avoirs repris, et se date du jour de la reprise des factures${repriseLe} ou d’après.`
}

/** Le titre du bouton « Avoir » d'une facture reprise, dans la liste des factures. */
export const TITRE_AVOIR_D_UNE_REPRISE = 'Facture reprise de l’ancien logiciel : elle se corrige par un avoir de l’application, '
  + 'qui la cite par son numéro et sa date.'
