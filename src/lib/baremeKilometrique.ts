// Barème kilométrique forfaitaire — cadre 7 du 2035-B, et total reporté ligne 23 du 2035-A (case BJ).
//
// Le formulaire le dit lui-même en bas de la page 2 : « Total A à reporter ligne 23 de l'annexe
// 2035 A ». Sans ce calcul, la case des frais de véhicules reste vide alors que le dossier porte un
// véhicule en indemnités kilométriques.
//
// Le barème est publié chaque année par l'administration ; la notice 2035-NOT-SD y renvoie (renvoi
// 12) sans le reproduire. Les valeurs sont donc saisies ici, avec leur millésime et leur source, et
// le calcul REFUSE de conclure pour une année non renseignée — retomber sur l'année précédente
// produirait une déduction fausse sans que rien ne le signale.
//
// Note (12) de la notice, qui conditionne tout : l'option pour le forfait se prend au 1er janvier,
// vaut pour l'année entière et pour TOUS les véhicules ; les dépenses couvertes par le barème ne
// doivent alors figurer à aucun poste de charges, et les amortissements des véhicules inscrits au
// registre doivent être réintégrés.

import type { VehiculeDossier } from './types'

export type TypeVehicule = 'voiture' | 'moto' | 'cyclomoteur'

// Une tranche de distance du barème. La formule officielle est toujours de la forme
// « d × coefficient » ou « (d × coefficient) + forfait » — les deux se ramènent à la même écriture,
// forfait nul dans le premier cas.
export interface TrancheBareme {
  // Borne haute de la tranche, en kilomètres. Null pour la dernière, non bornée.
  jusqua: number | null
  coefficient: number
  forfait: number
}

export interface LigneBareme {
  type: TypeVehicule
  // Puissance fiscale couverte, bornes incluses. Le cyclomoteur n'en a pas : 0 à 0.
  puissanceMin: number
  puissanceMax: number
  // L'administration publie des tables SÉPARÉES pour les véhicules 100 % électriques. Elles valent
  // les tables thermiques majorées de 20 % puis arrondies (vérifié sur les vingt valeurs), mais ce
  // sont les chiffres publiés qui sont repris ici plutôt qu'une majoration recalculée : c'est contre
  // eux qu'un contrôle se fera, et un arrondi maison donnerait des centimes d'écart.
  electrique: boolean
  tranches: TrancheBareme[]
}

export interface BaremeAnnuel {
  annee: number
  // D'où viennent ces chiffres. Écrit pour être relu : une table fiscale sans source ne se vérifie
  // pas, et personne ne saura plus dans deux ans si elle est à jour.
  source: string
  lignes: LigneBareme[]
}

const voiture = (cv: [number, number], electrique: boolean, t: [number, number, number, number]): LigneBareme => ({
  type: 'voiture',
  puissanceMin: cv[0],
  puissanceMax: cv[1],
  electrique,
  tranches: [
    { jusqua: 5000, coefficient: t[0], forfait: 0 },
    { jusqua: 20_000, coefficient: t[1], forfait: t[2] },
    { jusqua: null, coefficient: t[3], forfait: 0 },
  ],
})

const deuxRoues = (
  type: TypeVehicule,
  cv: [number, number],
  electrique: boolean,
  t: [number, number, number, number],
): LigneBareme => ({
  type,
  puissanceMin: cv[0],
  puissanceMax: cv[1],
  electrique,
  tranches: [
    { jusqua: 3000, coefficient: t[0], forfait: 0 },
    { jusqua: 6000, coefficient: t[1], forfait: t[2] },
    { jusqua: null, coefficient: t[3], forfait: 0 },
  ],
})

