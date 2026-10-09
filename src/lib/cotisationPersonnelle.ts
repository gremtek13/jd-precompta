import { ecritureConforme, type LigneEcritureMouvement } from './affectationBanque'
import { COMPTE_COTISATIONS_EXPLOITANT } from './comptes'
import {
  csgDeLEcriture, montantDeLEcheance, REFUS_MONTANTS_PAIEMENT_PERSONNEL, refusMontantsDuPaiementPersonnel,
} from './cotisationRapprochee'
import type { ModeleComptable } from './engagement'
import { remplirModele } from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import type { CotisationDeclaree, EcritureBrouillon, LigneBancaire } from './types'
import { dateFigee, estFigee, frontiereDeValidation } from './validationExercice'
import { compteDuDirigeant } from './virementPersonnel'

// UNE ÉCHÉANCE DE COTISATION PAYÉE DEPUIS LE COMPTE PERSONNEL DE L'EXPLOITANT S'ÉCRIT (ligne 26.6 de la feuille de route).
//
// Rapprochée d'un prélèvement, une échéance s'écrit face à la banque (lib/cotisationRapprochee.ts). Payée de la poche de
// l'exploitant, elle n'avait ni mouvement ni écriture : la 2035 la comptait à son échéance, le FEC nulle part, et la
// concordance la disait en écart — son exercice ne se validait pas, sans geste pour le lever.
//
// CE QUE LE DIRIGEANT PAIE DE SA POCHE POUR SON ACTIVITÉ EST UN APPORT, comme une note de frais : l'échéance s'écrit face
// au COMPTE DU DIRIGEANT (`compteDuDirigeant`) au lieu de la banque — le 108000 de l'exploitant en trésorerie ; en
// engagement, le compte choisi pour le dirigeant (455, 108 ou 467), celui de ses notes de frais et de ses virements
// personnels : deux comptes pour la même personne partageraient ce qu'on lui doit. La ventilation est celle d'une
// échéance rapprochée — la cotisation au 646000, la CSG-CRDS au 108000 en trésorerie — ; mais en trésorerie le compte du
// dirigeant EST le 108000, et la CSG-CRDS qu'il prend au débit se compense avec l'apport qu'il reçoit au crédit : l'écriture
// garde leur solde, la cotisation hors CSG-CRDS au 646000 face au 108000. La 2035 dit la même chose (le moteur ôte la
// CSG-CRDS du 646000, `calculerDeclaration2035`), et la part déductible de la CSG entre en BV hors comptabilité. En
// ENGAGEMENT toute l'échéance va au 646000, face au compte du dirigeant : la cotisation est une charge de l'entreprise,
// qu'elle doit à son dirigeant qui l'a avancée — comme une note de frais.
//
// UNE ÉCRITURE, UNE DATE : celle du PAIEMENT, que le cabinet connaît et saisit — jamais proposée. La 2035 compte
// l'échéance ce jour-là (`cotisationsComptees` ; CGI, art. 93 : les dépenses PAYÉES).
//
// UNE ÉCHÉANCE SE PAIE PAR UN MOUVEMENT OU PAR LE COMPTE PERSONNEL, JAMAIS LES DEUX : le dire avant le clic ici et dans
// `refusRapprochementCotisation`, et la base le tient dans la fonction et par deux déclencheurs.
//
// La fonction SQL `enregistrer_paiement_personnel_cotisation` (SECURITY DEFINER) contrôle l'accès d'abord, refait le
// calcul en centimes entiers, compare l'écriture composée ICI et l'écrit avec le paiement, d'un seul tenant ; ses refus
// sont ceux de `REFUS_PAIEMENT_PERSONNEL`, dans son ordre et sous ses mots (cotisationPersonnelle.test.ts les confronte
// au texte de la migration et aux messages que l'essai a lus en base). Le RETRAIT (`retirer_paiement_personnel_cotisation`)
// suit la même règle.

