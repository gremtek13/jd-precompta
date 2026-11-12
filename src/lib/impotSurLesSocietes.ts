// L'IMPÔT SUR LES SOCIÉTÉS D'UN EXERCICE (ligne 38 de la feuille de route, lot LIA3 ; docs/conceptions/37-liasse-2033.md,
// § 6). Module PUR, en centimes entiers : il ne lit ni la base ni l'horloge, il calcule depuis ce qu'on lui donne. Rien ne
// s'y devine : les réintégrations et les déductions sont SAISIES (LIA-Q4), le stock de déficits d'ouverture aussi
// (LIA-Q6), les conditions du taux réduit sont passées en paramètre (LIA-Q5), l'option de report en arrière et son
// montant aussi (LIA-Q7) ; les acomptes se calculent depuis les liasses de référence (LIA-Q8), une référence inconnue se
// dit « à saisir », jamais zéro.
//
// Sources publiques, lues le 12/11/2026 (Légifrance par sa page datée, le BOFiP par sa version publiée) :
//   [219]  CGI art. 219, I (version en vigueur depuis le 21/02/2026, loi n° 2026-103 du 19/02/2026, art. 15) : taux normal
//          de 25 % ; I b : 15 % dans la limite de 42 500 € de bénéfice imposable par période de douze mois, pour un
//          chiffre d'affaires de l'exercice, « ramené s'il y a lieu à douze mois », n'excédant pas 10 millions d'euros, et
//          un capital entièrement libéré, détenu de manière continue pour 75 % au moins par des personnes physiques (ou
//          par une société qui remplit les mêmes conditions).
//   [L10]  BOI-IS-LIQ-20-10-20230621 : le chiffre d'affaires est celui des recettes HT de l'activité normale et courante,
//          ramené à douze mois ; la limite de 42 500 € vaut pour les exercices clos à compter du 31/12/2022.
//   [L20]  BOI-IS-LIQ-20-20-20230621 : la limite est affectée du rapport entre le nombre de mois de l'exercice et 12 ; un
//          mois entamé compte ses jours, divisés par 30 (exemple : du 1er janvier au 15 septembre, 8,5 mois, limite de
//          30 104 €, soit 42 500 × 8,5 / 12).
//   [209]  CGI art. 209, I, alinéa 3 (version en vigueur depuis le 31/12/2023, loi n° 2023-1322 du 29/12/2023, art. 110) :
//          le déficit se déduit du bénéfice suivant « dans la limite d'un montant de 1 000 000 € majoré de 50 % du montant
//          correspondant au bénéfice imposable dudit exercice excédant ce premier montant » ; le reste se reporte, sans
//          limite de durée.
//   [220]  CGI art. 220 quinquies (version en vigueur depuis le 21/02/2026, loi n° 2026-103, art. 17 ; son I tel que
//          l'écrit l'art. 42 de la même loi, en vigueur le 01/01/2026) : sur option, le déficit est une charge du bénéfice
//          de l'exercice PRÉCÉDENT, dans la limite de sa fraction non distribuée, hors bénéfice exonéré ou payé par des
//          crédits d'impôt, et « dans la limite du montant le plus faible entre le bénéfice déclaré au titre de
//          l'exercice précédent et un montant de 1 000 000 € » ; « l'excédent d'impôt [...] fait naître [...] une créance
//          non imposable d'égal montant », utilisable sur l'IS des exercices clos dans les cinq ans, remboursée au terme.
//          L'option se prend dans le délai de la déclaration de l'exercice déficitaire (II).
//   [D10]  BOI-IS-DEF-20-10-20260812 : le déficit reporté en arrière est « réputé imputé en priorité sur le bénéfice soumis
//          au taux normal, puis sur le bénéfice soumis au taux réduit » ; exemple : 978 120 € au taux normal, un déficit de
//          1 000 000 € reporté, créance de 244 530 € + (1 000 000 − 978 120) × 15 % = 247 812 €.
//   [1668] CGI art. 1668 (version en vigueur depuis le 01/01/2020, décret n° 2019-559) : quatre acomptes aux 15 mars,
//          15 juin, 15 septembre et 15 décembre, tirés du dernier exercice clos ; aucun au titre du premier exercice ou de
//          la première période d'imposition (1) ; le solde au plus tard le 15 mai suivant un exercice clos le 31 décembre,
//          l'excédent restitué dans les trente jours (2) ; une société dont les acomptes couvrent déjà l'impôt peut
//          s'abstenir des suivants (4 bis : un choix du cabinet, que ce module ne fait pas).
//   [359]  CGI ann. III art. 359 (version en vigueur depuis le 01/01/2007) : chaque acompte est le quart de l'impôt liquidé
//          aux taux de l'article 219 sur les résultats du plus récent exercice clos dont le délai de déclaration est
//          expiré, ramenés à douze mois ; l'acompte échu entre la clôture et ce délai se régularise sur le suivant ;
//          dispense quand l'impôt de référence n'excède pas 3 000 €.
//   [D20]  BOI-IS-DECLA-20-10 (10/06/2020) : le premier acompte se calcule sur l'avant-dernier exercice et le deuxième
//          « est majoré ou réduit à due concurrence » ; la dispense s'apprécie à l'échéance de chaque acompte.
//   [N]    Notice 2033-NOT-SD 2026 (n° 50448#28, SHA-256 b0a43522…c7a6d1) : les tableaux fiscaux s'écrivent sans centimes ;
//          « les bases des impositions de toute nature sont arrondies à l'euro le plus proche. La fraction d'euro égale
//          0,50 est comptée pour 1. Cette règle [...] s'applique également au résultat de la liquidation » ; lignes 356
//          et 360 ; cadre 2033-D II (982, 983, 984, 860, 870).
//   [ZC]   CGI art. 235 ter ZC (texte en vigueur au 04/11/2026, lu par la page de sa section) : contribution sociale de
//          3,3 % de l'IS diminué d'un abattement de 763 000 € par période de douze mois. NON calculée ici : le module dit
//          seulement quand elle est nulle à coup sûr (l'IS sous l'abattement) et s'arrête sinon.
//
// Hors du module, et dit : les plus-values à long terme et les autres taux de l'article 219 (lignes 2033-C III, LIA-Q12),
// les crédits d'impôt (un montant SAISI, jamais calculé), la contribution sociale au-delà de l'abattement, les
// contributions exceptionnelles des grandes entreprises, l'intégration fiscale (art. 223 A), le dernier acompte modulé
// des entreprises de plus de 250 M€ de chiffre d'affaires, le report au jour ouvré d'une échéance (le calendrier, LIA8),
// les exercices qui ne se clôturent pas au 31 décembre (ligne 31, restante). Un BIC à l'impôt sur le revenu n'a pas d'IS :
// sa liasse porte 306 nul et son déficit va au revenu global (§ 6.5), ce module ne le sert pas.

