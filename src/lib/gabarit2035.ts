import { CASES_2035 } from './cases2035'

// Géométrie du remplissage de la 2035 : où écrire quoi sur le formulaire officiel, à partir de ce
// qu'on lit dans le PDF lui-même.
//
// Ce module ne touche ni à pdf.js ni à pdf-lib — il reçoit des fragments de texte et des filets déjà
// extraits, et rend un plan d'inscriptions. C'est le même partage que pdfText.ts / relevePdf.ts :
// les bibliothèques PDF touchent au DOM dès l'import, donc tout ce qui doit être testé vit ici.
//
// **Rien n'est codé en dur.** Le PDF fourni par la DGFiP n'a aucun champ de formulaire (zéro
// /AcroForm, zéro /Widget : vérifié), il faut donc écrire à des coordonnées. Les coder en dur voudrait
// dire tout reprendre à chaque millésime. On les déduit du formulaire :
//   - chaque case porte son code imprimé (AA, BH, CP…) dans la couche texte, ce qui donne la ligne ;
//   - les cellules sont tracées au filet. Le PREMIER filet vertical à droite du code ferme la
//     cellule du code lui-même, le DEUXIÈME ferme la case où va le montant.
// Cette règle vaut aussi bien pour les cases du bord droit que pour les cases « dont » en colonne
// intérieure (BW, BT, BY…), qui ont leur propre cellule plus étroite.

export interface FragmentTexte {
  texte: string
  x: number
  y: number
  largeur: number
  hauteur: number
}

export interface FiletVertical {
  x: number
  y0: number
  y1: number
}

export interface PageFormulaire {
  fragments: FragmentTexte[]
  filets: FiletVertical[]
}

export interface Ancrage {
  code: string
  // 1-indexé, comme les pages d'un PDF et comme on en parle.
  page: number
  // Bord droit de la case. Le montant s'y aligne à droite, comme sur un formulaire fiscal.
  xDroite: number
  // Ligne de base du code imprimé : le montant se pose dessus, donc il est centré dans sa case sans
  // qu'on ait à calculer quoi que ce soit.
  y: number
}

// Retrait entre le bord droit de la case et le dernier chiffre. Sans lui le montant colle au filet
// (constaté au rendu) : lisible à l'écran, limite à l'impression.
const RETRAIT_DROITE = 4

const CODES_CONNUS = new Set(CASES_2035.map((c) => c.code))

// Un code de case tel qu'imprimé : exactement deux majuscules. Le formulaire contient beaucoup
// d'autres fragments de deux lettres (« Si », « N° »…) ; ne retenir que les codes du tableau évite de
// prendre un mot pour une case.
function estCodeDeCase(texte: string): boolean {
  return CODES_CONNUS.has(texte.trim())
}

export function ancragesDesCases(pages: PageFormulaire[]): Map<string, Ancrage> {
  const ancrages = new Map<string, Ancrage>()

  pages.forEach((page, index) => {
    for (const fragment of page.fragments) {
      const code = fragment.texte.trim()
      if (!estCodeDeCase(code)) continue

      // Milieu de la hauteur du code : c'est ce qui décide quels filets appartiennent à sa ligne.
      // Prendre la ligne de base ferait rater un filet qui s'arrête pile dessus.
      const centre = fragment.y + fragment.hauteur / 2
      const aDroite = page.filets
        .filter((f) => f.x > fragment.x + fragment.largeur + 1 && f.y0 < centre && f.y1 > centre)
        .sort((a, b) => a.x - b.x)

      // Le premier ferme la cellule du code, le deuxième la case du montant. Sans les deux, on ne
      // sait pas où écrire : mieux vaut aucune ancre qu'une ancre inventée.
      if (aDroite.length < 2) continue
      if (!ancrages.has(code)) {
        ancrages.set(code, { code, page: index + 1, xDroite: aDroite[1].x, y: fragment.y })
      }
    }
  })

  return ancrages
}

// Montant tel qu'il s'écrit sur le formulaire : entier (« ne pas porter les centimes »), séparateur
// de milliers par espace ORDINAIRE.
//
// Le piège vient d'Intl : `new Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine
// insécable (U+202F). Les polices standard d'un PDF sont encodées en WinAnsi, qui ne sait pas
// représenter ce caractère — la génération plante sur le premier montant à quatre chiffres, donc sur
// à peu près toute déclaration réelle. Découvert en générant, pas en relisant le code.
export function formaterMontant(montant: number): string {
  const entier = Math.round(montant)
  const signe = entier < 0 ? '-' : ''
  const chiffres = String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return signe + chiffres
}