// Les refus de `enregistrer_paiement_personnel_cotisation`, dans l'ordre de la fonction : chaque « % » reçoit la valeur
// que la base y met (`remplirModele`). Les quatre refus des montants sont ceux de lib/cotisationRapprochee.ts, à leur rang.
export const REFUS_PAIEMENT_PERSONNEL = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'echeance_introuvable', modele: 'Échéance introuvable dans ce dossier.' },
  { cle: 'deja_payee', modele: "Cette échéance est déjà payée depuis le compte personnel, le % : retire d'abord ce paiement." },
  { cle: 'rapprochee', modele: 'Cette échéance est rapprochée du mouvement du % : elle ne se paie pas aussi depuis le compte personnel.' },
  { cle: 'echeance_figee', modele: '% : cette échéance ne change plus.' },
  { cle: 'date_absente', modele: 'La date du paiement depuis le compte personnel est à renseigner.' },
  { cle: 'date_avant_2000', modele: "Un paiement ne se date pas avant l'an 2000." },
  { cle: 'date_future', modele: "Un paiement ne se date pas dans l'avenir : nous sommes le %." },
  { cle: 'date_figee', modele: "% : un paiement ne s'y déclare plus." },
  { cle: 'avant_ouverture', modele: "Ce paiement précède l'ouverture du dossier, le % : il est dans les comptes repris." },
  ...REFUS_MONTANTS_PAIEMENT_PERSONNEL,
  { cle: 'ecriture_illisible', modele: "L'écriture proposée est incomplète." },
  { cle: 'ecriture_differente', modele: "L'écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (%)." },
  // Après l'écriture : l'écriture conforme s'équilibre par construction, la fonction le revérifie quand même.
  { cle: 'desequilibre', modele: 'Écriture déséquilibrée : % au débit, % au crédit.' },
] as const

export type CleRefusPaiementPersonnel = (typeof REFUS_PAIEMENT_PERSONNEL)[number]['cle']

export interface RefusPaiementPersonnel {
  cle: CleRefusPaiementPersonnel
  message: string
}

function refus(cle: CleRefusPaiementPersonnel, ...valeurs: string[]): RefusPaiementPersonnel {
  return { cle, message: remplirModele(REFUS_PAIEMENT_PERSONNEL.find((r) => r.cle === cle)!.modele, valeurs) }
}

// Ce que l'écran sait du dossier quand il propose de déclarer un paiement.
export interface ContextePaiementPersonnel {
  modele: ModeleComptable
  // Le mouvement qui paie déjà cette échéance, s'il y en a un — lu dans un relevé lu EN ENTIER : sur une lecture
  // partielle, l'écran ne propose rien (une lecture partielle ne commande aucune écriture).
  mouvement: Pick<LigneBancaire, 'date'> | null
  // Les exercices validés du dossier (`ExercicesValidesContext`) : ils figent ce qui précède leur 31 décembre.
  anneesValidees: readonly number[]
  // L'ouverture d'un dossier repris : la plus ancienne date de ses à-nouveaux, sinon rien.
  ouverture: string | null
  // Aujourd'hui À PARIS (`aujourdHuiAParis`) : la base lit la date ainsi.
  aujourdHui: string
}

const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/

