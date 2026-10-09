import { ecritureConforme, ecrituresSansPieceParMouvement, type LigneEcritureMouvement, type MouvementBancaire } from './affectationBanque'
import { libelleExploitable } from './appariementBanque'
import { refusEcritSurUnCompteDeBilan, refusPaieUneDeclarationTva } from './classementsDuMouvement'
import { COMPTE_BANQUE, COMPTE_COTISATIONS_EXPLOITANT, COMPTE_EXPLOITANT } from './comptes'
import { euroCommeLaBase, remplirModele } from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { CotisationDeclaree, EcritureBrouillon, ModeComptable } from './types'
import { estFigee } from './validationExercice'

// UNE ÉCHÉANCE DE COTISATION RAPPROCHÉE D'UN MOUVEMENT S'ÉCRIT (ligne 26.6 de la feuille de route,
// étape b).
//
// Le rapprochement ne posait que le lien : ni écriture au brouillon ni ligne au FEC, et le compte 512 de
// l'application ne retrouvait pas le prélèvement de l'Urssaf. La 2035 comptait la cotisation, à son
// échéance ; le FEC, rien.
//
// CE QUI S'ÉCRIT, à la date et dans le sens du mouvement : la cotisation au 646000 (cotisations sociales
// personnelles de l'exploitant), face à la banque. En TRÉSORERIE (BNC), la CSG-CRDS de l'échéance, quand
// elle est saisie, passe ENTIÈRE au 108000 (compte de l'exploitant) : c'est ce que fait l'expert-comptable
// du cabinet sur une 2035 déposée (CLAUDE.md, 22/09/2026) — la part déductible est réintroduite en BV hors
// comptabilité, la part non déductible n'apparaît nulle part. C'est aussi ce que fait déjà le moteur de la
// 2035 (`partCsgNonDeductible`), si bien que l'écriture et la déclaration disent la même chose. En
// ENGAGEMENT (BIC, IS), tout va au 646000 : la cotisation est une charge de l'entreprise, et la part non
// déductible d'un exploitant se réintègre sur la liasse, que l'application ne produit pas.
//
// UN PRÉLÈVEMENT PAIE UNE ÉCHÉANCE POSITIVE (un appel), UN ENCAISSEMENT REÇOIT UNE ÉCHÉANCE NÉGATIVE (un
// remboursement) — `sensCotisationCoherent`. L'écriture suit le sens du mouvement : un remboursement
// crédite le 646000, et le 108000 de sa CSG-CRDS.
//
// L'écriture est composée ICI (testée) ; la fonction SQL `rapprocher_cotisation` la VÉRIFIE ligne à ligne
// contre le mouvement, l'échéance et le modèle du dossier, puis l'écrit AVEC le rapprochement, dans une
// transaction (voir supabase/essais/cotisationRapprochee.sql).

const centimes = (n: number) => Math.round(n * 100)
const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

/** Le montant d'une échéance : le versement saisi, sinon l'appel. Son SIGNE dit ce qu'elle est. */
export function montantDeLEcheance(c: Pick<CotisationDeclaree, 'montant_verse' | 'montant_appele'>): number {
  return c.montant_verse ?? c.montant_appele
}

// La CSG-CRDS que l'écriture porte au 108000, en valeur absolue : celle de l'échéance en trésorerie, quand
// elle est saisie ; rien en engagement.
export function csgDeLEcriture(c: Pick<CotisationDeclaree, 'montant_csg_crds'>, mode: ModeComptable): number {
  return mode === 'tresorerie' && c.montant_csg_crds != null ? Math.abs(c.montant_csg_crds) : 0
}

export const REFUS_COTISATION_CLASSEE =
  'Ce mouvement est rapproché d’une pièce ou d’un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.'

