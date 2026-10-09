import { COMPTE_DOTATIONS_AMORTISSEMENTS } from './comptes'
import { anneeDe, jourDe, moisDe } from './format'
import { montantRetenu } from './montantRetenu'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation, Piece } from './types'
import { estFigee } from './validationExercice'

// LES DOTATIONS AUX AMORTISSEMENTS (ligne 26.6 de la feuille de route, étape b).
//
// La 2035 comptait la dotation d'un bien en case CH depuis le registre, et rien ne l'écrivait : ni 681100
// ni compte 28 au brouillon, donc rien au FEC — un vérificateur qui additionne le fichier ne retrouvait
// pas la déclaration. Elle s'écrit désormais, une écriture par bien et par exercice, au 31 décembre.
//
// LE CALCUL EST CELUI DE LA RÈGLE FISCALE : linéaire, PRORATA TEMPORIS depuis la MISE EN SERVICE, les jours
// comptés en mois de trente jours (30/360, la convention des amortissements linéaires). La première
// annuité d'un bien mis en service en cours d'année est réduite, et le reliquat se déduit une année de
// plus, après la durée. L'application comptait jusqu'ici l'annuité pleine dès l'année d'acquisition, et le
// disait (« à reprendre à la main avant de signer ») : l'écrire au FEC aurait gravé une dotation connue
// pour fausse. Sans date de mise en service saisie, l'amortissement part de la date d'acquisition.
//
// LE CUMUL S'ARRONDIT, PAS L'ANNUITÉ : l'amortissement cumulé au soir d'un jour vaut la valeur × les jours
// en service ÷ (360 × la durée), au centime, le demi-centime vers le haut, plafonné à la valeur ; la
// dotation d'un exercice est l'écart de deux cumuls. La somme des dotations fait donc EXACTEMENT la valeur,
// sans « dernière annuité qui rattrape les arrondis ».
//
// LE MÊME CALCUL QU'EN BASE, EN ENTIERS, ET C'EST CE QUI LE REND ÉCRIVABLE : `ecrire_dotation_amortissement`
// refait le calcul (`amortissement_cumule_centimes`) et REFUSE une écriture qui ne vaut pas sa dotation au
// centime. Un arrondi qui différerait d'un centime d'un côté ferait refuser une écriture juste, et personne
// ne comprendrait pourquoi. Les centimes sont donc des entiers (BigInt, comme le `bigint` de la base), et
// la parité est éprouvée par amortissements.test.ts sur une table relevée en base.

export type BienAmortissable = Pick<Immobilisation, 'valeur' | 'duree_annees' | 'date_acquisition' | 'date_mise_en_service'>

/** Le jour d'où part l'amortissement : la mise en service, sinon l'acquisition — la base fait de même. */
export function miseEnService(bien: Pick<Immobilisation, 'date_acquisition' | 'date_mise_en_service'>): string {
  return bien.date_mise_en_service ?? bien.date_acquisition
}

// Le rang d'un jour en mois de trente jours, le 31 compté comme le 30 — `rang_360` en base. Un 28 février
// est le 58e jour de l'année, un 1er mars le 61e : la convention saute le 29 et le 30 février.
export function rang360(date: string): number {
  return anneeDe(date) * 360 + (moisDe(date) - 1) * 30 + Math.min(jourDe(date), 30) - 1
}

const valeurEnCentimes = (bien: Pick<Immobilisation, 'valeur'>) => BigInt(Math.round(bien.valeur * 100))
const enEuros = (centimes: bigint) => Number(centimes) / 100

// L'amortissement cumulé au soir du jour de rang `rang`, en centimes : la valeur × les jours en service (le
// jour de mise en service compris) ÷ (360 × la durée), le demi-centime vers le haut, plafonné à la valeur.
// `amortissement_cumule_centimes` en base, au caractère près de la formule.
export function amortissementCumuleCentimes(bien: BienAmortissable, rang: number): bigint {
  const duree = BigInt(bien.duree_annees)
  const jours = BigInt(Math.min(Math.max(rang - rang360(miseEnService(bien)) + 1, 0), 360 * bien.duree_annees))
  return (2n * valeurEnCentimes(bien) * jours + 360n * duree) / (720n * duree)
}