// Les polices standard d'un PDF sont encodées en WinAnsi (CP1252) : un caractère hors de ce jeu fait
// planter l'écriture, pas seulement mal s'afficher. Les montants ne sont que des chiffres, mais un
// nom de dossier est du texte libre — un client nommé « Bǎlan » ou « Kowalczyk-Łódź » suffirait à
// casser la génération pour ce dossier-là. On translittère au lieu de laisser tomber : l'accent perdu
// se corrige à la relecture, la déclaration non produite bloque.
export function texteCompatiblePdf(texte: string): string {
  return [...texte]
    .map((c) => {
      if (c.charCodeAt(0) < 128) return c
      // Une lettre accentuée hors CP1252 se ramène à sa lettre de base ; ce qui n'a pas de base
      // latine (idéogramme, emoji) disparaît plutôt que de faire échouer tout le formulaire.
      if (CP1252_SUPPLEMENTAIRES.has(c) || /^[ -ÿ]$/.test(c)) return c
      const barree = LETTRES_BARREES.get(c)
      if (barree) return barree
      const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '')
      return /^[\x20-\x7e]+$/.test(base) ? base : ''
    })
    .join('')
}

// Lettres dont le trait fait partie du glyphe plutôt que d'être un accent combinant : Unicode ne les
// décompose pas, donc `normalize('NFD')` ne les ramène pas à leur lettre de base et elles seraient
// purement et simplement perdues. Le cas se voit dans un nom polonais (Łódź) ou croate (Đurić).
const LETTRES_BARREES = new Map([
  ['Ł', 'L'], ['ł', 'l'], ['Đ', 'D'], ['đ', 'd'], ['Ħ', 'H'], ['ħ', 'h'], ['Ŧ', 'T'], ['ŧ', 't'],
])

// Les caractères que CP1252 ajoute à Latin-1 dans la plage 0x80-0x9F — apostrophe typographique et
// tiret cadratin en tête, qu'on croise vraiment dans un nom de cabinet.
const CP1252_SUPPLEMENTAIRES = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž',
  '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ',
])

// Une grille de saisie du formulaire : la suite de cases d'un caractère, tracées au filet, où se
// porte un numéro chiffre par chiffre. Rendue par ses centres, prêts à recevoir un caractère centré.
//
// Repérée par la régularité de l'espacement : une grille de saisie, contrairement au reste du
// tableau, avance d'un pas constant. L'écart toléré est RELATIF et non absolu — sur le formulaire
// réel, une cellule de la grille SIRET est large d'un point de plus que ses voisines, ce qui suffit
// à casser un critère absolu et à ne trouver que la moitié de la grille.
//
// Rend null si le compte de cellules trouvé n'est pas celui attendu : mieux vaut laisser la grille
// vide que d'y écrire des chiffres décalés d'une case.
export function grilleDeSaisie(
  page: PageFormulaire,
  libelle: string,
  nbCellules: number,
  ecartRelatifTolere = 0.18,
): number[] | null {
  const label = page.fragments.find((f) => f.texte.trim() === libelle)
  if (!label) return null

  const centre = label.y + label.hauteur / 2
  const filets = [...new Set(
    page.filets
      .filter((f) => f.y0 < centre && f.y1 > centre && f.x > label.x + label.largeur)
      .map((f) => Math.round(f.x * 10) / 10),
  )].sort((a, b) => a - b)

  // Plus longue suite de filets régulièrement espacés.
  let grille: number[] = []
  for (let i = 0; i < filets.length - 1; i++) {
    const pas = filets[i + 1] - filets[i]
    const suite = [filets[i], filets[i + 1]]
    for (let j = i + 1; j < filets.length - 1; j++) {
      if (Math.abs(filets[j + 1] - filets[j] - pas) / pas > ecartRelatifTolere) break
      suite.push(filets[j + 1])
    }
    if (suite.length > grille.length) grille = suite
  }

  if (grille.length !== nbCellules + 1) return null
  return grille.slice(0, -1).map((x, i) => (x + grille[i + 1]) / 2)
}