// Pourquoi ce mouvement ne peut pas être rapproché de cette échéance, dit AVANT d'écrire. La base refait
// les mêmes refus, dans le même ordre (`rapprocher_cotisation`) — plus deux que l'écran ne peut pas dire
// d'ici : l'échéance déjà rapprochée d'un AUTRE mouvement (l'écran ne propose que celles qu'aucun ne paie)
// et l'écriture validée. Un mouvement déjà rapproché d'une échéance n'est pas refusé : un nouveau
// rapprochement remplace le précédent.
//
// UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL ne se paie pas aussi par un mouvement (lib/cotisationPersonnelle.ts) :
// la base le refuse au moment où le mouvement la désignerait — le déclencheur `garder_mouvement_paiement_personnel`,
// après tous les refus de la fonction —, d'où ce refus en dernier, sous ses mots.
export function refusRapprochementCotisation(
  ligne: MouvementBancaire,
  cotisation: Pick<CotisationDeclaree, 'montant_verse' | 'montant_appele' | 'montant_csg_crds' | 'paiement_personnel_le'>,
  mode: ModeComptable,
): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  const surUnCompteDeBilan = refusEcritSurUnCompteDeBilan(ligne)
  if (surUnCompteDeBilan) return surUnCompteDeBilan
  const paieUneDeclaration = refusPaieUneDeclarationTva(ligne)
  if (paieUneDeclaration) return paieUneDeclaration
  if (ligne.piece_id || ligne.categorie_id || ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) {
    return REFUS_COTISATION_CLASSEE
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  const montant = montantDeLEcheance(cotisation)
  if (montant === 0) return 'Une échéance de zéro euro ne se rapproche pas.'
  if (montant > 0 && ligne.montant > 0) {
    return 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d’une échéance négative.'
  }
  if (montant < 0 && ligne.montant < 0) {
    return 'Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.'
  }
  const csg = csgDeLEcriture(cotisation, mode)
  if (!auCentime(csg)) return 'La CSG-CRDS de cette échéance n’est pas au centime.'
  if (centimes(csg) > centimes(Math.abs(ligne.montant))) {
    return `La CSG-CRDS de cette échéance (${formatMoney(csg)}) dépasse le mouvement (${formatMoney(Math.abs(ligne.montant))}).`
  }
  if (cotisation.paiement_personnel_le) {
    return `Cette échéance est payée depuis le compte personnel, le ${formatDate(cotisation.paiement_personnel_le)} : un mouvement ne la paie pas aussi.`
  }
  return null
}

// CE QUI DÉCIDE QU'UN PAIEMENT DEPUIS LE COMPTE PERSONNEL PEUT S'ÉCRIRE, d'après les seuls montants de l'échéance et le
// modèle du dossier : les refus de `enregistrer_paiement_personnel_cotisation` qui ne tiennent qu'à eux, sous ses mots
// et dans son ordre. Ils vivent ici, et non dans lib/cotisationPersonnelle.ts qui les reprend à leur rang, parce que
// `cotisationsComptees` en a besoin : un paiement qui ne PEUT pas s'écrire ne date rien, comme un rapprochement.
export const REFUS_MONTANTS_PAIEMENT_PERSONNEL = [
  { cle: 'echeance_nulle', modele: "Une échéance de zéro euro n'a rien à payer." },
  { cle: 'montant_centime', modele: "Le montant de cette échéance n'est pas au centime." },
  { cle: 'csg_centime', modele: "La CSG-CRDS de cette échéance n'est pas au centime." },
  { cle: 'csg_depasse', modele: 'La CSG-CRDS de cette échéance (% €) dépasse son montant (% €).' },
] as const

export type CleRefusMontantsPaiementPersonnel = (typeof REFUS_MONTANTS_PAIEMENT_PERSONNEL)[number]['cle']

export interface RefusMontantsPaiementPersonnel {
  cle: CleRefusMontantsPaiementPersonnel
  message: string
}

// Le montant de l'échéance (le versement saisi, sinon l'appel) ; en trésorerie, sa CSG-CRDS, qui ne peut pas le
// dépasser — sa part au 646000 serait négative. Les montants se comparent en CENTIMES ENTIERS, comme la base.
export function refusMontantsDuPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'montant_verse' | 'montant_appele' | 'montant_csg_crds'>,
  mode: ModeComptable,
): RefusMontantsPaiementPersonnel | null {
  const refus = (cle: CleRefusMontantsPaiementPersonnel, ...valeurs: string[]): RefusMontantsPaiementPersonnel => ({
    cle, message: remplirModele(REFUS_MONTANTS_PAIEMENT_PERSONNEL.find((r) => r.cle === cle)!.modele, valeurs),
  })
  const montant = montantDeLEcheance(cotisation)
  if (montant === 0) return refus('echeance_nulle')
  if (!auCentime(montant)) return refus('montant_centime')
  const csg = csgDeLEcriture(cotisation, mode)
  if (!auCentime(csg)) return refus('csg_centime')
  if (centimes(csg) > centimes(Math.abs(montant))) {
    return refus('csg_depasse', euroCommeLaBase(centimes(csg)), euroCommeLaBase(centimes(Math.abs(montant))))
  }
  return null
}