/** La dotation d'un exercice, en euros : l'écart des cumuls au 31 décembre de l'exercice et du précédent. */
export function dotationDeLExercice(bien: BienAmortissable, annee: number): number {
  return enEuros(
    amortissementCumuleCentimes(bien, rang360(`${annee}-12-31`))
    - amortissementCumuleCentimes(bien, rang360(`${annee - 1}-12-31`)),
  )
}

// La dotation d'une PÉRIODE, bornes comprises : l'écart du cumul au soir de la fin et de celui de la veille
// du début. C'est ce que la situation intermédiaire compte (« du 1er janvier au … ») : une charge
// rapportée à sa période, sans rien supposer de l'année — une période à cheval sur deux exercices est juste
// elle aussi.
export function dotationSurPeriode(bien: BienAmortissable, debut: string, fin: string): number {
  if (fin < debut) return 0
  return enEuros(amortissementCumuleCentimes(bien, rang360(fin)) - amortissementCumuleCentimes(bien, rang360(debut) - 1))
}

export interface AnnuiteAmortissement {
  annee: number
  dotation: number
  /** L'amortissement cumulé au 31 décembre. */
  cumul: number
  /** Ce qui reste à amortir au 31 décembre. */
  valeurNette: number
}

// Le tableau d'amortissement d'un bien : de l'exercice de sa mise en service jusqu'à celui où le cumul
// atteint la valeur — la durée, plus l'exercice du reliquat quand la mise en service n'est pas un 1er
// janvier. Un exercice à dotation nulle au milieu reste dans le tableau (un bien de quelques centimes
// amorti sur cinq ans), puisque le tableau est le justificatif des dotations écrites.
export function planAmortissement(bien: BienAmortissable): AnnuiteAmortissement[] {
  const valeur = valeurEnCentimes(bien)
  const premiere = anneeDe(miseEnService(bien))
  const plan: AnnuiteAmortissement[] = []
  for (let annee = premiere; annee <= premiere + bien.duree_annees; annee++) {
    const cumul = amortissementCumuleCentimes(bien, rang360(`${annee}-12-31`))
    plan.push({ annee, dotation: dotationDeLExercice(bien, annee), cumul: enEuros(cumul), valeurNette: enEuros(valeur - cumul) })
    if (cumul >= valeur) break
  }
  return plan
}

// LE COMPTE D'AMORTISSEMENT D'UN COMPTE D'IMMOBILISATION : 28 suivi du compte sans son 2, « même ventilation que
// celle du compte 20 » ou « du compte 21 » (PCG, art. 1121-1, comptes 280 et 281), sans ses zéros de fin, qui ne font
// que regrouper (art. 1131-2), puis complété à six chiffres comme tous les comptes de l'application : 218300 → 281830,
// 205000 → 280500. Un sixième chiffre significatif se GARDE, et le compte en prend un septième : 218311 → 2818311. Il
// était tronqué (`28` et les chiffres 2 à 5), et 218310 comme 218311 rendaient 281831 : deux comptes de biens amortis
// sur un seul. Le même calcul que `compte_amortissement` en base, qui vérifie la dotation : amortissements.test.ts le
// confronte à une table relevée en base.
export function compteAmortissement(compteImmobilisation: string): string {
  return `28${compteImmobilisation.slice(1)}`.replace(/0+$/, '').padEnd(6, '0')
}

/** Le 31 décembre d'un exercice : la date de sa dotation. */
export const dateDeLaDotation = (annee: number) => `${annee}-12-31`

