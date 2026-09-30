import {
  ecritureConforme, ecrituresSansPieceParMouvement, natureDuCompte,
  type LigneEcritureMouvement, type MouvementBancaire, type NatureCompte,
} from './affectationBanque'
import { libelleExploitable } from './appariementBanque'
import { COMPTE_BANQUE } from './comptes'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { Categorie, EcritureBrouillon, VentilationBancaire } from './types'
import { compteDuDirigeant } from './virementPersonnel'

// UN MOUVEMENT SANS JUSTIFICATIF SE VENTILE SUR PLUSIEURS COMPTES (ligne 26.6 de la feuille de route,
// étape a). Une affectation met tout le mouvement dans UNE catégorie ; or un même paiement mêle souvent ce
// que la 2035 sépare :
//   - une dépense en partie personnelle — l'abonnement téléphonique pris en charge à 70 %, le reste
//     prélevé par l'exploitant : la part professionnelle en charge, l'autre sur le compte du dirigeant ;
//   - un achat qui relève de deux postes ;
//   - une remise de carte bancaire créditée NETTE de sa commission : la recette brute au 706, la
//     commission au 627, en sens inverse du mouvement.
//
// UNE PART S'ÉCRIT COMME UNE AFFECTATION DE SON MONTANT (voir affectationBanque.ts) : le compte de sa
// catégorie — ou celui du dirigeant — dans le sens de son SIGNE, jamais dans celui de la nature du compte.
// Le montant d'une part est signé comme le relevé (positif, une entrée ; négatif, une sortie), et la somme
// des parts est le mouvement. L'écriture est composée ICI (testée) ; la fonction SQL
// `ventiler_mouvement_bancaire` la vérifie, puis l'écrit AVEC la ventilation et ses parts, dans une
// transaction (voir `supabase/essais/ventilation.sql`).
//
// CE QUE LA BASE NE TIENT PAS SEULE : que les parts d'un mouvement ventilé fassent son montant. C'est un
// invariant entre lignes, qu'aucune contrainte de ligne ne dit, et un déclencheur différé rendrait
// impossible la restauration d'une sauvegarde. La fonction le vérifie ; `ventilationsIncoherentes` dit un
// écart venu d'un autre chemin (défensif).

export type PartSaisie = Pick<VentilationBancaire, 'categorie_id' | 'part_personnelle' | 'montant'>

const centimes = (n: number) => Math.round(n * 100)
const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

// L'écran fait saisir les montants DANS LE SENS DU MOUVEMENT — un paiement de 120 € se ventile en 80 et
// 40, pas en −80 et −40 —, et un montant négatif va en sens inverse : la commission retenue sur une remise.
// Le passage d'une forme à l'autre ne s'écrit qu'ici : c'est la même opération dans les deux sens.
const dansLeSens = (ligne: Pick<MouvementBancaire, 'montant'>, montant: number) =>
  centimes(ligne.montant < 0 ? -montant : montant) / 100

export function montantSigne(ligne: Pick<MouvementBancaire, 'montant'>, montantSaisi: number): number {
  return dansLeSens(ligne, montantSaisi)
}

export function montantSaisi(ligne: Pick<MouvementBancaire, 'montant'>, part: Pick<PartSaisie, 'montant'>): number {
  return dansLeSens(ligne, part.montant)
}

// Ce qu'il reste à ventiler, dans le sens du mouvement : zéro quand les parts font le mouvement, négatif
// quand elles le dépassent. En centimes, pour que 0,1 + 0,2 ne laisse pas un reste de 0,000…04.
export function resteAVentiler(ligne: Pick<MouvementBancaire, 'montant'>, montantsSaisis: readonly number[]): number {
  return (Math.abs(centimes(ligne.montant)) - montantsSaisis.reduce((s, m) => s + centimes(m), 0)) / 100
}

