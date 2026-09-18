import { parseDateBancaire, parseMontantBancaire } from './csv'

// Lecture des opérations d'un relevé bancaire déjà converti en lignes (voir `extractPdfLignes`).
// Séparé de `pdfText.ts` parce que celui-ci charge pdf.js, qui touche au DOM dès l'import et rend
// tout le module impossible à exécuter en test — même découpage que `comptes.ts`, pour la même
// raison.

// `xFin` est l'abscisse du dernier fragment de la ligne, c'est-à-dire du montant. Le texte seul ne
// permet pas de distinguer un débit d'un crédit sur un relevé à deux colonnes : une fois les
// fragments recollés, les deux colonnes donnent la même chose. Leur position, elle, les sépare.
export interface LignePdf {
  texte: string
  xFin: number
}

export interface LigneExtraite {
  date: string
  libelle: string
  montant: number
  // Vrai quand la ligne décrit un SOLDE et non une opération. Renseigné uniquement en mode 'tous'
  // (voir `parseLignesFromPdf`), où l'aperçu d'import montre tout et laisse l'opérateur corriger :
  // sur les relevés où la banque n'écrit pas le mot « solde », c'est lui qui les désigne.
  estSolde?: boolean
}

// Deux mises en page, comme pour l'import CSV :
// - `signe` : une seule colonne, le débit porte un signe moins ;
// - `debit_credit` : deux colonnes, le signe se lit dans celle où le montant est imprimé.
export type FormatMontant = 'signe' | 'debit_credit'

// Écart horizontal minimal, en unités PDF (~1/72 de pouce), pour considérer que deux montants sont
// dans des colonnes différentes. Un centimètre : en deçà, c'est du désalignement, pas une colonne.
const ECART_COLONNES_MIN = 28

