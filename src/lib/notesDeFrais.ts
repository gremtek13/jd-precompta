// LES NOTES DE FRAIS, EN BASE (ligne 51.5, partie B, étape B7 ; migration `notes_de_frais`, PRÉPARÉE le 11/11/2026 :
// supabase/preparees/20261111238000_notes_de_frais.sql ; l'essai : supabase/essais/notesDeFrais.sql). MEG2-Q6 : chaque accès
// « Notes de frais » saisit les siennes, l'accès « Achats » — le dirigeant — les approuve et les rembourse, un salarié sans
// accès est saisi par le dirigeant ; MEG2-Q7 : la note d'un salarié au compte du personnel, 421000 par défaut, un rôle du
// plan comptable réglable par dossier ; MEG2-Q8 : ses kilomètres au barème fiscal, un dépassement signalé, rien de calculé en
// paie. Ce module redit, sous les mêmes mots et dans le même ordre, ce que `enregistrer_note_de_frais` refuse — pour que
// l'écran (étape B8) le dise AVANT le clic, sur la saisie telle qu'elle part —, calcule le montant des kilomètres que la base
// VÉRIFIE (au barème de lib/baremeKilometrique.ts, que baremeKilometrique.test.ts confronte à celui de la base, jamais une
// copie) et dit le dépassement de la première tranche. Il ne lit ni n'écrit rien : les écrans passeront par les six
// fonctions seules. notesDeFrais.test.ts le confronte au texte de la migration et à l'essai.

import { baremeDeLAnnee, indemniteKilometriqueCentimes, type TypeVehicule } from './baremeKilometrique'
import type { DefinitionRoleComptable } from './planComptable'

/** La migration est-elle en base ? Baissé tant qu'elle n'est que préparée : aucun écran ne lit sa table ni n'appelle ses
 *  fonctions, et sa table reste hors du plan de sauvegarde (sauvegarde.ts, `auPlanDesNotesDeFrais`). */
export const NOTES_DE_FRAIS_PREVUES: boolean = false

/** La table de la migration. */
export const TABLES_DES_NOTES_DE_FRAIS = ['notes_de_frais'] as const

/** La nature d'une dépense : une liste fermée (la contrainte `notes_de_frais_nature`). */
export const NATURES_DE_FRAIS = [
  'repas', 'hebergement', 'transport', 'carburant', 'peage_stationnement', 'fournitures', 'kilometres', 'autre',
] as const
export type NatureDeFrais = (typeof NATURES_DE_FRAIS)[number]

/** Les états d'une note (la contrainte `notes_de_frais_etat_connu`) ; « retirée » est un brouillon abandonné. */
export const ETATS_DES_NOTES = ['brouillon', 'soumise', 'approuvee', 'refusee', 'remboursee', 'retiree'] as const
export type EtatDeNote = (typeof ETATS_DES_NOTES)[number]

/** Le moyen d'un remboursement déclaré (la contrainte `notes_de_frais_moyen`) : « paie », avec la paie. */
export const MOYENS_DE_REMBOURSEMENT = ['virement', 'cheque', 'especes', 'paie', 'autre'] as const
export type MoyenDeRemboursement = (typeof MOYENS_DE_REMBOURSEMENT)[number]

/** Les types de véhicule d'une note de kilomètres : ceux du barème. */
export const TYPES_DE_VEHICULE: readonly TypeVehicule[] = ['voiture', 'moto', 'cyclomoteur']

/** Le rôle du personnel que la migration ajoute au catalogue des rôles comptables (MEG2-Q7, B7-Q4). Il n'entre dans
 *  `ROLES_COMPTABLES` (lib/planComptable.ts) qu'avec l'écriture d'une note d'un salarié, après B8 : la base le porte, la
 *  lecture du plan ignore sans conséquence un rôle qu'elle ne connaît pas (`planDeLaReponse`). */
export const ROLE_DU_PERSONNEL: DefinitionRoleComptable = {
  role: 'personnel', racines: ['421', '4286'], compteDefaut: '421000', libelleDefaut: 'Personnel — rémunérations dues',
  prefixeAuxiliaireDefaut: null, ordre: 330,
}