// ─── Montants ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const UN_EURO = 100
const UN_MILLION_D_EUROS = 100_000_000
const POINTS_DE_BASE = 10_000

// Arrondi fiscal [N] : à l'euro le plus proche, la fraction de 0,50 comptée pour 1 — en valeur absolue, une perte
// s'arrondissant comme un bénéfice.
export function arrondiALEuro(centimes: number): number {
  const signe = centimes < 0 ? -1 : 1
  const r = Math.floor((Math.abs(centimes) + UN_EURO / 2) / UN_EURO) * UN_EURO
  return r === 0 ? 0 : signe * r
}

const enEurosEntiers = (c: number) => Number.isSafeInteger(c) && c % UN_EURO === 0

// Un taux en points de base (2 500 = 25 %) appliqué à une base en euros entiers : le produit tombe au centime.
const appliquer = (base: number, tauxPdb: number) => (base * tauxPdb) / POINTS_DE_BASE

// ─── Le barème de l'article 219 ────────────────────────────────────────────────────────────────────────────────────────

export interface BaremeIs {
  // En points de base : 2 500 = 25 %.
  tauxNormal: number
  tauxReduit: number
  // Le bénéfice au taux réduit, par période de douze mois, en centimes.
  plafondTauxReduit: number
  // Le chiffre d'affaires HT au-delà duquel le taux réduit tombe, par période de douze mois, en centimes.
  seuilChiffreDAffaires: number
  source: string
}