// Barème applicable aux revenus 2025 (déclaration déposée en 2026), saisi d'après la publication de
// l'administration.
//
// Une année absente de la liste `BAREMES` fait échouer le calcul plutôt que d'emprunter le barème
// d'une autre année : un millésime périmé appliqué en silence est le défaut le plus coûteux ici.
// Ajouter une année reste donc un acte explicite, même quand les valeurs ne changent pas — voir
// BAREME_2026 plus bas.
const BAREME_2025: BaremeAnnuel = {
  annee: 2025,
  source: 'impots.gouv.fr — barème kilométrique applicable aux revenus 2025, non revalorisé en 2026',
  lignes: [
    // Voitures thermiques, à hydrogène et hybrides.
    voiture([0, 3], false, [0.529, 0.316, 1065, 0.370]),
    voiture([4, 4], false, [0.606, 0.340, 1330, 0.407]),
    voiture([5, 5], false, [0.636, 0.357, 1395, 0.427]),
    voiture([6, 6], false, [0.665, 0.374, 1457, 0.447]),
    voiture([7, 99], false, [0.697, 0.394, 1515, 0.470]),
    // Voitures 100 % électriques.
    voiture([0, 3], true, [0.635, 0.379, 1278, 0.444]),
    voiture([4, 4], true, [0.727, 0.408, 1596, 0.488]),
    voiture([5, 5], true, [0.763, 0.428, 1674, 0.512]),
    voiture([6, 6], true, [0.798, 0.449, 1748, 0.536]),
    voiture([7, 99], true, [0.836, 0.473, 1818, 0.564]),
    // Motos et scooters de plus de 50 cm³, thermiques.
    deuxRoues('moto', [1, 2], false, [0.395, 0.099, 891, 0.248]),
    deuxRoues('moto', [3, 5], false, [0.468, 0.082, 1158, 0.275]),
    deuxRoues('moto', [6, 99], false, [0.606, 0.079, 1583, 0.343]),
    // Motos et scooters de plus de 50 cm³, 100 % électriques.
    deuxRoues('moto', [1, 2], true, [0.474, 0.119, 1069, 0.298]),
    deuxRoues('moto', [3, 5], true, [0.562, 0.098, 1390, 0.330]),
    deuxRoues('moto', [6, 99], true, [0.727, 0.095, 1900, 0.412]),
    // Cyclomoteurs (50 cm³ et moins) : une seule ligne, sans puissance fiscale.
    deuxRoues('cyclomoteur', [0, 0], false, [0.315, 0.079, 711, 0.198]),
    deuxRoues('cyclomoteur', [0, 0], true, [0.378, 0.095, 853, 0.238]),
  ],
}

// Barème applicable aux revenus 2026. Le barème n'ayant pas été revalorisé, ce sont les mêmes
// valeurs qu'en 2025 — et c'est littéralement la MÊME table qui est réutilisée, pas une copie : deux
// listes recopiées à la main finiraient par diverger sur un chiffre, et personne ne saurait laquelle
// fait foi. Un test fige cette identité.
//
// **Provenance, à lire avant de s'en servir.** Contrairement au millésime 2025, saisi d'après la
// publication de l'administration, celui-ci repose sur l'absence de revalorisation confirmée par le
// cabinet (septembre 2026). Le barème applicable aux revenus 2026 ne sera publié qu'au printemps
// 2027 : il faudra alors le confronter à cette table et remplacer cette entrée par la publication,
// que les chiffres bougent ou non. C'est le sens de ce commentaire — qu'on sache dans deux ans
// d'où venaient ces valeurs.
const BAREME_2026: BaremeAnnuel = {
  annee: 2026,
  source: 'Identique au barème des revenus 2025, non revalorisé — sur confirmation du cabinet '
    + '(septembre 2026). À confronter à la publication officielle dès sa parution, au printemps 2027.',
  lignes: BAREME_2025.lignes,
}

export const BAREMES: BaremeAnnuel[] = [BAREME_2025, BAREME_2026]

export function baremeDeLAnnee(annee: number, baremes: BaremeAnnuel[] = BAREMES): BaremeAnnuel | null {
  return baremes.find((b) => b.annee === annee) ?? null
}

export interface Vehicule {
  type: TypeVehicule
  puissanceFiscale: number
  kmProfessionnel: number
  electrique: boolean
}

// Passage de la fiche véhicule enregistrée à ce que le barème attend. Écrit une seule fois plutôt
// que recopié dans chaque appelant : le seul point délicat est `electrique`, et il vaut 20 % de la
// déduction. Un hybride ou un véhicule à hydrogène relève de la table THERMIQUE — seuls les 100 %
// électriques ont la leur — et une conversion recopiée à deux endroits finirait par diverger sur
// exactement ce point.
export function vehiculeDuDossier(v: VehiculeDossier): Vehicule {
  return {
    type: v.type,
    puissanceFiscale: v.puissance_fiscale,
    kmProfessionnel: v.km_professionnel,
    electrique: v.motorisation === 'electrique',
  }
}