/** Les mots des refus de la base, au caractère près (l'apostrophe droite de la migration). */
export const REFUS_DES_NOTES = {
  accesDossier: 'Accès refusé à ce dossier.',
  accesNote: 'Accès refusé à cette note de frais.',
  plusUnBrouillon: "Cette note de frais n'est plus un brouillon : elle ne se modifie plus.",
  version: "Cette note de frais a changé depuis sa lecture : la relire avant de l'écrire.",
  salarieSansAchats: "Seul un accès « Achats » saisit la note d'un salarié sans accès.",
  nomDuSalarie: "Le nom du salarié tient sur une ligne, d'un à cent vingt caractères, sans blanc en tête ni en fin.",
  date: "La date de la dépense est requise, entre le 1er janvier 2000 et aujourd'hui.",
  nature: 'La nature de la dépense est repas, hébergement, transport, carburant, péage et stationnement, fournitures, kilomètres ou autre.',
  motif: "Le motif tient sur une ligne, d'un à deux cents caractères.",
  distance: 'La distance est un nombre entier de kilomètres, de 1 à 100 000.',
  vehicule: 'Le véhicule se décrit par son type (voiture, moto ou cyclomoteur), sa puissance fiscale et sa motorisation, électrique ou non.',
  tvaDesKilometres: 'Des kilomètres ne portent pas de TVA.',
  justificatifDesKilometres: 'Des kilomètres ne citent pas de justificatif : la date, la distance et le motif les justifient.',
  baremeAbsent: (annee: number) => `Le barème kilométrique de ${annee} n'est pas en base pour ce véhicule : rien ne se calcule à sa place.`,
  montantDesKilometres: (annee: number) => `Le montant des kilomètres est celui du barème de ${annee} pour cette distance et ce véhicule.`,
  pasUnVehicule: 'Seuls des kilomètres décrivent une distance et un véhicule.',
  ttc: 'Le montant TTC est un nombre positif, au centime près.',
  tva: 'La TVA déclarée est positive ou nulle, au centime près, et moindre que le TTC.',
  justificatifDeLAuteur: "Le justificatif est une pièce que l'auteur de la note a déposée dans ce dossier.",
  justificatifValide: 'Ce justificatif est déjà validé par le cabinet : il ne justifie plus une note de frais.',
  justificatifCite: "Ce justificatif est déjà celui d'une autre note de frais.",
  sansJustificatif: 'Une note de frais se soumet avec son justificatif.',
  baremeChange: (annee: number) => `Le barème kilométrique de ${annee} a changé depuis l'enregistrement de la note : l'enregistrer de nouveau.`,
  retraitSoumise: 'Seul un brouillon se retire : une note soumise reste.',
  pasSoumise: "Seule une note soumise s'approuve ou se refuse.",
  pasApprouvee: 'Seule une note approuvée se rembourse.',
  motifDuRefus: "Le motif du refus tient sur une ligne, d'un à deux cents caractères.",
  dateDuRemboursement: "La date du remboursement est requise, entre la date de la dépense et aujourd'hui.",
  moyenDuRemboursement: 'Le moyen du remboursement est virement, chèque, espèces, avec la paie ou autre.',
} as const

/** Le véhicule d'une note de kilomètres, tel que la note le décrit. */
export interface VehiculeDeLaNote {
  type: TypeVehicule
  puissanceFiscale: number
  electrique: boolean
}

/** L'indemnité d'une note de kilomètres, EN CENTIMES : le barème de l'année de la dépense appliqué à SA distance (B7-Q3),
 *  en entiers comme `indemnite_kilometrique_centimes`, ou null quand le barème de l'année manque pour ce véhicule — jamais
 *  celui d'une autre année. */
export function centimesDesKilometres(dateDepense: string, distanceKm: number, vehicule: VehiculeDeLaNote): bigint | null {
  const annee = Number(dateDepense.slice(0, 4))
  return indemniteKilometriqueCentimes(
    { type: vehicule.type, puissanceFiscale: vehicule.puissanceFiscale, kmProfessionnel: distanceKm, electrique: vehicule.electrique },
    annee,
  )
}

/** La saisie d'un brouillon, telle qu'elle part vers `enregistrer_note_de_frais` (montants en euros, null pour l'absent). */
export interface SaisieDeNote {
  dateDepense: string | null
  nature: string | null
  motif: string | null
  montantTtc: number | null
  montantTva: number | null
  beneficiaireSalarie: string | null
  pieceId: string | null
  distanceKm: number | null
  vehicule: { type: string | null; puissanceFiscale: number | null; electrique: boolean | null } | null
}

/** Ce que l'écran sait du justificatif choisi, d'une liste lue en entier ; null quand il n'en choisit aucun. */
export interface EtatDuJustificatif {
  deposeParLAuteurDansCeDossier: boolean
  aValider: boolean
  citeParUneAutreNote: boolean
}