// CE QUE LA FACTURE D'UN BIEN ÉCRIT (lib/ecritures.ts, `piecesAComptabiliser`) : son ACQUISITION, au compte
// d'immobilisation de sa NATURE, non à celui de sa catégorie — ou rien, et pourquoi :
// - `sans_nature` : son compte n'est pas connu, et rien ne s'écrit avant qu'on la choisisse ;
// - `repris` : le bien est acquis AVANT l'ouverture d'un dossier repris (lib/aNouveaux.ts). La balance reprise
//   porte déjà sa valeur brute, en classe 2 : l'écrire encore la compterait deux fois. C'est la règle de ses
//   dotations d'avant l'ouverture (`dotationAEcrire`), pour la même raison. La date qui décide est celle du
//   REGISTRE — l'acquisition —, pas celle d'un paiement que le relevé de l'application ne porte pas.
// Un bien dont la facture a été supprimée (`piece_id` nul) n'a pas d'acquisition à écrire.
export type AcquisitionDuBien =
  | { compte: string; motif: null }
  | { compte: null; motif: 'sans_nature' | 'repris' }

/** Le bien est-il acquis avant l'ouverture du dossier — donc dans ses à-nouveaux ? */
export function bienRepris(bien: Pick<Immobilisation, 'date_acquisition'>, ouverture: string | null): boolean {
  return ouverture != null && bien.date_acquisition < ouverture
}

// La pièce de chaque bien du registre, et ce que sa facture écrit. `ouverture` : la date des à-nouveaux,
// nulle pour un dossier qui n'a pas été repris — sans valeur par défaut : oubliée, elle ferait écrire une
// seconde fois chaque bien que la balance reprise porte déjà.
export function acquisitionsDesBiens(
  immobilisations: readonly Pick<Immobilisation, 'piece_id' | 'nature_id' | 'date_acquisition'>[],
  natures: readonly Pick<NatureImmobilisation, 'id' | 'compte_immobilisation'>[],
  ouverture: string | null,
): Map<string, AcquisitionDuBien> {
  const compteParNature = new Map(natures.map((n) => [n.id, n.compte_immobilisation]))
  const acquisitions = new Map<string, AcquisitionDuBien>()
  for (const bien of immobilisations) {
    if (!bien.piece_id) continue
    if (bienRepris(bien, ouverture)) {
      acquisitions.set(bien.piece_id, { compte: null, motif: 'repris' })
      continue
    }
    const compte = (bien.nature_id ? compteParNature.get(bien.nature_id) : undefined) ?? null
    acquisitions.set(bien.piece_id, compte ? { compte, motif: null } : { compte: null, motif: 'sans_nature' })
  }
  return acquisitions
}

// LA VALEUR D'UN BIEN QUI NE SUIT PLUS SA FACTURE. L'acquisition s'écrit au montant de la FACTURE — le hors
// taxe pour un dossier assujetti, le TTC sinon (`montantRetenu`) —, les dotations sur la valeur du REGISTRE :
// quand les deux diffèrent, le compte du bien ne se recoupe plus avec son amortissement, et le FEC le montre
// à qui l'additionne. La valeur se saisit au montant retenu à l'enregistrement ; elle diverge quand on la
// modifie, ou quand la facture porte autre chose que le bien — elle s'écrit alors en entier sur le compte du
// bien, l'application n'ayant qu'une pièce par bien. Rend le montant de la facture quand il diffère au
// centime, nul sinon — et nul sans facture lue ou sans montant, qui n'ont rien à comparer. Nul aussi pour un
// bien REPRIS : son acquisition ne s'écrit pas (`acquisitionsDesBiens`), la balance reprise porte sa valeur.
export function montantDeFactureDifferent(
  bien: Pick<Immobilisation, 'valeur' | 'date_acquisition'>, facture: Pick<Piece, 'montant_ttc' | 'montant_ht' | 'montant_tva'> | undefined,
  assujettiTva: boolean, ouverture: string | null,
): number | null {
  if (bienRepris(bien, ouverture)) return null
  const montant = facture && facture.montant_ttc != null ? montantRetenu(facture, assujettiTva) : null
  if (montant == null) return null
  return Math.round(montant * 100) === Math.round(bien.valeur * 100) ? null : Math.round(montant * 100) / 100
}

// La dotation à ÉCRIRE pour un exercice : celle du calcul, sauf avant l'ouverture du dossier — ses
// à-nouveaux portent déjà l'amortissement cumulé des exercices repris, et l'écrire encore le compterait deux
// fois. La base fait le même refus (`ecrire_dotation_amortissement`).
export function dotationAEcrire(bien: BienAmortissable, annee: number, ouverture: string | null): number {
  if (ouverture && dateDeLaDotation(annee) < ouverture) return 0
  return dotationDeLExercice(bien, annee)
}