export const BAREME_ARTICLE_219: BaremeIs = {
  tauxNormal: 2_500,
  tauxReduit: 1_500,
  plafondTauxReduit: 4_250_000,
  seuilChiffreDAffaires: 1_000_000_000,
  source: 'CGI art. 219, I et I b, version en vigueur depuis le 21/02/2026 (lue le 12/11/2026) ; BOI-IS-LIQ-20-10-20230621',
}

// Les exercices dont le barème est CONFIRMÉ : ouverts à compter du 1er janvier 2022 (le taux normal de 25 %), clos à
// compter du 31 décembre 2022 (la limite de 42 500 €) et AVANT le 31 décembre 2026. Un exercice clos le 31 décembre 2026
// ou après relève d'une loi de finances pour 2027, en discussion le 12/11/2026, qui peut changer l'article 219 pour lui :
// son barème est celui d'aujourd'hui, À CONFIRMER, et le rendu le dit (LIA3-Q1).
export const PREMIERE_CLOTURE_A_CONFIRMER = '2026-12-31'

export type BaremeDeLExercice =
  | { etat: 'confirme'; bareme: BaremeIs }
  | { etat: 'a-confirmer'; bareme: BaremeIs; raison: string }
  | { etat: 'hors-periode'; raison: string }

export function baremeDeLExercice(debut: string, fin: string): BaremeDeLExercice {
  if (debut < '2022-01-01' || fin < '2022-12-31') {
    return { etat: 'hors-periode', raison: 'Un exercice ouvert avant 2022 ou clos avant le 31 décembre 2022 relève d’un autre barème, que l’application ne connaît pas.' }
  }
  if (fin >= PREMIERE_CLOTURE_A_CONFIRMER) {
    return {
      etat: 'a-confirmer', bareme: BAREME_ARTICLE_219,
      raison: 'Barème de l’article 219 en vigueur au 12/11/2026 : la loi de finances pour 2027, en discussion, peut le changer pour un exercice clos à compter du 31 décembre 2026.',
    }
  }
  return { etat: 'confirme', bareme: BAREME_ARTICLE_219 }
}

// ─── La durée d'un exercice, en trentièmes de mois [L20] ───────────────────────────────────────────────────────────────

const DATE_CIVILE = /^(\d{4})-(\d{2})-(\d{2})$/

function lireDate(date: string): [number, number, number] | null {
  const m = DATE_CIVILE.exec(date)
  if (!m) return null
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || j < 1 || j > joursDuMois(a, mo)) return null
  return [a, mo, j]
}

function joursDuMois(annee: number, mois: number): number {
  if (mois === 2) return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(mois) ? 30 : 31
}

// Le nombre de mois de l'exercice, en TRENTIÈMES de mois : chaque mois calendaire entier compte 30, un mois entamé compte
// ses jours [L20]. Du 1er janvier au 15 septembre : 8 × 30 + 15 = 255, soit 8,5 mois. `null` si les dates ne se lisent
// pas ou se suivent à l'envers.
export function trentiemesDeMois(debut: string, fin: string): number | null {
  const d = lireDate(debut)
  const f = lireDate(fin)
  if (!d || !f || debut > fin) return null
  let total = 0
  // Les mois calendaires parcourus, numérotés depuis l'an zéro.
  for (let rang = d[0] * 12 + d[1] - 1; rang <= f[0] * 12 + f[1] - 1; rang++) {
    const [a, m] = [Math.floor(rang / 12), (rang % 12) + 1]
    const dernier = joursDuMois(a, m)
    const premierJour = a === d[0] && m === d[1] ? d[2] : 1
    const dernierJour = a === f[0] && m === f[1] ? f[2] : dernier
    const jours = dernierJour - premierJour + 1
    total += jours === dernier ? 30 : jours
  }
  return total
}

const DOUZE_MOIS = 360

// La limite du bénéfice au taux réduit d'un exercice de cette durée, arrondie à l'euro [L20] : 42 500 € × mois / 12.
export function plafondDuTauxReduit(bareme: BaremeIs, trentiemes: number): number {
  return arrondiALEuro((bareme.plafondTauxReduit * trentiemes) / DOUZE_MOIS)
}

// ─── Le taux réduit : ses conditions [219], passées en paramètre ──────────────────────────────────────────────────────