// Les motorisations qui ne consomment aucun carburant du tableau (gazole, sans plomb, GPL). Le
// formulaire demande le carburant, mais la question n'a pas de réponse pour ces deux-là.
const SANS_CARBURANT: VehiculeDossier['motorisation'][] = ['electrique', 'hydrogene']

// Complète une modification de fiche véhicule des champs qu'elle vient de priver de sens.
//
// Ce n'est pas du confort d'écran : une valeur restée en place ne se voit plus (son champ est grisé)
// mais continue de compter. Une voiture de 6 CV basculée en « cyclomoteur » gardait sa puissance
// fiscale, et la ligne « cyclomoteur » du barème ne couvrant que la puissance 0, l'indemnité repartait
// en « puissance hors barème » — un calcul qui échoue alors que rien à l'écran ne paraît faux.
//
// Écrit ici et non dans l'écran pour être testable, et parce que c'est une règle du barème : c'est lui
// qui décide qu'un cyclomoteur n'a pas de puissance fiscale et qu'un véhicule électrique n'a pas de
// carburant.
export function completerModificationVehicule(champs: Partial<VehiculeDossier>): Partial<VehiculeDossier> {
  const complet = { ...champs }
  if (champs.type === 'cyclomoteur') complet.puissance_fiscale = 0
  if (champs.motorisation !== undefined && SANS_CARBURANT.includes(champs.motorisation)) complet.carburant = null
  return complet
}

// Le carburant a-t-il un sens pour cette motorisation ? Sert à griser le champ plutôt qu'à le masquer :
// la colonne existe sur le formulaire, et la voir grisée dit « sans objet », là où une colonne absente
// laisserait croire à un oubli.
export function carburantApplicable(motorisation: VehiculeDossier['motorisation']): boolean {
  return !SANS_CARBURANT.includes(motorisation)
}

// Un montant du barème en millièmes d'euro : les coefficients ont trois décimales (0,529 € par km), les
// forfaits sont des euros entiers. baremeKilometrique.test.ts vérifie que la table n'a rien de plus fin.
const enMillimes = (euros: number) => BigInt(Math.round(euros * 1000))

// L'indemnité d'un véhicule sur un exercice, EN CENTIMES, ou null quand le calcul ne peut pas être fait de
// façon sûre — barème absent pour l'année, puissance fiscale hors des tranches publiées, kilométrage qui
// n'est pas un nombre entier de kilomètres. Null n'est pas zéro : zéro se déclarerait, null demande une
// saisie.
//
// LE CALCUL SE FAIT EN ENTIERS, COMME EN BASE : le kilométrage × le coefficient en millièmes d'euro, plus
// le forfait de la tranche, arrondi au centime, le demi-centime vers le haut. `indemnite_kilometrique_
// centimes` refait exactement ce calcul pour VÉRIFIER l'écriture du forfait (`ecrire_forfait_kilometrique`)
// et la refuse si elle ne vaut pas son indemnité au centime. Le calcul en flottants qu'il remplace rendait
// un centime de moins dans un cas sur soixante — 45 km à 0,529 € font 23,805 €, que `toFixed(2)` arrondissait
// à 23,80 € faute de pouvoir représenter le demi exactement — et la base aurait refusé l'écriture juste.
export function indemniteKilometriqueCentimes(
  vehicule: Vehicule,
  annee: number,
  baremes: BaremeAnnuel[] = BAREMES,
): bigint | null {
  const bareme = baremeDeLAnnee(annee, baremes)
  if (!bareme) return null
  if (!Number.isInteger(vehicule.kmProfessionnel) || vehicule.kmProfessionnel < 0) return null

  const ligne = bareme.lignes.find(
    (l) => l.type === vehicule.type
      && l.electrique === vehicule.electrique
      && vehicule.puissanceFiscale >= l.puissanceMin
      && vehicule.puissanceFiscale <= l.puissanceMax,
  )
  if (!ligne) return null

  // La tranche se choisit sur le kilométrage TOTAL, et sa formule s'applique à ce même total — ce
  // n'est pas un barème progressif par tranches cumulées. C'est tout l'objet du forfait ajouté sur
  // la tranche intermédiaire : il rattrape l'écart au point de bascule.
  const tranche = ligne.tranches.find((t) => t.jusqua === null || vehicule.kmProfessionnel <= t.jusqua)
  if (!tranche) return null

  return (BigInt(vehicule.kmProfessionnel) * enMillimes(tranche.coefficient) + enMillimes(tranche.forfait) + 5n) / 10n
}