const auCentimePres = (m: number) => Math.abs(m * 100 - Math.round(m * 100)) < 1e-6
// `btrim` ne retire que les espaces : un autre blanc (une espace insécable) compte, comme en base.
const sansEspacesAuxBords = (t: string) => t.replace(/^ +| +$/g, '')
const uneLigne = (t: string, max: number) => sansEspacesAuxBords(t) !== '' && t.length <= max && !/\p{Cc}/u.test(t)

/**
 * Le premier refus de `enregistrer_note_de_frais` que la saisie rencontrerait, sous ses mots, ou null — dans l'ordre de la
 * fonction, après l'accès, la note existante et sa version, que l'écran juge sur ce qu'il a lu : le salarié (la case
 * « Achats »), la date (au jour de Paris), la nature, le motif, puis les kilomètres ou la dépense, puis le justificatif.
 */
export function refusDeLaSaisie(
  saisie: SaisieDeNote, contexte: { aujourdHui: string; achats: boolean; justificatif: EtatDuJustificatif | null },
): string | null {
  const R = REFUS_DES_NOTES
  if (saisie.beneficiaireSalarie !== null) {
    if (!contexte.achats) return R.salarieSansAchats
    const nom = saisie.beneficiaireSalarie
    if (nom !== sansEspacesAuxBords(nom) || nom === '' || nom.length > 120 || /\p{Cc}/u.test(nom)) return R.nomDuSalarie
  }
  const date = saisie.dateDepense
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > contexte.aujourdHui) return R.date
  if (saisie.nature === null || !(NATURES_DE_FRAIS as readonly string[]).includes(saisie.nature)) return R.nature
  if (saisie.motif === null || !uneLigne(saisie.motif, 200)) return R.motif
  const annee = Number(date.slice(0, 4))
  if (saisie.nature === 'kilometres') {
    const d = saisie.distanceKm
    if (d === null || !Number.isInteger(d) || d < 1 || d > 100_000) return R.distance
    const v = saisie.vehicule
    if (v === null || v.type === null || !(TYPES_DE_VEHICULE as readonly string[]).includes(v.type) || v.puissanceFiscale === null
      || !Number.isInteger(v.puissanceFiscale) || v.puissanceFiscale < 0 || v.puissanceFiscale > 99 || v.electrique === null) {
      return R.vehicule
    }
    if ((saisie.montantTva ?? 0) !== 0) return R.tvaDesKilometres
    if (saisie.pieceId !== null) return R.justificatifDesKilometres
    const centimes = centimesDesKilometres(date, d, { type: v.type as TypeVehicule, puissanceFiscale: v.puissanceFiscale, electrique: v.electrique })
    if (centimes === null) return R.baremeAbsent(annee)
    const m = saisie.montantTtc
    if (m === null || !auCentimePres(m) || BigInt(Math.round(m * 100)) !== centimes) return R.montantDesKilometres(annee)
  } else {
    if (saisie.distanceKm !== null || (saisie.vehicule !== null
      && (saisie.vehicule.type !== null || saisie.vehicule.puissanceFiscale !== null || saisie.vehicule.electrique !== null))) {
      return R.pasUnVehicule
    }
    const m = saisie.montantTtc
    if (m === null || !Number.isFinite(m) || m <= 0 || m > 9_999_999_999.99 || !auCentimePres(m)) return R.ttc
    const t = saisie.montantTva
    if (t !== null && (!Number.isFinite(t) || t < 0 || t >= m || !auCentimePres(t))) return R.tva
  }
  if (saisie.pieceId !== null) {
    const j = contexte.justificatif
    if (j === null || !j.deposeParLAuteurDansCeDossier) return R.justificatifDeLAuteur
    if (!j.aValider) return R.justificatifValide
    if (j.citeParUneAutreNote) return R.justificatifCite
  }
  return null
}

/**
 * Le cumul des kilomètres d'une année qui dépasse la PREMIÈRE tranche du barème de ce type de véhicule (5 000 km pour une
 * voiture, 3 000 pour un deux-roues, lus dans le barème de l'année) : chaque note est calculée au barème appliqué à SA
 * distance, ce qui vaut tant que le cumul reste dans la première tranche ; au-delà, la formule de la tranche suivante
 * s'applique au total, et le cabinet régularise — l'écran le SIGNALE (MEG2-Q8), rien ne se recalcule à sa place. Null
 * quand le barème de l'année manque.
 */
export function depassementDeLaPremiereTranche(annee: number, type: TypeVehicule, cumulKm: number): boolean | null {
  const bareme = baremeDeLAnnee(annee)
  const ligne = bareme?.lignes.find((l) => l.type === type)
  const borne = ligne?.tranches[0]?.jusqua
  if (borne === undefined || borne === null) return null
  return cumulKm > borne
}