// Pourquoi ce mouvement ne peut pas être ventilé ainsi, dit AVANT d'écrire. La base refait les mêmes refus
// (`ventiler_mouvement_bancaire`), dans le même ordre, plus celui d'une écriture déjà validée, que l'écran ne
// lit pas : l'écran les dit pour qu'on ne clique pas pour rien, la base pour qu'aucun chemin ne les
// contourne. Un mouvement déjà VENTILÉ n'est pas refusé : une nouvelle ventilation remplace la précédente.
export function refusVentilation(
  ligne: MouvementBancaire,
  parts: readonly PartSaisie[],
  categories: readonly Pick<Categorie, 'id' | 'libelle' | 'compte_comptable'>[],
  assujettiTva: boolean,
): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.emprunt_id || ligne.prelevement_personnel) {
    return 'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie ou classé en virement personnel : annule d’abord ce classement.'
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  if (parts.length < 2) return 'Une ventilation porte au moins deux parts.'
  for (const p of parts) {
    if ((p.categorie_id ? 1 : 0) + (p.part_personnelle ? 1 : 0) !== 1) {
      return 'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'
    }
    if (!Number.isFinite(p.montant) || p.montant === 0 || !auCentime(p.montant)) {
      return 'Chaque part porte un montant non nul, au centime.'
    }
  }
  if (new Set(parts.map((p) => p.categorie_id ?? 'dirigeant')).size !== parts.length) {
    return 'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'
  }
  // Les montants sont dits dans le sens du mouvement, comme l'opérateur les a saisis : « 120 € au lieu
  // des 150 € » d'un paiement, pas « −120 € au lieu des −150 € ».
  const somme = parts.reduce((s, p) => s + centimes(p.montant), 0)
  if (somme !== centimes(ligne.montant)) {
    return `Les parts font ${formatMoney(dansLeSens(ligne, somme / 100))} au lieu des ${formatMoney(Math.abs(ligne.montant))} du mouvement.`
  }
  const parId = new Map(categories.map((c) => [c.id, c]))
  const ciblees = []
  for (const p of parts) {
    if (!p.categorie_id) continue
    const c = parId.get(p.categorie_id)
    if (!c) return 'Cette catégorie n’existe pas pour ce dossier.'
    ciblees.push(c)
  }
  // La première dans l'ordre des libellés, comme la base : deux catégories fautives ne font pas deux
  // messages différents selon l'ordre des parts.
  const horsResultat = ciblees.filter((c) => !natureDuCompte(c.compte_comptable)).sort((a, b) => a.libelle.localeCompare(b.libelle))
  if (horsResultat.length > 0) {
    return `La catégorie « ${horsResultat[0].libelle} » n’a pas de compte de charge ou de produit (classe 6 ou 7).`
  }
  // UNE RECETTE D'UN DOSSIER ASSUJETTI PORTE DE LA TVA, que rien ici ne saurait calculer — le refus de
  // l'affectation, pour la même raison (voir `refusAffectation`).
  if (assujettiTva && ciblees.some((c) => natureDuCompte(c.compte_comptable) === 'recette')) {
    return 'Sur un dossier assujetti à la TVA, une recette sans facture n’est pas encore prise en charge : sa TVA ne serait pas calculée. Dépose la facture et rapproche-la.'
  }
  return null
}