// Certaines banques (Caisse d'Épargne, vérifié sur un relevé réel) n'impriment que jour/mois sur
// chaque ligne d'opération, l'année n'apparaissant qu'une fois dans l'en-tête du relevé ("...de
// votre compte au 31/01/23..."). Sans cette période, une date jour/mois est inexploitable (aucune
// année à qui l'attribuer) — on ne cherche donc les dates à 2 segments qu'en complément d'une
// période trouvée, jamais en la devinant.
function trouvePeriode(texte: string): { mois: number; annee: number } | null {
  const m = texte.match(/\bau\s+(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/i)
  if (!m) return null
  const mois = +m[2]
  let annee = +m[3]
  if (annee < 100) annee += annee < 70 ? 2000 : 1900
  return { mois, annee }
}

// Sépare les montants en deux colonnes d'après le plus grand écart horizontal observé entre eux :
// à gauche le débit, à droite le crédit. Rendre null quand cet écart reste sous le seuil est
// délibéré — une seule colonne occupée ne dit pas *laquelle*, et deviner inverserait une ligne sur
// deux. L'appelant traite alors tout en débit, le cas de loin le plus fréquent, et la
// prévisualisation reste modifiable.
export function seuilDeuxColonnes(abscisses: number[]): number | null {
  const distinctes = [...new Set(abscisses)].sort((a, b) => a - b)
  let meilleurEcart = 0
  let seuil: number | null = null
  for (let i = 1; i < distinctes.length; i++) {
    const ecart = distinctes[i] - distinctes[i - 1]
    if (ecart > meilleurEcart) {
      meilleurEcart = ecart
      seuil = (distinctes[i] + distinctes[i - 1]) / 2
    }
  }
  return meilleurEcart >= ECART_COLONNES_MIN ? seuil : null
}

// Heuristique volontairement simple : une opération = une ligne avec une date en début et un
// montant en fin (format le plus courant sur les relevés PDF). Les lignes qui ne matchent pas
// (en-têtes, totaux, texte de libellé qui déborde sur une deuxième ligne) sont ignorées — mieux
// vaut manquer une ligne que d'en inventer une. Le tableau de prévisualisation reste modifiable
// pour corriger ou compléter à la main.
// `inclure` décide de ce que la fonction rend, avec la même lecture de date et de montant dans les
// trois cas :
//   - 'operations' (défaut) : tout sauf les lignes de solde, comme avant ;
//   - 'soldes'     : uniquement les lignes de solde, pour contrôler l'arithmétique du relevé ;
//   - 'tous'       : tout, chaque ligne portant `estSolde`. C'est ce que montre l'aperçu d'import,
//                    où l'opérateur coche lui-même les soldes que la banque n'a pas nommés.
export function parseLignesFromPdf(
  lignes: LignePdf[],
  format: FormatMontant = 'signe',
  inclure: 'operations' | 'soldes' | 'tous' = 'operations',
): LigneExtraite[] {
  // Date en tout début de ligne : c'est la date d'opération. Une même ligne réelle porte souvent
  // une seconde date (date de valeur, ou date d'achat rappelée dans le libellé — "CB FACTURE DU
  // 03/01/26"), qui n'est pas celle de l'opération.
  const dateDebutComplete = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/
  const dateDebutCourte = /^(\d{1,2})[/.](\d{1,2})\b/
  // Repli pour les mises en page qui font précéder la date d'autre chose (numéro de séquence, code
  // opération) : on prend alors la première date complète où qu'elle soit.
  const dateAilleurs = /(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/

  // Le montant est seulement *repéré* ici ; son interprétation revient à `parseMontantBancaire`,
  // seul juge du séparateur décimal (selon la banque, le point sépare les milliers ou les
  // décimales). Une expression régulière parallèle finit toujours par diverger de l'analyseur :
  // c'est le défaut qui, dans csv.ts, rendait 1,23 € pour "1.234,56".
  //
  // Deux formes acceptées faute de pouvoir supposer le séparateur de milliers : par groupes de
  // trois ("1 234,56", "1.234,56") ou d'une traite ("1234,56"). Sans la seconde, l'expression
  // s'accrochait aux trois derniers chiffres avant la virgule — "20846,47" devenait 846,47 et
  // "-1500,00" devenait +500,00, sans le moindre signal.
  //
  // Le `(?<![\d.,])` interdit de commencer au milieu d'un nombre : c'est précisément ce qui
  // permettait ces troncatures silencieuses. Il est de largeur nulle, donc `index` désigne bien le
  // premier caractère du montant, ce dont dépend le découpage du libellé.
  const montantRegex = /(?<![\d.,])(\(?[-+]?(?:\d{1,3}(?:[\s.,]\d{3})*|\d+)[.,]\d{2}\)?\s*-?)\s*(?:€|EUR)?\s*$/i

  const periode = trouvePeriode(lignes.map((l) => l.texte).join('\n'))

  const brutes: { ligne: LigneExtraite; xFin: number }[] = []
  for (const { texte, xFin } of lignes) {
    // pdf.js rend des fragments de texte, pas des lignes : recoller ces fragments laisse des
    // espaces doublés au milieu des nombres. "1  234,56" ne ressemblait plus à un montant groupé et
    // se faisait tronquer en 234,56.
    const line = texte.replace(/\s+/g, ' ').trim()
    // Lignes de solde (ouverture/synthèse/clôture) : portent souvent une date et un montant en fin
    // de ligne comme une vraie opération, mais n'en sont pas une — exclues explicitement plutôt que
    // de polluer le rapprochement avec un faux mouvement.
    if (!line) continue
    // Un relevé ne contient pas que des opérations : il porte aussi les soldes d'ouverture et de
    // clôture, qui ressemblent à une opération (une date, un montant en fin de ligne) sans en être
    // une. Elles sont écartées du flux normal — et récupérées à part pour contrôler le relevé.
    const estSolde = /SOLDE/i.test(line)
    if (inclure !== 'tous' && estSolde !== (inclure === 'soldes')) continue

    const montantMatch = line.match(montantRegex)
    if (!montantMatch || montantMatch.index === undefined) continue

    let date: string | null = null
    let finDate = 0

    const debutComplete = line.match(dateDebutComplete)
    const debutCourte = line.match(dateDebutCourte)
    if (debutComplete) {
      date = parseDateBancaire(debutComplete[0])
      finDate = debutComplete[0].length
    } else if (debutCourte && periode) {
      const jour = +debutCourte[1]
      const mois = +debutCourte[2]
      // Le relevé peut chevaucher la fin de l'année précédente (relevé de janvier commençant par
      // des opérations de décembre) — un mois postérieur à celui de la période appartient alors à
      // l'année d'avant, jamais à celle du relevé.
      const annee = mois > periode.mois ? periode.annee - 1 : periode.annee
      date = parseDateBancaire(`${jour}/${mois}/${annee}`)
      finDate = debutCourte[0].length
    } else {
      const ailleurs = line.match(dateAilleurs)
      if (ailleurs && ailleurs.index !== undefined) {
        date = parseDateBancaire(ailleurs[0])
        finDate = ailleurs.index + ailleurs[0].length
      }
    }
    if (!date) continue

    const montant = parseMontantBancaire(montantMatch[1])
    if (montant === null) continue

    const libelle = line.slice(finDate, montantMatch.index).trim()
    brutes.push({ ligne: { date, libelle: libelle || 'Mouvement bancaire', montant, ...(inclure === 'tous' ? { estSolde } : {}) }, xFin })
  }

  if (format === 'signe') return brutes.map((b) => b.ligne)

  // Deux colonnes : le signe imprimé, s'il y en a un, ne veut plus rien dire — c'est la colonne qui
  // porte l'information.
  const seuil = seuilDeuxColonnes(brutes.map((b) => b.xFin))
  return brutes.map(({ ligne, xFin }) => ({
    ...ligne,
    montant: seuil !== null && xFin > seuil ? Math.abs(ligne.montant) : -Math.abs(ligne.montant),
  }))
}

// Soldes d'ouverture et de clôture lus sur un relevé PDF, pour `controlerSolde`.
//
// **Ne reconnaît que les lignes qui écrivent le mot « solde ».** C'est une limite assumée, pas un
// oubli : sur le relevé réel du dossier de test, les deux lignes de solde portent le NUMÉRO DE
// COMPTE en guise de libellé et n'écrivent jamais ce mot. L'import CSV s'en sort grâce à un signal
// structurel — ces lignes ont moins de colonnes que les opérations (voir `lignesDeSolde`) — qui ne
// survit pas au recollage des fragments de pdf.js.
//
// Une heuristique textuelle a été essayée puis ÉCARTÉE sur preuve : « un libellé sans aucun mot d'au
// moins trois lettres ». Confrontée aux données réelles, elle attrapait 32 vrais encaissements CPAM
// (des références nues du type « 0000001366072490830101250325 », jusqu'à 14 812 €) pour 2 lignes de
// solde. Appliquée, elle aurait supprimé les recettes du dossier. Tant qu'aucun signal fiable n'est
// trouvé, mieux vaut un contrôle qui ne s'exécute pas qu'un import qui perd des recettes.
export function soldesDuPdf(lignes: LignePdf[], format: FormatMontant = 'signe'): { date: string; montant: number }[] {
  return parseLignesFromPdf(lignes, format, 'soldes').map(({ date, montant }) => ({ date, montant }))
}