// LIA-Q5, pas tranchée : la recommandation (A) exige le chiffre d'affaires ET l'attestation du capital ; (B) se contente
// du chiffre d'affaires. Le choix est un paramètre OBLIGATOIRE, sans défaut.
export type RegleDuTauxReduit = 'chiffre-d-affaires-et-attestation' | 'chiffre-d-affaires-seul'

export interface ConditionsDuTauxReduit {
  regle: RegleDuTauxReduit
  // HT, des recettes de l'activité normale et courante [L10], sur l'exercice tel qu'il est (le module le ramène à douze
  // mois), en centimes.
  chiffreDAffairesHt: number
  // Le capital entièrement libéré et détenu pour 75 % au moins par des personnes physiques, attesté par le cabinet pour
  // cet exercice.
  capitalAtteste: boolean
}

export type TauxReduit =
  | { applique: true; plafond: number }
  | { applique: false; raison: string }

function tauxReduitDeLExercice(bareme: BaremeIs, trentiemes: number, c: ConditionsDuTauxReduit): TauxReduit {
  // Le chiffre d'affaires ramené à douze mois, comparé sans division : CA × 360 ≤ seuil × trentièmes.
  if (c.chiffreDAffairesHt * DOUZE_MOIS > bareme.seuilChiffreDAffaires * trentiemes) {
    return { applique: false, raison: 'Le chiffre d’affaires, ramené à douze mois, dépasse 10 millions d’euros : taux normal sur tout le bénéfice.' }
  }
  if (c.regle === 'chiffre-d-affaires-et-attestation' && !c.capitalAtteste) {
    return { applique: false, raison: 'Le cabinet n’a pas attesté le capital entièrement libéré et détenu pour 75 % au moins par des personnes physiques : taux normal sur tout le bénéfice.' }
  }
  return { applique: true, plafond: plafondDuTauxReduit(bareme, trentiemes) }
}

// L'impôt brut sur un bénéfice imposable en euros entiers, avant l'arrondi de la liquidation : le taux réduit jusqu'à la
// limite, le taux normal au-delà.
function impotSurLeBenefice(bareme: BaremeIs, benefice: number, taux: TauxReduit): { auTauxReduit: number; impot: number } {
  const auTauxReduit = taux.applique ? Math.min(benefice, taux.plafond) : 0
  return {
    auTauxReduit,
    impot: appliquer(auTauxReduit, bareme.tauxReduit) + appliquer(benefice - auTauxReduit, bareme.tauxNormal),
  }
}

// ─── Le report en arrière [220], [D10] ─────────────────────────────────────────────────────────────────────────────────

export interface ExercicePrecedent {
  // Le bénéfice déclaré de l'exercice précédent (sa ligne 370), en centimes, euros entiers.
  beneficeDeclare: number
  // Le bénéfice d'imputation, déjà diminué de ce que la loi écarte (distribué, exonéré, payé par des crédits) [220] :
  // sa part imposée au taux normal et sa part au taux réduit, SAISIES depuis la liasse et les décisions de l'exercice.
  beneficeImputableAuTauxNormal: number
  beneficeImputableAuTauxReduit: number
  // Le barème de l'exercice précédent : la créance se compte à ses taux.
  bareme: BaremeIs
}

export type ReportEnArriere =
  | { option: 'non' }
  // Le montant que la société choisit de reporter (ligne 356), plafonné par le module.
  | { option: 'oui'; montantDemande: number; exercicePrecedent: ExercicePrecedent }

// ─── Le calcul ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MontantSaisi {
  // La ligne de la 2033-B (« 316 », « 324 », « 342 »…), pour le dire.
  ligne: string
  montant: number
}

export interface EntreesImpot {
  // L'exercice, en dates civiles ; clos le 31 décembre (les exercices décalés restent à la ligne 31).
  debut: string
  fin: string
  bareme: BaremeDeLExercice
  // Ligne 310 : bénéfice positif, perte négative ; en centimes, euros entiers (la liasse s'écrit sans centimes [N]).
  resultatComptable: number
  // Lignes 316 à 330 et 251 : SAISIES ou confirmées par le cabinet (LIA-Q4) ; l'IS lui-même en 324.
  reintegrations: MontantSaisi[]
  // Lignes 342 à 350 : de même.
  deductions: MontantSaisi[]
  // Ligne 982 : les déficits restant à reporter à l'ouverture (le 870 de la liasse précédente, ou la saisie unique de
  // LIA-Q6).
  deficitsAReporterALOuverture: number
  reportEnArriere: ReportEnArriere
  tauxReduit: ConditionsDuTauxReduit
  // Imputés sur l'IS, SAISIS : les créances de report en arrière que le cabinet choisit d'imputer, les crédits d'impôt
  // justifiés par leur déclaration. Jamais plus que l'IS.
  creancesImputees: number
  creditsDImpotImputes: number
  // Les acomptes versés pour l'exercice (lus au 444 du relevé), en centimes.
  acomptesVerses: number
}