// L'écriture d'une échéance rapprochée, une ligne par compte NON NUL : la base ne compte pas une ligne à
// zéro euro (une échéance faite toute de CSG-CRDS) et refuse l'écriture qui en porterait une. LE SENS
// VIENT DU SIGNE DU MOUVEMENT : un prélèvement débite le 646000 et crédite la banque, un remboursement
// l'inverse. Calculée en centimes, pour que les lignes s'équilibrent exactement.
export function ecritureDeLaCotisation(
  ligne: MouvementBancaire,
  cotisation: Pick<CotisationDeclaree, 'montant_csg_crds'>,
  mode: ModeComptable,
): LigneEcritureMouvement[] {
  const libelle = libelleExploitable(ligne) || ligne.libelle
  const total = centimes(Math.abs(ligne.montant))
  const csg = centimes(csgDeLEcriture(cotisation, mode))
  const sortie = ligne.montant < 0
  const sensCompte = sortie ? 'debit' : 'credit'
  const lignes: LigneEcritureMouvement[] = [
    { compte: COMPTE_BANQUE, sens: sortie ? 'credit' : 'debit', montant: total / 100, libelle },
    { compte: COMPTE_COTISATIONS_EXPLOITANT, sens: sensCompte, montant: (total - csg) / 100, libelle },
    { compte: COMPTE_EXPLOITANT, sens: sensCompte, montant: csg / 100, libelle },
  ]
  return lignes.filter((l) => l.montant > 0)
}

export interface CotisationComptee {
  cotisation: CotisationDeclaree
  // La date à laquelle elle compte : celle du mouvement qui la paie, sinon son échéance.
  date: string
  // Ce qu'elle pèse en charge, SIGNÉ : un paiement positif, un remboursement négatif.
  montant: number
  // Sa CSG-CRDS, dans le même sens que `montant` ; nulle quand elle n'est pas saisie — inconnue, surtout
  // pas zéro (voir `partCsgNonDeductible`).
  csgCrds: number | null
  // Le mouvement qui la paie, quand le rapprochement le connaît et qu'il s'écrit.
  ligne: MouvementBancaire | null
  // Le jour de son paiement depuis le compte personnel (lib/cotisationPersonnelle.ts), quand c'est lui qui la date —
  // donc quand il peut s'écrire. Jamais avec `ligne` : une échéance se paie par l'un ou par l'autre.
  paiementPersonnel: string | null
  // Pourquoi son rapprochement, ou son paiement depuis le compte personnel, ne s'écrit pas, quand elle en a un qui ne
  // le peut pas : elle reste alors comptée à son échéance, et la concordance de la 2035 le dit au lieu de la croire
  // sans paiement.
  refus: string | null
}

