import { dotationDeLExercice } from './amortissements'
import { indemniteKilometriqueCentimes, motifNonCalcule, vehiculeDuDossier } from './baremeKilometrique'
import { COMPTE_INDEMNITES_KILOMETRIQUES } from './comptes'
import type { ModeleComptable } from './engagement'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation, VehiculeDossier } from './types'
import { estFigee } from './validationExercice'
import { compteDuDirigeant } from './virementPersonnel'

// LE FORFAIT KILOMÉTRIQUE S'ÉCRIT (ligne 26.6 de la feuille de route, étape b).
//
// La 2035 comptait le forfait en case BJ depuis le cadre 7 (la table `vehicules`, une ligne par véhicule et
// par exercice), et rien ne l'écrivait : ni charge ni contrepartie au brouillon, donc rien au FEC — un
// vérificateur qui additionne le fichier ne retrouvait pas la ligne 23 de la déclaration. Il s'écrit
// désormais, une écriture par ligne du cadre 7, au 31 décembre de son exercice.
//
// L'ÉCRITURE : l'indemnité du barème au débit du 625110, et au crédit du compte du DIRIGEANT — le 108000 de
// l'exploitant en trésorerie, le compte choisi pour le dirigeant en engagement (455, 108 ou 467). C'est lui
// qui a supporté les frais du véhicule, et le barème les lui rend : ni la banque ni une pièce n'y prennent
// part. Le même compte que ses notes de frais et ses virements personnels (`compteDuDirigeant`) : deux
// comptes pour la même personne partageraient ce qu'on lui doit en deux moitiés.
//
// LE MONTANT EST CELUI DE LA BASE, AU CENTIME : `ecrire_forfait_kilometrique` refait le calcul du barème
// (`indemnite_kilometrique_centimes`) et refuse une écriture qui ne vaut pas son indemnité au centime. Le
// calcul de l'application est donc en entiers lui aussi (`indemniteKilometriqueCentimes`), et
// baremeKilometrique.test.ts confronte les deux tables et les deux calculs.
//
// AVANT L'OUVERTURE D'UN DOSSIER REPRIS, RIEN NE S'ÉCRIT : l'exercice est dans les comptes repris (ses
// à-nouveaux), et son forfait avec lui — la règle des dotations (`dotationAEcrire`), pour la même raison.

// Le forfait tombe au 31 décembre de son exercice : il couvre l'année entière, l'option pour le barème se
// prenant au 1er janvier (notice 2035, renvoi 12). La base le garantit (`ecritures_brouillon_forfait_au_31_
// decembre`).
export const dateDuForfait = (annee: number) => `${annee}-12-31`

// Le nom d'un véhicule tel qu'un écran, une écriture ou un export le disent : son modèle quand il est
// saisi, sinon ce que le barème en sait — « Voiture 5 CV électrique ». Un libellé vide ne désignerait rien.
export function nomDuVehicule(v: Pick<VehiculeDossier, 'modele' | 'type' | 'puissance_fiscale' | 'motorisation'>): string {
  const modele = v.modele?.trim()
  if (modele) return modele
  const type = v.type === 'voiture' ? 'Voiture' : v.type === 'moto' ? 'Moto' : 'Cyclomoteur'
  const puissance = v.type === 'cyclomoteur' ? '' : ` ${v.puissance_fiscale} CV`
  return `${type}${puissance}${v.motorisation === 'electrique' ? ' électrique' : ''}`
}

// Le forfait à ÉCRIRE pour une ligne du cadre 7, en centimes : zéro avant l'ouverture du dossier — ses
// à-nouveaux portent l'exercice, et l'écrire encore le compterait deux fois —, null quand le barème ne le
// calcule pas (barème de l'année absent, puissance hors des tranches publiées). La base fait les mêmes
// choix, dans le même ordre (`ecrire_forfait_kilometrique`).
export function forfaitAEcrireCentimes(vehicule: VehiculeDossier, ouverture: string | null): bigint | null {
  if (ouverture && dateDuForfait(vehicule.annee) < ouverture) return 0n
  return indemniteKilometriqueCentimes(vehiculeDuDossier(vehicule), vehicule.annee)
}

