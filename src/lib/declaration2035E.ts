import { POSTE_INDEMNITES_KM } from './declaration2035'

// L'ANNEXE 2035-E : la valeur ajoutée produite au cours de l'exercice, qui sert à la CVAE (ligne 48 de la feuille de
// route). Tirée de la 2035 elle-même, case par case, sans revenir aux pièces : c'est la 2035 déposée qui la porte, et un
// contrôleur doit pouvoir retrouver EF dans AD, EJ dans BA, EL dans BH. Aucune recatégorisation, donc aucune seconde
// lecture des catégories qui pourrait dire autre chose que le formulaire.
//
// Sources, toutes publiques :
//   [N] notice 2035-NOT-SD 2026, pages 7-8 (renvois 2, 3, 5, 9, 12) et 11-12 (annexe 2035-E-SD) ;
//   [F] le formulaire lui-même, page 3 de public/formulaires/2035-sd-2026.pdf (2035-E-SD 2026, cerfa 15945*08) ;
//   [B] BOFiP : BOI-CVAE-BASE-20-10 § 60-80 (le chiffre d'affaires d'un BNC), BOI-CVAE-BASE-20-20 § 180-213 (les loyers),
//       § 280-310 (la valeur ajoutée d'un BNC), § 350-370 (le plafonnement), BOI-CVAE-CHAMP-10-20 § 1 (le seuil) ;
//   [C] notice 1330-CVAE-NOT-SD 2026 : une valeur ajoutée négative se déclare zéro.
//
// **Ce module ne calcule aucun impôt.** Il dit si l'annexe est due, ce qu'elle porte, et si une CVAE peut être due ; le
// montant de la CVAE se liquide sur la 1329-DEF, qui n'est pas de son ressort.

// « Les informations de l'annexe n° 2035-E-SD doivent être remplies lorsque le chiffre d'affaires réalisé par l'entreprise
// au cours de la période de référence [...] est supérieur à 152 500 € hors taxes » [N, p. 11] — le seuil d'assujettissement
// à la CVAE (CGI, art. 1586 ter). Strictement supérieur : à 152 500 € pile, l'annexe n'est pas due.
export const SEUIL_ANNEXE_2035E = 152_500

// En dessous, le taux de la CVAE est nul : l'entreprise est « assujettie non redevable », elle déclare et ne paie rien
// (BOI-CVAE-LIQ-10 § 60, barème 2025 à 2029 ; brochure Impôts locaux 2026, aide-mémoire CVAE). À 500 000 € pile, la
// formule du barème rend encore zéro.
export const SEUIL_CVAE_A_PAYER = 500_000

// Le plafonnement de la valeur ajoutée : 80 % du chiffre d'affaires jusqu'à 7,6 millions d'euros, 85 % au-delà [B, § 360].
export const SEUIL_PLAFONNEMENT_85 = 7_600_000

export type Partie2035E = 'recettes' | 'depenses' | 'valeurAjoutee' | 'cvae'

export interface Ligne2035E {
  code: string
  // Recopié du formulaire [F] : un libellé maison ferait douter de la ligne visée.
  libelle: string
  partie: Partie2035E
  // D'où vient le montant : les cases de la 2035 qui l'alimentent, la formule d'un total, ou la saisie qu'elle attend.
  origine: string
  // Un total du formulaire : aucune case ne l'alimente directement.
  calculee?: true
  // Une ligne que la 2035 ne sait pas remplir : seul le cabinet la connaît (plus-values, stocks, biens donnés en location).
  saisieCabinet?: true
}

