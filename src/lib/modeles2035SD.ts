// LA DÉCLARATION PRINCIPALE N° 2035-SD DE CHAQUE EXERCICE (demande du cabinet du 17/11/2026 ;
// docs/conceptions/55-formulaire-2035-sd.md), sur le patron de lib/modeles2033.ts et de lib/modeles2035.ts (2035S-Q5 (B) :
// sans son millésime, le dernier livré, sous un avertissement).
//
// La 2035 se dépose en DEUX documents de la DGFiP. Le premier, que l'application remplit depuis l'étape 2035S6, est la liasse
// des annexes (2035-A, 2035-B, 2035-E, 2035-F, 2035-G ; cerfa 15945*08, public/formulaires/2035-sd-2026.pdf). Le second est
// la DÉCLARATION elle-même, n° 2035-SD (cerfa 11176*28, millésime 2026, « REVENUS 2025 » ; impots.gouv.fr,
// /sites/default/files/formulaires/2035-sd/2026/2035-sd_5382.pdf, quatre pages) : l'identification du déclarant, la
// récapitulation des éléments d'imposition, le personnel salarié, le tableau des immobilisations et des amortissements, celui
// des plus et moins-values, la répartition entre associés. Sa notice : 2035-NOT-SD (cerfa 50532#28, 2035-sd_5385.pdf).
//
// UN FICHIER PAR MILLÉSIME, jamais écrasé, servi par l'application depuis public/formulaires/ — jamais demandé à une autre
// adresse (aucun appel réseau externe). Son EMPREINTE est écrite ici, confrontée au fichier livré par modeles2035SD.test.ts,
// et vérifiée par remplir2035SD.ts avant tout remplissage. Ce module ne lit rien et ne charge rien.

/**
 * Le bouton « Déclaration 2035-SD » de l'onglet Clôture. Levé le 17/11/2026 sur la demande du cabinet (« oui ouvre-le
 * maintenant ») : le PDF ne porte que ce que l'application sait déjà — l'identité, la ligne 1 reportée de CP ou CR, le tableau
 * des immobilisations tiré du registre et CONFRONTÉ à la case CH —, le reste vide ou « à saisir ». Baissé, rien ne change à
 * l'écran d'avant.
 */
export const FORMULAIRE_2035_SD_OFFERT: boolean = true

export interface ModeleLivre2035SD {
  chemin: string
  /** SHA-256 du fichier tel que la DGFiP le publie, vérifié avant de l'ajouter au dépôt. */
  empreinte: string
}

/** Les millésimes que l'application sert : le millésime → le modèle vierge, dans public/formulaires/. */
export const MODELES_2035_SD: ReadonlyMap<number, ModeleLivre2035SD> = new Map([
  [2026, {
    chemin: '/formulaires/2035-sd-declaration-2026.pdf',
    empreinte: '2dc4ba76ff2066d21092c2fe89f87f70db5bfdfbfcd788f8482d3366871382f0',
  }],
])

/** Le millésime qui déclare l'exercice : les revenus de N se déclarent sur le formulaire de N + 1, comme les annexes. */
export function millesimeDeLExercice2035SD(annee: number): number {
  return annee + 1
}

export interface ModeleDuFormulaire2035SD {
  /** Le millésime du fichier qui sera rempli. */
  millesime: number
  chemin: string
  empreinte: string
  /** Le millésime que l'exercice demande (N + 1). */
  attendu: number
  /** Vrai quand `millesime` n'est pas `attendu` : ce modèle tient lieu du bon. */
  substitut: boolean
}

// Le sien s'il est livré, sinon le plus récent (le plus proche de ce que la DGFiP publiera) ; rien seulement si
// l'application n'en livre aucun.
export function modeleDuFormulaire2035SD(annee: number): ModeleDuFormulaire2035SD | null {
  const attendu = millesimeDeLExercice2035SD(annee)
  const sien = MODELES_2035_SD.get(attendu)
  if (sien !== undefined) return { millesime: attendu, ...sien, attendu, substitut: false }
  if (MODELES_2035_SD.size === 0) return null
  const dernier = Math.max(...MODELES_2035_SD.keys())
  return { millesime: dernier, ...MODELES_2035_SD.get(dernier)!, attendu, substitut: true }
}

function pourquoiLeMillesimeManque(modele: ModeleDuFormulaire2035SD): string {
  return modele.attendu > modele.millesime ? 'n’est pas encore publié' : 'n’est pas dans l’application'
}

// Ce que Clôture dit avant le clic quand le modèle n'est pas le bon, ou rien quand il l'est. Le PDF se remplit quand même.
export function avertissementDuFormulaire2035SD(annee: number): string | null {
  const modele = modeleDuFormulaire2035SD(annee)
  if (modele === null || !modele.substitut) return null
  return `La déclaration 2035-SD des revenus ${annee} (millésime ${modele.attendu}) ${pourquoiLeMillesimeManque(modele)} : le PDF `
    + `est rempli sur le millésime ${modele.millesime}, sous l’en-tête « REVENUS ${modele.millesime - 1} ». Il ne se dépose pas tel `
    + `quel : les cases sont à reporter sur le formulaire du bon millésime ou sur le logiciel de dépôt.`
}

// Ce qui s'écrit en tête de chaque page remplie quand le modèle n'est pas le bon (sans caractère hors de WinAnsi).
export function mentionDuPdf2035SD(annee: number): string[] {
  const modele = modeleDuFormulaire2035SD(annee)
  if (modele === null || !modele.substitut) return []
  return [
    `ATTENTION - exercice ${annee} rempli sur la déclaration 2035-SD millésime ${modele.millesime} (en-tête « REVENUS ${modele.millesime - 1} »).`,
    `Ne pas déposer tel quel : reporter les cases sur le formulaire du millésime ${modele.attendu} ou le logiciel de dépôt.`,
  ]
}
