import { anneeDe, jourDe, moisDe } from './format'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from './types'

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
// clôture. Simplification assumée, comme dans ClotureTab : la dotation d'amortissement d'un bien est
// comptée en entier dès que la date de fin tombe dans son année d'acquisition ou une année suivante
// couverte par sa durée, jamais proratisée au nombre de mois déjà écoulés dans l'année en cours.
// Part de l'année civile couverte par la période, en convention 30/360 — celle des amortissements
// linéaires, déjà retenue par `fractionPremiereAnnee` dans declaration2035.ts.
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
  pieces: Piece[], categories: Categorie[], immobilisations: Immobilisation[], cotisations: CotisationDeclaree[],
  periodeDebut: string, periodeFin: string,
): SituationIntermediaire {
  const categorieById = new Map(categories.map((c) => [c.id, c]))
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))
  const anneeFin = anneeDe(periodeFin)

  const totauxParPoste = new Map<string, number>()
  for (const p of pieces) {
    if (p.statut !== 'validee') continue
    if (immobilisationPieceIds.has(p.id)) continue
    if (!p.date_piece || p.date_piece < periodeDebut || p.date_piece > periodeFin) continue
    const cat = p.categorie_id ? categorieById.get(p.categorie_id) : null
    if (!cat?.poste_2035) continue
    const montant = p.montant_ht ?? p.montant_ttc ?? 0
    const signe = p.type_piece === 'vente' ? 1 : -1
    totauxParPoste.set(cat.poste_2035, (totauxParPoste.get(cat.poste_2035) ?? 0) + signe * montant)
  }

  // LA DOTATION SUIT LA PÉRIODE ANNONCÉE, et ce n'était pas le cas.
  //
  // Cet état porte en tête « Période du 1er janvier au <date choisie> », et la ligne
  // « Amortissements » y comptait UNE ANNÉE ENTIÈRE de dotation quelle que soit cette date. Sur un
  // état arrêté au 30 juin, c'étaient douze mois de charge contre six mois de recettes ; au 31
  // janvier, un bien de 12 000 € sur 5 ans suffisait à afficher un résultat NÉGATIF de 1 600 € sur
  // 800 € de recettes — un déficit entièrement fabriqué par la convention, sur le document qui part
  // à une banque.
  //
  // Ce n'est pas la réserve de `RESERVE_PRORATA_TEMPORIS` (voir declaration2035.ts), qui porte sur
  // la date de MISE EN SERVICE, absente du modèle et laissée à l'arbitrage de l'expert-comptable :
  // ici la longueur de la période est connue exactement, et une charge rapportée à une période est
  // ce que cette période veut dire. La réserve, elle, reste entière — la fraction part du 1er
  // janvier et non de l'acquisition, donc un bien acquis en cours de période est toujours compté un
  // peu large, dans le même sens qu'à la Clôture.
  //
  // Une année civile complète (01/01 → 31/12) rend exactement 360/360, donc le PRÉVISIONNEL, qui
  // appelle cette fonction sur l'année entière, est inchangé au centime.
  const fraction = fractionDeLAnnee(periodeDebut, periodeFin)
  const totalAmortissements = immobilisations.reduce((sum, i) => {
    const anneeAcquisition = anneeDe(i.date_acquisition)
    const dansLaDuree = anneeFin >= anneeAcquisition && anneeFin < anneeAcquisition + i.duree_annees
    // Et un bien acquis APRÈS la date de l'état n'existe pas encore : il n'a rien à y faire. La
    // comparaison ne portait que sur les ANNÉES, donc un matériel acheté le 15 décembre était
    // amorti en entier sur une situation arrêtée au 30 juin.
    if (!dansLaDuree || i.date_acquisition > periodeFin) return sum
    return sum + (i.valeur / i.duree_annees) * fraction
  }, 0)
  if (totalAmortissements > 0) {
    totauxParPoste.set(POSTE_AMORTISSEMENTS, -Math.round(totalAmortissements * 100) / 100)
  }

  const totalCotisations = cotisations.reduce((sum, c) => {
    if (c.echeance < periodeDebut || c.echeance > periodeFin) return sum
    return sum + (c.montant_verse ?? c.montant_appele)
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
