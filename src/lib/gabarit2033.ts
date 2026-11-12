import { CASES_DES_TOTAUX, RUBRIQUES_ACTIF, RUBRIQUES_PASSIF, type BilanEtabli } from './bilan'
import {
  CASES_ALIMENTEES_2033B, CASES_DONT_2033B, compteDeResultatALEuro, FORMULES_2033B, type CompteDeResultatEtabli,
} from './compteDeResultat2033'
import {
  ancragesDesCodes, formaterMontant, texteCompatiblePdf, TAILLE_ENTETE, TAILLE_MONTANT,
  type Ancrage, type Inscription, type PageFormulaire,
} from './gabarit2035'
import {
  bilan2033AALEuro, CASES_SAISIES_2033E, FORMULES_2033C, FORMULES_2033D, FORMULES_2033E, LIGNES_2033C, LIGNES_2033D,
  tableau2033CALEuro, tableau2033DALEuro, tableau2033EALEuro, type Tableau2033C, type Tableau2033D, type Tableau2033E,
} from './liasse2033'

// LA GÉOMÉTRIE DU REMPLISSAGE DE LA LIASSE 2033 — ligne 37, lot LIA6 (docs/conceptions/37-liasse-2033.md, § 3.3), sur le
// patron de lib/gabarit2035.ts, dont il reprend la règle et les outils : rien n'est codé en dur, tout se lit sur le PDF.
//
// Le formulaire 2033-SD 2026 (cerfa 15948*08) n'a, lui non plus, aucun champ de formulaire (zéro annotation sur ses sept
// pages : relevé le 12/11/2026) ; chaque case porte son code de trois chiffres dans la couche texte, et sa cellule est
// tracée au filet. La règle de la 2035 y vaut telle quelle : le PREMIER filet vertical à droite du code ferme la cellule
// du code, le DEUXIÈME ferme la case du montant — pour les cases du bord droit, pour les « dont » de la colonne intérieure
// (209, 215, 217, 243…) et pour les colonnes des tableaux à quatre colonnes (2033-C, 2033-D).
//
// UN JEU DE CODES PAR PAGE : les tableaux réemploient des codes — 310 est le résultat au 2033-B et les loyers déductibles
// au 2033-E, 154 les provisions au 2033-A et une case du 2033-D III, 016 une immobilisation au 2033-A et une case CVAE
// au 2033-E. Chaque page se lit donc seule, avec les codes de SON tableau, comme la 2035-E. Une page porte aussi un code
// qui n'est pas une case : « art. 217 octies » au 2033-B ; l'ancre retenue est la première rencontrée, la case, que le
// test du gabarit vérifie.
//
// LE CADRE C DU 2033-D (les provisions non déductibles) n'a pas de codes : sept lignes numérotées de 1 à 7, la première
// au libellé imprimé (« Indemnités pour congés à payer… »), les six autres libres, un montant sous la colonne du total
// 780. Une ligne s'y repère par son numéro imprimé, au-dessus de 780 et à droite du cadre B ; son montant s'aligne sur le bord droit de la case 780. Sept numéros trouvés en ordre, ou aucun : un montant
// écrit sur la mauvaise ligne serait pire qu'un montant manquant, qui se dit.

export type Tableau2033 = '2033-A' | '2033-B' | '2033-C' | '2033-D' | '2033-E'

export const TABLEAUX_2033: readonly Tableau2033[] = ['2033-A', '2033-B', '2033-C', '2033-D', '2033-E']

/** La page de chaque tableau sur le formulaire 2033-SD 2026 [F] (le 2033-F et le 2033-G, pages 6 et 7, ne se remplissent pas : LIA-Q10). */
export const PAGE_DU_TABLEAU: Readonly<Record<Tableau2033, number>> = {
  '2033-A': 1, '2033-B': 2, '2033-C': 3, '2033-D': 4, '2033-E': 5,
}

/** Les lignes du cadre C du 2033-D : des pseudo-codes, que le formulaire n'imprime pas. */
export const LIGNES_DU_CADRE_C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const

const codesDes = (formules: readonly (readonly [string, readonly (readonly [number, string])[]])[]) =>
  formules.flatMap(([code, termes]) => [code, ...termes.map(([, t]) => t)])