// LA DATE ET LE MONTANT AUXQUELS UNE ÉCHÉANCE COMPTE — pour la 2035, la situation intermédiaire et
// l'estimation, qui ne doivent pas le décider chacune de leur côté.
//
// PAYÉE PAR UN MOUVEMENT RAPPROCHÉ, elle compte à la date de ce mouvement et pour son montant : le
// bénéfice non commercial se détermine sur les dépenses PAYÉES (CGI, art. 93), et c'est la date et le
// montant de l'écriture, donc du FEC. Une échéance de décembre prélevée en janvier compte l'année du
// prélèvement — la 2035 et le FEC disent enfin la même année. Sa CSG-CRDS reste celle saisie sur
// l'échéance, dans le sens du paiement.
//
// PAYÉE DEPUIS LE COMPTE PERSONNEL DE L'EXPLOITANT (lib/cotisationPersonnelle.ts), elle compte au jour de ce paiement,
// pour son montant — le versement saisi, sinon l'appel : c'est la date et le montant de son écriture, face au compte du
// dirigeant. Sa CSG-CRDS est celle saisie, dans le sens du paiement, comme pour un prélèvement.
//
// SANS MOUVEMENT NI PAIEMENT PERSONNEL, elle compte à son échéance, pour le versement saisi ou à défaut l'appel — la
// règle d'avant, qui reste une SUPPOSITION : une échéance que personne n'a rapprochée n'est pas une échéance
// impayée. Et un rapprochement qui ne PEUT pas s'écrire (un encaissement sur un appel, un mouvement de
// zéro euro, une CSG-CRDS qui dépasse le mouvement) ne date rien : l'échéance reste comptée à son
// échéance, et la Checklist dit pourquoi (`rapprochementsCotisationRefuses`). Un paiement personnel qui ne peut pas
// s'écrire non plus (`refusMontantsDuPaiementPersonnel`) — la base l'a vérifié en le posant et fige ensuite les
// montants de l'échéance, mais une sauvegarde restaurée n'a pas eu ce juge.
//
// Le mode comptable est un paramètre OBLIGATOIRE : il décide si la CSG-CRDS passe au 108000, donc si une
// CSG-CRDS qui dépasse le mouvement empêche l'écriture. Seul le MODE compte ici, pas le compte des notes de
// frais : la base le lit de même (`rapprocher_cotisation`).
export function cotisationsComptees(
  cotisations: readonly CotisationDeclaree[],
  lignes: readonly MouvementBancaire[],
  mode: ModeComptable,
): CotisationComptee[] {
  const parCotisation = new Map<string, MouvementBancaire>()
  for (const l of lignes) {
    if (l.statut === 'rapprochee' && l.cotisation_id) parCotisation.set(l.cotisation_id, l)
  }
  return cotisations.map((cotisation) => {
    const ligne = parCotisation.get(cotisation.id)
    const refus = ligne ? refusRapprochementCotisation(ligne, cotisation, mode) : null
    if (ligne && !refus) {
      const montant = -ligne.montant
      const csgCrds = cotisation.montant_csg_crds == null ? null : Math.sign(montant) * Math.abs(cotisation.montant_csg_crds)
      return { cotisation, date: ligne.date, montant, csgCrds, ligne, paiementPersonnel: null, refus: null }
    }
    const paiement = !ligne ? cotisation.paiement_personnel_le ?? null : null
    const refusPersonnel = paiement ? refusMontantsDuPaiementPersonnel(cotisation, mode) : null
    if (paiement && !refusPersonnel) {
      const montant = montantDeLEcheance(cotisation)
      const csgCrds = cotisation.montant_csg_crds == null ? null : Math.sign(montant) * Math.abs(cotisation.montant_csg_crds)
      return { cotisation, date: paiement, montant, csgCrds, ligne: null, paiementPersonnel: paiement, refus: null }
    }
    return {
      cotisation, date: cotisation.echeance, montant: montantDeLEcheance(cotisation),
      csgCrds: cotisation.montant_csg_crds, ligne: null, paiementPersonnel: null, refus: refus ?? refusPersonnel?.message ?? null,
    }
  })
}

// L'échéance compte-t-elle à son échéance, faute de paiement connu qui la date ? Ni un prélèvement rapproché qui
// s'écrit, ni un paiement depuis le compte personnel qui s'écrit : c'est la SUPPOSITION que Clôture liste.
export function compteeASonEcheance(c: Pick<CotisationComptee, 'ligne' | 'paiementPersonnel'>): boolean {
  return c.ligne === null && c.paiementPersonnel === null
}

export interface RapprochementCotisation<L extends MouvementBancaire = MouvementBancaire> {
  ligne: L
  cotisation: CotisationDeclaree
}

// Les mouvements rapprochés d'une échéance LUE, avec elle. Une échéance absente de la liste fournie (une
// lecture partielle, que l'écran signale) écarte le mouvement : on n'écrit pas ce qu'on n'a pas lu.
function rapprochementsDeCotisation<L extends MouvementBancaire>(
  lignes: readonly L[],
  cotisations: readonly CotisationDeclaree[],
): RapprochementCotisation<L>[] {
  const parId = new Map(cotisations.map((c) => [c.id, c]))
  const rapprochements: RapprochementCotisation<L>[] = []
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.cotisation_id) continue
    const cotisation = parId.get(ligne.cotisation_id)
    if (cotisation) rapprochements.push({ ligne, cotisation })
  }
  return rapprochements
}

