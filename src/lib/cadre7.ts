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
//   - la ligne « Frais réels non couverts par les barèmes » : CADRE7-Q1, réponse du cabinet du 17/11/2026 — « péage et
//     stationnement c'est en frais de déplacement et pas en frais de véhicule ». Ils comptent en BJ par leurs propres postes
//     (ligne 24, « Autres frais de déplacements »), jamais au cadre 7 : la ligne reste vide, et le total A, reporté ligne 23,
//     porte le barème seul ;
//   - le modèle, la motorisation ou le carburant non saisis : la cellule reste vide (jamais « Voiture 5 CV », que
//     `nomDuVehicule` compose pour un écran) ; la puissance d'un cyclomoteur, que le barème ignore : vide.
//
// LES AMORTISSEMENTS À RÉINTÉGRER ET LEUR TOTAL B (CADRE7-Q2 (A), 17/11/2026) : la carte Véhicules saisit, véhicule par
// véhicule, s'il est inscrit au registre des immobilisations et le montant à réintégrer — les colonnes
// `inscrit_immobilisations` et `amortissements_a_reintegrer` de la table, sans migration. Un véhicule inscrit porte son
// montant, ou « à saisir » tant qu'il n'est pas dit ; le total B est leur somme. La case `inscrit_immobilisations` vaut
// « non » par défaut : la base ne distingue pas « non inscrit » de « pas encore dit ». Quand aucun véhicule n'est dit inscrit
// alors qu'un bien du matériel de transport est amorti l'année du barème (`amortissementsSousLeBareme`), le total B reste
// donc « à saisir » : le défaut ne fait pas taire le registre.
//
// PLUS DE DEUX VÉHICULES AU BARÈME (CADRE7-Q3, réponse du cabinet du 17/11/2026 : « à déconseiller ») : le formulaire n'a que
// deux lignes ; les autres se portent sur un état annexe que l'application n'imprime pas, et le total A les compte tous. La
// carte Véhicules le dit en attention (`avisAuDelaDesLignes`), sans rien refuser.
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
  // Vide pour un véhicule qui n'est pas dit inscrit au registre ; « à saisir » pour un inscrit sans montant.
  amortissements: MontantDuCadre7
}

export interface Cadre7ARemplir {
  lignes: LigneDuCadre7[]
  totalA: MontantDuCadre7
  // La somme des amortissements à réintégrer, « à saisir », ou rien (voir plus haut).
  totalB: MontantDuCadre7
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

// Les lignes de véhicules que le formulaire offre (le millésime 2026 en trace deux, que lib/gabaritCadre7.ts relit).
export const LIGNES_DE_VEHICULES_DU_FORMULAIRE = 2

// CADRE7-Q3 : plus de véhicules au barème que le formulaire n'a de lignes, sur un exercice. Dit en attention, jamais refusé.
export function avisAuDelaDesLignes(vehicules: readonly VehiculeDossier[], annee: number): string | null {
  const n = vehicules.filter((v) => v.annee === annee && v.km_professionnel > 0).length
  if (n <= LIGNES_DE_VEHICULES_DU_FORMULAIRE) return null
  return `${n} véhicules au barème sur ${annee} : déconseillé. Le cadre 7 de la 2035-B n'a que `
    + `${LIGNES_DE_VEHICULES_DU_FORMULAIRE} lignes ; les autres véhicules se portent sur un état annexe, que l'application `
    + "n'imprime pas, et le total A les compte tous."
}

// Le montant à réintégrer d'un véhicule inscrit, en centimes ; null quand il n'est pas dit, ou ne se croit pas (négatif).
function amortissementsEnCentimes(v: VehiculeDossier): number | null {
  const m = v.amortissements_a_reintegrer
  if (m === null || !Number.isFinite(Number(m)) || Number(m) < 0) return null
  return Math.round(Number(m) * 100)
}

// La colonne des amortissements, ligne par ligne dans l'ordre du cadre, et le total B. Un montant nul ne s'imprime pas.
function amortissementsDuCadre(
  auBareme: readonly VehiculeDossier[], amortissementsAReintegrer: boolean,
): { parLigne: MontantDuCadre7[]; totalB: MontantDuCadre7 } {
  // `undefined` : non inscrit ; `null` : inscrit, montant non dit.
  const inscrits = auBareme.map((v) => (v.inscrit_immobilisations ? amortissementsEnCentimes(v) : undefined))
  const dits = inscrits.filter((c): c is number => typeof c === 'number')
  const manquant = inscrits.some((c) => c === null)
  const totalEuros = eurosArrondis(dits.reduce((s, c) => s + c, 0))
  const repartis = manquant ? dits.map(eurosArrondis) : repartirEnEuros(dits, totalEuros)
  let k = 0
  const parLigne = inscrits.map((c): MontantDuCadre7 => {
    if (c === undefined) return null
    if (c === null) return 'a_saisir'
    const euros = repartis[k]
    k += 1
    return euros === 0 ? null : euros
  })
  const aucunInscrit = inscrits.every((c) => c === undefined)
  const totalB: MontantDuCadre7 = manquant || (aucunInscrit && amortissementsAReintegrer)
    ? 'a_saisir'
    : totalEuros === 0 ? null : totalEuros
  return { parLigne, totalB }
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

  const amortissements = amortissementsDuCadre(auBareme, amortissementsAReintegrer)
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
    amortissements: amortissements.parLigne[i],
  }))

  return {
    cadre: {
      lignes,
      totalA: ecart ? null : toutesCalculees ? totalEuros : 'a_saisir',
      totalB: amortissements.totalB,
    },
    ecart,
  }
}
