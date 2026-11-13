// LES LECTEURS DU TEXTE SQL DES MIGRATIONS QUE PARTAGENT LES RELEVÉS DES RÈGLES POSÉES SOUS CONDITION.
//
// Une migration préparée pose sur ses tables ce qu'une AUTRE migration préparée posera sur les tables présentes en
// s'appliquant — la porte d'accès devant les gardes (porteDevantLesGardes.test.ts), la policy restrictive de la double
// authentification exigée (deuxFacteursDesTablesNeuves.test.ts) : un bloc `do` teste que la fonction de l'autre est en
// base, puis pose sur les tables qu'il nomme. Les deux relevés lisent ces blocs ici, une fois : deux lectures du même bloc
// qui divergeraient le feraient en silence.

/** Le texte sans ses commentaires `--`, jusqu'à la fin de leur ligne. */
export const sansCommentaires = (sql: string): string => sql.replace(/--[^\n]*/g, '')

/** Les blancs, retours à la ligne compris, ramenés à une espace. */
export const espaces = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Chaque bloc `do $balise$ … $balise$` d'un texte : sa position dans ce texte, et son corps. */
export function blocsDo(texte: string): { debut: number; fin: number; corps: string }[] {
  return [...texte.matchAll(/\bdo\s+\$(\w*)\$([\s\S]*?)\$\1\$/gi)].map((m) => ({ debut: m.index, fin: m.index + m[0].length, corps: m[2] }))
}

/** Les noms entre apostrophes des listes `array[…]` d'un texte. */
export function nomsDesListes(texte: string): string[] {
  return [...texte.matchAll(/array\[([^\]]*)\]/g)].flatMap((t) => [...t[1].matchAll(/'(\w+)'/g)].map((l) => l[1]))
}

/**
 * Deux littéraux consécutifs réunis en un, comme SQL les lit : `'a' || 'b'`, et `'a'` suivi de `'b'` à la ligne (deux
 * constantes séparées par un retour à la ligne se concatènent : PostgreSQL, « Lexical Structure », String Constants).
 * Un même texte s'écrit ainsi d'une ligne ou de deux, et le relevé le reconnaît sous ses trois formes.
 */
export function litterauxReunis(sql: string): string {
  return sql.replace(/'\s*\|\|\s*'/g, '').replace(/'[ \t]*\r?\n\s*'/g, '')
}
