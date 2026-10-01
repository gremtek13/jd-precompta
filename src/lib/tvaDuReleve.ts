import type { NatureCompte } from './affectationBanque'

// LA TVA D'UNE RECETTE DU RELEVÉ (ligne 26.6 de la feuille de route, étape a, fin).
//
// Une recette encaissée sans facture au dossier — un client qui vire, un organisme qui règle — s'affecte
// depuis le relevé (lib/affectationBanque.ts) ou se ventile avec d'autres parts (lib/ventilationBanque.ts).
// Sur un dossier ASSUJETTI, elle porte de la TVA collectée que rien sur le relevé ne dit : ni le taux, ni
// la part hors taxe. L'affectation la refusait donc : écrite au TTC en 706, la taxe serait comptée en
// chiffre d'affaires, et aucune CA3 ne la verrait.
//
// LE TAUX SE CHOISIT, IL NE SE DEVINE JAMAIS : 20, 10, 5,5 ou 8,5 %, ou « exonérée » (zéro) — les actes de
// soins d'un praticien dont une autre activité est taxée, une recette non imposable. Il se garde sur le
// mouvement, sur la part ventilée et sur la règle d'affectation, et la base l'exige pour une recette d'un
// dossier assujetti, le refuse partout ailleurs (migration `recettes_assujetties_du_releve`). 2,1 % n'en
// est pas : sa ligne de la CA3 dépend du territoire (T6, 11 ou T4), et une facture le dit, pas un relevé.
//
// LA TVA SE CALCULE SUR LE MONTANT ENCAISSÉ, qui est TTC : TTC × taux / (100 + taux), au centime, le
// demi-centime vers le haut. En arithmétique ENTIÈRE — des centimes et des dixièmes de point —, comme
// `tva_incluse` en base, qui vérifie l'écriture : un arrondi qui différerait d'un centime ferait refuser une
// écriture juste, et personne ne comprendrait pourquoi.
//
// CE QUI DÉCIDE QU'UN TAUX S'APPLIQUE est le statut ACTUEL du dossier, comme pour une pièce
// (`montantRetenu`) : un dossier redevenu non assujetti compte ses recettes au TTC, et l'écriture attendue
// n'a plus de TVA — « Réaffecter » la réécrit. Une recette d'un dossier assujetti affectée SANS taux (avant
// qu'il le devienne) reste comptée au TTC, et la Checklist la montre : on ne devine pas sa TVA.

// Dans l'ordre où l'écran les propose : le taux normal d'abord, l'exonération à la fin.
export const TAUX_TVA_RELEVE = [20, 10, 5.5, 8.5, 0] as const

export function tauxPrisEnCharge(taux: number): boolean {
  return (TAUX_TVA_RELEVE as readonly number[]).includes(taux)
}

export function libelleTaux(taux: number): string {
  return taux === 0 ? 'exonérée' : `${String(taux).replace('.', ',')} %`
}

// Un taux est demandé pour une RECETTE d'un dossier assujetti, et pour rien d'autre : sur une dépense, il
// dirait une TVA déductible que seule une facture ouvre.
export function tauxRequis(assujettiTva: boolean, nature: NatureCompte | null): boolean {
  return assujettiTva && nature === 'recette'
}

// Le taux qui s'applique AUJOURD'HUI à ce qu'on a gardé : celui du mouvement ou de la part quand il est
// requis, rien ailleurs — un taux resté d'avant que le dossier cesse d'être assujetti ne s'applique plus.
export function tauxApplicable(assujettiTva: boolean, nature: NatureCompte | null, taux: number | null): number | null {
  return tauxRequis(assujettiTva, nature) ? taux : null
}

const enCentimes = (montant: number) => Math.round(Math.abs(montant) * 100)

// La TVA comprise dans un TTC de `centimes`, en centimes : ⌊(2·c·t + 1000 + t) / (2·(1000 + t))⌋, où t est
// le taux en dixièmes de point — c·t / (1000 + t) arrondi au plus proche, le demi vers le haut, sans un
// seul nombre à virgule. Le reste de la division se retire avant de diviser : la division est alors
// exacte, quel que soit le montant.
function tvaEnCentimes(centimes: number, taux: number): number {
  const t = Math.round(taux * 10)
  const numerateur = 2 * centimes * t + 1000 + t
  const denominateur = 2 * (1000 + t)
  return (numerateur - (numerateur % denominateur)) / denominateur
}

/** La TVA comprise dans un montant TTC, positive, au centime — `tva_incluse` en base. */
export function tvaIncluse(montant: number, taux: number): number {
  return tvaEnCentimes(enCentimes(montant), taux) / 100
}

// Le hors taxe et la TVA d'un montant TTC, POSITIFS, au centime. Calculés en centimes entiers, ils font le
// TTC exactement : une écriture composée de flottants (492,60 − 82,10) porterait 410,50000000000006, que
// la base refuserait comme ne correspondant pas. Sans taux, tout est hors taxe.
export function horsTaxeEtTva(montant: number, taux: number | null): { ht: number; tva: number } {
  const centimes = enCentimes(montant)
  const tva = taux == null ? 0 : tvaEnCentimes(centimes, taux)
  return { ht: (centimes - tva) / 100, tva: tva / 100 }
}

/** Le hors taxe d'un montant, SIGNÉ comme lui : ce qu'une recette taxée ajoute à son poste. */
export function horsTaxeSigne(montant: number, taux: number | null): number {
  const { ht } = horsTaxeEtTva(montant, taux)
  return montant < 0 ? -ht : ht
}
