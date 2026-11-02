// LE FORMULAIRE 2035 DE CHAQUE EXERCICE (étape 2035S6, relecture de la 2035 du 01/11/2026, point 3 ; 2035S-Q5, tranchée par
// le cabinet le 02/11/2026 : (B), CONTRE la recommandation (A) — imprimer sur le dernier millésime livré, avec un avertissement,
// plutôt que retenir le PDF).
//
// La DGFiP publie chaque année un millésime du formulaire : celui de 2026, « REVENUS 2025 » (cerfa 15945*08,
// impots.gouv.fr, /sites/default/files/formulaires/2035-sd/2026/2035-sd_5384.pdf), sert à déclarer l'exercice 2025 — la
// déclaration des revenus de N se dépose en N + 1, sur le millésime N + 1. L'application n'en servait qu'un, quel que soit
// l'exercice : les chiffres de 2026 s'imprimaient sous l'en-tête « REVENUS 2025 », sans rien dire, et ceux d'avant 2025 sur
// un formulaire qui n'était pas le leur (le cadre 8 y restait vide).
//
// UN MODÈLE PAR MILLÉSIME, ET SANS LE SIEN LE DERNIER, AVERTISSEMENT À L'APPUI. Un millésime nouveau se pose ici, son fichier à côté de l'autre
// dans public/formulaires/ — on AJOUTE un fichier, on n'écrase jamais celui avec lequel les déclarations passées ont été
// produites —, avec son test de gabarit (gabarit2035.test.ts : les cases ont pu bouger d'une édition à l'autre). Sans le sien, l'exercice
// se remplit sur le plus récent livré : les cases ont pu bouger, et l'en-tête dit une autre année, donc l'avertissement
// (`avertissementDuFormulaire`) se lit à l'écran avant le clic ET s'écrit sur le PDF (`mentionDuPdf`), pour qu'un papier qui
// circule le dise aussi. Ce module ne lit rien et ne charge rien : remplir2035.ts, qui charge pdf.js, le lit, et Clôture le
// juge avant le clic.

/** Les millésimes que l'application sert : le millésime → le modèle vierge, dans public/formulaires/. */
export const MODELES_2035: ReadonlyMap<number, string> = new Map([
  [2026, '/formulaires/2035-sd-2026.pdf'],
])

/** Le millésime qui déclare l'exercice : les revenus de N se déclarent sur le formulaire de N + 1. */
export function millesimeDeLExercice(annee: number): number {
  return annee + 1
}

export interface ModeleDuFormulaire {
  /** Le millésime du fichier qui sera rempli. */
  millesime: number
  chemin: string
  /** Le millésime que l'exercice demande (N + 1). */
  attendu: number
  /** Vrai quand `millesime` n'est pas `attendu` : ce modèle tient lieu du bon. */
  substitut: boolean
}

// LE MODÈLE QUI REMPLIT LA 2035 DE CET EXERCICE : le sien s'il est livré, sinon le plus récent (2035S-Q5, (B)) ; rien
// seulement si l'application n'en livre aucun. Le plus récent, et non le plus proche : c'est le plus proche de ce que la
// DGFiP publiera, et celui dont les cases ont le moins bougé.
export function modeleDuFormulaire(annee: number): ModeleDuFormulaire | null {
  const attendu = millesimeDeLExercice(annee)
  const chemin = MODELES_2035.get(attendu)
  if (chemin !== undefined) return { millesime: attendu, chemin, attendu, substitut: false }
  if (MODELES_2035.size === 0) return null
  const dernier = Math.max(...MODELES_2035.keys())
  return { millesime: dernier, chemin: MODELES_2035.get(dernier)!, attendu, substitut: true }
}

// POURQUOI LE MILLÉSIME MANQUE : plus récent que le dernier livré, il n'est sans doute pas encore publié ; sinon, il n'a pas
// été ajouté à l'application.
function pourquoiLeMillesimeManque(modele: ModeleDuFormulaire): string {
  return modele.attendu > modele.millesime ? 'n’est pas encore publié' : 'n’est pas dans l’application'
}

// CE QUE CLÔTURE DIT AVANT LE CLIC quand le modèle n'est pas le bon, ou rien quand il l'est. Le PDF s'imprime quand même.
export function avertissementDuFormulaire(annee: number): string | null {
  const modele = modeleDuFormulaire(annee)
  if (modele === null || !modele.substitut) return null
  return `Le formulaire 2035 des revenus ${annee} (millésime ${modele.attendu}) ${pourquoiLeMillesimeManque(modele)} : le PDF est `
    + `rempli sur le millésime ${modele.millesime}, sous l’en-tête « REVENUS ${modele.millesime - 1} ». Il ne se dépose pas tel quel : `
    + `les cases sont à reporter sur le formulaire du bon millésime ou sur le logiciel de dépôt.`
}

// CE QUI S'ÉCRIT EN TÊTE DE CHAQUE PAGE REMPLIE quand le modèle n'est pas le bon (lignes courtes, sans caractère hors de
// l'encodage WinAnsi des polices PDF standard), ou rien quand il l'est.
export function mentionDuPdf(annee: number): string[] {
  const modele = modeleDuFormulaire(annee)
  if (modele === null || !modele.substitut) return []
  return [
    `ATTENTION - exercice ${annee} rempli sur le formulaire millésime ${modele.millesime} (en-tête « REVENUS ${modele.millesime - 1} »).`,
    `Ne pas déposer tel quel : reporter les cases sur le formulaire du millésime ${modele.attendu} ou le logiciel de dépôt.`,
  ]
}
