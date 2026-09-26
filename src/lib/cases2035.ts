import { POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_CSG_DEDUCTIBLE, POSTE_INDEMNITES_KM } from './declaration2035'
import type { Declaration2035, LigneDeclaration } from './declaration2035'

// Rattachement des postes du moteur (voir declaration2035.ts) aux cases du formulaire officiel.
//
// C'est la couche qui manquait pour passer d'un récapitulatif à une déclaration : le moteur produit
// « un poste, un montant », le formulaire attend « une case, un montant », et les deux ne sont PAS en
// correspondance un pour un.
//
// Le fait structurant, relevé sur le formulaire lui-même (2035-A-SD, revenus 2025) : les lignes 17,
// 18, 20, 21, 22, 23, 24, 26, 27, 28 et 30 n'ont AUCUNE case à elles. Elles passent par trois totaux
// groupés — BH « Travaux, fournitures et services extérieurs », BJ « Transport et déplacements »,
// BM « Frais divers de gestion ». Deux preuves indépendantes, parce que se tromper ici met des
// montants dans la mauvaise case d'une déclaration fiscale :
//   1. la ligne 33 est « TOTAL (lignes 8 à 32) = BR ». Sans case collective, ces onze lignes ne
//      pourraient jamais entrer dans BR : le formulaire serait arithmétiquement incohérent ;
//   2. dans le PDF, toutes les cases qui entrent dans le total sont imprimées dans la même colonne
//      (x ≈ 456-459), et toutes les cases « dont » dans une colonne intérieure (x ≤ 374). BH, BJ et
//      BM sont dans la colonne des totaux ; BW, BT, BZ, BU et BY dans celle des « dont ».
//
// Conséquence directe sur les catégories par défaut du produit : « Honoraires » et « Assurance »
// tombent toutes les deux dans BH. Un rendu « une ligne par poste » afficherait deux lignes pour un
// seul encadré du formulaire.

export type Formulaire = '2035-A' | '2035-B'
export type Cadre = 'recettes' | 'depenses' | 'resultat' | 'travailleursIndependants'

// Premier exercice dont la 2035 porte le cadre 8 « Travailleurs indépendants » : la réforme de
// l'assiette sociale vaut « à partir de la déclaration des revenus 2025 » (titre de section des deux
// notices 2041-DRI, indépendants et praticiens conventionnés), et c'est la 2035-SD millésime 2026 qui
// a reçu les cases DB, DC, DD et DE. Avant, ces cases n'existent pas sur la déclaration : les calculer
// ferait écrire un revenu qu'aucun formulaire de ces années ne demande.
export const PREMIER_EXERCICE_REVENU_BRUT_SOCIAL = 2025

export interface Case2035 {
  code: string
  // Numéro(s) de ligne tels qu'imprimés sur le formulaire — « 17 à 22 » pour un total groupé. Le
  // cadre 8 n'en imprime aucun : ses cases portent le cadre à la place.
  ligne: string
  // Libellé officiel, recopié du formulaire. Sert d'intitulé à l'écran et sur le PDF : un libellé
  // maison ferait douter l'expert-comptable de la case visée.
  libelle: string
  formulaire: Formulaire
  cadre: Cadre
  // Case « dont » : un détail À L'INTÉRIEUR d'une autre case. Elle ne s'additionne JAMAIS au total,
  // son montant est déjà compté dans la case porteuse. L'ajouter doublerait la dépense.
  sousCaseDe?: string
  // Case calculée à partir d'autres cases : la formule, telle qu'imprimée sur le formulaire (celle
  // du cadre 8 n'y est pas imprimée : c'est la notice qui la donne). Sa présence veut dire « aucun
  // poste ne l'alimente directement ».
  calculee?: string
  // Case que le moteur ne produira jamais : elle relève d'un arbitrage de l'expert-comptable
  // (plus-values, réintégrations, exonérations). Elle existe ici pour que l'arithmétique du
  // formulaire soit complète, pas pour être remplie automatiquement.
  saisieCabinet?: true
  // Se retranche au lieu de s'ajouter (débours et rétrocessions, lignes 2 et 3).
  soustractive?: true
  // Case apparue sur le formulaire à partir de cet exercice. Avant, elle n'existe pas : l'écran ne la
  // montre pas et le calcul la laisse à zéro.
  depuisExercice?: number
}

