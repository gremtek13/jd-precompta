import { indemniteKilometriqueCentimes, vehiculeDuDossier } from './baremeKilometrique'
import { nomDuVehicule } from './forfaitKilometrique'
import type { VehiculeDossier } from './types'

// LE CADRE 7 DE LA 2035-B, « BARÈMES KILOMÉTRIQUES », CE QU'IL PORTE (signalement du cabinet du 17/11/2026 : le PDF n'en
// remplissait rien, ni les véhicules ni le total A). Ce module dit QUOI imprimer ; lib/gabaritCadre7.ts dit OÙ.
//
// SOURCES. Le formulaire 2035-B-SD 2026 (public/formulaires/2035-sd-2026.pdf), cadre 7 : une ligne par véhicule — modèle,
// type (1) T, M ou V, puissance fiscale, une croix sous « Barème BNC » ou « Barème BIC » (2), motorisation (3), type de
// carburant (4), kilométrage professionnel, indemnités kilométriques déductibles, amortissements pratiqués à réintégrer (si le
// véhicule est inscrit au registre des immobilisations) —, la ligne « Frais réels non couverts par les barèmes
// kilométriques », puis « Total A à reporter ligne 23 de l'annexe 2035 A ; total B à reporter au cadre B de la page 2 de la
// déclaration 2035 ». La notice 2035-NOT-SD 2026, renvoi (12) : l'option pour le barème se prend au 1er janvier, vaut l'année
// entière et pour tous les véhicules, et oblige à servir le cadre 7 ; et, au tableau des immobilisations, les amortissements
// d'un véhicule inscrit au registre sont à réintégrer au cadre B, « le barème couvrant déjà l'amortissement ».
//
// CE QUE L'APPLICATION SAIT, ligne par ligne : la table `vehicules` (une ligne par véhicule et par exercice, figée par la
// validation), donc le modèle quand il est saisi, le type, la puissance, le barème BNC ou BIC, la motorisation et le
// carburant quand ils sont saisis, les kilomètres, et l'indemnité du barème (`indemniteKilometriqueCentimes`, le calcul même
// de la 2035 et de l'écriture du forfait). Le TOTAL A est donc la part de la case BJ venue du barème, au centime avant
// l'arrondi à l'euro (cadre7.test.ts le prouve contre `calculerDeclaration2035`).
//
// CE QU'ELLE NE SAIT PAS, et qui reste vide, jamais deviné ni écrit 0 :
//   - la ligne « Frais réels non couverts par les barèmes » (péages, stationnement) : ces dépenses comptent en BJ par
//     leurs propres postes (« Frais de déplacement »…), mêlées au train et à l'hôtel ; l'application ne sait pas les isoler.
//     Le total A porte donc le barème seul, et BJ le tout — question CADRE7-Q1 ;
//   - les amortissements à réintégrer, véhicule par véhicule, et leur total B : aucun écran ne les saisit (les colonnes
//     `inscrit_immobilisations` et `amortissements_a_reintegrer` de la table restent à leur défaut), et le registre ne dit pas
//     quel bien est quel véhicule. Quand un bien du matériel de transport est amorti l'année du barème
//     (`amortissementsSousLeBareme`), la case du total B porte « à saisir » en rouge ; sinon elle reste vide — question
//     CADRE7-Q2 ;
//   - le modèle, la motorisation ou le carburant non saisis : la cellule reste vide (jamais « Voiture 5 CV », que
//     `nomDuVehicule` compose pour un écran) ; la puissance d'un cyclomoteur, que le barème ignore : vide.
//
// UN VÉHICULE DONT LE BARÈME NE CALCULE PAS L'INDEMNITÉ (barème de l'année absent, puissance hors des tranches) a sa ligne,
// « à saisir » dans la colonne des indemnités, et le total A porte « à saisir » : la 2035 n'en compte rien, Clôture le dit
// déjà (« Véhicules dont l'indemnité n'a pas pu être calculée »), et un total qui l'omettrait se lirait complet.
//
// UN EXERCICE VALIDÉ : ses véhicules sont figés en base (`garder_vehicule_valide`), mais l'indemnité se recalcule avec les
// barèmes livrés aujourd'hui ; l'instantané, lui, ne garde que le total du poste. L'appelant passe la part de BJ venue du
// barème telle que la 2035 MONTRÉE la porte (l'instantané d'un exercice validé, le calcul sinon) : quand le recalcul ne la
// retrouve pas au centime, les colonnes des montants et le total A restent vides (`ecart`), les colonnes descriptives
// s'impriment, et l'écran le dit. Jamais un total qui contredirait la 2035 validée.

export type TypeDuCadre7 = 'T' | 'M' | 'V'

// Ce qu'une cellule de montant porte : des euros entiers, « à saisir » (dessiné en rouge), ou rien (`null`).
export type MontantDuCadre7 = number | 'a_saisir' | null

export interface LigneDuCadre7 {
  // Le nom que l'écran donne au véhicule, pour dire ce qui n'a pas trouvé de ligne sur le formulaire ; jamais imprimé.
  nom: string
  modele: string | null
  type: TypeDuCadre7
  // Nulle pour un cyclomoteur : le barème ne lui connaît pas de puissance.
  puissanceFiscale: number | null
  bareme: 'bnc' | 'bic'
  motorisation: string | null
  carburant: string | null
  kilometres: number
  indemnite: MontantDuCadre7
}

export interface Cadre7ARemplir {
  lignes: LigneDuCadre7[]
  totalA: MontantDuCadre7
  // Jamais un montant aujourd'hui (voir plus haut) : « à saisir » ou rien.
  totalB: 'a_saisir' | null
}