// Dans l'ordre d'impression. Le cadre réservé aux mono-établissements (AH, AJ, BO, BK, KA, LA, MA) n'y est pas : il ne se
// remplit que si le dossier n'a qu'un établissement au sens de la CFE, ce que l'application ne sait pas (voir
// `cadreMonoEtablissement`).
export const LIGNES_2035E: readonly Ligne2035E[] = [
  { code: 'EF', libelle: 'Montant net des honoraires ou recettes provenant de l’exercice d’une profession non commerciale', partie: 'recettes',
    origine: '2035-A : AD − BW (les redevances de collaboration versées sont des rétrocessions pour la CVAE)' },
  { code: 'EG', libelle: 'Gains divers (à l’exclusion des remboursements de crédit de TVA)', partie: 'recettes', origine: '2035-A : AF' },
  { code: 'EH', libelle: 'TVA déductible afférente aux dépenses mentionnées aux lignes EJ à EP', partie: 'recettes',
    origine: 'comptabilité « TVA incluse » seulement — ici les dépenses sont hors taxes, ou sans TVA déductible' },
  { code: 'EN', libelle: 'Plus-values de cession d’éléments d’immobilisations corporelles et incorporelles lorsqu’elles se rapportent à une activité normale et courante',
    partie: 'recettes', origine: 'saisie du cabinet', saisieCabinet: true },
  { code: 'EI', libelle: 'TOTAL 1', partie: 'recettes', origine: 'EF + EG + EH + EN', calculee: true },
  { code: 'EJ', libelle: 'Achats', partie: 'depenses', origine: '2035-A : BA' },
  { code: 'EK', libelle: 'Variation de stock', partie: 'depenses', origine: 'saisie du cabinet', saisieCabinet: true },
  { code: 'EL', libelle: 'Services extérieurs à l’exception des loyers et redevances', partie: 'depenses', origine: '2035-A : BH' },
  { code: 'EM', libelle: 'Loyers et redevances, à l’exception de ceux afférents à des immobilisations corporelles mises à disposition dans le cadre d’une convention de location-gérance ou de crédit-bail ou encore d’une convention de location de plus de 6 mois',
    partie: 'depenses', origine: 'saisie du cabinet : la part de BF + BG − BW qui n’est pas un loyer de plus de six mois', saisieCabinet: true },
  { code: 'EO', libelle: 'Frais de transport et de déplacement', partie: 'depenses', origine: '2035-A : BJ − le forfait kilométrique' },
  { code: 'EP', libelle: 'Frais divers de gestion', partie: 'depenses', origine: '2035-A : BM' },
  { code: 'EQ', libelle: 'TVA incluse dans les recettes mentionnées ligne EF', partie: 'depenses',
    origine: 'comptabilité « TVA incluse » seulement — ici les recettes sont hors taxes' },
  { code: 'ER', libelle: 'Taxe sur le chiffre d’affaires et assimilées, contributions indirectes, taxe intérieure de consommation sur les produits énergétiques',
    partie: 'depenses', origine: 'saisie du cabinet', saisieCabinet: true },
  { code: 'EU', libelle: 'Dotations aux amortissements afférentes à des immobilisations corporelles mises à disposition dans le cadre d’une convention de location-gérance ou de crédit-bail ou encore d’une convention de location de plus de 6 mois',
    partie: 'depenses', origine: 'saisie du cabinet', saisieCabinet: true },
  { code: 'EV', libelle: 'Moins-values de cession d’éléments d’immobilisations corporelles et incorporelles lorsqu’elles se rapportent à une activité normale et courante',
    partie: 'depenses', origine: 'saisie du cabinet', saisieCabinet: true },
  { code: 'EW', libelle: 'TOTAL 2', partie: 'depenses', origine: 'EJ + EK + EL + EM + EO + EP + EQ + ER + EU + EV', calculee: true },
  { code: 'EX', libelle: 'Calcul de la valeur ajoutée (TOTAL 1 – TOTAL 2)', partie: 'valeurAjoutee', origine: 'EI − EW', calculee: true },
  { code: 'JU', libelle: 'Valeur ajoutée assujettie à la CVAE', partie: 'cvae',
    origine: 'EX plafonnée à 80 % du chiffre d’affaires (85 % au-delà de 7,6 M€), zéro si négative', calculee: true },
]

export const CODES_2035E: readonly string[] = LIGNES_2035E.map((l) => l.code)