export interface ImpotDeLExercice {
  // Les lignes de la 2033-B (B), en centimes, euros entiers.
  l312: number
  l314: number
  reintegrations: number
  deductions: number
  l352: number
  l354: number
  l356: number
  l360: number
  l370: number
  l372: number
  // Le cadre 2033-D II.
  l982: number
  l983: number
  l984: number
  l860: number
  l870: number
  trentiemes: number
  tauxReduit: TauxReduit
  beneficeAuTauxReduit: number
  beneficeAuTauxNormal: number
  // L'IS brut, liquidé et arrondi à l'euro [N].
  impotBrut: number
  creancesImputees: number
  creditsDImpotImputes: number
  impotNet: number
  // IS net moins les acomptes versés : positif à payer au solde, négatif à restituer [1668].
  solde: number
  echeanceDuSolde: string
  // La créance née du report en arrière de CET exercice [220], arrondie à l'euro, nulle sans option.
  creanceNee: number
  contributionSociale: { etat: 'nulle' } | { etat: 'non-calculee'; raison: string }
  // Ce que le rendu doit dire : un barème à confirmer, un taux réduit écarté.
  avertissements: string[]
}

export type CalculImpot = { refus: string[] } | { impot: ImpotDeLExercice }

const ABATTEMENT_CONTRIBUTION_SOCIALE = 76_300_000

// Le solde d'un exercice clos le 31 décembre : le 15 mai suivant [1668, 2].
export function echeanceDuSolde(fin: string): string | null {
  const f = lireDate(fin)
  if (!f || f[1] !== 12 || f[2] !== 31) return null
  return `${f[0] + 1}-05-15`
}

function refusDesEntrees(e: EntreesImpot): string[] {
  const refus: string[] = []
  const t = trentiemesDeMois(e.debut, e.fin)
  if (t === null) refus.push('Les dates de l’exercice ne se lisent pas, ou la clôture précède l’ouverture.')
  else if (t > 2 * DOUZE_MOIS) refus.push('Un exercice de plus de vingt-quatre mois ne se calcule pas.')
  if (echeanceDuSolde(e.fin) === null) refus.push('L’exercice ne se clôture pas au 31 décembre : les exercices décalés ne se calculent pas encore.')
  if (e.bareme.etat === 'hors-periode') refus.push(e.bareme.raison)
  // Le résultat comptable seul peut être négatif ; tout le reste est un montant positif.
  if (!enEurosEntiers(e.resultatComptable)) refus.push('Le résultat comptable s’écrit en euros entiers, sans centimes (notice 2033).')
  const euros: [string, number][] = [
    ['Les déficits à reporter à l’ouverture', e.deficitsAReporterALOuverture],
    ['Les créances imputées', e.creancesImputees],
    ['Les crédits d’impôt imputés', e.creditsDImpotImputes],
    ...e.reintegrations.map((r): [string, number] => [`La réintégration ${r.ligne}`, r.montant]),
    ...e.deductions.map((r): [string, number] => [`La déduction ${r.ligne}`, r.montant]),
  ]
  if (e.reportEnArriere.option === 'oui') {
    const p = e.reportEnArriere.exercicePrecedent
    euros.push(
      ['Le report en arrière demandé', e.reportEnArriere.montantDemande],
      ['Le bénéfice déclaré de l’exercice précédent', p.beneficeDeclare],
      ['Le bénéfice imputable au taux normal', p.beneficeImputableAuTauxNormal],
      ['Le bénéfice imputable au taux réduit', p.beneficeImputableAuTauxReduit],
    )
  }
  for (const [nom, montant] of euros) {
    if (!enEurosEntiers(montant)) refus.push(`${nom} s’écrit en euros entiers, sans centimes (notice 2033).`)
  }
  for (const [nom, montant] of euros) {
    if (montant < 0) refus.push(`${nom} ne peut pas être négatif.`)
  }
  // Le chiffre d'affaires vient des comptes 70, au centime ; il ne sert qu'à une comparaison.
  if (!Number.isSafeInteger(e.tauxReduit.chiffreDAffairesHt) || e.tauxReduit.chiffreDAffairesHt < 0) refus.push('Le chiffre d’affaires est un montant positif, en centimes.')
  if (!Number.isSafeInteger(e.acomptesVerses) || e.acomptesVerses < 0) refus.push('Les acomptes versés sont un montant positif, en centimes.')
  return refus
}

