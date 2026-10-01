import { dotationSurPeriode } from './amortissements'
import { anneeDe, jourDe, moisDe } from './format'
import type { PartDuReleve } from './partsDuReleve'
import { montantRetenu } from './montantRetenu'
import { partDansLaPeriode, rattachements, type PaiementsDesPieces } from './rattachement'
import type { CotisationComptee } from './cotisationRapprochee'
import type { Categorie, Immobilisation, ModeComptable, Piece } from './types'

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
): SituationIntermediaire {
  const categorieById = new Map(categories.map((c) => [c.id, c]))
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))

  const totauxParPoste = new Map<string, number>()
  for (const p of pieces) {
    if (p.statut !== 'validee') continue
    if (immobilisationPieceIds.has(p.id)) continue
    // En trésorerie, la période de la pièce est celle de son PAIEMENT, sa date de facture à défaut : la
    // règle de la 2035 (voir lib/rattachement.ts). Un état arrêté au 31 janvier ne porte donc pas une
    // facture de janvier réglée en février, et porte celle de décembre réglée en janvier. En
    // engagement, c'est celle de sa facture.
    const part = partDansLaPeriode(rattachements(p, paiements.get(p.id) ?? [], mode), periodeDebut, periodeFin)
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

  return { periodeDebut, periodeFin, totauxParPoste: entries, recettes, charges, resultat: recettes - charges }
}
