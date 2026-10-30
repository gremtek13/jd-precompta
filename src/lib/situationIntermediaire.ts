import { dotationSurPeriode } from './amortissements'
import { anneeDe, jourDe, moisDe } from './format'
import type { PartDuReleve } from './partsDuReleve'
import { montantRetenu } from './montantRetenu'
import { partDansLaPeriode, rattachements, type PaiementsDesPieces } from './rattachement'
import type { CotisationComptee } from './cotisationRapprochee'
import type { Categorie, Immobilisation, ModeComptable, Piece } from './types'
import {
  POSTE_VENTES_FACTUREES, categorieDesFraisBancaires, type EcrituresDesVentesDeLa2035, type FraisSansPoste,
} from './declaration2035'
import { fraisDesMouvements } from './ecrituresVentesFacturees'
import type { PlanComptable } from './planComptable'
import type { RecetteDeCaisse, RecettesDeCaisse } from './recettesDeCaisse'
import {
  exemplaireDUneFactureSource, recettesFactureesDeLaPeriode, type ExcedentVenteFacturee, type VenteEcartee, type VentesFacturees,
} from './ventesFacturees'

// Exporté parce que `ratiosBancaires.ts` doit retrouver ce poste dans `totauxParPoste` pour calculer
// la CAF. Il le cherchait par une chaîne littérale écrite de son côté : renommer le poste ici aurait
// fait rendre 0 à ce `find`, donc une CAF sous-estimée et une capacité de remboursement surévaluée —
// un chiffre montré à une banque, faux sans le moindre signal.
export const POSTE_AMORTISSEMENTS = 'Amortissements'
const POSTE_COTISATIONS = 'Cotisations sociales personnelles'

export interface SituationIntermediaire {
  periodeDebut: string
  periodeFin: string
  totauxParPoste: [string, number][]
  recettes: number
  charges: number
  resultat: number
  // LES VENTES FACTURÉES (ligne 28.6, chantier EC-Q3, étape VF3b3), ce qu'elles retirent ou n'ont pas pu compter, pour que
  // l'écran le DISE — comme la 2035 dont cet état est la version « à ce jour ». Les exemplaires d'une facture source que la
  // période aurait comptés : la vente l'est par sa facture.
  exemplairesDeFacturesSources: Piece[]
  // Les factures sources que le module ne sait pas compter sans deviner : celles du DOSSIER, tous exercices — le module ne
  // date pas une facture qu'il écarte (lib/declaration2035.ts, `ventesFactureesEcartees`).
  ventesFactureesEcartees: VenteEcartee[]
  // Les taux encaissés au-delà de la facture nette de ses avoirs : comptés — l'argent a été reçu —, et dits. Du dossier.
  ventesFactureesEnExcedent: ExcedentVenteFacturee[]
  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS QUE NULLE LIGNE NE PORTE (ligne 28.65, chantier EC-Q3) : ceux de la période,
  // quand la catégorie « Frais bancaires » du dossier manque ou n'a pas de poste. Le trou que la 2035 dit
  // (`exclusions.fraisSansPoste`), dit ici pour la même raison : une charge payée qui manque à l'état montré à une banque
  // flatte le résultat sans un signe.
  fraisSansPoste: FraisSansPoste[]
  // LES RECETTES DE CAISSE DE LA PÉRIODE QUE NULLE LIGNE NE PORTE (étape C3a) : leur catégorie n'a pas de poste, ou n'est
  // plus un produit. Dites, comme la 2035 les dit : une recette qui manque à l'état montré à une banque se tairait sinon.
  recettesDeCaisseSansPoste: RecetteDeCaisse[]
}

// Situation intermédiaire — première brique du "dossier bancaire automatisé" (voir CLAUDE.md) :
// même logique de regroupement par poste 2035 que ClotureTab (recettes, achats, charges sociales,
// amortissements...), mais sur une période libre (du 1er janvier de l'exercice jusqu'à une date
// choisie) plutôt qu'une année civile entière — pour produire un état "à ce jour" sans attendre la
// clôture. La dotation d'amortissement y est celle de la PÉRIODE (`dotationSurPeriode`,
// lib/amortissements.ts) : le calcul de la 2035, prorata temporis depuis la mise en service, rapporté
// aux jours de la période.

