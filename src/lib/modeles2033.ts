// LE FORMULAIRE 2033-SD DE CHAQUE EXERCICE — ligne 37 de la feuille de route, lot LIA6 (docs/conceptions/37-liasse-2033.md,
// § 3.3), sur le patron de lib/modeles2035.ts (2035S-Q5 (B) : sans son millésime, le dernier livré, sous un avertissement).
//
// La DGFiP publie chaque année un millésime de la liasse du régime simplifié : celui de 2026 (tableaux 2033-A-SD à
// 2033-G-SD, cerfa 15948*08, impots.gouv.fr, /sites/default/files/formulaires/2033-sd/2026/2033-sd_5394.pdf, sept pages)
// porte les comptes de l'exercice clos en 2025 : l'exercice N (civil, la seule forme que l'application tient : les
// exercices décalés restent à la ligne 31) se dépose en N + 1, sur le millésime N + 1, comme la 2035.
//
// UN FICHIER PAR MILLÉSIME, jamais écrasé (on ajoute celui de l'année suivante à côté), servi par l'application depuis
// public/formulaires/ : jamais demandé à une autre adresse, ni au chargement ni au clic (aucun appel réseau externe). Son
// EMPREINTE est écrite ici et confrontée au fichier livré par modeles2033.test.ts : un PDF remplacé par erreur, ou par un
// autre que celui de la DGFiP, fait échouer la suite, et le gabarit (gabarit2033.test.ts) se relit millésime par millésime.
//
// Ce module ne lit rien et ne charge rien : remplir2033.ts, qui charge pdf.js, le lit. Aucun écran ne l'appelle encore.

/**
 * LIA6 : la liasse 2033 en PDF n'est offerte par AUCUN écran tant que ce drapeau est baissé. Il se lève avec l'onglet
 * « Liasse » (LIA7), qui attend la base de LIA4 et LIA5 ; d'ici là, rien ne le lit.
 */
export const LIASSE_EXPORTEE: boolean = false

export interface ModeleLivre2033 {
  chemin: string
  /** SHA-256 du fichier tel que la DGFiP le publie, vérifié avant de l'ajouter au dépôt. */
  empreinte: string
}

/** Les millésimes que l'application sert : le millésime → le modèle vierge, dans public/formulaires/. */
export const MODELES_2033: ReadonlyMap<number, ModeleLivre2033> = new Map([
  [2026, {
    chemin: '/formulaires/2033-sd-2026.pdf',
    empreinte: 'ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb',
  }],
])

/** Le millésime qui déclare l'exercice : les comptes de N se déposent sur le formulaire de N + 1. */
export function millesimeDeLExercice2033(annee: number): number {
  return annee + 1
}

export interface ModeleDuFormulaire2033 {
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
export function modeleDuFormulaire2033(annee: number): ModeleDuFormulaire2033 | null {
  const attendu = millesimeDeLExercice2033(annee)
  const sien = MODELES_2033.get(attendu)
  if (sien !== undefined) return { millesime: attendu, ...sien, attendu, substitut: false }
  if (MODELES_2033.size === 0) return null
  const dernier = Math.max(...MODELES_2033.keys())
  return { millesime: dernier, ...MODELES_2033.get(dernier)!, attendu, substitut: true }
}

function pourquoiLeMillesimeManque(modele: ModeleDuFormulaire2033): string {
  return modele.attendu > modele.millesime ? 'n’est pas encore publié' : 'n’est pas dans l’application'
}

// Ce que l'écran dira avant le clic (LIA7) quand le modèle n'est pas le bon, ou rien quand il l'est. Le PDF se remplit
// quand même.
export function avertissementDuFormulaire2033(annee: number): string | null {
  const modele = modeleDuFormulaire2033(annee)
  if (modele === null || !modele.substitut) return null
  return `La liasse 2033 de l’exercice ${annee} (millésime ${modele.attendu}) ${pourquoiLeMillesimeManque(modele)} : le PDF est `
    + `rempli sur le millésime ${modele.millesime}, dont les cases ont pu changer. Il ne se dépose pas tel quel : les cases sont `
    + `à reporter sur le formulaire du bon millésime ou sur le logiciel de dépôt.`
}

// Ce qui s'écrit en tête de chaque page remplie quand le modèle n'est pas le bon (sans caractère hors de WinAnsi).
export function mentionDuPdf2033(annee: number): string[] {
  const modele = modeleDuFormulaire2033(annee)
  if (modele === null || !modele.substitut) return []
  return [
    `ATTENTION - exercice ${annee} rempli sur la liasse 2033-SD millésime ${modele.millesime}.`,
    `Ne pas déposer tel quel : reporter les cases sur le formulaire du millésime ${modele.attendu} ou le logiciel de dépôt.`,
  ]
}