export interface Inscription {
  page: number
  texte: string
  // Coordonnée d'ancrage. `alignement` dit si c'est le bord gauche ou le bord droit du texte.
  x: number
  y: number
  alignement: 'gauche' | 'droite' | 'centre'
  taille: number
}

export interface EnteteDeclaration {
  nom: string | null
  activite: string | null
  // Quatorze chiffres, un par case. Tout autre contenu est ignoré plutôt que tassé de travers dans
  // une grille qui n'a pas la bonne longueur.
  siret: string | null
}

export const TAILLE_MONTANT = 9
export const TAILLE_ENTETE = 9

// Libellés d'en-tête à renseigner, repérés par le texte imprimé qui les précède. La valeur va juste
// à droite de ce libellé — ces zones-là sont larges et libres, contrairement aux cases chiffrées.
const CHAMPS_ENTETE: { cle: keyof EnteteDeclaration; libelle: string }[] = [
  { cle: 'nom', libelle: 'NOM ET PRENOMS OU DÉNOMINATION' },
  { cle: 'activite', libelle: "Nature de l'activité (1)" },
]

// Le SIRET compte exactement quatorze chiffres. Les espaces de présentation sont retirés ; tout
// autre caractère fait renoncer, parce qu'une grille de quatorze cases ne pardonne pas un décalage.
export const LONGUEUR_SIRET = 14

export function chiffresDuSiret(siret: string | null): string[] | null {
  const chiffres = (siret ?? '').replace(/\s/g, '')
  if (!/^\d{14}$/.test(chiffres)) return null
  return [...chiffres]
}

// Ce qu'il faut écrire, et où. Une case à zéro n'est pas inscrite : sur un formulaire fiscal une case
// vide vaut zéro, et imprimer « 0 » dans les cinquante cases inutilisées noierait les montants réels.
//
// Un code sans ancre est ignoré plutôt que dessiné au jugé, et remonté par `codesSansAncrage` pour
// que l'appelant puisse le dire — un montant écrit au mauvais endroit sur une déclaration est pire
// qu'un montant manquant, qui se voit.
export function planDeRemplissage(
  ancrages: Map<string, Ancrage>,
  valeurs: Map<string, number>,
  entete: EnteteDeclaration,
  pages: PageFormulaire[],
): { inscriptions: Inscription[]; codesSansAncrage: string[] } {
  const inscriptions: Inscription[] = []
  const codesSansAncrage: string[] = []

  for (const c of CASES_2035) {
    const montant = valeurs.get(c.code) ?? 0
    if (montant === 0) continue
    const ancrage = ancrages.get(c.code)
    if (!ancrage) {
      codesSansAncrage.push(c.code)
      continue
    }
    inscriptions.push({
      page: ancrage.page,
      texte: formaterMontant(montant),
      x: ancrage.xDroite - RETRAIT_DROITE,
      y: ancrage.y,
      alignement: 'droite',
      taille: TAILLE_MONTANT,
    })
  }

  // Le SIRET s'écrit chiffre par chiffre dans une grille de quatorze cases. Elle n'est remplie que
  // si le formulaire la livre entière : une grille trouvée à treize ou quinze cases décalerait tout
  // le numéro d'un cran, ce qui est pire qu'un numéro absent.
  const chiffres = chiffresDuSiret(entete.siret)
  if (chiffres) {
    for (const [index, page] of pages.entries()) {
      const label = page.fragments.find((f) => f.texte.trim() === 'N° SIRET')
      const cellules = grilleDeSaisie(page, 'N° SIRET', LONGUEUR_SIRET)
      if (!label || !cellules) continue
      cellules.forEach((x, i) => {
        inscriptions.push({
          page: index + 1,
          texte: chiffres[i],
          x,
          y: label.y,
          alignement: 'centre',
          taille: TAILLE_ENTETE,
        })
      })
    }
  }

  for (const champ of CHAMPS_ENTETE) {
    const valeur = texteCompatiblePdf(entete[champ.cle]?.trim() ?? '')
    if (!valeur) continue
    for (const [index, page] of pages.entries()) {
      const fragment = page.fragments.find((f) => f.texte.trim() === champ.libelle)
      if (!fragment) continue
      inscriptions.push({
        page: index + 1,
        texte: valeur,
        x: fragment.x + fragment.largeur + 8,
        y: fragment.y,
        alignement: 'gauche',
        taille: TAILLE_ENTETE,
      })
      break
    }
  }

  return { inscriptions, codesSansAncrage }
}