export interface LigneEcritureForfait {
  compte: string
  sens: 'debit' | 'credit'
  montant: number
  libelle: string
}

// L'écriture du forfait : le 625110 au débit, le compte du dirigeant au crédit, du même montant. RIEN
// quand le forfait est nul (zéro kilomètre, exercice repris) — l'appel à la base retire alors celui qui
// aurait été écrit ; null quand le barème ne le calcule pas, et rien ne se compose sur un montant deviné.
export function ecritureDuForfait(
  vehicule: VehiculeDossier,
  modele: ModeleComptable,
  ouverture: string | null,
): LigneEcritureForfait[] | null {
  const centimes = forfaitAEcrireCentimes(vehicule, ouverture)
  if (centimes === null) return null
  if (centimes <= 0n) return []
  const montant = Number(centimes) / 100
  const libelle = `Indemnités kilométriques ${vehicule.annee} — ${nomDuVehicule(vehicule)}`
  return [
    { compte: COMPTE_INDEMNITES_KILOMETRIQUES, sens: 'debit', montant, libelle },
    { compte: compteDuDirigeant(modele), sens: 'credit', montant, libelle },
  ]
}

// Pourquoi le forfait de cette ligne ne peut pas s'écrire, dit AVANT le clic — les refus de la base, dans
// son ordre. Avant l'ouverture, rien n'est refusé : l'écriture composée est vide, et la base l'accepte pour
// retirer un forfait qui y aurait été écrit avant la reprise.
export function refusForfait(
  vehicule: VehiculeDossier,
  anneeCourante: number,
  presentes: readonly Pick<EcritureBrouillon, 'statut'>[],
  ouverture: string | null,
): string | null {
  if (vehicule.annee > anneeCourante) return 'Le forfait d’un exercice à venir ne s’écrit pas encore.'
  if (presentes.some((e) => e.statut !== 'proposee')) {
    return `Le forfait ${vehicule.annee} de ce véhicule est validé : il ne se remplace plus.`
  }
  if (forfaitAEcrireCentimes(vehicule, ouverture) !== null) return null
  switch (motifNonCalcule(vehiculeDuDossier(vehicule), vehicule.annee)) {
    case 'barème non renseigné pour cet exercice':
      return `Le barème kilométrique ${vehicule.annee} n’est pas renseigné dans l’application.`
    case 'kilométrage invalide':
      return 'Le kilométrage de ce véhicule n’est pas un nombre entier de kilomètres.'
    case 'puissance hors barème':
      return `La puissance fiscale de ce véhicule est hors du barème kilométrique ${vehicule.annee}.`
  }
}

// L'écriture présente est-elle EXACTEMENT celle attendue — mêmes lignes, dans n'importe quel ordre, au 31
// décembre, AU CENTIME ? Pas de tolérance : la base écrit le forfait au centime de son calcul, donc un écart
// d'un centime est un cadre 7 qui a bougé depuis.
export function forfaitConforme(
  presentes: readonly Pick<EcritureBrouillon, 'compte' | 'sens' | 'montant' | 'date'>[],
  attendues: readonly LigneEcritureForfait[],
  annee: number,
): boolean {
  if (presentes.length !== attendues.length) return false
  const restantes = [...presentes]
  for (const a of attendues) {
    const i = restantes.findIndex((e) => e.compte === a.compte && e.sens === a.sens && e.date === dateDuForfait(annee)
      && Math.round(e.montant * 100) === Math.round(a.montant * 100))
    if (i < 0) return false
    restantes.splice(i, 1)
  }
  return true
}