/** Les codes que l'application sait remplir, tableau par tableau : ceux des modules de LIA1 et de lib/bilan.ts, rien d'autre. */
export const CODES_REMPLIS_2033: Readonly<Record<Tableau2033, ReadonlySet<string>>> = {
  '2033-A': new Set([
    ...RUBRIQUES_ACTIF.flatMap((r) => (r.cases ? [r.cases.brut, r.cases.amortissements] : [])),
    ...RUBRIQUES_PASSIF.flatMap((r) => (r.case ? [r.case] : [])),
    ...Object.values(CASES_DES_TOTAUX).flatMap((v) => (typeof v === 'string' ? [v] : [v.brut, v.amortissements])),
  ]),
  '2033-B': new Set([
    ...CASES_ALIMENTEES_2033B.map((c) => c.code), ...CASES_DONT_2033B.map((c) => c.code),
    ...FORMULES_2033B.map(([code]) => code), '312', '314',
  ]),
  '2033-C': new Set([
    ...LIGNES_2033C.flatMap((l) => [l.immobilisations, ...(l.amortissements ? [l.amortissements] : [])])
      .flatMap((c) => [c.debut, c.augmentations, c.diminutions, c.fin]),
    ...codesDes(FORMULES_2033C),
  ]),
  '2033-D': new Set([
    ...LIGNES_2033D.flatMap((l) => [l.codes.debut, l.codes.augmentations, l.codes.diminutions, l.codes.fin]),
    ...codesDes(FORMULES_2033D),
  ]),
  '2033-E': new Set([...codesDes(FORMULES_2033E), ...CASES_SAISIES_2033E]),
}

const RETRAIT_DROITE = 4
const TAILLE_LIBELLE = 7
// La largeur moyenne d'un caractère d'Helvetica, rapportée à sa taille : de quoi couper un libellé avant la case du
// montant sans charger la police ici (pdf-lib ne se charge qu'au remplissage).
const CHASSE_MOYENNE = 0.52

export interface EnteteDeLaLiasse {
  /** La dénomination de l'entreprise, écrite à droite de « Désignation de l'entreprise » sur chaque page remplie. */
  designation: string | null
}

export interface Liasse2033ARemplir {
  /**
   * Les cases de chaque tableau, en EUROS entiers, telles que les fonctions « à l'euro » de LIA1 les rendent (l'arrondi n'est
   * pas refait ici). `null` : une case « à saisir », laissée vide et dite en tête de sa page, jamais écrite 0. Un tableau
   * absent ne se remplit pas.
   */
  tableaux: Partial<Record<Tableau2033, ReadonlyMap<string, number | null>>>
  /** Les libellés des lignes du cadre C du 2033-D, dans l'ordre (`Tableau2033D.nonDeductibles`), imprimés aux lignes 2 à 7, six au plus. */
  libellesDuCadreC: readonly string[]
  entete: EnteteDeLaLiasse
}

export interface PlanDeRemplissage2033 {
  inscriptions: Inscription[]
  /** « 2033-B 310 » : un montant non nul dont la case n'a pas été trouvée. Vide en temps normal ; jamais silencieux. */
  codesSansAncrage: string[]
  /** Les cases à saisir, tableau par tableau, dans l'ordre des codes. */
  aSaisir: Map<Tableau2033, string[]>
}

/** Les ancres des codes d'un tableau, lues sur SA page seule. */
export function ancragesDuTableau(page: PageFormulaire, tableau: Tableau2033): Map<string, Ancrage> {
  const numero = PAGE_DU_TABLEAU[tableau]
  const codes = CODES_REMPLIS_2033[tableau]
  const ancrages = ancragesDesCodes([page], codes)
  // Un code imprimé dans le même fragment que son libellé (« TOTAL 490 » au 2033-C) : sa place se déduit de la fin du
  // fragment, à proportion de ses caractères ; la règle des deux filets s'y applique ensuite comme ailleurs.
  const accoles = page.fragments.flatMap((f) => {
    const texte = f.texte.trim()
    const m = /\s(\d{3})$/.exec(texte)
    if (!m || !codes.has(m[1]) || ancrages.has(m[1])) return []
    const largeur = (f.largeur * m[1].length) / texte.length
    return [{ ...f, texte: m[1], x: f.x + f.largeur - largeur, largeur }]
  })
  if (accoles.length > 0) {
    for (const [code, a] of ancragesDesCodes([{ fragments: accoles, filets: page.filets }], codes)) ancrages.set(code, a)
  }
  for (const a of ancrages.values()) a.page = numero
  return ancrages
}