export function calculerImpotSurLesSocietes(e: EntreesImpot): CalculImpot {
  const refus = refusDesEntrees(e)
  if (refus.length > 0 || e.bareme.etat === 'hors-periode') return { refus }
  const bareme = e.bareme.bareme
  const trentiemes = trentiemesDeMois(e.debut, e.fin) as number
  const avertissements: string[] = []
  if (e.bareme.etat === 'a-confirmer') avertissements.push(e.bareme.raison)

  const reintegrations = e.reintegrations.reduce((s, r) => s + r.montant, 0)
  const deductions = e.deductions.reduce((s, r) => s + r.montant, 0)
  const resultatFiscal = e.resultatComptable + reintegrations - deductions
  const l352 = Math.max(0, resultatFiscal)
  const l354 = Math.max(0, -resultatFiscal)
  const l982 = e.deficitsAReporterALOuverture

  // Le déficit : le report en arrière d'abord, s'il est choisi, le reste en avant.
  let l356 = 0
  let creanceNee = 0
  if (e.reportEnArriere.option === 'oui') {
    if (l354 === 0) return { refus: ['Le report en arrière ne se choisit que sur un déficit de l’exercice (ligne 356).'] }
    const p = e.reportEnArriere.exercicePrecedent
    const imputable = p.beneficeImputableAuTauxNormal + p.beneficeImputableAuTauxReduit
    l356 = Math.min(e.reportEnArriere.montantDemande, l354, p.beneficeDeclare, UN_MILLION_D_EUROS, imputable)
    // Le taux normal d'abord, puis le taux réduit [D10].
    const surLeTauxNormal = Math.min(l356, p.beneficeImputableAuTauxNormal)
    creanceNee = arrondiALEuro(appliquer(surLeTauxNormal, p.bareme.tauxNormal) + appliquer(l356 - surLeTauxNormal, p.bareme.tauxReduit))
    if (l356 < e.reportEnArriere.montantDemande) {
      avertissements.push('Le report en arrière demandé dépasse ce que la loi permet : il est ramené au plus faible du déficit, du bénéfice déclaré de l’exercice précédent, de son bénéfice imputable et d’un million d’euros.')
    }
  }

  // Le bénéfice : les déficits antérieurs s'imputent jusqu'à un million, plus la moitié du bénéfice qui l'excède [209].
  // La moitié d'un nombre impair d'euros tombe à cinquante centimes : la limite s'arrondit à l'euro INFÉRIEUR, pour ne
  // jamais imputer plus que la loi.
  const limite = UN_MILLION_D_EUROS + Math.floor(Math.max(0, l352 - UN_MILLION_D_EUROS) / 2 / UN_EURO) * UN_EURO
  const l360 = Math.min(l982, l352, limite)
  const l370 = l352 - l360
  const l372 = l354 - l356

  const tauxReduit = tauxReduitDeLExercice(bareme, trentiemes, e.tauxReduit)
  if (!tauxReduit.applique && l370 > 0) avertissements.push(tauxReduit.raison)
  const { auTauxReduit, impot } = impotSurLeBenefice(bareme, l370, tauxReduit)
  const impotBrut = arrondiALEuro(impot)

  const imputations = e.creancesImputees + e.creditsDImpotImputes
  if (imputations > impotBrut) {
    return { refus: ['Les créances et les crédits imputés dépassent l’impôt de l’exercice : un crédit restituable ne s’impute pas ici.'] }
  }
  const impotNet = impotBrut - imputations

  const abattement = (ABATTEMENT_CONTRIBUTION_SOCIALE * trentiemes) / DOUZE_MOIS
  const contributionSociale: ImpotDeLExercice['contributionSociale'] = impotBrut <= abattement
    ? { etat: 'nulle' }
    : { etat: 'non-calculee', raison: 'L’impôt dépasse l’abattement de 763 000 € de la contribution sociale (CGI art. 235 ter ZC) : elle se calcule hors de l’application.' }

  const l984 = l982 - l360
  return {
    impot: {
      l312: Math.max(0, e.resultatComptable), l314: Math.max(0, -e.resultatComptable), reintegrations, deductions,
      l352, l354, l356, l360, l370, l372,
      l982, l983: l360, l984, l860: l372, l870: l984 + l372,
      trentiemes, tauxReduit, beneficeAuTauxReduit: auTauxReduit, beneficeAuTauxNormal: l370 - auTauxReduit,
      impotBrut, creancesImputees: e.creancesImputees, creditsDImpotImputes: e.creditsDImpotImputes, impotNet,
      solde: impotNet - e.acomptesVerses, echeanceDuSolde: echeanceDuSolde(e.fin) as string,
      creanceNee, contributionSociale, avertissements,
    },
  }
}