// L'état du forfait d'une ligne du cadre 7 au regard du brouillon :
//   - `a_ecrire`   : le barème en donne un — ou ne sait pas le calculer (voir `refus`) —, rien n'est écrit ;
//   - `a_reecrire` : un forfait est écrit, et ce n'est plus celui du barème (kilométrage, puissance,
//                    motorisation ou compte du dirigeant changés depuis) ;
//   - `a_retirer`  : un forfait est écrit, et il n'y en a plus (zéro kilomètre, exercice repris) ;
//   - `ecrit`      : celui du barème est écrit ;
//   - `valide`     : un forfait VALIDÉ qui n'est plus celui du barème — la base refuse de le remplacer. Il est
//                    dans un exercice validé (`fige`), donc ne se réclame plus : une erreur trouvée après la
//                    validation se corrige sur l'exercice suivant ;
//   - `rien`       : rien à écrire, rien d'écrit.
export type EtatForfait = 'a_ecrire' | 'a_reecrire' | 'a_retirer' | 'ecrit' | 'valide' | 'rien'

export interface ForfaitDuVehicule {
  vehicule: VehiculeDossier
  /** Le forfait de l'exercice, en centimes : 0 avant l'ouverture, null quand le barème ne le calcule pas. */
  centimes: bigint | null
  /** L'écriture à écrire ; nulle quand elle ne peut pas se composer (voir `refus`). */
  attendues: LigneEcritureForfait[] | null
  presentes: EcritureBrouillon[]
  etat: EtatForfait
  /** Pourquoi la base refuserait de l'écrire, dit avant le clic. */
  refus: string | null
  /** L'exercice est figé par la validation (lib/validationExercice.ts) : la ligne du cadre 7 ne change plus, et la base
   *  n'y écrit, n'y réécrit ni n'y retire plus de forfait. `etat` dit encore ce qu'il en est, pour que l'écran le
   *  montre ; aucun geste ne le propose, et la Checklist ne le réclame pas. */
  fige: boolean
}

// LES FORFAITS DU CADRE 7, ligne par ligne, comparés au brouillon. Toutes les lignes sont rendues — l'écran
// en montre l'état sur chacune —, y compris celles où il n'y a rien à écrire (`rien`).
//
// L'exercice EN COURS se traite comme les autres : son forfait peut s'écrire dès aujourd'hui, au 31
// décembre, sur le kilométrage saisi à ce jour. C'est à l'appelant de décider s'il le réclame — la
// Checklist ne réclame que les exercices révolus (`forfaitsEnDefaut`), un kilométrage de l'année n'étant
// complet qu'une fois l'année finie.
//
// UN EXERCICE FIGÉ PAR LA VALIDATION est rendu aussi, marqué `fige` : son forfait, écrit ou non, ne bouge plus. Sans
// valeur par défaut : un appelant qui oublie la frontière proposerait d'écrire un forfait que la base refuse, ou le
// réclamerait pour toujours.
export function forfaitsDuCadre7(
  vehicules: readonly VehiculeDossier[],
  ecritures: readonly EcritureBrouillon[],
  modele: ModeleComptable,
  ouverture: string | null,
  anneeCourante: number,
  frontiere: string | null,
): ForfaitDuVehicule[] {
  const parVehicule = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.vehicule_id) continue
    parVehicule.set(e.vehicule_id, [...(parVehicule.get(e.vehicule_id) ?? []), e])
  }
  return vehicules.map((vehicule) => {
    const presentes = parVehicule.get(vehicule.id) ?? []
    const centimes = forfaitAEcrireCentimes(vehicule, ouverture)
    const attendues = ecritureDuForfait(vehicule, modele, ouverture)
    const refus = refusForfait(vehicule, anneeCourante, presentes, ouverture)
    const nul = attendues !== null && attendues.length === 0
    let etat: EtatForfait
    if (presentes.length === 0) etat = nul ? 'rien' : 'a_ecrire'
    else if (attendues && forfaitConforme(presentes, attendues, vehicule.annee)) etat = 'ecrit'
    else if (presentes.some((e) => e.statut !== 'proposee')) etat = 'valide'
    else etat = nul ? 'a_retirer' : 'a_reecrire'
    return { vehicule, centimes, attendues, presentes, etat, refus, fige: estFigee(dateDuForfait(vehicule.annee), frontiere) }
  })
}