// Part de l'année civile couverte par la période, en convention 30/360 — celle des amortissements
// linéaires (`rang360`, lib/amortissements.ts).
//
// Elle compte les jours écoulés jusqu'à chaque borne et rend leur écart. Un 31 décembre vaut
// 360/360 exactement, ce qui laisse une année complète inchangée.
//
// CE QU'ELLE SUPPOSE, ET QUI EST VRAI DE SES DEUX APPELANTS : les deux bornes tombent dans la MÊME
// année civile (`FinancementTab` pose toujours `periodeDebut` au 1er janvier de l'année de
// `periodeFin`). Sur une période à cheval elle rendrait la fraction du CALENDRIER et non la durée
// réelle — ce n'est pas un repli prudent, c'est un résultat faux, donc l'appelant qui voudrait une
// telle période aurait d'abord à décider ce que « dotation de la période » veut dire pour lui.
// Écrit comme une limite plutôt que laissé croire à une généralité.
export function fractionDeLAnnee(periodeDebut: string, periodeFin: string): number {
  const jours = (date: string, inclus: boolean) =>
    (moisDe(date) - 1) * 30 + (inclus ? Math.min(jourDe(date), 30) : Math.min(jourDe(date) - 1, 29))
  return Math.max(0, jours(periodeFin, true) - jours(periodeDebut, false)) / 360
}

// Les mois écoulés depuis le 1er janvier, en 30/360 — le diviseur qui annualise un chiffre observé
// sur une partie de l'année (voir ratiosBancaires.ts).
//
// L'écran lisait `new Date().getMonth() + 1`, c'est-à-dire le NUMÉRO du mois courant. Ce nombre
// n'est exact que le DERNIER jour de chaque mois : le 1er septembre il annonce 9 quand 8 sont
// écoulés, et le 1er février il annonce 2 pour un seul. Mesuré sur la CAF, qu'il divise : la valeur
// annoncée valait 52 % de la juste au 1er février, 84 % au 1er juin — toujours dans le sens
// pessimiste, donc jamais flatteuse, mais jamais vraie non plus, et le libellé de l'écran REPREND ce
// nombre (« sur N mois écoulés cette année »).
export function moisEcoulesDeLAnnee(dateDuJour: string): number {
  return fractionDeLAnnee(`${anneeDe(dateDuJour)}-01-01`, dateDuJour) * 12
}