// Ce que seul le cabinet sait, ligne par ligne. Sans valeur par défaut DANS LA FONCTION : un appelant qui l'oublie doit le
// découvrir à la compilation. L'écran passe aujourd'hui `SAISIES_2035E_ABSENTES` et DIT ce que cela suppose ; la saisie
// enregistrée par exercice demande une table (rapport de la ligne 48).
export interface Saisies2035E {
  // La part de BF + BG (hors BW) qui se DÉDUIT : un loyer de six mois au plus, ou la contrepartie d'une prestation distincte
  // de la mise à disposition. Le reste — le loyer du cabinet sous bail, un crédit-bail, une location longue d'un matériel —
  // ne se déduit pas [B, § 180 à 211 ; N, p. 11].
  loyersDeductibles: number
  plusValues: number // EN
  variationDeStock: number // EK : positive quand le stock baisse (elle s'ajoute aux charges), négative quand il monte [N, renvoi (2)]
  taxesSurLeChiffreDAffaires: number // ER
  dotationsBiensMisADisposition: number // EU
  moinsValues: number // EV
}

// AUCUNE SAISIE : tous les loyers et locations sont tenus pour non déductibles. C'est le cas du loyer d'un cabinet sous
// bail professionnel, de loin le plus fréquent, et l'hypothèse qui ne minore jamais la valeur ajoutée déclarée ; elle se
// dit à l'écran avec son montant.
export const SAISIES_2035E_ABSENTES: Saisies2035E = Object.freeze({
  loyersDeductibles: 0, plusValues: 0, variationDeStock: 0, taxesSurLeChiffreDAffaires: 0, dotationsBiensMisADisposition: 0, moinsValues: 0,
})

export interface Entree2035E {
  annee: number
  // Les cases de la 2035 AU CENTIME (`valeursDesCases`, ou celles d'une 2035 validée) : le seuil de 152 500 € se juge sur
  // le chiffre d'affaires réalisé, pas sur son arrondi — 152 500,40 € le dépassent.
  cases: ReadonlyMap<string, number>
  // Les mêmes À L'EURO, telles que le formulaire les porte (`arrondirPourFormulaire`, ou celles d'une 2035 validée) : la
  // 2035-E se remplit depuis la 2035 déposée, pour qu'un contrôleur qui la relit retombe sur ses cases.
  formulaire: ReadonlyMap<string, number>
  // Le forfait kilométrique compté en BJ (poste « Indemnités kilométriques », cadre 7, total A), au centime. Des « frais
  // forfaitaires de déplacement », que la notice retire de la ligne EO [N, renvoi (3) de l'annexe] : le barème n'est le
  // prix d'aucun bien ni d'aucun service acheté à un tiers.
  forfaitKilometrique: number
  saisies: Saisies2035E
}

export interface Incoherence2035E {
  code: string
  raison: string
}

export interface Annexe2035E {
  annee: number
  // Au centime : recettes nettes des débours et des rétrocessions, moins les redevances de collaboration versées, plus les
  // gains divers [B, BOI-CVAE-BASE-20-10 § 70 et 80].
  chiffreDAffaires: number
  obligatoire: boolean
  // Sous 500 000 €, le taux est nul : rien à payer. Au-delà, une CVAE peut être due, à liquider sur la 1329-DEF.
  cvae: 'nulle' | 'a_liquider'
  // À l'euro, chaque ligne de `LIGNES_2035E`, et AJ, le chiffre d'affaires de référence du cadre des mono-établissements.
  lignes: Map<string, number>
  // BF + BG − BW à l'euro, et ce qui n'en est pas déduit (toute la somme sans saisie).
  loyersEtLocations: number
  loyersNonDeduits: number
  forfaitKilometrique: number
  // BW à l'euro : les redevances de collaboration versées, telles que la 2035 les porte. Une case « dont » que le moteur
  // de la 2035 ne remplit jamais (`saisieCabinet`, lib/cases2035.ts) : zéro tant que personne ne la saisit — et le
  // chiffre d'affaires d'un collaborateur les comprend alors encore, ce que la carte dit.
  redevancesDeCollaboration: number
  // 80 % (ou 85 %) de AJ, à l'euro inférieur : la valeur ajoutée déclarée ne peut pas l'excéder.
  plafond: number
  plafonnee: boolean
  incoherences: Incoherence2035E[]
}