// Ce que la Checklist réclame : le forfait d'un exercice RÉVOLU qui n'est pas écrit, et tout forfait écrit
// qui ne suit plus le cadre 7 — quel que soit l'exercice, une écriture fausse l'est dès aujourd'hui.
//
// Le forfait d'un exercice révolu que le barème ne sait pas calculer est rendu aussi, avec son refus : la
// 2035 de cet exercice n'en compte rien non plus (`nonCalcules`), et la Checklist doit dire ce qui manque.
//
// RIEN D'UN EXERCICE FIGÉ PAR LA VALIDATION, qu'il y manque ou qu'il diverge : la base n'y écrit plus, et un point que
// rien ne peut lever resterait en erreur pour toujours (lib/validationExercice.ts). Un forfait validé ne vivant que
// dans un exercice validé, l'état `valide` ne se réclame donc plus.
export function forfaitsEnDefaut(forfaits: readonly ForfaitDuVehicule[], anneeCourante: number): ForfaitDuVehicule[] {
  return forfaits.filter((f) => !f.fige && f.etat !== 'ecrit' && f.etat !== 'rien'
    && (f.etat !== 'a_ecrire' || f.vehicule.annee < anneeCourante))
}

// ═══ Le véhicule du registre amorti sous le barème ═══════════════════════════════════════════════════
//
// LE BARÈME COUVRE DÉJÀ L'AMORTISSEMENT DU VÉHICULE. La notice de la 2035 le dit au tableau des
// immobilisations : « En cas d'option pour déterminer les frais d'utilisation des véhicules par application
// du barème forfaitaire de l'administration (cf. renvoi 12) – le barème couvrant déjà l'amortissement – les
// amortissements afférents à ces véhicules doivent être réintégrés au cadre B du tableau des
// "Immobilisations et des amortissements". » Or la 2035 de l'application compte en case CH la dotation de
// TOUT le registre (`dotationDeLExercice`), et le brouillon l'écrit au 681100 : un véhicule inscrit au
// registre, amorti l'année où le barème est retenu, y est déduit deux fois — par sa dotation et par le
// forfait.
//
// SIGNALÉ, JAMAIS CORRIGÉ : le cadre B du tableau n'est pas modélisé, et c'est le cabinet qui sait lequel
// de ses biens est le véhicule du cadre 7. La règle de `doublonFraisVehicules` (lib/cases2035.ts), pour
// l'autre moitié de la même note : les frais que le barème couvre ne figurent à aucun poste de charges.
//
// UN BIEN DU REGISTRE EST UN VÉHICULE quand sa nature porte le compte du MATÉRIEL DE TRANSPORT (2182). Le
// barème est retenu pour l'exercice dès qu'une ligne du cadre 7 de cet exercice porte des kilomètres —
// l'option vaut pour tous les véhicules de l'année.
export const PREFIXE_COMPTE_MATERIEL_DE_TRANSPORT = '2182'

export interface AmortissementSousLeBareme {
  annee: number
  immobilisation: Immobilisation
  dotation: number
}

export function amortissementsSousLeBareme(
  immobilisations: readonly Immobilisation[],
  natures: readonly NatureImmobilisation[],
  vehicules: readonly VehiculeDossier[],
  annee: number,
): AmortissementSousLeBareme[] {
  if (!vehicules.some((v) => v.annee === annee && v.km_professionnel > 0)) return []
  const natureParId = new Map(natures.map((n) => [n.id, n]))
  const resultat: AmortissementSousLeBareme[] = []
  for (const immobilisation of immobilisations) {
    const nature = immobilisation.nature_id ? natureParId.get(immobilisation.nature_id) : undefined
    if (!nature?.compte_immobilisation.startsWith(PREFIXE_COMPTE_MATERIEL_DE_TRANSPORT)) continue
    const dotation = dotationDeLExercice(immobilisation, annee)
    if (dotation > 0) resultat.push({ annee, immobilisation, dotation })
  }
  return resultat
}