export interface Cadre7DeLExercice {
  // Null : aucun véhicule au barème pour l'exercice, et le cadre reste vierge.
  cadre: Cadre7ARemplir | null
  // Le recalcul ne retrouve pas la part de BJ venue du barème : les montants restent vides, et l'écran le dit.
  ecart: { calculeCentimes: number; attenduCentimes: number } | null
}

const TYPES: Record<VehiculeDossier['type'], TypeDuCadre7> = { voiture: 'T', moto: 'M', cyclomoteur: 'V' }

// Les mots de la notice (renvoi (3) du cadre : « thermique, à hydrogène, hybride, électrique » ; (4) : « diesel, super sans
// plomb, GPL »). « Sans plomb » plutôt que « Super sans plomb » : la colonne fait 42 points, et le mot entier n'y tiendrait
// qu'à une taille illisible.
const MOTORISATIONS: Record<NonNullable<VehiculeDossier['motorisation']>, string> = {
  thermique: 'Thermique', hydrogene: 'Hydrogène', hybride: 'Hybride', electrique: 'Électrique',
}
const CARBURANTS: Record<NonNullable<VehiculeDossier['carburant']>, string> = {
  diesel: 'Diesel', super_sans_plomb: 'Sans plomb', gpl: 'GPL',
}

// L'euro le plus proche, en entiers (la moitié vers le haut) : `Math.round` sur des centimes divisés par 100 dériverait.
function eurosArrondis(centimes: number): number {
  return Math.floor((centimes + 50) / 100)
}

// Les euros de chaque ligne, dont la somme est EXACTEMENT le total arrondi : chaque ligne à l'euro inférieur, puis l'euro
// manquant aux plus grands restes (à égalité, l'ordre du cadre). Arrondies chacune de son côté, deux lignes de 0,50 €
// s'imprimeraient 1 et 1 sous un total de 1 : une colonne qui ne s'additionne pas.
function repartirEnEuros(centimes: readonly number[], totalEuros: number): number[] {
  const euros = centimes.map((c) => Math.floor(c / 100))
  let manque = totalEuros - euros.reduce((s, e) => s + e, 0)
  const ordre = centimes.map((c, i) => ({ i, reste: c % 100 })).sort((a, b) => b.reste - a.reste || a.i - b.i)
  for (const { i } of ordre) {
    if (manque <= 0) break
    euros[i] += 1
    manque -= 1
  }
  return euros
}

// L'ordre des lignes : celui de leur saisie, puis l'identifiant — le même PDF d'un clic à l'autre.
function ordreDeSaisie(a: VehiculeDossier, b: VehiculeDossier): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Le cadre 7 de l'exercice. `attenduCentimes` : la part de BJ venue du barème que la 2035 montrée porte
// (`forfaitKilometriqueDesPostes` sur ses postes, en centimes). `amortissementsAReintegrer` : un bien du matériel de transport
// est amorti l'année du barème (`amortissementsSousLeBareme(...).length > 0`). Sans valeur par défaut, l'un et l'autre : un
// appelant qui les oublierait imprimerait un total que rien n'a confronté, ou tairait un total B à saisir.
export function cadre7DeLExercice(
  vehicules: readonly VehiculeDossier[],
  annee: number,
  attenduCentimes: number,
  amortissementsAReintegrer: boolean,
): Cadre7DeLExercice {
  // Un véhicule sans kilomètre professionnel n'a pas d'indemnité, et la 2035 ne le compte pas : il n'a pas de ligne.
  const auBareme = vehicules.filter((v) => v.annee === annee && v.km_professionnel > 0).sort(ordreDeSaisie)
  if (auBareme.length === 0) return { cadre: null, ecart: null }

  const indemnites = auBareme.map((v) => {
    const c = indemniteKilometriqueCentimes(vehiculeDuDossier(v), annee)
    return c === null ? null : Number(c)
  })
  const calculees = indemnites.filter((c): c is number => c !== null)
  const calculeCentimes = calculees.reduce((s, c) => s + c, 0)
  const ecart = calculeCentimes === attenduCentimes ? null : { calculeCentimes, attenduCentimes }
  const toutesCalculees = calculees.length === indemnites.length

  const totalEuros = eurosArrondis(calculeCentimes)
  const repartis = toutesCalculees ? repartirEnEuros(calculees, totalEuros) : calculees.map(eurosArrondis)
  let k = 0
  const montantDe = (c: number | null): MontantDuCadre7 => {
    if (ecart) return null
    if (c === null) return 'a_saisir'
    const euros = repartis[k]
    k += 1
    return euros
  }

  const lignes = auBareme.map((v, i): LigneDuCadre7 => ({
    nom: nomDuVehicule(v),
    modele: v.modele?.trim() || null,
    type: TYPES[v.type],
    puissanceFiscale: v.type === 'cyclomoteur' ? null : v.puissance_fiscale,
    bareme: v.bareme,
    motorisation: v.motorisation ? MOTORISATIONS[v.motorisation] : null,
    carburant: v.carburant ? CARBURANTS[v.carburant] : null,
    kilometres: v.km_professionnel,
    indemnite: montantDe(indemnites[i]),
  }))

  return {
    cadre: {
      lignes,
      totalA: ecart ? null : toutesCalculees ? totalEuros : 'a_saisir',
      totalB: amortissementsAReintegrer ? 'a_saisir' : null,
    },
    ecart,
  }
}