const centimes = (n: number) => Math.round(n * 100)

// LE CHIFFRE D'AFFAIRES AU SENS DE LA CVAE, au centime, depuis les cases de la 2035. AD est déjà net des débours (ligne 2)
// et des rétrocessions (ligne 3) ; les redevances de collaboration VERSÉES, que la 2035 porte en dépense (BW, dans BG),
// sont des rétrocessions pour la CVAE et en sortent aussi [N, renvoi (9) ; B, BOI-CVAE-BASE-20-10 § 80]. Les produits
// financiers (AE) n'en sont pas.
export function chiffreDAffaires2035E(cases: ReadonlyMap<string, number>): number {
  const c = (code: string) => centimes(cases.get(code) ?? 0)
  return (c('AD') - c('BW') + c('AF')) / 100
}

export function calculer2035E(entree: Entree2035E): Annexe2035E {
  const v = (code: string) => Math.round(entree.formulaire.get(code) ?? 0)
  const s = entree.saisies
  const incoherences: Incoherence2035E[] = []

  const chiffreDAffaires = chiffreDAffaires2035E(entree.cases)
  const lignes = new Map<string, number>()

  // A. Recettes. EH n'existe que pour une comptabilité « TVA incluse » [N, renvoi (1) de l'annexe] ; celle de
  // l'application est hors taxes pour un assujetti, et un exonéré n'a pas de TVA déductible (lib/montantRetenu.ts).
  lignes.set('EF', v('AD') - v('BW'))
  lignes.set('EG', v('AF'))
  lignes.set('EH', 0)
  lignes.set('EN', Math.round(s.plusValues))

  // B. Dépenses : les seules lignes de la 2035 que la notice énumère — achats, stocks, travaux, fournitures et services
  // extérieurs, loyers et locations, transports et déplacements, frais divers de gestion [N, p. 11 ; B, § 290]. Ni les
  // salaires et charges sociales (BB, BC), ni les impôts (BD, JY, BS), ni la CSG et les charges personnelles (BV, BK), ni
  // les frais financiers et pertes (BN, BP), ni les amortissements (CH) : la valeur ajoutée les comprend.
  const forfait = Math.round(entree.forfaitKilometrique)
  const loyersEtLocations = v('BF') + v('BG') - v('BW')
  const loyersDeductibles = Math.round(s.loyersDeductibles)
  lignes.set('EJ', v('BA'))
  lignes.set('EK', Math.round(s.variationDeStock))
  lignes.set('EL', v('BH'))
  lignes.set('EM', loyersDeductibles)
  lignes.set('EO', v('BJ') - forfait)
  lignes.set('EP', v('BM'))
  lignes.set('EQ', 0)
  lignes.set('ER', Math.round(s.taxesSurLeChiffreDAffaires))
  lignes.set('EU', Math.round(s.dotationsBiensMisADisposition))
  lignes.set('EV', Math.round(s.moinsValues))

  // Une saisie qui dépasse ce que la 2035 porte, ou une ligne de dépense qui passe sous zéro, ne se corrige pas en
  // silence : elle se dit, comme une case négative de la 2035 (lib/cases2035.ts, `casesNegatives`).
  if (loyersDeductibles < 0 || loyersDeductibles > loyersEtLocations) {
    incoherences.push({
      code: 'EM',
      raison: `Les loyers déduits (${loyersDeductibles} €) doivent rester entre zéro et les loyers et locations de la 2035, BF + BG − BW (${loyersEtLocations} €).`,
    })
  }
  for (const code of ['EF', 'EG', 'EJ', 'EL', 'EO', 'EP']) {
    const montant = lignes.get(code) ?? 0
    if (montant < 0) incoherences.push({ code, raison: `La ligne ${code} est négative (${montant} €) : elle ne se dépose pas ainsi.` })
  }

  const somme = (codes: string[]) => codes.reduce((t, code) => t + (lignes.get(code) ?? 0), 0)
  lignes.set('EI', somme(['EF', 'EG', 'EH', 'EN']))
  lignes.set('EW', somme(['EJ', 'EK', 'EL', 'EM', 'EO', 'EP', 'EQ', 'ER', 'EU', 'EV']))
  lignes.set('EX', (lignes.get('EI') ?? 0) - (lignes.get('EW') ?? 0))

  // Le chiffre d'affaires de référence, À L'EURO comme le formulaire le porte : EF + EG. Le plafond en découle, à l'euro
  // INFÉRIEUR — arrondi au plus proche, il pourrait excéder 80 % d'un demi-euro, ce que la règle interdit [B, § 370]. La
  // correction à douze mois ne s'applique pas au plafonnement [B, § 360].
  const chiffreDeReference = (lignes.get('EF') ?? 0) + (lignes.get('EG') ?? 0)
  lignes.set('AJ', chiffreDeReference)
  const taux = chiffreDeReference > SEUIL_PLAFONNEMENT_85 ? 85 : 80
  const plafond = Math.max(0, Math.floor((chiffreDeReference * taux) / 100))
  const valeurAjoutee = lignes.get('EX') ?? 0
  // Négative, elle se déclare zéro [C, cadre A2] ; au-delà du plafond, elle s'y arrête [B, § 370].
  lignes.set('JU', Math.max(0, Math.min(valeurAjoutee, plafond)))

  return {
    annee: entree.annee,
    chiffreDAffaires,
    obligatoire: centimes(chiffreDAffaires) > SEUIL_ANNEXE_2035E * 100,
    cvae: centimes(chiffreDAffaires) > SEUIL_CVAE_A_PAYER * 100 ? 'a_liquider' : 'nulle',
    lignes,
    loyersEtLocations,
    loyersNonDeduits: loyersEtLocations - loyersDeductibles,
    forfaitKilometrique: forfait,
    redevancesDeCollaboration: v('BW'),
    plafond,
    plafonnee: valeurAjoutee > plafond,
    incoherences,
  }
}