export function calculerSituationIntermediaire(
  pieces: Piece[], categories: Categorie[], immobilisations: Immobilisation[],
  // Les échéances à la date et au montant auxquels elles comptent (`cotisationsComptees`,
  // lib/cotisationRapprochee.ts) : celles du mouvement qui les paie, sinon leur échéance — la règle de la
  // 2035, et la date de l'écriture du FEC.
  cotisations: readonly CotisationComptee[],
  periodeDebut: string, periodeFin: string,
  // TVA comprise pour un dossier exonéré, hors taxes pour un assujetti — la règle de la 2035 (voir
  // lib/montantRetenu.ts), sur l'état qu'on montre à une banque.
  assujettiTva: boolean,
  // Les paiements de chaque pièce, parts de règlements groupés comprises (`paiementsDesPieces`), qui
  // DATENT les pièces (voir lib/rattachement.ts) : une pièce compte dans la période de son paiement,
  // comme dans la 2035 dont cet état est la version « à ce jour ». Sans valeur par défaut — une liste
  // vide ferait tout compter à la date de facture.
  paiements: PaiementsDesPieces,
  // Le modèle comptable du dossier : en ENGAGEMENT, une pièce compte à la date de sa facture, le
  // paiement ne datant rien (lib/rattachement.ts, `rattachements`). Sans valeur par défaut, pour la
  // même raison que les paiements.
  mode: ModeComptable,
  // Ce que le relevé compte sans justificatif (lib/partsDuReleve.ts) — mouvements affectés, intérêts et
  // assurance des échéances d'emprunt —, dans la période de leur DATE, comme la 2035 dont cet état est
  // la version « à ce jour ». Sans valeur par défaut : les oublier montrerait à une banque un cabinet
  // sans ses encaissements, et sans ses frais financiers.
  partsDuReleve: readonly PartDuReleve[],
  // Les ventes facturées du dossier (lib/ventesFacturees.ts, lues par lib/ventesFactureesLecture.ts) : une facture validée
  // SOURCE de sa vente compte elle-même — en trésorerie, les parts de ses encaissements datées dans la période, pour leur
  // hors-taxe (CGI, art. 93, 1) ; en engagement, la facture et ses avoirs à leur date d'émission (EC3-Q12) —, sous le poste
  // de la case AA, comme dans la 2035 ; la pièce désignée comme son exemplaire ne compte plus. Sans valeur par défaut : un
  // appelant qui les oublierait montrerait à une banque un dossier qui facture dans l'application sans ses ventes ; des
  // ventes vides par commodité compteraient l'exemplaire à la place de sa facture.
  ventesFacturees: VentesFacturees,
  // Le plan du dossier : la composition porte les frais d'un mouvement d'encaissements au compte des services bancaires DE
  // CE PLAN, et c'est là que `fraisDesMouvements` les lit. La situation n'en lit rien d'autre. Sans valeur par défaut : un
  // plan par défaut chercherait les frais d'un dossier qui en règle un autre sur un compte qu'aucune écriture ne porte.
  plan: Pick<PlanComptable, 'services_bancaires'>,
  // Les écritures des ventes facturées du dossier, d'où la 2035 tire les frais d'un mouvement d'encaissements
  // (lib/declaration2035.ts, `EcrituresDesVentesDeLa2035`) : la situation, sa version « à ce jour », les tire de même. Sans
  // valeur par défaut : un appelant qui les oublierait montrerait à une banque un dossier basculé sans ses frais bancaires,
  // un résultat flatté ; l'absence de bascule se DIT (`sans_bascule`).
  ecrituresDesVentes: EcrituresDesVentesDeLa2035,
  // Les recettes de caisse du dossier (étape C3a ; lib/recettesDeCaisse.ts), dans la période de leur date, comme dans la 2035
  // dont cet état est la version « à ce jour ». Sans valeur par défaut : les oublier montrerait à une banque un praticien
  // sans ses recettes en espèces. Absente (le drapeau baissé), elle ne change rien.
  recettesDeCaisse: RecettesDeCaisse,
): SituationIntermediaire {
  const categorieById = new Map(categories.map((c) => [c.id, c]))
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))

  const totauxParPoste = new Map<string, number>()
  const exemplairesDeFacturesSources: Piece[] = []
  for (const p of pieces) {
    if (p.statut !== 'validee') continue
    if (immobilisationPieceIds.has(p.id)) continue
    // En trésorerie, la période de la pièce est celle de son PAIEMENT, sa date de facture à défaut : la
    // règle de la 2035 (voir lib/rattachement.ts). Un état arrêté au 31 janvier ne porte donc pas une
    // facture de janvier réglée en février, et porte celle de décembre réglée en janvier. En
    // engagement, c'est celle de sa facture.
    const part = partDansLaPeriode(rattachements(p, paiements.get(p.id) ?? [], mode), periodeDebut, periodeFin)
    // L'EXEMPLAIRE D'UNE FACTURE SOURCE NE COMPTE PLUS : sa facture compte la vente, plus bas. Dit seulement dans la période
    // où la pièce aurait compté, par la même règle de date qu'une autre.
    if (exemplaireDUneFactureSource(p, ventesFacturees)) {
      if (part !== 0) exemplairesDeFacturesSources.push(p)
      continue
    }
    if (part === 0) continue
    const cat = p.categorie_id ? categorieById.get(p.categorie_id) : null
    if (!cat?.poste_2035) continue
    const montant = (montantRetenu(p, assujettiTva) ?? 0) * part
    const signe = p.type_piece === 'vente' ? 1 : -1
    totauxParPoste.set(cat.poste_2035, (totauxParPoste.get(cat.poste_2035) ?? 0) + signe * montant)
  }

  // Le relevé : chaque part à la date de son mouvement, dans son poste, signée comme sa nature — une
  // recette en positif, une dépense en négatif, un remboursement à l'inverse.
  for (const p of partsDuReleve) {
    if (p.ligne.date < periodeDebut || p.ligne.date > periodeFin) continue
    if (!p.nature || !p.poste) continue
    const signe = p.nature === 'recette' ? 1 : -1
    totauxParPoste.set(p.poste, (totauxParPoste.get(p.poste) ?? 0) + signe * p.montantPoste)
  }

  // LES RECETTES DE CAISSE DE LA PÉRIODE (étape C3a), au poste de leur catégorie, pour ce qu'elles ajoutent à ce poste — la
  // règle de la 2035 —, en centimes entiers jusqu'au poste. Une caisse absente n'ajoute rien, ni ligne ni zéro.
  const recettesDeCaisseSansPoste: RecetteDeCaisse[] = []
  if (recettesDeCaisse.etat === 'lue') {
    const parPoste = new Map<string, number>()
    for (const r of recettesDeCaisse.recettes) {
      if (r.date < periodeDebut || r.date > periodeFin) continue
      if (r.nature !== 'recette' || !r.poste) {
        recettesDeCaisseSansPoste.push(r)
        continue
      }
      parPoste.set(r.poste, (parPoste.get(r.poste) ?? 0) + r.htCentimes)
    }
    for (const [poste, centimes] of parPoste) {
      if (centimes !== 0) totauxParPoste.set(poste, (totauxParPoste.get(poste) ?? 0) + centimes / 100)
    }
  }

  // Les ventes facturées de la période, au poste de la case AA, en centimes entiers jusqu'au bout : la règle de
  // `recettesFactureesDeLaPeriode`, celle de l'estimation. Une période sans aucune n'a pas de ligne — un dossier qui n'a pas
  // basculé garde l'état d'hier, ligne pour ligne.
  const facturees = recettesFactureesDeLaPeriode(ventesFacturees, periodeDebut, periodeFin, mode)
  if (facturees !== 0) {
    totauxParPoste.set(POSTE_VENTES_FACTUREES, (totauxParPoste.get(POSTE_VENTES_FACTUREES) ?? 0) + facturees / 100)
  }

  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS (ligne 28.65, chantier EC-Q3 ; la règle de la 2035, VF4C3-Q1) : quand la
  // banque crédite un peu moins que les encaissements qu'un mouvement règle, l'écriture du mouvement porte la différence au
  // compte des services bancaires — une charge payée à la date du MOUVEMENT. Les MÊMES fonctions que la 2035, jamais une
  // règle recopiée : `fraisDesMouvements` lit la sortie de la composition, rien n'est recalculé ; `categorieDesFraisBancaires`
  // choisit la catégorie (celle du dossier, sinon la commune), dont le poste reçoit la dépense. Sans catégorie ou sans
  // poste : nulle part, et dit (`fraisSansPoste`), jamais un poste deviné. En trésorerie comme en engagement : la
  // composition écrit le mouvement de la même façon dans les deux modes (lib/ecrituresVentesFacturees.ts, « Les mouvements
  // que des encaissements citent », qui ne lit pas le mode). En centimes entiers jusqu'à la ligne, comme les ventes
  // facturées. Sans bascule, rien : l'état d'hier, ligne pour ligne.
  const fraisSansPoste: FraisSansPoste[] = []
  if (ecrituresDesVentes.etat === 'composees') {
    const composition = ecrituresDesVentes.composition
    const categorieFrais = categorieDesFraisBancaires(categories, composition.dossierId)
    let fraisCentimes = 0
    for (const frais of fraisDesMouvements(composition, plan)) {
      if (frais.date < periodeDebut || frais.date > periodeFin) continue
      if (!categorieFrais?.poste_2035) {
        fraisSansPoste.push({ frais, categorie: categorieFrais })
        continue
      }
      fraisCentimes += frais.centimes
    }
    const poste = categorieFrais?.poste_2035
    if (poste && fraisCentimes !== 0) totauxParPoste.set(poste, (totauxParPoste.get(poste) ?? 0) - fraisCentimes / 100)
  }

  // LA DOTATION SUIT LA PÉRIODE ANNONCÉE. Cet état porte en tête « Période du 1er janvier au <date
  // choisie> », et sa ligne « Amortissements » comptait jusqu'au 22/09/2026 UNE ANNÉE ENTIÈRE de dotation
  // quelle que soit cette date — au 31 janvier, un bien de 12 000 € sur 5 ans affichait un résultat
  // NÉGATIF de 1 600 € sur 800 € de recettes, un déficit fabriqué par la convention sur le document qui
  // part à une banque. Elle était ensuite rapportée à la fraction de l'année, en partant du 1er janvier
  // et non de la mise en service.
  //
  // C'est maintenant l'écart de l'amortissement cumulé entre la veille du début et la fin de la période
  // (`dotationSurPeriode`) : le calcul de la 2035, jour par jour en 30/360. Un bien mis en service en
  // cours de période ne compte que depuis sa mise en service, un bien mis en service après la date de
  // l'état ne compte pas, et l'année civile complète rend exactement la dotation de l'exercice — le
  // PRÉVISIONNEL, qui appelle cette fonction sur l'année entière, compte donc la case CH de la 2035.
  const totalAmortissements = immobilisations.reduce((sum, i) => sum + dotationSurPeriode(i, periodeDebut, periodeFin), 0)
  if (totalAmortissements > 0) {
    totauxParPoste.set(POSTE_AMORTISSEMENTS, -Math.round(totalAmortissements * 100) / 100)
  }

  const totalCotisations = cotisations.reduce((sum, c) => {
    if (c.date < periodeDebut || c.date > periodeFin) return sum
    return sum + c.montant
  }, 0)
  if (totalCotisations > 0) totauxParPoste.set(POSTE_COTISATIONS, -totalCotisations)

  const entries = [...totauxParPoste.entries()].sort((a, b) => b[1] - a[1])
  // Résultat = simple somme des postes signés (produits positifs, charges déjà négatives) — pas
  // besoin de reséparer recettes/charges pour l'obtenir ; recettes/charges ci-dessous ne servent
  // qu'à l'affichage (deux totaux positifs plutôt qu'un mélange de signes).
  const recettes = entries.filter(([, m]) => m > 0).reduce((s, [, m]) => s + m, 0)
  const charges = entries.filter(([, m]) => m < 0).reduce((s, [, m]) => s - m, 0)

  return {
    periodeDebut, periodeFin, totauxParPoste: entries, recettes, charges, resultat: recettes - charges,
    exemplairesDeFacturesSources,
    ventesFactureesEcartees: [...ventesFacturees.ecartees],
    ventesFactureesEnExcedent: [...ventesFacturees.excedents],
    fraisSansPoste,
    recettesDeCaisseSansPoste,
  }
}