// LES ÉCHÉANCES PAYÉES À ÉCRIRE : rapprochées d'un mouvement, et dont l'écriture n'est pas celle que le
// rapprochement produirait aujourd'hui. Le cas réel est l'écriture ABSENTE — une échéance rapprochée avant
// le 01/10/2026, quand le rapprochement n'écrivait rien : elle manque au FEC et à la trésorerie, et rien
// ne le dit. Le reste — un autre compte, un autre montant, un autre sens, une autre date — vient d'une
// CSG-CRDS saisie ou corrigée sur l'échéance APRÈS le rapprochement, ou d'un autre chemin : « Écrire »
// rejoue le rapprochement, et la base remplace l'écriture.
//
// Un rapprochement qui ne PEUT pas s'écrire n'est pas rendu : « Écrire » échouerait. Il est rendu à part,
// avec sa raison (`rapprochementsCotisationRefuses`).
//
// NI UN PAIEMENT D'UN EXERCICE FIGÉ PAR LA VALIDATION : la base n'y écrit plus (« aucune écriture ne s'y passe
// plus »), et le compter dans « Écrire les N » proposerait un geste voué à l'échec — dans la Checklist, un point que
// rien ne lève. Une échéance compte à la date du mouvement qui la paie : c'est elle qui dit l'exercice. Sans valeur
// par défaut : passer `null` revient à tout comparer, ce que fait l'écran qui MONTRE l'état de chaque échéance.
export function cotisationsAEcrire<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  cotisations: readonly CotisationDeclaree[],
  mode: ModeComptable,
  frontiere: string | null,
): RapprochementCotisation<L>[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return rapprochementsDeCotisation(lignes, cotisations).filter(({ ligne, cotisation }) =>
    !estFigee(ligne.date, frontiere)
    && !refusRapprochementCotisation(ligne, cotisation, mode)
    && !ecritureConforme(parLigne.get(ligne.id) ?? [], ecritureDeLaCotisation(ligne, cotisation, mode), ligne.date))
}

export interface RapprochementCotisationRefuse<L extends MouvementBancaire = MouvementBancaire> extends RapprochementCotisation<L> {
  raison: string
}

// LES RAPPROCHEMENTS QUI NE S'ÉCRIVENT PAS — posés avant que le rapprochement s'écrive, quand l'écran
// proposait une échéance sans regarder le sens : un encaissement rapproché d'un appel (mesuré le
// 01/10/2026 : deux, dans un bac à sable), un mouvement de zéro euro, ou une CSG-CRDS saisie depuis, qui
// dépasse le mouvement. Ils ne datent rien (`cotisationsComptees`) et n'ont pas d'écriture : le geste est
// d'annuler le rapprochement, ou de corriger l'échéance.
//
// Rien d'un exercice figé par la validation : le mouvement ne change plus, ni l'échéance qu'il paie — aucun des deux
// gestes n'y est plus possible, et le dire serait réclamer ce que la base refuse.
export function rapprochementsCotisationRefuses<L extends MouvementBancaire>(
  lignes: readonly L[],
  cotisations: readonly CotisationDeclaree[],
  mode: ModeComptable,
  frontiere: string | null,
): RapprochementCotisationRefuse<L>[] {
  return rapprochementsDeCotisation(lignes, cotisations).flatMap(({ ligne, cotisation }) => {
    if (estFigee(ligne.date, frontiere)) return []
    const raison = refusRapprochementCotisation(ligne, cotisation, mode)
    return raison ? [{ ligne, cotisation, raison }] : []
  })
}

// CE QUE LE RETRAIT D'UNE ÉCHÉANCE DÉFAIT, dit dans sa confirmation — une confirmation nomme ce qu'on perd.
// `supprimer_echeance_cotisation` remet à traiter le mouvement qui la paie et retire son écriture, dans la
// même transaction. Le mouvement est nommé quand on le connaît ; sur une lecture partielle du relevé, on
// ne sait pas s'il y en a un, et la phrase le dit au conditionnel plutôt que d'affirmer « aucun ».
export function avertissementRetraitEcheance(
  paiement: Pick<MouvementBancaire, 'date' | 'montant'> | null,
  releveLuEnEntier: boolean,
): string {
  if (paiement) {
    const nature = paiement.montant > 0 ? 'Le remboursement' : 'Le prélèvement'
    return `${nature} du ${formatDate(paiement.date)} (${formatMoney(Math.abs(paiement.montant))}) qui la paie redevient à traiter, et son écriture est retirée du brouillon.`
  }
  if (!releveLuEnEntier) return 'Si un mouvement bancaire la paie, il redevient à traiter, et son écriture est retirée du brouillon.'
  return 'Aucun mouvement bancaire ne la paie.'
}