/** Les sept lignes du cadre C du 2033-D : leur numéro imprimé, ou null si elles ne se trouvent pas toutes, en ordre. */
export function lignesDuCadreC(page: PageFormulaire): { y: number; xLibelle: number; xDroite: number }[] | null {
  const ancres = ancragesDesCodes([page], new Set(['775', '780']))
  const a780 = ancres.get('780')
  const a775 = ancres.get('775')
  if (!a780 || !a775) return null
  const lignes: { y: number; xLibelle: number; xDroite: number }[] = []
  for (let k = 1; k <= 7; k++) {
    const candidats = page.fragments.filter((f) => f.texte.trim() === String(k)
      && f.x > a775.xDroite && f.x < a780.xDroite && f.y > a780.y && f.y < a780.y + 150)
    if (candidats.length !== 1) return null
    const f = candidats[0]
    lignes.push({ y: f.y, xLibelle: f.x + f.largeur + 6, xDroite: a780.xDroite })
  }
  for (let k = 1; k < 7; k++) if (lignes[k].y >= lignes[k - 1].y) return null
  return lignes
}

// La ligne de libellé tient entre son numéro et la case du montant (la largeur d'une case de montant de 780 laissée
// libre) ; au-delà, elle se coupe et finit par « … » remplacé par « ... » (WinAnsi le sait, mais la chasse est plus sûre).
function libelleCoupe(texte: string, largeurDisponible: number): string {
  const propre = texteCompatiblePdf(texte.trim())
  const max = Math.max(4, Math.floor(largeurDisponible / (TAILLE_LIBELLE * CHASSE_MOYENNE)))
  return propre.length <= max ? propre : `${propre.slice(0, max - 3)}...`
}

/**
 * Ce qu'il faut écrire, et où. Une case à zéro ne s'inscrit pas (une case vide vaut zéro) ; une case nulle est « à saisir »
 * et ne s'inscrit pas non plus ; un code qu'aucun module ne remplit, ou un montant qui n'est pas un euro entier, lève :
 * c'est une faute de l'appelant, jamais une case à écrire au jugé.
 */