// L'écriture d'un mouvement ventilé : une ligne par part — le compte de sa catégorie, ou celui du
// dirigeant lu dans le modèle du dossier —, puis la banque. LE SENS VIENT DU SIGNE : une part positive
// (une entrée) crédite son compte, une négative le débite, et la banque prend le sens du mouvement. Les
// montants passent par les centimes, pour que les lignes s'équilibrent exactement — la base refuse une
// écriture déséquilibrée d'un centime.
//
// NUL quand une part ne peut pas s'écrire : sa catégorie est absente de la liste fournie, ou n'a plus de
// compte de résultat. L'appelant l'a refusée avant (`refusVentilation`) ou le signale
// (`mouvementsVentilesDesynchronises`).
export function ecritureDeLaVentilation(
  ligne: MouvementBancaire,
  parts: readonly PartSaisie[],
  categories: readonly Pick<Categorie, 'id' | 'compte_comptable'>[],
  modele: ModeleComptable,
): LigneEcritureMouvement[] | null {
  const libelle = libelleExploitable(ligne) || ligne.libelle
  const parId = new Map(categories.map((c) => [c.id, c]))
  const lignes: LigneEcritureMouvement[] = []
  for (const p of parts) {
    let compte: string | null = null
    if (p.part_personnelle) {
      compte = compteDuDirigeant(modele)
    } else if (p.categorie_id) {
      const c = parId.get(p.categorie_id)
      compte = c && natureDuCompte(c.compte_comptable) ? c.compte_comptable : null
    }
    if (!compte) return null
    lignes.push({ compte, sens: p.montant > 0 ? 'credit' : 'debit', montant: Math.abs(centimes(p.montant)) / 100, libelle })
  }
  lignes.push({ compte: COMPTE_BANQUE, sens: ligne.montant > 0 ? 'debit' : 'credit', montant: Math.abs(centimes(ligne.montant)) / 100, libelle })
  return lignes
}

// Les parts, rangées par mouvement.
export function partsParMouvement<P extends Pick<VentilationBancaire, 'ligne_bancaire_id'>>(parts: readonly P[]): Map<string, P[]> {
  const parLigne = new Map<string, P[]>()
  for (const p of parts) parLigne.set(p.ligne_bancaire_id, [...(parLigne.get(p.ligne_bancaire_id) ?? []), p])
  return parLigne
}

export interface PartVentilee {
  ligne: MouvementBancaire
  categorie: Categorie
  // Nulle quand le compte de la catégorie n'est plus un compte de résultat (voir `MouvementAffecte`).
  nature: NatureCompte | null
  // Le montant de la part, signé comme le relevé.
  montant: number
  // Ce que la part ajoute à son poste, positif quand elle l'augmente : une recette encaissée ou une
  // dépense payée ; négatif pour la commission retenue sur une remise rangée en recettes, ou un
  // remboursement.
  montantPoste: number
}

// LES PARTS DES MOUVEMENTS VENTILÉS, pour la 2035 et les états qui la déclinent (lib/partsDuReleve.ts) : une
// part par catégorie, à la date du MOUVEMENT. La part personnelle n'en est pas : elle va au compte du
// dirigeant, ni charge ni recette. Seuls comptent les mouvements RAPPROCHÉS et VENTILÉS — une part dont le
// mouvement ne l'est pas est un écart que `ventilationsIncoherentes` dit, pas une dépense. Une catégorie
// absente de la liste fournie (une lecture partielle, que l'écran signale déjà) écarte la part : on ne
// compte pas ce qu'on ne sait pas ranger.
export function partsDesVentilations(
  lignes: readonly MouvementBancaire[],
  ventilations: readonly VentilationBancaire[],
  categories: readonly Categorie[],
): PartVentilee[] {
  const parLigne = partsParMouvement(ventilations)
  const parId = new Map(categories.map((c) => [c.id, c]))
  const resultat: PartVentilee[] = []
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.ventilee) continue
    for (const part of parLigne.get(ligne.id) ?? []) {
      if (!part.categorie_id) continue
      const categorie = parId.get(part.categorie_id)
      if (!categorie) continue
      const nature = natureDuCompte(categorie.compte_comptable)
      resultat.push({ ligne, categorie, nature, montant: part.montant, montantPoste: nature === 'depense' ? -part.montant : part.montant })
    }
  }
  return resultat
}

// LES MOUVEMENTS VENTILÉS EN PARTIE EN RECETTE SUR UN DOSSIER DEVENU ASSUJETTI : le pendant de
// `recettesAffecteesSurDossierAssujetti`. La base refuse d'en ventiler un nouveau, mais un dossier peut le
// devenir après coup, et ses recettes restent écrites au TTC : leur TVA collectée n'est dans aucune CA3.
// Un mouvement par entrée, même s'il porte deux parts de recette.
export function recettesVentileesSurDossierAssujetti(
  parts: readonly PartVentilee[],
  assujettiTva: boolean,
): MouvementBancaire[] {
  if (!assujettiTva) return []
  const parLigne = new Map<string, MouvementBancaire>()
  for (const p of parts) if (p.nature === 'recette') parLigne.set(p.ligne.id, p.ligne)
  return [...parLigne.values()]
}