export interface LigneEcritureDotation {
  compte: string
  sens: 'debit' | 'credit'
  montant: number
  libelle: string
}

// L'écriture d'une dotation : le 681100 au débit, le compte d'amortissement du bien au crédit, au 31
// décembre. RIEN quand la dotation est nulle — l'appel à la base retire alors celle qui aurait été écrite.
export function ecritureDeLaDotation(
  bien: BienAmortissable & Pick<Immobilisation, 'libelle'>,
  compteImmobilisation: string,
  annee: number,
  ouverture: string | null,
): LigneEcritureDotation[] {
  const montant = dotationAEcrire(bien, annee, ouverture)
  if (montant <= 0) return []
  const libelle = `Dotation ${annee} — ${bien.libelle}`
  return [
    { compte: COMPTE_DOTATIONS_AMORTISSEMENTS, sens: 'debit', montant, libelle },
    { compte: compteAmortissement(compteImmobilisation), sens: 'credit', montant, libelle },
  ]
}

export const REFUS_DOTATION_SANS_NATURE = 'Choisissez la nature de ce bien : c’est elle qui donne son compte d’amortissement.'

// Pourquoi la dotation de cet exercice ne peut pas s'écrire, dit AVANT le clic — les refus de la base, dans
// son ordre. `nature` est celle que l'écran a lue : introuvable alors que le bien en désigne une, c'est
// une lecture qui a manqué quelque chose, et on ne compose pas d'écriture sur un compte deviné.
export function refusDotation(
  bien: BienAmortissable & Pick<Immobilisation, 'nature_id'>,
  annee: number,
  anneeCourante: number,
  presentes: readonly Pick<EcritureBrouillon, 'statut'>[],
  nature: Pick<NatureImmobilisation, 'compte_immobilisation'> | undefined,
  ouverture: string | null,
): string | null {
  if (annee > anneeCourante) return 'La dotation d’un exercice à venir ne s’écrit pas encore.'
  if (presentes.some((e) => e.statut !== 'proposee')) return `La dotation ${annee} de ce bien est validée : elle ne se remplace plus.`
  if (dotationAEcrire(bien, annee, ouverture) > 0) {
    if (!bien.nature_id) return REFUS_DOTATION_SANS_NATURE
    if (!nature) return 'La nature de ce bien est introuvable.'
  }
  return null
}

// L'écriture présente est-elle EXACTEMENT celle attendue — mêmes lignes, dans n'importe quel ordre, au 31
// décembre, AU CENTIME ? Pas de tolérance ici, à la différence d'une écriture de pièce : la base écrit la
// dotation au centime de son calcul, donc un écart d'un centime est un registre qui a bougé depuis.
export function dotationConforme(
  presentes: readonly Pick<EcritureBrouillon, 'compte' | 'sens' | 'montant' | 'date'>[],
  attendues: readonly LigneEcritureDotation[],
  annee: number,
): boolean {
  if (presentes.length !== attendues.length) return false
  const restantes = [...presentes]
  for (const a of attendues) {
    const i = restantes.findIndex((e) => e.compte === a.compte && e.sens === a.sens && e.date === dateDeLaDotation(annee)
      && Math.round(e.montant * 100) === Math.round(a.montant * 100))
    if (i < 0) return false
    restantes.splice(i, 1)
  }
  return true
}

// L'état d'une dotation du registre au regard du brouillon :
//   - `a_ecrire`    : le calcul en donne une, aucune n'est écrite ;
//   - `a_reecrire`  : une est écrite, et ce n'est plus celle du calcul (valeur, durée, mise en service ou
//                     nature changées depuis) ;
//   - `a_retirer`   : une est écrite, et le calcul n'en donne plus (mise en service repoussée, exercice
//                     repris dans les à-nouveaux) ;
//   - `ecrite`      : celle du calcul est écrite ;
//   - `validee`     : une écrite VALIDÉE qui n'est plus celle du calcul — la base refuse de la remplacer. Elle
//                     est dans un exercice validé (`figee`), donc ne se réclame plus : une erreur trouvée après la
//                     validation se corrige sur l'exercice suivant.
export type EtatDotation = 'a_ecrire' | 'a_reecrire' | 'a_retirer' | 'ecrite' | 'validee'