export function planDeRemplissage2033(
  pages: ReadonlyMap<number, PageFormulaire>,
  liasse: Liasse2033ARemplir,
): PlanDeRemplissage2033 {
  const inscriptions: Inscription[] = []
  const codesSansAncrage: string[] = []
  const aSaisir = new Map<Tableau2033, string[]>()

  for (const tableau of TABLEAUX_2033) {
    const valeurs = liasse.tableaux[tableau]
    if (!valeurs) continue
    const numero = PAGE_DU_TABLEAU[tableau]
    const page = pages.get(numero) ?? { fragments: [], filets: [] }
    const ancrages = ancragesDuTableau(page, tableau)
    const cadreC = tableau === '2033-D' ? lignesDuCadreC(page) : null
    const manquantes: string[] = []
    for (const [code, montant] of [...valeurs].sort(([a], [b]) => a.localeCompare(b))) {
      const pseudo = (LIGNES_DU_CADRE_C as readonly string[]).indexOf(code)
      if (!CODES_REMPLIS_2033[tableau].has(code) && !(tableau === '2033-D' && pseudo >= 0)) {
        throw new Error(`${tableau} : la case ${code} n’est remplie par aucun module de la liasse.`)
      }
      if (montant === null) { manquantes.push(code); continue }
      if (!Number.isInteger(montant)) throw new Error(`${tableau} ${code} : ${montant} n’est pas un montant en euros entiers.`)
      if (montant === 0) continue
      if (pseudo >= 0) {
        const ligne = cadreC?.[pseudo]
        if (!ligne) { codesSansAncrage.push(`${tableau} cadre C ligne ${pseudo + 1}`); continue }
        inscriptions.push({ page: numero, texte: formaterMontant(montant), x: ligne.xDroite - RETRAIT_DROITE, y: ligne.y, alignement: 'droite', taille: TAILLE_MONTANT })
        // La première ligne a son libellé imprimé (les congés à payer) ; les provisions vont de la deuxième à la septième
        // (`tableau2033D`), et la septième porte aussi les suivantes (« joindre un état du même modèle », [F]) : elle le dit.
        const libelle = pseudo === 0 ? null : liasse.libellesDuCadreC[pseudo - 1]
        const texte = pseudo === 6 && liasse.libellesDuCadreC.length > 6 ? 'Autres provisions (état joint)' : libelle
        if (texte) {
          inscriptions.push({
            page: numero, texte: libelleCoupe(texte, ligne.xDroite - 85 - ligne.xLibelle), x: ligne.xLibelle, y: ligne.y,
            alignement: 'gauche', taille: TAILLE_LIBELLE,
          })
        }
        continue
      }
      const ancrage = ancrages.get(code)
      if (!ancrage) { codesSansAncrage.push(`${tableau} ${code}`); continue }
      inscriptions.push({
        page: numero, texte: formaterMontant(montant), x: ancrage.xDroite - RETRAIT_DROITE, y: ancrage.y,
        alignement: 'droite', taille: TAILLE_MONTANT,
      })
    }
    if (manquantes.length > 0) aSaisir.set(tableau, manquantes)

    const designation = texteCompatiblePdf(liasse.entete.designation?.trim() ?? '')
    const libelle = page.fragments.find((f) => f.texte.trim() === 'Désignation de l\'entreprise')
    if (designation && libelle) {
      inscriptions.push({
        page: numero, texte: designation, x: libelle.x + libelle.largeur + 8, y: libelle.y, alignement: 'gauche', taille: TAILLE_ENTETE,
      })
    }
  }
  return { inscriptions, codesSansAncrage, aSaisir }
}

/** Ce qui s'écrit en rouge en tête d'une page dont des cases restent à saisir, ou rien. */
export function mentionDesCasesASaisir(codes: readonly string[]): string[] {
  if (codes.length === 0) return []
  return [`A saisir par le cabinet, laissées vides : ${codes.join(', ')}.`]
}

export interface SortiesDeLia1 {
  bilan: BilanEtabli
  compteDeResultat: CompteDeResultatEtabli
  tableau2033C: Tableau2033C
  tableau2033D: Tableau2033D
  tableau2033E: Tableau2033E
}

/**
 * Les tableaux à remplir, tirés des sorties de LIA1 par leurs fonctions « à l'euro » : les « dont » du 2033-B, qu'aucun
 * compte ne dit, sont à saisir (nuls) ; un 2033-A que `bilan2033AALEuro` refuse n'est pas rempli, et son refus est rendu
 * pour être dit. Le cadre B du 2033-B (le résultat fiscal), le 2033-D II à IV et les effectifs et la CVAE du 2033-E
 * attendent les saisies de LIA4 : ils ne sont ni remplis ni dits « à saisir » d'ici là.
 */
export function liasseDepuisLia1(
  s: SortiesDeLia1,
  entete: EnteteDeLaLiasse,
): { liasse: Liasse2033ARemplir; refus2033A: string | null } {
  const b = new Map<string, number | null>(compteDeResultatALEuro(s.compteDeResultat))
  for (const dont of s.compteDeResultat.dontASaisir) b.set(dont.code, null)
  const a = bilan2033AALEuro(s.bilan)
  const tableaux: Liasse2033ARemplir['tableaux'] = {
    '2033-B': b,
    '2033-C': tableau2033CALEuro(s.tableau2033C),
    '2033-D': tableau2033DALEuro(s.tableau2033D),
    '2033-E': tableau2033EALEuro(s.tableau2033E),
  }
  if (a.etat === 'rempli') tableaux['2033-A'] = a.cases
  return {
    liasse: { tableaux, libellesDuCadreC: s.tableau2033D.nonDeductibles.map((n) => n.libelle), entete },
    refus2033A: a.etat === 'refuse' ? a.texte : null,
  }
}