export type RaisonIncoherence = 'moins_de_deux_parts' | 'somme_differente' | 'parts_sans_ventilation'

export interface VentilationIncoherente {
  ligne: MouvementBancaire
  raison: RaisonIncoherence
}

// UNE VENTILATION QUE SES PARTS NE DISENT PLUS : un mouvement ventilé qui porte moins de deux parts, ou des
// parts qui ne font pas son montant ; ou des parts sur un mouvement qui n'est pas ventilé. La transaction de
// la base écrit le drapeau et les parts ensemble et vérifie la somme, donc le cas ne vient pas d'un échec à
// mi-chemin : il est défensif, pour qu'une part écrite ou retirée par un autre chemin ne fausse pas la 2035
// en silence. À ne regarder que sur des lectures COMPLÈTES des mouvements et des parts — sinon une part non
// lue passerait pour une part manquante.
export function ventilationsIncoherentes(
  lignes: readonly MouvementBancaire[],
  ventilations: readonly VentilationBancaire[],
): VentilationIncoherente[] {
  const parLigne = partsParMouvement(ventilations)
  const incoherentes: VentilationIncoherente[] = []
  for (const ligne of lignes) {
    const parts = parLigne.get(ligne.id) ?? []
    if (ligne.ventilee) {
      if (parts.length < 2) incoherentes.push({ ligne, raison: 'moins_de_deux_parts' })
      else if (parts.reduce((s, p) => s + centimes(p.montant), 0) !== centimes(ligne.montant)) {
        incoherentes.push({ ligne, raison: 'somme_differente' })
      }
    } else if (parts.length > 0) {
      incoherentes.push({ ligne, raison: 'parts_sans_ventilation' })
    }
  }
  return incoherentes
}

// UN MOUVEMENT VENTILÉ DONT L'ÉCRITURE N'EST PLUS CELLE QUE SES PARTS PRODUIRAIENT : absente, sur un autre
// compte, d'un autre montant, dans un autre sens ou à une autre date. La transaction de la base les écrit
// ensemble ; le cas vient d'une CATÉGORIE dont le compte a changé depuis — le défaut d'un mouvement affecté
// dont la catégorie a changé de compte (`mouvementsAffectesDesynchronises`), invisible de la même façon,
// les totaux ne bougeant pas. « Réécrire » la réécrit depuis les mêmes parts.
//
// Ne juge que les ventilations COHÉRENTES — les autres sont dites par `ventilationsIncoherentes`, et les
// compter ici ferait dire deux fois la même chose. Une catégorie absente de la liste fournie écarte le
// mouvement (on ne juge pas ce qu'on n'a pas lu) ; une catégorie présente mais sortie des comptes de
// résultat le rend périmé, comme pour une affectation.
export function mouvementsVentilesDesynchronises<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  ventilations: readonly VentilationBancaire[],
  categories: readonly Categorie[],
  modele: ModeleComptable,
): L[] {
  const ecrituresParLigne = ecrituresSansPieceParMouvement(ecritures)
  const parLigne = partsParMouvement(ventilations)
  const incoherentes = new Set(ventilationsIncoherentes(lignes, ventilations).map((v) => v.ligne.id))
  const connues = new Set(categories.map((c) => c.id))
  return lignes.filter((ligne) => {
    if (!ligne.ventilee || ligne.statut !== 'rapprochee' || incoherentes.has(ligne.id)) return false
    const parts = parLigne.get(ligne.id) ?? []
    if (parts.some((p) => p.categorie_id && !connues.has(p.categorie_id))) return false
    const attendue = ecritureDeLaVentilation(ligne, parts, categories, modele)
    if (!attendue) return true
    return !ecritureConforme(ecrituresParLigne.get(ligne.id) ?? [], attendue, ligne.date)
  })
}