// ─── Les acomptes [1668], [359], [D20] ─────────────────────────────────────────────────────────────────────────────────

// L'exercice de référence d'un acompte, lu de sa liasse figée ; « à saisir » quand il est hors de l'application et que
// le cabinet n'a pas encore saisi son impôt de référence — jamais deviné.
export type ReferenceDesAcomptes =
  | { etat: 'aucun-exercice' }
  | { etat: 'a-saisir' }
  | {
    etat: 'connue'
    debut: string
    fin: string
    // Sa ligne 370, en centimes, euros entiers.
    beneficeImposable: number
    // Le taux réduit lui était-il acquis (ses conditions, telles que sa liasse les a figées) ?
    tauxReduitApplicable: boolean
  }

export type Acompte =
  | { numero: 1 | 2 | 3 | 4; date: string; etat: 'du'; montant: number }
  | { numero: 1 | 2 | 3 | 4; date: string; etat: 'aucun' | 'dispense' | 'non-calculable'; montant: 0; raison: string }

export interface AcomptesDeLExercice {
  acomptes: Acompte[]
  impotDeReferenceAvantDernier: number | null
  impotDeReferenceDernier: number | null
  // Ce que le premier acompte a versé au-delà de la moitié de l'impôt de référence du dernier exercice : le deuxième ne se
  // réduit pas sous zéro, l'excédent revient au solde [1668, 2].
  excedentDuPremierAcompte: number
}

export const SEUIL_DISPENSE_ACOMPTES = 300_000

// L'impôt de référence : liquidé aux taux de l'article 219 sur le bénéfice ramené à douze mois, arrondi à l'euro [359].
function impotDeReference(bareme: BaremeIs, r: Extract<ReferenceDesAcomptes, { etat: 'connue' }>): number | string {
  const t = trentiemesDeMois(r.debut, r.fin)
  if (t === null || t === 0) return 'Les dates de l’exercice de référence ne se lisent pas.'
  if (!enEurosEntiers(r.beneficeImposable) || r.beneficeImposable < 0) return 'Le bénéfice de référence est un montant positif, en euros entiers.'
  const ramene = arrondiALEuro((r.beneficeImposable * DOUZE_MOIS) / t)
  const taux: TauxReduit = r.tauxReduitApplicable ? { applique: true, plafond: bareme.plafondTauxReduit } : { applique: false, raison: '' }
  return arrondiALEuro(impotSurLeBenefice(bareme, ramene, taux).impot)
}

