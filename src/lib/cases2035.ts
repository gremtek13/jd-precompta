import { POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_CSG_DEDUCTIBLE, POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES } from './declaration2035'
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
  // formulaire soit complète, pas pour être remplie automatiquement. DB l'est encore (étape 2035S1) :
  // seules les indemnités journalières rangées sous leur poste propre la remplissent, le reste du
  // renvoi (25) — un déficit non professionnel — attend la saisie du cabinet (2035S3 et S4).
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
  { code: 'BW', ligne: '16', libelle: 'dont redevances de collaboration', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BG' },
  { code: 'BG', ligne: '16', libelle: 'Location de matériel et de mobilier', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BH', ligne: '17 à 22', libelle: 'Travaux, fournitures et services extérieurs', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BJ', ligne: '23 et 24', libelle: 'Transport et déplacements', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BT', ligne: '25', libelle: 'dont charges sociales personnelles obligatoires', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK' },
  { code: 'BZ', ligne: '25', libelle: 'dont cotisations facultatives Madelin', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK' },
  { code: 'BU', ligne: '25', libelle: 'dont facultatives aux nouveaux plans d’épargne retraite', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BK' },
  { code: 'BK', ligne: '25', libelle: 'Charges sociales personnelles', formulaire: '2035-A', cadre: 'depenses' },
  { code: 'BY', ligne: '29', libelle: 'dont cotisations syndicales et professionnelles', formulaire: '2035-A', cadre: 'depenses', sousCaseDe: 'BM' },
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
// LA CASE PORTEUSE N'EST JAMAIS UNE CASE « DONT » : un poste rattaché à BY ou BT sortirait du total, puisque ces cases ne
// s'additionnent pas. Un test le vérifie.
//
// MAIS UN POSTE PEUT ALIMENTER AUSSI UNE SECONDE CASE (étape 2035S1, le troisième élément) : la case « dont » qui détaille
// sa porteuse — BY pour les cotisations syndicales et professionnelles (ligne 29, dans BM), BW pour les redevances de
// collaboration (renvoi (9), dans BG), BZ pour un contrat Madelin et BU pour un plan d'épargne retraite (ligne 25, dans
// BK ; notice 2035-NOT-SD 2026, p. 1) —, ou DB pour les indemnités journalières comptées en gains divers (renvoi (25) :
// « lorsqu'elles ont été incluses dans la rubrique AF »). Le montant y est AJOUTÉ, jamais retiré de la porteuse : une
// case « dont » ne s'additionne pas, DB ne joue qu'au revenu brut social. Le choix de porter les indemnités en AF reste à
// l'expert-comptable (2035S-Q3, (A)) : le poste propre le rend visible, il ne le tranche pas. Un test vérifie que la
// seconde case est une « dont » de la porteuse, ou DB derrière AF, et rien d'autre (`SECONDES_CASES_ADMISES_HORS_DONT`).
const RATTACHEMENTS: [poste: string, porteuse: string, aussi?: string][] = [
  // Recettes
  ['Recettes', 'AA'],
  // Le libellé officiel de la ligne 1, qui est aussi le poste des ventes facturées (étape VF3b1) : IMPORTÉ, comme la CSG
  // déductible plus bas — recopié, il se désynchroniserait d'un renommage, et les ventes facturées perdraient leur case.
  [POSTE_VENTES_FACTUREES, 'AA'],
  // Pas de rattachement pour « Honoraires » tout court : le mot désigne une recette ligne 1 chez le
  // praticien et une dépense ligne 21 chez celui qui les paie. Mieux vaut le signaler comme non
  // rattaché et laisser trancher que de choisir à pile ou face le sens d'un montant.
  ['Débours payés pour le compte des clients', 'AB'],
  ['Débours', 'AB'],
  ['Honoraires rétrocédés', 'AC'],
  ['Rétrocessions', 'AC'],
  ['Produits financiers', 'AE'],
  ['Gains divers', 'AF'],
  // 2035S-Q3, (A) : un poste propre, en AF et en DB. Pour (B) — DB seulement saisi —, retirer la seconde case ici.
  ['Indemnités journalières', 'AF', 'DB'],

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
  ['Redevances de collaboration', 'BG', 'BW'],

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
  // BT, la part obligatoire de BK, ne vient pas d'un poste : des échéances de l'onglet Cotisations elles-mêmes
  // (`partObligatoireDeBK`). Le poste générique reste en BK sans « dont » (2035S-Q2, (A)).
  [POSTE_COTISATIONS, 'BK'],
  ['Charges sociales personnelles', 'BK'],
  ['Cotisations facultatives Madelin', 'BK', 'BZ'],
  ["Plan d'épargne retraite", 'BK', 'BU'],

  // Dépenses — lignes 26 à 30, total groupé BM
  ['Frais de réception, de représentation et de congrès', 'BM'],
  ['Frais de réception, de représentation', 'BM'],
  ['Fournitures de bureau, frais de documentation, de correspondance et de téléphone', 'BM'],
  ['Fournitures de bureau', 'BM'],
  ["Frais d'actes et de contentieux", 'BM'],
  ['Cotisations syndicales et professionnelles', 'BM', 'BY'],
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
const SECONDE_CASE_PAR_CLE_DE_POSTE = new Map(RATTACHEMENTS.flatMap(([poste, , aussi]) => (aussi ? [[cle(poste), aussi] as const] : [])))

// Les secondes cases qu'un poste peut alimenter. Exporté pour le test qui juge la liste ENTIÈRE : chacune est une « dont »
// de sa porteuse, ou DB derrière AF (le seul « à déduire » du cadre 8 qu'un poste connaisse).
export const SECONDES_CASES = new Map(RATTACHEMENTS.flatMap(([poste, porteuse, aussi]) =>
  (aussi ? [[poste, { porteuse, aussi }] as const] : [])))
export const SECONDES_CASES_ADMISES_HORS_DONT: readonly { porteuse: string; aussi: string }[] = [{ porteuse: 'AF', aussi: 'DB' }]

// 2035S-Q2 : LES POSTES COMPTÉS OBLIGATOIRES, EN PLUS DES ÉCHÉANCES DE L'ONGLET COTISATIONS. Vide sur la réponse (A) : le
// poste générique « Charges sociales personnelles » ne dit pas si la charge est obligatoire ou facultative, et Clôture dit
// la part de BK que rien ne qualifie (`partDeBKSansNature`). La réponse (B) — le poste générique compté obligatoire aussi —
// s'écrit en y ajoutant 'Charges sociales personnelles'.
export const POSTES_COMPTES_OBLIGATOIRES: readonly string[] = []

// Les codes qu'un poste peut atteindre. Exporté pour que le test vérifie sur la liste ENTIÈRE, et non
// sur trois postes choisis, qu'aucun ne vise une case calculée, une case « dont » ou une case du
// cadre 8 : un montant qui y atterrirait sortirait du résultat sans que rien ne le dise.
export const CODES_RATTACHABLES = new Set(RATTACHEMENTS.map(([, code]) => code))

// LES POSTES QU'ON PROPOSE À UNE CATÉGORIE dont le poste n'atteint aucune case (Clôture, « Postes sans case ») : les
// libellés que le rattachement connaît, sauf ceux que le moteur calcule lui-même — la dotation aux amortissements vient du
// registre, la CSG déductible des échéances, les indemnités kilométriques du cadre 7. Une catégorie qui y porterait des
// pièces les ajouterait à ce calcul, et la même charge compterait deux fois.
const CASES_CALCULEES_PAR_LE_MOTEUR = new Set(['CH', 'BV'])
export const POSTES_PROPOSABLES: readonly string[] = [...new Set(RATTACHEMENTS
  .filter(([poste, code]) => !CASES_CALCULEES_PAR_LE_MOTEUR.has(code) && poste !== POSTE_INDEMNITES_KM)
  .map(([poste]) => poste))]

// La case pré-remplie pour un poste, ou null si le rattachement ne le connaît pas.
export function caseDuPoste(poste: string): Case2035 | null {
  const code = CASE_PAR_CLE_DE_POSTE.get(cle(poste))
  return code ? CASE_PAR_CODE.get(code) ?? null : null
}

// LES POSTES QUE LE RATTACHEMENT CONNAÎT, sous l'orthographe du code (FEC22a, lib/champsBncDuFec.ts) : la NatOp d'une ligne
// de charge ou de produit du FEC d'un BNC en trésorerie y écrit le poste de sa catégorie (FEC22-Q3, (C)), et jamais le
// texte que le cabinet a tapé dans le champ « poste 2035 » — « achats » ou « ACHATS » s'y écrivent « Achats », la clé
// du rattachement les confondant déjà. La première orthographe d'une clé l'emporte.
//
// SAUF LES QUATRE POSTES NEUFS DE L'ÉTAPE 2035S1, TANT QUE LA BASE NE LES CONNAÎT PAS : la migration préparée de FEC22b
// (`champs_bnc_du_fec`, supabase/preparees/) — et celle qui la reprend (`validation_des_paiements_par_la_caisse`) — copient
// cette liste dans trois listes fermées (`valider_exercice`, la contrainte des écritures), confrontées par
// champsBncFiges.test.ts, et refuseraient à la validation une NatOp qui en nomme un autre. Hors de la liste, la NatOp de
// leurs lignes ne porte que la nature (« Dépense », « Recette »), ce que la base accepte. Les y faire entrer demande de
// reprendre ces migrations, leurs empreintes et leurs retours — une décision de la session, avant leur application —,
// puis de vider cette constante.
export const POSTES_HORS_DES_LISTES_DU_FEC: readonly string[] = [
  'Indemnités journalières', 'Redevances de collaboration', 'Cotisations facultatives Madelin', "Plan d'épargne retraite",
]
export const POSTES_RATTACHES: readonly string[] = [...new Set(RATTACHEMENTS.map(([poste]) => poste))]
  .filter((poste) => !POSTES_HORS_DES_LISTES_DU_FEC.includes(poste))
const POSTE_PAR_CLE = new Map<string, string>()
for (const poste of POSTES_RATTACHES) if (!POSTE_PAR_CLE.has(cle(poste))) POSTE_PAR_CLE.set(cle(poste), poste)

// Le poste d'une ligne de cette nature tel que le formulaire le range, sous l'orthographe du rattachement ; nul quand le
// rattachement ne le connaît pas, ou que sa case est de l'autre cadre — exactement les postes que `repartirEnCases` dit
// « sans case » (`cadreCompatible`) : une recette sous un poste de dépenses n'est le poste d'aucune case. Nul aussi pour un
// poste que la base ne connaît pas encore (`POSTES_HORS_DES_LISTES_DU_FEC`).
export function posteRattache(poste: string, nature: LigneDeclaration['nature']): string | null {
  const c = caseDuPoste(poste)
  return c && cadreCompatible(c, nature) ? POSTE_PAR_CLE.get(cle(poste)) ?? null : null
}

export interface CaseRemplie {
  case: Case2035
  montant: number
  // Les postes du moteur derrière ce montant. Plusieurs postes partagent une case (BH en reçoit deux
  // rien qu'avec les catégories par défaut) : les nommer, c'est pouvoir justifier la case d'un clic.
  postes: string[]
  nbPieces: number
  // La SOMME des mouvements de ses postes : un mouvement ventilé sur deux postes d'une même case y compte
  // deux fois — les postes ne portent qu'un nombre, pas les mouvements eux-mêmes. Aucun écran ne
  // l'affiche aujourd'hui ; le jour où l'un le fera, c'est ici qu'il faudra porter les identifiants.
  nbMouvements: number
  // Et la somme des encaissements de factures de ses postes (étape VF7d) : un même encaissement ne porte qu'un poste, celui
  // des ventes facturées, et n'y compte donc qu'une fois.
  nbEncaissements: number
  // Et la somme des opérations de caisse de ses postes (étape C3a) : présente quand la 2035 a lu la caisse, comme sur ses
  // lignes (`LigneDeclaration.nbOperationsDeCaisse`) ; absente sinon, et la case est celle d'avant la caisse.
  nbOperationsDeCaisse?: number
}

export interface PosteNonRattache {
  ligne: LigneDeclaration
  raison: 'aucune case connue' | 'case du mauvais sens'
  // Renseigné quand une case a bien été trouvée mais qu'elle ne va pas : de quoi expliquer plutôt
  // que de laisser l'utilisateur deviner.
  codeRefuse?: string
}

export interface RepartitionCases {
  // Les cases qui s'additionnent — une par poste, sa porteuse.
  cases: CaseRemplie[]
  // LES SECONDES CASES (étape 2035S1) : les « dont » que les postes alimentent aussi (BY, BW, BZ, BU), BT tirée des
  // échéances de l'onglet Cotisations, et DB des indemnités journalières. Leur montant est DÉJÀ dans une case de `cases` :
  // les additionner aux premières compterait deux fois. Seulement celles que le formulaire de l'exercice porte (DB depuis
  // les revenus 2025).
  secondes: CaseRemplie[]
  // Postes qu'aucune case ne reçoit. Comme partout ailleurs dans ce moteur, ce qui sort du calcul est
  // remonté plutôt que retiré en silence : sur une déclaration, un poste écarté est un montant que
  // personne ne verra manquer.
  postesSansCase: PosteNonRattache[]
}

// Une case de recettes ne peut recevoir qu'une recette, une case de dépenses qu'une dépense. Le
// rattachement se fait sur un libellé de poste, mais le sens vient du type de la pièce : sans ce
// contrôle, un poste au libellé ambigu ferait entrer une dépense dans les recettes — et le montant
// compterait deux fois à l'envers dans le résultat.
//
// SAUF LES DEUX CASES QUI SE RETRANCHENT DES RECETTES, les débours (AB, ligne 2) et les honoraires rétrocédés (AC, ligne
// 3) : elles sont imprimées au cadre des recettes, mais ce qu'elles reçoivent est de l'argent VERSÉ — la part que la
// titulaire rétrocède à sa remplaçante, les frais avancés pour le client —, dont l'encaissement est déjà en ligne 1 et
// que le formulaire retranche (2035-A-SD, cadre 2 : la ligne 1 « recettes encaissées y compris les remboursements de
// frais », la ligne 4 « montant net des recettes » = ligne 1 − ligne 2 − ligne 3). Une rétrocession se range donc dans
// une catégorie de CHARGE (un compte 6, au poste « Honoraires rétrocédés ») et le moteur en fait une DÉPENSE, comptée en
// positif, qui diminue le résultat comme la case diminue la ligne 4 : la case l'accepte, et elle seule. Elles refusaient
// toute dépense, comme « case du mauvais sens » — et une rétrocession en charge laissait AC vide, AD au brut, la
// validation bloquée ; rangée en produit
// (une recette négative), elle y entrait au signe de la recette, AD = AA − (−AC) gonflait AD du double de la rétrocession,
// et la case négative bloquait aussi (relecture du 31/10/2026). Une RECETTE sous ce poste n'y entre plus : c'est le cas
// de la REMPLAÇANTE, pour qui la rétrocession reçue est une recette de la ligne 1, et la retrancher l'ôterait de son
// résultat ; Clôture la montre dans les postes sans case, et la validation la refuse, jusqu'à ce que le cabinet range la
// catégorie.
function cadreCompatible(c: Case2035, nature: LigneDeclaration['nature']): boolean {
  if (c.soustractive) return nature === 'depense'
  return nature === 'recette' ? c.cadre === 'recettes' : c.cadre !== 'recettes'
}

// Regroupe les postes d'une déclaration dans les cases du formulaire. `montant` reste positif, le
// sens étant porté par le cadre de la case (recettes/dépenses), comme dans le moteur.
// Ajoute une ligne (ou ce qui en tient lieu) à la case `c` de `parCode`.
function porterDans(
  parCode: Map<string, CaseRemplie>, c: Case2035,
  ligne: Pick<LigneDeclaration, 'poste' | 'montant' | 'nbPieces' | 'nbMouvements' | 'nbEncaissements' | 'nbOperationsDeCaisse'>,
): void {
  const actuel = parCode.get(c.code)
  if (actuel) {
    actuel.montant += ligne.montant
    actuel.postes.push(ligne.poste)
    actuel.nbPieces += ligne.nbPieces
    actuel.nbMouvements += ligne.nbMouvements
    actuel.nbEncaissements += ligne.nbEncaissements
    if (ligne.nbOperationsDeCaisse !== undefined) actuel.nbOperationsDeCaisse = (actuel.nbOperationsDeCaisse ?? 0) + ligne.nbOperationsDeCaisse
    return
  }
  parCode.set(c.code, {
    case: c, montant: ligne.montant, postes: [ligne.poste], nbPieces: ligne.nbPieces, nbMouvements: ligne.nbMouvements,
    nbEncaissements: ligne.nbEncaissements,
    ...(ligne.nbOperationsDeCaisse !== undefined ? { nbOperationsDeCaisse: ligne.nbOperationsDeCaisse } : {}),
  })
}

// La case que le formulaire de cet exercice porte : DB n'existe qu'à partir des revenus 2025.
const porteeEn = (c: Case2035, annee: number) => (c.depuisExercice ?? annee) <= annee

// BT, LA PART OBLIGATOIRE DE BK (renvoi (13) : « la part respective des cotisations obligatoires et facultatives »), au
// centime : les échéances de l'onglet Cotisations — Urssaf, caisse de retraite, que la loi impose —, telles que la 2035 les
// porte en BK, leur CSG-CRDS sortie (sa part déductible va en BV). Lues dans les CONTRIBUTIONS, jamais au poste : une
// catégorie que le cabinet aurait nommée « Cotisations sociales personnelles » partage la ligne du poste, et ne dit pas pour
// autant une charge obligatoire (2035S-Q2, (A)). Plus les postes que `POSTES_COMPTES_OBLIGATOIRES` désigne — aucun en (A).
export function partObligatoireDeBK(declaration: Declaration2035): { centimes: number; nbMouvements: number } {
  let centimes = 0
  const mouvements = new Set<string>()
  for (const c of declaration.contributions) {
    if (c.source.type === 'cotisation') {
      centimes += c.centimes
      if (c.source.ligne) mouvements.add(c.source.ligne.id)
    }
  }
  const obligatoires = new Set(POSTES_COMPTES_OBLIGATOIRES.map(cle))
  for (const l of declaration.depenses) {
    if (l.poste !== POSTE_COTISATIONS && obligatoires.has(cle(l.poste)) && caseDuPoste(l.poste)?.code === 'BK') {
      centimes += Math.round(l.montant * 100)
    }
  }
  return { centimes, nbMouvements: mouvements.size }
}

// Regroupe les postes d'une déclaration dans les cases du formulaire. `montant` reste positif, le
// sens étant porté par le cadre de la case (recettes/dépenses), comme dans le moteur.
export function repartirEnCases(declaration: Declaration2035): RepartitionCases {
  const parCode = new Map<string, CaseRemplie>()
  const secondes = new Map<string, CaseRemplie>()
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
    porterDans(parCode, c, ligne)
    // La seconde case, quand le poste en nomme une et que le formulaire de l'exercice la porte : le même montant, AJOUTÉ.
    const aussi = CASE_PAR_CODE.get(SECONDE_CASE_PAR_CLE_DE_POSTE.get(cle(ligne.poste)) ?? '')
    if (aussi && porteeEn(aussi, declaration.annee)) porterDans(secondes, aussi, ligne)
  }

  // BT : la part de BK que les échéances de l'onglet Cotisations portent.
  const obligatoire = partObligatoireDeBK(declaration)
  if (obligatoire.centimes !== 0) {
    porterDans(secondes, CASE_PAR_CODE.get('BT')!, {
      poste: POSTE_COTISATIONS, montant: obligatoire.centimes / 100, nbPieces: 0, nbMouvements: obligatoire.nbMouvements,
      nbEncaissements: 0,
    })
  }

  // Ordre du formulaire, pas ordre d'apparition : une déclaration se lit dans l'ordre imprimé.
  const rang = new Map(CASES_2035.map((c, i) => [c.code, i]))
  const dansLOrdre = (m: Map<string, CaseRemplie>) => [...m.values()]
    .map((r) => ({ ...r, montant: Number(r.montant.toFixed(2)) }))
    .sort((a, b) => (rang.get(a.case.code) ?? 0) - (rang.get(b.case.code) ?? 0))

  return { cases: dansLOrdre(parCode), secondes: dansLOrdre(secondes), postesSansCase }
}

// UNE CASE NÉGATIVE NE SE DÉPOSE PAS. Un poste dont les avoirs et les remboursements de l'exercice
// dépassent ce qu'il compte reste négatif (voir `LigneDeclaration`) ; dans une case qui reçoit d'autres
// postes, il la diminue, et c'est juste. Quand la CASE elle-même passe sous zéro, le formulaire ne sait pas
// la porter : un remboursement reçu une année sans dépense du même poste se rattache le plus souvent à une
// dépense d'un exercice antérieur, et sa place est à arbitrer avant de signer. Le moteur ne tranche pas —
// il totalise, il ne déclare pas — mais il ne retourne plus le signe, et il le dit ici, avec les postes
// qui font la case.
//
// Une seconde case aussi (étape 2035S1) : BT négative — des remboursements d'obligatoires plus forts que leurs appels — ne
// se dépose pas davantage, même quand un Madelin garde BK positive.
export function casesNegatives(declaration: Declaration2035): CaseRemplie[] {
  const { cases, secondes } = repartirEnCases(declaration)
  return [...cases, ...secondes].filter((r) => r.montant < 0)
}

// Toutes les cases du formulaire, y compris celles qu'aucun poste n'alimente et celles qui se
// calculent. Une case sans montant vaut 0 : sur un formulaire, l'absence est un zéro, et le PDF a
// besoin d'une valeur par case plutôt que d'un trou.
export function valeursDesCases(declaration: Declaration2035): {
  valeurs: Map<string, number>
  postesSansCase: PosteNonRattache[]
} {
  const { cases, secondes, postesSansCase } = repartirEnCases(declaration)
  const valeurs = new Map<string, number>(CASES_2035.map((c) => [c.code, 0]))
  for (const r of [...cases, ...secondes]) valeurs.set(r.case.code, r.montant)

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
// Depuis l'étape 2035S1, le moteur remplit les « dont » d'un poste qui les nomme, et BT des échéances : chacune est une
// part de sa porteuse par construction, et ne la dépasse pas. L'incohérence reste à dire d'une saisie à venir, et d'une
// case négative qui ferait passer la porteuse sous ses « dont ». C'est justement ce qu'un relecteur ne voit pas : les deux
// cases sont loin l'une de l'autre sur le formulaire, et rien n'oblige l'œil à les rapprocher.
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

// LA PART DE BK QUE RIEN NE QUALIFIE (étape 2035S1, 2035S-Q2 (A)) : ce que la ligne 25 porte au-delà de ses trois « dont »
// — BT, les échéances de l'onglet Cotisations ; BZ, un poste « Cotisations facultatives Madelin » ; BU, un poste « Plan
// d'épargne retraite ». Le reste vient d'une catégorie au poste générique « Charges sociales personnelles », qui ne dit pas
// si la charge est obligatoire ou facultative : le formulaire veut cette part (renvoi (13)), et l'application ne la
// devine pas. Clôture le dit ; ranger la catégorie sous le poste qui la nomme le règle. Au centime ; zéro si rien ne reste.
export function partDeBKSansNature(valeurs: ReadonlyMap<string, number>): number {
  const c = (code: string) => Math.round((valeurs.get(code) ?? 0) * 100)
  return Math.max(0, c('BK') - c('BT') - c('BZ') - c('BU')) / 100
}

// « Ne pas porter les centimes », dit le formulaire. Arrondir chaque case indépendamment casserait
// l'addition imprimée (les totaux ne tomberaient plus juste à l'euro près) : on arrondit donc les
// cases alimentées, puis on RECALCULE les totaux à partir des valeurs arrondies. Un formulaire dont
// les colonnes ne s'additionnent pas est un formulaire qu'on se fait renvoyer.
//
// L'exercice est exigé, sans valeur par défaut : le cadre 8 en dépend, et un appelant qui l'oublierait
// doit le découvrir à la compilation plutôt que sur un revenu brut social absent du PDF.
//
// ET LES « DONT » D'UNE MÊME PORTEUSE NE LA DÉPASSENT PAS UNE FOIS ARRONDIS (étape 2035S1). Chacun s'arrondit seul, comme
// sa porteuse : BT 9 000,60 € et BZ 1 200,60 € s'impriment 9 001 et 1 201, quand BK, leur somme 10 201,20 €, s'imprime
// 10 201 — un euro de « dont » de plus que la case qui les porte, sur un formulaire que les contrôles de cohérence
// rejettent. Quand les montants au centime tiennent dans la porteuse et que l'arrondi seul l'en fait sortir, l'euro de trop
// se retire du « dont » que l'arrondi a le plus relevé (`ajusterLesDontArrondis`). Une incohérence au centime n'est pas
// touchée : c'est une saisie contradictoire, que `incoherencesDesCases` dit.
export function arrondirPourFormulaire(valeurs: Map<string, number>, annee: number): Map<string, number> {
  const arrondies = new Map<string, number>()
  for (const c of CASES_2035) {
    if (c.calculee) continue
    arrondies.set(c.code, Math.round(valeurs.get(c.code) ?? 0))
  }
  ajusterLesDontArrondis(valeurs, arrondies)
  calculerLesCasesCalculees(arrondies, annee)
  return arrondies
}

function ajusterLesDontArrondis(valeurs: Map<string, number>, arrondies: Map<string, number>): void {
  const parPorteuse = new Map<string, Case2035[]>()
  for (const c of CASES_2035) if (c.sousCaseDe) parPorteuse.set(c.sousCaseDe, [...(parPorteuse.get(c.sousCaseDe) ?? []), c])
  for (const [porteuse, dont] of parPorteuse) {
    const auCentime = dont.reduce((s, c) => s + Math.round((valeurs.get(c.code) ?? 0) * 100), 0)
    if (auCentime > Math.round((valeurs.get(porteuse) ?? 0) * 100)) continue
    let exces = dont.reduce((s, c) => s + (arrondies.get(c.code) ?? 0), 0) - (arrondies.get(porteuse) ?? 0)
    while (exces > 0) {
      // Le « dont » dont l'arrondi a le plus relevé le montant ; à égalité, l'ordre du formulaire.
      // En centimes : un écart en virgule flottante départagerait deux arrondis égaux au hasard des décimales.
      const releve = (c: Case2035) => (arrondies.get(c.code) ?? 0) * 100 - Math.round((valeurs.get(c.code) ?? 0) * 100)
      const plusReleve = dont.reduce((a, b) => (releve(b) > releve(a) ? b : a))
      if (releve(plusReleve) <= 0) break
      arrondies.set(plusReleve.code, (arrondies.get(plusReleve.code) ?? 0) - 1)
      exces--
    }
  }
}