// POURQUOI CETTE ÉCHÉANCE NE PEUT PAS ÊTRE DÉCLARÉE PAYÉE DEPUIS LE COMPTE PERSONNEL À CETTE DATE, dit AVANT le clic, dans
// l'ordre de la fonction et sous ses mots — sauf l'accès et l'échéance introuvable, que l'écran ne peut pas dire (il ne
// propose que les échéances qu'il a lues, du dossier qu'il montre), et l'écriture, qu'il compose lui-même
// (`ecritureDuPaiementPersonnel`). La date est un FAIT que le cabinet saisit : vide, elle est à renseigner.
export function refusPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds' | 'paiement_personnel_le'>,
  date: string | null,
  contexte: ContextePaiementPersonnel,
): RefusPaiementPersonnel | null {
  if (cotisation.paiement_personnel_le) return refus('deja_payee', formatDate(cotisation.paiement_personnel_le))
  if (contexte.mouvement) return refus('rapprochee', formatDate(contexte.mouvement.date))
  const frontiere = frontiereDeValidation(contexte.anneesValidees)
  if (estFigee(cotisation.echeance, frontiere)) return refus('echeance_figee', dateFigee(cotisation.echeance, contexte.anneesValidees)!)
  if (!date || !DATE_CIVILE.test(date)) return refus('date_absente')
  if (date < '2000-01-01') return refus('date_avant_2000')
  if (date > contexte.aujourdHui) return refus('date_future', formatDate(contexte.aujourdHui))
  if (estFigee(date, frontiere)) return refus('date_figee', dateFigee(date, contexte.anneesValidees)!)
  if (contexte.ouverture && date < contexte.ouverture) return refus('avant_ouverture', formatDate(contexte.ouverture))
  return refusMontantsDuPaiementPersonnel(cotisation, contexte.modele.mode)
}

const centimes = (n: number) => Math.round(n * 100)

// Le libellé de l'écriture, que le FEC reprend (EcritureLib) : l'échéance qu'elle paie, et d'où l'argent est venu.
export function libelleDuPaiementPersonnel(cotisation: Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse'>): string {
  return montantDeLEcheance(cotisation) < 0
    ? `Remboursement de cotisation, échéance du ${formatDate(cotisation.echeance)}, reçu sur le compte personnel`
    : `Cotisation, échéance du ${formatDate(cotisation.echeance)}, payée depuis le compte personnel`
}

// L'ÉCRITURE DU PAIEMENT, une ligne par compte NON NUL, en centimes pour qu'elle s'équilibre exactement : la cotisation
// hors CSG-CRDS au 646000 face au compte du dirigeant. LE SENS VIENT DU SIGNE DE L'ÉCHÉANCE : un appel débite le 646000
// et crédite le compte du dirigeant (un apport) ; un remboursement reçu sur le compte personnel les crédite et débite à
// l'inverse (un prélèvement). En trésorerie, une échéance faite toute de CSG-CRDS ne laisse rien à écrire : la base
// n'attend alors aucune ligne. C'est la composition que la base refait (`enregistrer_paiement_personnel_cotisation`) ;
// elle refuse toute autre.
export function ecritureDuPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds'>,
  modele: ModeleComptable,
): LigneEcritureMouvement[] {
  const montant = montantDeLEcheance(cotisation)
  const net = centimes(Math.abs(montant)) - centimes(csgDeLEcriture(cotisation, modele.mode))
  if (net <= 0) return []
  const appel = montant > 0
  const libelle = libelleDuPaiementPersonnel(cotisation)
  return [
    { compte: COMPTE_COTISATIONS_EXPLOITANT, sens: appel ? 'debit' : 'credit', montant: net / 100, libelle },
    { compte: compteDuDirigeant(modele), sens: appel ? 'credit' : 'debit', montant: net / 100, libelle },
  ]
}

// Ce que l'écran envoie à `enregistrer_paiement_personnel_cotisation` : le dossier annoncé (la fonction y contrôle l'accès
// avant de rien lire), l'échéance, la date saisie et l'écriture composée ici.
export function argumentsDeLaDeclaration(
  dossierId: string,
  cotisation: Pick<CotisationDeclaree, 'id' | 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds'>,
  date: string,
  modele: ModeleComptable,
): { p_dossier_id: string; p_cotisation_id: string; p_date_paiement: string; p_ecritures: LigneEcritureMouvement[] } {
  return {
    p_dossier_id: dossierId, p_cotisation_id: cotisation.id, p_date_paiement: date,
    p_ecritures: ecritureDuPaiementPersonnel(cotisation, modele),
  }
}