// Le formulaire, cadre par cadre. Ordre d'impression, donc ordre d'affichage.
export const CASES_2035: Case2035[] = [
  // ── 2035-A-SD, cadre 2 : recettes ────────────────────────────────────────────────────────────
  { code: 'AA', ligne: '1', libelle: 'Recettes encaissées y compris les remboursements de frais', formulaire: '2035-A', cadre: 'recettes' },
  { code: 'AB', ligne: '2', libelle: 'Débours payés pour le compte des clients', formulaire: '2035-A', cadre: 'recettes', soustractive: true },
  { code: 'AC', ligne: '3', libelle: 'Honoraires rétrocédés', formulaire: '2035-A', cadre: 'recettes', soustractive: true },
  { code: 'AD', ligne: '4', libelle: 'Montant net des recettes', formulaire: '2035-A', cadre: 'recettes', calculee: 'ligne 1 − ligne 2 − ligne 3' },
  { code: 'AE', ligne: '5', libelle: 'Produits financiers', formulaire: '2035-A', cadre: 'recettes' },
  { code: 'AF', ligne: '6', libelle: 'Gains divers', formulaire: '2035-A', cadre: 'recettes' },
  { code: 'AG', ligne: '7', libelle: 'TOTAL', formulaire: '2035-A', cadre: 'recettes', calculee: 'lignes 4 à 6' },

  // ── 2035-A-SD, cadre 3 : dépenses professionnelles ───────────────────────────────────────────
  // Note (6) de la notice 2035-NOT-SD : les achats sont les fournitures et produits revendus à la
  // clientèle ou entrant dans la composition des prestations, « à l'exclusion de tout achat de
  // matériel ». Un achat de matériel est une immobilisation ou du petit outillage (ligne 19, BH).
  { code: 'BA', ligne: '8', libelle: 'Achats', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BB', ligne: '9', libelle: 'Salaires nets et avantages en nature', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BC', ligne: '10', libelle: 'Charges sociales sur salaires (parts patronale et ouvrière)', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BD', ligne: '11', libelle: 'Taxe sur la valeur ajoutée', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'JY', ligne: '12', libelle: 'Contribution économique territoriale', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BS', ligne: '13', libelle: 'Autres impôts', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BV', ligne: '14', libelle: 'Contribution sociale généralisée déductible', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BF', ligne: '15', libelle: 'Loyer et charges locatives', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BW', ligne: '16', libelle: 'dont redevances de collaboration', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BG', saisieCabinet: true },
  { code: 'BG', ligne: '16', libelle: 'Location de matériel et de mobilier', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BH', ligne: '17 à 22', libelle: 'Travaux, fournitures et services extérieurs', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BJ', ligne: '23 et 24', libelle: 'Transport et déplacements', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BT', ligne: '25', libelle: 'dont charges sociales personnelles obligatoires', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK', saisieCabinet: true },
  { code: 'BZ', ligne: '25', libelle: 'dont cotisations facultatives Madelin', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK', saisieCabinet: true },
  { code: 'BU', ligne: '25', libelle: 'dont facultatives aux nouveaux plans d’épargne retraite', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK', saisieCabinet: true },
  { code: 'BK', ligne: '25', libelle: 'Charges sociales personnelles', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BY', ligne: '29', libelle: 'dont cotisations syndicales et professionnelles', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BM', saisieCabinet: true },
  { code: 'BM', ligne: '26 à 30', libelle: 'Frais divers de gestion', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BN', ligne: '31', libelle: 'Frais financiers', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BP', ligne: '32', libelle: 'Pertes diverses', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BR', ligne: '33', libelle: 'TOTAL', formulaire: '2035-A', cadre: 'depenses', calculee: 'lignes 8 à 32' },

  // ── 2035-B-SD, cadre 4 : détermination du résultat fiscal ────────────────────────────────────
  // Les amortissements ne sont PAS dans le cadre 3 : ils entrent par la ligne 41 du 2035-B. Le
  // résultat final est le même, l'emplacement non — et c'est l'emplacement qui fait une déclaration
  // juste. La plupart des autres lignes relèvent d'un arbitrage (plus-values, réintégrations,
  // exonérations) : elles sont ici pour que l'addition tienne, pas pour être pré-remplies.
  { code: 'CA', ligne: '34', libelle: 'Excédent', formulaire: '2035-B', cadre: 'resultat', calculee: 'ligne 7 − ligne 33' },
  { code: 'CB', ligne: '35', libelle: 'Plus-values à court terme', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CC', ligne: '36', libelle: 'Divers à réintégrer', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CD', ligne: '37', libelle: 'Bénéfice Société civile de moyens', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CE', ligne: '38', libelle: 'TOTAL', formulaire: '2035-B', cadre: 'resultat', calculee: 'lignes 34 à 37' },
  { code: 'CF', ligne: '39', libelle: 'Insuffisance', formulaire: '2035-B', cadre: 'resultat', calculee: 'ligne 33 − ligne 7' },
  { code: 'CG', ligne: '40', libelle: 'Frais d’établissement', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'BE', ligne: '41', libelle: 'dont amortissement des éléments incorporels du fonds', formulaire: '2035-B', cadre: 'resultat', sousCaseDe: 'CH', saisieCabinet: true },
  { code: 'CH', ligne: '41', libelle: 'Dotation aux amortissements', formulaire: '2035-B', cadre: 'resultat' },
  { code: 'CK', ligne: '42', libelle: 'Moins-value à court terme', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CL', ligne: '43', libelle: 'Divers à déduire', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CM', ligne: '44', libelle: 'Déficit Société civile de moyens', formulaire: '2035-B', cadre: 'resultat', saisieCabinet: true },
  { code: 'CN', ligne: '45', libelle: 'TOTAL', formulaire: '2035-B', cadre: 'resultat', calculee: 'lignes 39 à 44' },
  { code: 'CP', ligne: '46', libelle: 'Bénéfice', formulaire: '2035-B', cadre: 'resultat', calculee: 'ligne 38 − ligne 45' },
  { code: 'CR', ligne: '47', libelle: 'Déficit', formulaire: '2035-B', cadre: 'resultat', calculee: 'ligne 45 − ligne 38' },

  // ── 2035-B-SD, cadre 8 : travailleurs indépendants (depuis les revenus 2025) ────────────────
  // Le « revenu brut social » de la réforme de l'assiette : recettes moins charges, SANS déduire les
  // cotisations sociales, la CSG déductible ni les exonérations fiscales. C'est la base que l'Urssaf
  // reprend, et elle applique ELLE-MÊME l'abattement de 26 % — surtout ne pas le retrancher ici
  // (notice 2035-NOT-SD 2026, renvois 24 à 26 ; notices 2041-DRI, rubrique « Revenu brut social »).
  //
  // DE et DB portent des éléments que le moteur ne connaît pas (plus-values à court terme exonérées,
  // intéressement de l'exploitant, indemnités journalières comptées en gains divers, résultats non
  // professionnels) : saisie du cabinet, comme CB, CC ou CL. DC et DD se calculent.
  { code: 'DE', ligne: 'cadre 8', libelle: 'Sommes à réintégrer pour la détermination du revenu brut social', formulaire: '2035-B', cadre: 'travailleursIndependants', saisieCabinet: true, depuisExercice: PREMIER_EXERCICE_REVENU_BRUT_SOCIAL },
  { code: 'DB', ligne: 'cadre 8', libelle: 'Sommes à déduire pour la détermination du revenu brut social', formulaire: '2035-B', cadre: 'travailleursIndependants', saisieCabinet: true, depuisExercice: PREMIER_EXERCICE_REVENU_BRUT_SOCIAL },
  { code: 'DC', ligne: 'cadre 8', libelle: 'Revenu brut social (si le montant est négatif)', formulaire: '2035-B', cadre: 'travailleursIndependants', calculee: 'renvoi (26) : CE − CN + BK + BV + exonérations de la ligne 43 + DE − DB, s’il est négatif', depuisExercice: PREMIER_EXERCICE_REVENU_BRUT_SOCIAL },
  { code: 'DD', ligne: 'cadre 8', libelle: 'Revenu brut social (si le montant est positif)', formulaire: '2035-B', cadre: 'travailleursIndependants', calculee: 'renvoi (26) : CE − CN + BK + BV + exonérations de la ligne 43 + DE − DB, s’il est positif', depuisExercice: PREMIER_EXERCICE_REVENU_BRUT_SOCIAL },
]

export const CASE_PAR_CODE = new Map(CASES_2035.map((c) => [c.code, c]))

// Les cases du cadre 3 qui s'additionnent pour faire BR. Dérivé plutôt qu'écrit à la main : ajouter
// une case au tableau sans la compter dans le total est exactement le genre d'oubli qui ne se voit
// pas. Un test vérifie que ce filtre rend bien les quinze codes attendus.
export const CODES_TOTALISES_BR = CASES_2035
  .filter((c) => c.cadre === 'depenses' && !c.calculee && !c.sousCaseDe)
  .map((c) => c.code)

// Clé de rapprochement d'un poste. Volontairement pas `normaliserPourRecherche` : ce normaliseur-là
// sert la barre de recherche et peut évoluer pour elle (il ramène par exemple la virgule au point) ;
// l'indexer ici ferait bouger un rattachement fiscal au gré d'un réglage d'ergonomie.
function cle(poste: string): string {
  return poste
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Rattachement pré-rempli poste → case. Il est fait pour être faux quelquefois : l'expert-comptable
// corrige à l'écran, c'est le contrat posé avec lui (« je préremplis, tu corriges »). Il vaut donc
// mieux proposer une case plausible que laisser vide — un poste sans case est un trou dans la
// déclaration, et c'est ce que signale `postesSansCase`.
//
// Les clés couvrent les postes par défaut du produit ET les libellés officiels du formulaire, que le
// cabinet est susceptible de recopier tels quels dans le champ « poste 2035 ».
//
// Aucune valeur n'est une case « dont » : un poste rattaché à BY ou BT sortirait du total, puisque
// ces cases ne s'additionnent pas. Un test le vérifie.
const RATTACHEMENTS: [string, string][] = [
  // Recettes
  ['Recettes', 'AA'],
  ['Recettes encaissées y compris les remboursements de frais', 'AA'],
  // Pas de rattachement pour « Honoraires » tout court : le mot désigne une recette ligne 1 chez le
  // praticien et une dépense ligne 21 chez celui qui les paie. Mieux vaut le signaler comme non
  // rattaché et laisser trancher que de choisir à pile ou face le sens d'un montant.
  ['Débours payés pour le compte des clients', 'AB'],
  ['Débours', 'AB'],
  ['Honoraires rétrocédés', 'AC'],
  ['Rétrocessions', 'AC'],
  ['Produits financiers', 'AE'],
  ['Gains divers', 'AF'],

  // Dépenses — lignes à case propre
  ['Achats', 'BA'],
  ['Salaires nets et avantages en nature', 'BB'],
  ['Salaires', 'BB'],
  ['Charges sociales sur salaires', 'BC'],
  ['Taxe sur la valeur ajoutée', 'BD'],
  ['TVA', 'BD'],
  ['Contribution économique territoriale', 'JY'],
  ['CET', 'JY'],
  ['Autres impôts', 'BS'],
  ['Impôts et taxes', 'BS'],
  ['Contribution sociale généralisée déductible', 'BV'],
  // Poste IMPORTÉ, jamais réécrit : une chaîne recopiée ici se désynchroniserait d'un renommage
  // côté declaration2035.ts, et le rattachement tomberait en silence (même piège que
  // POSTE_AMORTISSEMENTS dans ratiosBancaires).
  [POSTE_CSG_DEDUCTIBLE, 'BV'],
  ['Loyer et charges locatives', 'BF'],
  ['Loyers et charges locatives', 'BF'],
  ['Location de matériel et de mobilier', 'BG'],

  // Dépenses — lignes 17 à 22, total groupé BH
  ['Entretien et réparations', 'BH'],
  ['Personnel intérimaire', 'BH'],
  ['Petit outillage', 'BH'],
  ['Chauffage, eau, gaz, électricité', 'BH'],
  ['Honoraires ne constituant pas des rétrocessions', 'BH'],
  ["Primes d'assurance", 'BH'],
  ["Primes d'assurances", 'BH'],
  ['Assurance', 'BH'],

  // Dépenses — lignes 23 et 24, total groupé BJ
  ['Frais de véhicules', 'BJ'],
  ['Autres frais de déplacements', 'BJ'],
  ['Frais de déplacement', 'BJ'],
  ['Frais de déplacements', 'BJ'],
  // Le « total A » du cadre 7 du 2035-B : le formulaire dit lui-même, sous le tableau des barèmes,
  // « Total A à reporter ligne 23 de l'annexe 2035 A ». Ligne 23, donc BJ.
  [POSTE_INDEMNITES_KM, 'BJ'],

  // Dépenses — ligne 25
  [POSTE_COTISATIONS, 'BK'],
  ['Charges sociales personnelles', 'BK'],

  // Dépenses — lignes 26 à 30, total groupé BM
  ['Frais de réception, de représentation et de congrès', 'BM'],
  ['Frais de réception, de représentation', 'BM'],
  ['Fournitures de bureau, frais de documentation, de correspondance et de téléphone', 'BM'],
  ['Fournitures de bureau', 'BM'],
  ["Frais d'actes et de contentieux", 'BM'],
  ['Cotisations syndicales et professionnelles', 'BM'],
  ['Autres frais divers de gestion', 'BM'],
  ['Frais divers de gestion', 'BM'],
  // « Divers » est le poste de la catégorie fourre-tout « Autre ». Le formulaire n'a pas de case
  // « divers » dans le cadre 3 ; sa destination naturelle est la ligne 30, « Autres frais divers de
  // gestion », donc BM. À vérifier pièce par pièce, comme tout fourre-tout.
  ['Divers', 'BM'],

  // Dépenses — lignes 31 et 32
  ['Frais financiers', 'BN'],
  ['Pertes diverses', 'BP'],

  // 2035-B
  [POSTE_AMORTISSEMENTS, 'CH'],
  ['Dotation aux amortissements', 'CH'],
]

const CASE_PAR_CLE_DE_POSTE = new Map(RATTACHEMENTS.map(([poste, code]) => [cle(poste), code]))

// Les codes qu'un poste peut atteindre. Exporté pour que le test vérifie sur la liste ENTIÈRE, et non
// sur trois postes choisis, qu'aucun ne vise une case calculée, une case « dont » ou une case du
// cadre 8 : un montant qui y atterrirait sortirait du résultat sans que rien ne le dise.
export const CODES_RATTACHABLES = new Set(RATTACHEMENTS.map(([, code]) => code))

// La case pré-remplie pour un poste, ou null si le rattachement ne le connaît pas.
export function caseDuPoste(poste: string): Case2035 | null {
  const code = CASE_PAR_CLE_DE_POSTE.get(cle(poste))
  return code ? CASE_PAR_CODE.get(code) ?? null : null
}

export interface CaseRemplie {
  case: Case2035
  montant: number
  // Les postes du moteur derrière ce montant. Plusieurs postes partagent une case (BH en reçoit deux
  // rien qu'avec les catégories par défaut) : les nommer, c'est pouvoir justifier la case d'un clic.
  postes: string[]
  nbPieces: number
}

export interface PosteNonRattache {
  ligne: LigneDeclaration
  raison: 'aucune case connue' | 'case du mauvais sens'
  // Renseigné quand une case a bien été trouvée mais qu'elle ne va pas : de quoi expliquer plutôt
  // que de laisser l'utilisateur deviner.
  codeRefuse?: string
}

export interface RepartitionCases {
  cases: CaseRemplie[]
  // Postes qu'aucune case ne reçoit. Comme partout ailleurs dans ce moteur, ce qui sort du calcul est
  // remonté plutôt que retiré en silence : sur une déclaration, un poste écarté est un montant que
  // personne ne verra manquer.
  postesSansCase: PosteNonRattache[]
}

// Une case de recettes ne peut recevoir qu'une recette, une case de dépenses qu'une dépense. Le
// rattachement se fait sur un libellé de poste, mais le sens vient du type de la pièce : sans ce
// contrôle, un poste au libellé ambigu ferait entrer une dépense dans les recettes — et le montant
// compterait deux fois à l'envers dans le résultat.
function cadreCompatible(c: Case2035, nature: LigneDeclaration['nature']): boolean {
  return nature === 'recette' ? c.cadre === 'recettes' : c.cadre !== 'recettes'
}

// Regroupe les postes d'une déclaration dans les cases du formulaire. `montant` reste positif, le
// sens étant porté par le cadre de la case (recettes/dépenses), comme dans le moteur.
export function repartirEnCases(declaration: Declaration2035): RepartitionCases {
  const parCode = new Map<string, CaseRemplie>()
  const postesSansCase: PosteNonRattache[] = []

  for (const ligne of [...declaration.recettes, ...declaration.depenses]) {
    const c = caseDuPoste(ligne.poste)
    if (!c) {
      postesSansCase.push({ ligne, raison: 'aucune case connue' })
      continue
    }
    if (!cadreCompatible(c, ligne.nature)) {
      postesSansCase.push({ ligne, raison: 'case du mauvais sens', codeRefuse: c.code })
      continue
    }
    const actuel = parCode.get(c.code)
    if (actuel) {
      actuel.montant += ligne.montant
      actuel.postes.push(ligne.poste)
      actuel.nbPieces += ligne.nbPieces
      continue
    }
    parCode.set(c.code, { case: c, montant: ligne.montant, postes: [ligne.poste], nbPieces: ligne.nbPieces })
  }

  // Ordre du formulaire, pas ordre d'apparition : une déclaration se lit dans l'ordre imprimé.
  const rang = new Map(CASES_2035.map((c, i) => [c.code, i]))
  const cases = [...parCode.values()]
    .map((r) => ({ ...r, montant: Number(r.montant.toFixed(2)) }))
    .sort((a, b) => (rang.get(a.case.code) ?? 0) - (rang.get(b.case.code) ?? 0))

  return { cases, postesSansCase }
}

// Toutes les cases du formulaire, y compris celles qu'aucun poste n'alimente et celles qui se
// calculent. Une case sans montant vaut 0 : sur un formulaire, l'absence est un zéro, et le PDF a
// besoin d'une valeur par case plutôt que d'un trou.
export function valeursDesCases(declaration: Declaration2035): {
  valeurs: Map<string, number>
  postesSansCase: PosteNonRattache[]
} {
  const { cases, postesSansCase } = repartirEnCases(declaration)
  const valeurs = new Map<string, number>(CASES_2035.map((c) => [c.code, 0]))
  for (const r of cases) valeurs.set(r.case.code, r.montant)

  calculerLesCasesCalculees(valeurs, declaration.annee)

  for (const [code, montant] of valeurs) valeurs.set(code, Number(montant.toFixed(2)))
  return { valeurs, postesSansCase }
}

// Les cases calculées, déduites des cases alimentées. UN SEUL endroit pour les deux usages — les
// valeurs montrées à l'écran et celles arrondies pour le PDF : écrite dans chacun, une case calculée
// ajoutée à l'un manquerait à l'autre, et le formulaire imprimé ne dirait plus ce que l'écran a montré.
function calculerLesCasesCalculees(valeurs: Map<string, number>, annee: number): void {
  const v = (code: string) => valeurs.get(code) ?? 0
  const somme = (codes: string[]) => codes.reduce((s, code) => s + v(code), 0)

  valeurs.set('AD', v('AA') - v('AB') - v('AC'))
  valeurs.set('AG', v('AD') + v('AE') + v('AF'))
  valeurs.set('BR', somme(CODES_TOTALISES_BR))

  // Excédent et insuffisance sont exclusifs : le formulaire a deux lignes pour un seul écart, et
  // remplir les deux serait le compter deux fois.
  const ecart = v('AG') - v('BR')
  valeurs.set('CA', Math.max(0, ecart))
  valeurs.set('CF', Math.max(0, -ecart))

  valeurs.set('CE', somme(['CA', 'CB', 'CC', 'CD']))
  valeurs.set('CN', somme(['CF', 'CG', 'CH', 'CK', 'CL', 'CM']))

  // Même logique pour bénéfice et déficit.
  const resultat = v('CE') - v('CN')
  valeurs.set('CP', Math.max(0, resultat))
  valeurs.set('CR', Math.max(0, -resultat))

  // Et pour le revenu brut social du cadre 8, qui n'existe qu'à partir des revenus 2025.
  //
  // DC porte la VALEUR ABSOLUE d'un revenu négatif, comme CR celle d'un déficit : la case dit déjà
  // « si le montant est négatif », et aucune des deux notices ne demande d'y écrire un signe. C'est
  // une DÉDUCTION tirée de la forme du formulaire (deux cases exclusives pour un seul montant, comme
  // CA/CF et CP/CR), pas une consigne lue : à confronter à la première 2035 déposée qui porte un DC.
  const brutSocial = annee >= PREMIER_EXERCICE_REVENU_BRUT_SOCIAL ? revenuBrutSocial(v) : 0
  valeurs.set('DD', Math.max(0, brutSocial))
  valeurs.set('DC', Math.max(0, -brutSocial))
}

// Renvoi (26) de la notice 2035-NOT-SD 2026, pour une entreprise individuelle :
//   CE − CN + BK + BV + CS + AW + CU + CI + DG + DH + CO + CJ + DE − DB.
// Le résultat fiscal, auquel on rend ce que l'assiette sociale ne déduit pas : les cotisations
// sociales personnelles (BK), la CSG déductible (BV) et les exonérations fiscales.
//
// CS à CJ sont des « dont » de la ligne 43, « Divers à déduire » (CL) : six exonérations et deux
// déductions propres aux médecins conventionnés de secteur I. Le moteur ne remplit jamais CL
// (`saisieCabinet`), donc elles valent zéro et ne figurent pas ici. LE JOUR OÙ CL SE SAISIRA, elles
// devront y entrer — elles seules, pas CL entier : ses autres « dont » ne figurent pas au renvoi (DF,
// CT), ou passent par DE (AX, et CQ hors article 151 septies A, dont la plus-value s'ajoute
// directement sur la déclaration de revenus : renvoi 24 et notices 2041-DRI).
//
// Insensible à la ventilation de la CSG-CRDS, et c'est ce qui le rend juste aujourd'hui, où aucune
// cotisation n'est ventilée : non ventilée, la CSG-CRDS reste entière en BK ; ventilée, sa part non
// déductible sort de BK sans entrer nulle part et sa part déductible passe en BV. BK et BV étant
// rajoutés au résultat qui les avait retranchés, le revenu brut social est le même au centime
// (cases2035.test.ts le vérifie, depuis les cotisations).
//
// Pour une société, le renvoi retranche en plus les rémunérations des associés comprises en CC : une
// saisie du cabinet, nulle ici, et le calcul reste juste tant qu'elle l'est.
function revenuBrutSocial(v: (code: string) => number): number {
  return v('CE') - v('CN') + v('BK') + v('BV') + v('DE') - v('DB')
}

// Les postes dont la dépense est DÉJÀ couverte par le barème kilométrique. Note (12) de la notice
// 2035-NOT-SD : l'option pour le forfait vaut pour tous les véhicules, et les dépenses qu'il couvre
// « ne doivent alors figurer à aucun poste de charges ».
//
// Volontairement pas « toutes les cases BJ » : la ligne 24, « Autres frais de déplacements » (train,
// hôtel, taxi), coexiste tout à fait légitimement avec le forfait — le barème ne couvre que le
// véhicule. Ni « Entretien et réparations » ni « Primes d'assurance », qui vont en BH et désignent
// aussi bien le cabinet que la voiture : les signaler ferait crier au loup sur des dossiers justes,
// et un avertissement qui se trompe souvent finit par ne plus être lu.
const POSTES_COUVERTS_PAR_LE_BAREME = ['Frais de véhicules', 'Frais de véhicule', 'Carburant', 'Frais de carburant']
const CLES_COUVERTES_PAR_LE_BAREME = new Set(POSTES_COUVERTS_PAR_LE_BAREME.map(cle))

export interface DoublonFraisVehicule {
  montantIndemnites: number
  // Les postes qui font double emploi, avec leur montant — de quoi décider lequel des deux retirer.
  postes: LigneDeclaration[]
  totalPostes: number
}

// Le barème kilométrique et des frais de véhicule au réel dans la même déclaration : les deux
// tombent dans la case BJ, donc la même dépense y est comptée deux fois. C'est exactement ce que la
// note (12) interdit, et c'est invisible à la relecture — la case BJ n'affiche qu'un total, sans dire
// de quoi il est fait.
//
// Signalé, jamais corrigé tout seul : choisir entre le forfait et le réel est un arbitrage, et il
// engage l'année entière pour tous les véhicules.
export function doublonFraisVehicules(declaration: Declaration2035): DoublonFraisVehicule | null {
  const indemnites = declaration.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)
  if (!indemnites || indemnites.montant === 0) return null

  const postes = declaration.depenses.filter((l) => CLES_COUVERTES_PAR_LE_BAREME.has(cle(l.poste)))
  if (postes.length === 0) return null

  return {
    montantIndemnites: indemnites.montant,
    postes,
    totalPostes: Number(postes.reduce((s, l) => s + l.montant, 0).toFixed(2)),
  }
}

export interface IncoherenceCase {
  porteuse: Case2035
  sousCases: Case2035[]
  montantPorteuse: number
  totalSousCases: number
}

// Une case « dont » ne peut pas dépasser la case qui la porte : son montant en est un sous-ensemble.
// Le formulaire le dit explicitement pour la ligne 16 — notice 2035-NOT-SD, note (9) : « individualiser
// à la ligne 16 dans le cadre BW […] le montant de ces redevances puis porter le total des locations de
// matériel et de mobilier, Y COMPRIS ces redevances, en ligne BG ».
//
// Le moteur ne remplit aucune case « dont » (toutes marquées `saisieCabinet`), donc l'incohérence ne
// peut venir que d'une saisie. C'est justement ce qu'un relecteur ne voit pas : les deux cases sont
// loin l'une de l'autre sur le formulaire, et rien n'oblige l'œil à les rapprocher.
//
// Les sous-cases d'une même porteuse sont additionnées avant comparaison : BT (obligatoires), BZ
// (Madelin) et BU (nouveaux plans) sont trois parts disjointes de BK, donc c'est leur somme qui ne
// doit pas dépasser le total, pas chacune prise isolément.
export function incoherencesDesCases(valeurs: Map<string, number>): IncoherenceCase[] {
  const parPorteuse = new Map<string, Case2035[]>()
  for (const c of CASES_2035) {
    if (!c.sousCaseDe) continue
    parPorteuse.set(c.sousCaseDe, [...(parPorteuse.get(c.sousCaseDe) ?? []), c])
  }

  const incoherences: IncoherenceCase[] = []
  for (const [codePorteuse, sousCases] of parPorteuse) {
    const porteuse = CASE_PAR_CODE.get(codePorteuse)
    if (!porteuse) continue
    const totalSousCases = sousCases.reduce((s, c) => s + (valeurs.get(c.code) ?? 0), 0)
    if (totalSousCases === 0) continue
    const montantPorteuse = valeurs.get(codePorteuse) ?? 0
    // Un centime de tolérance : l'écart qui compte ici est une saisie contradictoire, pas un arrondi.
    if (totalSousCases > montantPorteuse + 0.01) {
      incoherences.push({
        porteuse,
        sousCases,
        montantPorteuse,
        totalSousCases: Number(totalSousCases.toFixed(2)),
      })
    }
  }
  return incoherences
}

// « Ne pas porter les centimes », dit le formulaire. Arrondir chaque case indépendamment casserait
// l'addition imprimée (les totaux ne tomberaient plus juste à l'euro près) : on arrondit donc les
// cases alimentées, puis on RECALCULE les totaux à partir des valeurs arrondies. Un formulaire dont
// les colonnes ne s'additionnent pas est un formulaire qu'on se fait renvoyer.
//
// L'exercice est exigé, sans valeur par défaut : le cadre 8 en dépend, et un appelant qui l'oublierait
// doit le découvrir à la compilation plutôt que sur un revenu brut social absent du PDF.
export function arrondirPourFormulaire(valeurs: Map<string, number>, annee: number): Map<string, number> {
  const arrondies = new Map<string, number>()
  for (const c of CASES_2035) {
    if (c.calculee) continue
    arrondies.set(c.code, Math.round(valeurs.get(c.code) ?? 0))
  }
  calculerLesCasesCalculees(arrondies, annee)
  return arrondies
}