export interface DotationDuRegistre {
  immobilisation: Immobilisation
  annee: number
  /** Ce que la dotation de l'exercice doit valoir — 0 avant l'ouverture du dossier. */
  montant: number
  /** L'écriture à écrire ; nulle quand elle ne peut pas se composer (voir `refus`). */
  attendues: LigneEcritureDotation[] | null
  presentes: EcritureBrouillon[]
  etat: EtatDotation
  /** Pourquoi la base refuserait de l'écrire, dit avant le clic. */
  refus: string | null
  /** L'exercice est figé par la validation (lib/validationExercice.ts) : la base n'y écrit, n'y réécrit ni n'y retire
   *  plus rien. `etat` dit encore ce qu'il en est, pour que l'écran le montre ; aucun geste ne la propose, et la
   *  Checklist ne la réclame pas. */
  figee: boolean
}

// LES DOTATIONS DU REGISTRE, exercice par exercice, comparées au brouillon. Pour chaque bien, les exercices
// de sa mise en service à l'exercice en cours, plus ceux où une dotation est écrite — même hors de cette
// plage (une mise en service repoussée laisse derrière elle une dotation à retirer). Un exercice où le
// calcul ne donne rien et où rien n'est écrit n'est pas rendu.
//
// L'exercice EN COURS est rendu comme les autres : sa dotation peut s'écrire dès aujourd'hui, au 31
// décembre. C'est à l'appelant de décider s'il la réclame — la Checklist ne réclame que les exercices
// révolus (`dotationsEnDefaut`), une dotation de l'année ne manquant qu'une fois l'année finie.
//
// UN EXERCICE FIGÉ PAR LA VALIDATION est rendu aussi, marqué `figee` : sa dotation, écrite ou non, ne bouge plus —
// la base refuse toute écriture au plus tard à la frontière. Sans valeur par défaut : un appelant qui oublie la
// frontière proposerait d'écrire une dotation que la base refuse, ou la réclamerait pour toujours.
export function dotationsDuRegistre(
  immobilisations: readonly Immobilisation[],
  natures: readonly NatureImmobilisation[],
  ecritures: readonly EcritureBrouillon[],
  ouverture: string | null,
  anneeCourante: number,
  frontiere: string | null,
): DotationDuRegistre[] {
  const natureParId = new Map(natures.map((n) => [n.id, n]))
  const ecrituresParBien = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.immobilisation_id) continue
    ecrituresParBien.set(e.immobilisation_id, [...(ecrituresParBien.get(e.immobilisation_id) ?? []), e])
  }

  const resultat: DotationDuRegistre[] = []
  for (const bien of immobilisations) {
    const nature = bien.nature_id ? natureParId.get(bien.nature_id) : undefined
    const sesEcritures = ecrituresParBien.get(bien.id) ?? []
    const annees = new Set<number>()
    for (let a = anneeDe(miseEnService(bien)); a <= anneeCourante; a++) annees.add(a)
    for (const e of sesEcritures) annees.add(anneeDe(e.date))

    for (const annee of [...annees].sort((a, b) => a - b)) {
      const presentes = sesEcritures.filter((e) => anneeDe(e.date) === annee)
      const montant = dotationAEcrire(bien, annee, ouverture)
      if (montant <= 0 && presentes.length === 0) continue
      const refus = refusDotation(bien, annee, anneeCourante, presentes, nature, ouverture)
      const attendues = montant <= 0 ? [] : nature ? ecritureDeLaDotation(bien, nature.compte_immobilisation, annee, ouverture) : null
      let etat: EtatDotation
      if (presentes.length === 0) etat = 'a_ecrire'
      else if (attendues && dotationConforme(presentes, attendues, annee)) etat = 'ecrite'
      else if (presentes.some((e) => e.statut !== 'proposee')) etat = 'validee'
      else etat = montant <= 0 ? 'a_retirer' : 'a_reecrire'
      resultat.push({ immobilisation: bien, annee, montant, attendues, presentes, etat, refus, figee: estFigee(dateDeLaDotation(annee), frontiere) })
    }
  }
  return resultat
}