// La même indemnité en euros — ce que l'écran affiche et ce que la 2035 totalise.
export function indemniteKilometrique(
  vehicule: Vehicule,
  annee: number,
  baremes: BaremeAnnuel[] = BAREMES,
): number | null {
  const centimes = indemniteKilometriqueCentimes(vehicule, annee, baremes)
  return centimes === null ? null : Number(centimes) / 100
}

export type MotifNonCalcule = 'barème non renseigné pour cet exercice' | 'puissance hors barème' | 'kilométrage invalide'

// Pourquoi une indemnité ne se calcule pas — le barème manque, le kilométrage n'en est pas un, ou la
// puissance sort des tranches publiées. Les trois appellent un geste différent : saisir le barème,
// corriger le kilométrage, corriger la fiche du véhicule.
export function motifNonCalcule(vehicule: Vehicule, annee: number, baremes: BaremeAnnuel[] = BAREMES): MotifNonCalcule {
  if (!baremeDeLAnnee(annee, baremes)) return 'barème non renseigné pour cet exercice'
  if (!Number.isInteger(vehicule.kmProfessionnel) || vehicule.kmProfessionnel < 0) return 'kilométrage invalide'
  return 'puissance hors barème'
}

export interface TotalKilometrique {
  // Somme des indemnités calculées — c'est le « total A » à reporter ligne 23 du 2035-A (case BJ).
  total: number
  // Véhicules dont l'indemnité n'a pas pu être calculée, avec la raison. Remontés plutôt qu'ignorés :
  // un véhicule absent du total est une déduction perdue que personne ne verra manquer.
  nonCalcules: { vehicule: Vehicule; motif: MotifNonCalcule }[]
}

// La somme se fait en centimes : additionner des euros en flottants dériverait d'un centime sur un
// cabinet qui déclare plusieurs véhicules, et le total ne serait plus la somme des écritures.
export function totalIndemnitesKilometriques(
  vehicules: Vehicule[],
  annee: number,
  baremes: BaremeAnnuel[] = BAREMES,
): TotalKilometrique {
  let total = 0n
  const nonCalcules: TotalKilometrique['nonCalcules'] = []

  for (const vehicule of vehicules) {
    const centimes = indemniteKilometriqueCentimes(vehicule, annee, baremes)
    if (centimes === null) {
      nonCalcules.push({ vehicule, motif: motifNonCalcule(vehicule, annee, baremes) })
      continue
    }
    total += centimes
  }

  return { total: Number(total) / 100, nonCalcules }
}

// Les exercices qu'il est utile de proposer pour la saisie des véhicules : ceux qui portent déjà des
// véhicules, et ceux dont le barème est renseigné. Du plus récent au plus ancien.
//
// L'union des deux, et pas seulement les millésimes du barème : un exercice où des kilomètres ont été
// saisis avant que le barème n'arrive doit rester atteignable, sinon les données deviendraient
// invisibles depuis l'écran — et personne ne saurait qu'elles existent.
//
// Sert à ne PLUS choisir l'exercice à la place de l'utilisateur. La carte retombait sur l'année
// civile en cours quand l'en-tête était sur « toutes années » : elle enregistrait alors des
// kilomètres sur un exercice que personne n'avait demandé, et l'indemnité repartait en « barème non
// renseigné » sans que le lien avec l'année soit évident.
export function exercicesProposables(
  anneesAvecVehicules: number[],
  baremes: BaremeAnnuel[] = BAREMES,
): number[] {
  return [...new Set([...anneesAvecVehicules, ...baremes.map((b) => b.annee)])].sort((a, b) => b - a)
}