// Les quatre acomptes de l'année `annee` (exercice civil) : le premier sur l'avant-dernier exercice, le deuxième
// régularise sur le dernier, les deux suivants le quart du dernier. Le barème est celui de l'exercice en cours, dont les
// acomptes se paient (LIA3-Q2 : à confirmer). Les dates sont les dates légales, sans report au jour ouvré (LIA8).
export function acomptesDeLExercice(e: {
  annee: number
  premierExercice: boolean
  avantDernier: ReferenceDesAcomptes
  dernier: ReferenceDesAcomptes
  bareme: BaremeIs
}): { refus: string } | AcomptesDeLExercice {
  const dates = ['03-15', '06-15', '09-15', '12-15'].map((md) => `${e.annee}-${md}`)
  const numeros = [1, 2, 3, 4] as const
  const sans = (etat: 'aucun' | 'dispense' | 'non-calculable', raison: string, de: number[]): Acompte[] =>
    de.map((i) => ({ numero: numeros[i], date: dates[i], etat, montant: 0, raison }))

  if (e.premierExercice) {
    return {
      acomptes: sans('aucun', 'Premier exercice soumis à l’impôt sur les sociétés : aucun acompte (CGI art. 1668, 1).', [0, 1, 2, 3]),
      impotDeReferenceAvantDernier: null, impotDeReferenceDernier: null, excedentDuPremierAcompte: 0,
    }
  }
  if (e.dernier.etat === 'aucun-exercice') {
    return { refus: 'Hors du premier exercice, le dernier exercice clos existe : son impôt de référence se lit de sa liasse ou se saisit.' }
  }

  // Le premier acompte, sur l'avant-dernier exercice.
  let impotN2: number | null = null
  let premier: Acompte
  if (e.avantDernier.etat === 'aucun-exercice') {
    premier = sans('aucun', 'Aucun exercice clos dont la déclaration est échue au 15 mars.', [0])[0]
  } else if (e.avantDernier.etat === 'a-saisir') {
    premier = sans('non-calculable', 'L’impôt de l’avant-dernier exercice est à saisir.', [0])[0]
  } else {
    const i = impotDeReference(e.bareme, e.avantDernier)
    if (typeof i === 'string') return { refus: i }
    impotN2 = i
    premier = i <= SEUIL_DISPENSE_ACOMPTES
      ? sans('dispense', 'L’impôt de référence n’excède pas 3 000 € : dispense (CGI ann. III art. 359).', [0])[0]
      : { numero: 1, date: dates[0], etat: 'du', montant: i / 4 }
  }

  // Les trois suivants, sur le dernier exercice ; le deuxième régularise le premier, jamais sous zéro.
  if (e.dernier.etat === 'a-saisir') {
    return {
      acomptes: [premier, ...sans('non-calculable', 'L’impôt du dernier exercice est à saisir.', [1, 2, 3])],
      impotDeReferenceAvantDernier: impotN2, impotDeReferenceDernier: null, excedentDuPremierAcompte: 0,
    }
  }
  const impotN1 = impotDeReference(e.bareme, e.dernier)
  if (typeof impotN1 === 'string') return { refus: impotN1 }
  if (impotN1 <= SEUIL_DISPENSE_ACOMPTES) {
    return {
      acomptes: [premier, ...sans('dispense', 'L’impôt de référence n’excède pas 3 000 € : dispense (CGI ann. III art. 359).', [1, 2, 3])],
      impotDeReferenceAvantDernier: impotN2, impotDeReferenceDernier: impotN1,
      excedentDuPremierAcompte: Math.max(0, premier.montant - impotN1 / 2),
    }
  }
  const quart = impotN1 / 4
  if (premier.etat === 'non-calculable') {
    return {
      acomptes: [premier, sans('non-calculable', 'Le deuxième acompte régularise le premier, qui attend sa saisie.', [1])[0],
        { numero: 3, date: dates[2], etat: 'du', montant: quart }, { numero: 4, date: dates[3], etat: 'du', montant: quart }],
      impotDeReferenceAvantDernier: impotN2, impotDeReferenceDernier: impotN1, excedentDuPremierAcompte: 0,
    }
  }
  const deuxiemeAvantPlancher = 2 * quart - premier.montant
  return {
    acomptes: [
      premier,
      { numero: 2, date: dates[1], etat: 'du', montant: Math.max(0, deuxiemeAvantPlancher) },
      { numero: 3, date: dates[2], etat: 'du', montant: quart },
      { numero: 4, date: dates[3], etat: 'du', montant: quart },
    ],
    impotDeReferenceAvantDernier: impotN2, impotDeReferenceDernier: impotN1,
    excedentDuPremierAcompte: Math.max(0, -deuxiemeAvantPlancher),
  }
}