// Ce que la Checklist réclame : une dotation d'un exercice RÉVOLU qui n'est pas écrite, et toute dotation
// écrite qui ne suit plus le registre — quel que soit l'exercice, une écriture fausse l'est dès
// aujourd'hui.
//
// RIEN D'UN EXERCICE FIGÉ PAR LA VALIDATION, qu'elle y manque ou qu'elle diverge : la base n'y écrit plus, et un point
// que rien ne peut lever resterait en erreur pour toujours (lib/validationExercice.ts — « ce qu'un exercice validé a
// figé ne se compare plus »). Une écriture validée ne vivant que dans un exercice validé, l'état `validee` ne se
// réclame donc plus : une erreur trouvée après la validation se corrige sur l'exercice suivant.
export function dotationsEnDefaut(dotations: readonly DotationDuRegistre[], anneeCourante: number): DotationDuRegistre[] {
  return dotations.filter((d) => !d.figee && d.etat !== 'ecrite' && (d.etat !== 'a_ecrire' || d.annee < anneeCourante))
}

// La valeur d'un bien telle que le formulaire la donne, en texte : la virgule française vaut le point, et
// ce qui n'est pas un nombre rend NaN. Une seule lecture pour le refus et pour l'écriture — deux lectures
// finiraient par ne plus s'accorder, et l'écran écrirait autre chose que ce qu'il a accepté.
export function valeurSaisie(texte: string): number {
  return texte.trim() ? Number(texte.replace(',', '.').trim()) : Number.NaN
}

// Ce que la base refuserait d'un bien saisi ou modifié, dit avant d'enregistrer — et ce qui, sans être
// refusé par elle, n'a pas de sens : une mise en service qui précède l'acquisition ferait amortir le bien
// avant qu'il n'existe. Les montants arrivent du formulaire en texte, virgule comprise.
export function refusBien(saisie: {
  libelle: string; valeur: string; dateAcquisition: string; dateMiseEnService: string; duree: string
}): string | null {
  if (!saisie.libelle.trim()) return 'Donnez un libellé au bien.'
  const valeur = valeurSaisie(saisie.valeur)
  if (!Number.isFinite(valeur) || valeur <= 0) return 'La valeur du bien doit être un montant positif.'
  if (Math.abs(valeur * 100 - Math.round(valeur * 100)) > 1e-6) return 'La valeur du bien se saisit au centime.'
  if (!/^\d+$/.test(saisie.duree.trim()) || Number(saisie.duree) < 1) return 'La durée d’amortissement est un nombre entier d’années, au moins un.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.dateAcquisition)) return 'Donnez la date d’acquisition du bien.'
  if (saisie.dateMiseEnService && saisie.dateMiseEnService < saisie.dateAcquisition) {
    return 'La mise en service ne précède pas l’acquisition : le bien serait amorti avant d’exister.'
  }
  return null
}

// Ce que la base refuserait d'une nature créée pour le dossier : son compte est un compte d'immobilisation
// de six chiffres, incorporelle (20…) ou corporelle (21…) — c'est de lui que la dotation tire son compte 28.
export const FORMAT_COMPTE_IMMOBILISATION = /^2[01]\d{4}$/

export function refusNature(saisie: { libelle: string; duree: string; compte: string }): string | null {
  if (!saisie.libelle.trim()) return 'Donnez un nom à la nature.'
  if (!/^\d+$/.test(saisie.duree.trim()) || Number(saisie.duree) < 1) return 'La durée usuelle est un nombre entier d’années, au moins un.'
  if (!FORMAT_COMPTE_IMMOBILISATION.test(saisie.compte.trim())) {
    return 'Le compte d’une nature est un compte d’immobilisation de six chiffres, commençant par 20 (incorporelle) ou 21 (corporelle).'
  }
  return null
}