// Le forfait kilométrique d'une 2035 : la ligne de dépense du poste « Indemnités kilométriques ». Lue dans les postes
// plutôt que dans le cadre 7, pour qu'une 2035 VALIDÉE — dont l'instantané garde les postes, pas le cadre 7 — donne la
// même annexe qu'au jour de sa validation. Le poste est IMPORTÉ, jamais recopié : renommé dans le moteur, une chaîne
// recopiée ici ne trouverait plus rien et le forfait resterait en EO sans que rien le dise.
export function forfaitKilometriqueDesPostes(
  postes: readonly { poste: string; nature: 'recette' | 'depense'; montant: number }[],
): number {
  return postes
    .filter((p) => p.nature === 'depense' && p.poste === POSTE_INDEMNITES_KM)
    .reduce((s, p) => s + centimes(p.montant), 0) / 100
}

// LE CADRE RÉSERVÉ AUX MONO-ÉTABLISSEMENTS, tel qu'il se remplirait : coché, il dispense de la déclaration 1330-CVAE
// [F ; BOI-CVAE-DECLA-10 § 20]. L'application ne le remplit pas — elle ne sait ni si le dossier n'a qu'un établissement au
// sens de la CFE, ni combien de salariés il emploie — mais elle donne ce qu'il porterait : le chiffre d'affaires de
// référence et la période de référence, l'année civile pour un BNC [B, BOI-CVAE-CHAMP-10-20 § 60].
export function cadreMonoEtablissement(annexe: Annexe2035E): { chiffreDeReference: number; du: string; au: string } {
  return { chiffreDeReference: annexe.lignes.get('AJ') ?? 0, du: `${annexe.annee}-01-01`, au: `${annexe.annee}-12-31` }
}