// LA CONFIRMATION NOMME CE QUI S'ÉCRIT : l'échéance, la date, ce que reçoit le brouillon, l'exercice où elle comptera — la
// 2035 de cette année en trésorerie ; en engagement la 2035 n'est pas produite, et la confirmation ne la promet pas —, et
// ce qui le défera.
export function confirmationPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds'>,
  date: string,
  modele: ModeleComptable,
): string {
  const montant = montantDeLEcheance(cotisation)
  const lignes = ecritureDuPaiementPersonnel(cotisation, modele)
  const quoi = montant < 0
    ? `Déclarer le remboursement de l'échéance du ${formatDate(cotisation.echeance)} (${formatMoney(Math.abs(montant))}) reçu sur le compte personnel de l'exploitant, le ${formatDate(date)}.`
    : `Déclarer l'échéance du ${formatDate(cotisation.echeance)} (${formatMoney(montant)}) payée depuis le compte personnel de l'exploitant, le ${formatDate(date)}.`
  const ecriture = lignes.length === 0
    ? 'Faite toute de CSG-CRDS, elle ne laisse rien à écrire au brouillon.'
    : `Le brouillon reçoit ${formatMoney(lignes[0].montant)} au ${lignes[0].sens === 'debit' ? 'débit' : 'crédit'} du ${lignes[0].compte}, face au ${lignes[1].compte}, à cette date.`
  const ou = modele.mode === 'tresorerie' ? `dans la 2035 de ${date.slice(0, 4)}` : `dans l'exercice ${date.slice(0, 4)}`
  return `${quoi} ${ecriture} L'échéance compte ce jour-là ${ou}. Ce paiement se retire tant que son exercice n’est pas validé.`
}

// LES PAIEMENTS PERSONNELS DONT L'ÉCRITURE EST À REPRENDRE : absente, ou qui n'est plus celle que le paiement produirait —
// ou qui ne peut pas s'écrire. La base écrit le paiement et l'écriture ensemble, fige les montants de l'échéance tant que
// le paiement tient, et ne laisse écrire, modifier ou retirer l'écriture qu'avec lui : ce contrôle est DÉFENSIF. Il voit
// ce qui viendrait d'une sauvegarde restaurée, de la porte de restauration du super-administrateur, ou d'un modèle
// comptable changé sur un brouillon vide (une échéance toute de CSG-CRDS n'a rien écrit en trésorerie, et en attend une
// écriture en engagement). Le geste est de retirer le paiement, puis de le déclarer de nouveau.
//
// Rien d'un exercice figé par la validation : son écriture ne se reprend plus. Sans valeur par défaut, comme les autres
// contrôles du brouillon. `ecritures` : tout le brouillon du dossier, lu en entier.
export interface PaiementPersonnelAReprendre {
  cotisation: CotisationDeclaree
  raison: string
}

export const RAISON_ECRITURE_A_REPRENDRE =
  "Son écriture manque ou ne suit plus l'échéance : retire le paiement, puis déclare-le de nouveau."

export function paiementsPersonnelsAReprendre(
  ecritures: readonly EcritureBrouillon[],
  cotisations: readonly CotisationDeclaree[],
  modele: ModeleComptable,
  frontiere: string | null,
): PaiementPersonnelAReprendre[] {
  const parCotisation = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.cotisation_id) continue
    parCotisation.set(e.cotisation_id, [...(parCotisation.get(e.cotisation_id) ?? []), e])
  }
  return cotisations.flatMap((cotisation) => {
    const date = cotisation.paiement_personnel_le
    if (!date || estFigee(date, frontiere)) return []
    const montants = refusMontantsDuPaiementPersonnel(cotisation, modele.mode)
    if (montants) return [{ cotisation, raison: montants.message }]
    const presentes = parCotisation.get(cotisation.id) ?? []
    return ecritureConforme(presentes, ecritureDuPaiementPersonnel(cotisation, modele), date)
      ? []
      : [{ cotisation, raison: RAISON_ECRITURE_A_REPRENDRE }]
  })
}

