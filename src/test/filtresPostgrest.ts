// Les filtres PostgREST qu'un faux client APPLIQUE, au lieu de les accepter en silence.
//
// Un faux client qui répond `not: () => chaine` rend les mêmes lignes avec ou sans le filtre : il ne
// peut donc pas voir qu'un écran filtre TROP. C'est ainsi que le défaut que la ligne 26.6 corrige —
// `.not('piece_id', 'is', null)` sur la lecture des mouvements rapprochés, qui cachait tout mouvement
// affecté à une catégorie — restait invisible dans cinq écrans : remis tel quel, il laissait leurs
// tests VERTS, leurs faux clients rendant les mouvements affectés quoi que la requête demande. Même
// panne sur les catégories : lues par `.eq('dossier_id', …)` au lieu du `.or(…)` qui ajoute celles du
// cabinet, elles disparaissent TOUTES en production — aucune n'y appartient à un dossier —, et un faux
// client qui ignore les deux filtres ne le voit pas.
//
// Une forme que ce module ne connaît pas LÈVE au lieu d'être ignorée : un filtre accepté sans être
// appliqué est exactement la panne qu'il corrige. Il ne modélise que ce dont les écrans se servent —
// `.eq`, `.is(colonne, null)`, `.not(colonne, 'is', null)` et les termes `eq` et `is.null` d'un `.or` —,
// et un faux client l'emploie table par table, là où l'écart entre « filtré » et « pas filtré » décide
// de ce que l'écran montre.

export type Ligne = Record<string, unknown>
export type Predicat = (ligne: Ligne) => boolean

/** `.eq(colonne, valeur)`. */
export function predicatEq(colonne: string, valeur: unknown): Predicat {
  return (ligne) => ligne[colonne] === valeur
}

/** `.not(colonne, 'is', null)` — les lignes dont la colonne est renseignée. Rien d'autre n'est modélisé. */
export function predicatNot(colonne: string, operateur: string, valeur: unknown): Predicat {
  if (operateur === 'is' && valeur === null) return (ligne) => ligne[colonne] != null
  throw new Error(`Faux client : .not('${colonne}', '${operateur}', …) n'est pas modélisé.`)
}

/** `.is(colonne, null)` — les lignes dont la colonne est vide. Rien d'autre n'est modélisé. */
export function predicatIs(colonne: string, valeur: unknown): Predicat {
  if (valeur === null) return (ligne) => ligne[colonne] == null
  throw new Error(`Faux client : .is('${colonne}', …) n'est pas modélisé hors de null.`)
}

/**
 * `.or('a.eq.x,a.is.null')` — les lignes qui satisfont l'un des termes. PostgREST compare le texte de
 * la valeur, d'où le `String` ; et une colonne absente de la ligne d'essai vaut NULL, comme en base.
 */
export function predicatOr(expression: string): Predicat {
  const termes = expression.split(',').map((terme): Predicat => {
    const forme = /^([a-z_]+)\.(eq|is)\.(.+)$/.exec(terme)
    if (!forme) throw new Error(`Faux client : le terme « ${terme} » de .or() n'est pas modélisé.`)
    const [, colonne, operateur, valeur] = forme
    if (operateur === 'eq') return (ligne) => ligne[colonne] != null && String(ligne[colonne]) === valeur
    if (valeur !== 'null') throw new Error(`Faux client : le terme « ${terme} » de .or() n'est pas modélisé.`)
    return (ligne) => ligne[colonne] == null
  })
  return (ligne) => termes.some((terme) => terme(ligne))
}

/** Les lignes qui passent TOUS les prédicats, comme une requête qui les enchaîne. */
export function filtrer<T>(lignes: readonly T[], predicats: readonly Predicat[]): T[] {
  return lignes.filter((ligne) => predicats.every((predicat) => predicat(ligne as Ligne)))
}
