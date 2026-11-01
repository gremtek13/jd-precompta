// LE FORMULAIRE 2035 DE CHAQUE EXERCICE (étape 2035S6, relecture de la 2035 du 01/11/2026, point 3 ; 2035S-Q5, réponse (A),
// recommandée, écrite sans réponse du cabinet, qui a demandé de continuer et d'arbitrer plus tard).
//
// La DGFiP publie chaque année un millésime du formulaire : celui de 2026, « REVENUS 2025 » (cerfa 15945*08,
// impots.gouv.fr, /sites/default/files/formulaires/2035-sd/2026/2035-sd_5384.pdf), sert à déclarer l'exercice 2025 — la
// déclaration des revenus de N se dépose en N + 1, sur le millésime N + 1. L'application n'en servait qu'un, quel que soit
// l'exercice : les chiffres de 2026 s'imprimaient sous l'en-tête « REVENUS 2025 », sans rien dire, et ceux d'avant 2025 sur
// un formulaire qui n'était pas le leur (le cadre 8 y restait vide).
//
// UN MODÈLE PAR MILLÉSIME, ET LE PDF RETENU SANS LE SIEN. Un millésime nouveau se pose ici, son fichier à côté de l'autre
// dans public/formulaires/ — on AJOUTE un fichier, on n'écrase jamais celui avec lequel les déclarations passées ont été
// produites —, avec son test de gabarit (gabarit2035.test.ts : les cases ont pu bouger d'une édition à l'autre). Ce module ne
// lit rien et ne charge rien : remplir2035.ts, qui charge pdf.js, le lit, et Clôture le juge avant le clic.

/** Les millésimes que l'application sert : le millésime → le modèle vierge, dans public/formulaires/. */
export const MODELES_2035: ReadonlyMap<number, string> = new Map([
  [2026, '/formulaires/2035-sd-2026.pdf'],
])

/** Le millésime qui déclare l'exercice : les revenus de N se déclarent sur le formulaire de N + 1. */
export function millesimeDeLExercice(annee: number): number {
  return annee + 1
}

export interface ModeleDuFormulaire {
  millesime: number
  chemin: string
}

// LE MODÈLE QUI REMPLIT LA 2035 DE CET EXERCICE, ou rien. 2035S-Q5, réponse (A) : sans son millésime, rien — le PDF est
// retenu, et Clôture le dit (`formulaireAbsent`). La réponse (B) — imprimer sur le dernier millésime avec un avertissement —
// s'écrirait ici seulement : rendre le dernier modèle connu, marqué d'un autre millésime, et l'écran dirait l'avertissement.
export function modeleDuFormulaire(annee: number): ModeleDuFormulaire | null {
  const millesime = millesimeDeLExercice(annee)
  const chemin = MODELES_2035.get(millesime)
  return chemin === undefined ? null : { millesime, chemin }
}

// CE QUE CLÔTURE DIT QUAND LE MODÈLE MANQUE, ou rien quand il est là. Un millésime plus récent que le dernier servi n'est
// sans doute pas encore publié ; un plus ancien n'a pas été ajouté à l'application. Les cases restent à l'écran, à reporter
// sur le logiciel de dépôt.
export function formulaireAbsent(annee: number): string | null {
  if (modeleDuFormulaire(annee) !== null) return null
  const millesime = millesimeDeLExercice(annee)
  const dernier = Math.max(...MODELES_2035.keys())
  const pourquoi = millesime > dernier ? 'n’est pas encore publié' : 'n’est pas dans l’application'
  return `Le formulaire 2035 des revenus ${annee} (millésime ${millesime}) ${pourquoi} : le PDF n’est pas rempli, ses chiffres `
    + `s’imprimeraient sous l’en-tête d’une autre année. Les cases ci-dessous restent à reporter sur le logiciel de dépôt.`
}