// ── Le retrait ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Les refus de `retirer_paiement_personnel_cotisation`, dans son ordre et sous ses mots.
export const REFUS_RETRAIT_PAIEMENT_PERSONNEL = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'echeance_introuvable', modele: 'Échéance introuvable dans ce dossier.' },
  { cle: 'pas_payee', modele: "Cette échéance n'est pas payée depuis le compte personnel." },
  { cle: 'paiement_fige', modele: '% : ce paiement ne se retire plus.' },
  { cle: 'echeance_figee', modele: "% : sans ce paiement, l'échéance du % y compterait ; il ne se retire plus." },
] as const

export type CleRefusRetraitPaiementPersonnel = (typeof REFUS_RETRAIT_PAIEMENT_PERSONNEL)[number]['cle']

export interface RefusRetraitPaiementPersonnel {
  cle: CleRefusRetraitPaiementPersonnel
  message: string
}

// POURQUOI CE PAIEMENT NE SE RETIRE PAS, dit avant le clic : il n'y en a pas ; il tombe dans un exercice figé par la
// validation ; ou c'est l'ÉCHÉANCE qui y tombe — sans le paiement, elle y compterait de nouveau, et la 2035 validée ne le
// sait pas.
export function refusRetraitPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'echeance' | 'paiement_personnel_le'>,
  anneesValidees: readonly number[],
): RefusRetraitPaiementPersonnel | null {
  const fige = (cle: CleRefusRetraitPaiementPersonnel, ...valeurs: string[]): RefusRetraitPaiementPersonnel => ({
    cle, message: remplirModele(REFUS_RETRAIT_PAIEMENT_PERSONNEL.find((r) => r.cle === cle)!.modele, valeurs),
  })
  const date = cotisation.paiement_personnel_le
  if (!date) return fige('pas_payee')
  const frontiere = frontiereDeValidation(anneesValidees)
  if (estFigee(date, frontiere)) return fige('paiement_fige', dateFigee(date, anneesValidees)!)
  if (estFigee(cotisation.echeance, frontiere)) {
    return fige('echeance_figee', dateFigee(cotisation.echeance, anneesValidees)!, formatDate(cotisation.echeance))
  }
  return null
}

// LA CONFIRMATION DU RETRAIT NOMME CE QU'ON PERD : le paiement, son écriture, et la date à laquelle l'échéance comptera
// désormais — son échéance, une supposition, tant qu'aucun paiement ne la date.
export function avertissementRetraitPaiementPersonnel(
  cotisation: Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds' | 'paiement_personnel_le'>,
  modele: ModeleComptable,
): string {
  const lignes = ecritureDuPaiementPersonnel(cotisation, modele)
  const ecriture = lignes.length === 0
    ? 'Il n’avait rien écrit au brouillon.'
    : `Son écriture (${formatMoney(lignes[0].montant)} au ${lignes[0].compte}, face au ${lignes[1].compte}) est retirée du brouillon.`
  return `Le paiement du ${formatDate(cotisation.paiement_personnel_le ?? null)} depuis le compte personnel est retiré. ${ecriture} `
    + `L’échéance compte de nouveau à son échéance, le ${formatDate(cotisation.echeance)}, tant qu’aucun paiement ne la date.`
}

// Ce que la confirmation de la SUPPRESSION d'une échéance payée depuis le compte personnel ajoute : la clé est en
// cascade, son paiement et son écriture partent avec elle (`supprimer_echeance_cotisation`). Nul sans paiement.
export function avertissementSuppressionEcheancePayee(
  cotisation: Pick<CotisationDeclaree, 'paiement_personnel_le'>,
): string | null {
  return cotisation.paiement_personnel_le
    ? `Son paiement du ${formatDate(cotisation.paiement_personnel_le)} depuis le compte personnel part avec elle, et son écriture est retirée du brouillon.`
    : null
}
