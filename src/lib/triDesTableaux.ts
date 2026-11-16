// LE TRI D'UN TABLEAU PAR UN CLIC SUR L'EN-TÊTE D'UNE COLONNE (demande du cabinet du 16/11/2026).
//
// Un module pur : l'état du tri (une colonne, un sens), son cycle au clic, et l'ordre qu'il donne aux lignes.
// L'écran DÉCLARE ses colonnes triables et leur TYPE ; le module ne devine jamais la nature d'une valeur.
//
// Ce que le tri ne fait pas, et qui tient la règle des recherches (`recherchesEtTotaux.test.ts`) : il ordonne
// l'AFFICHAGE. Il ne retire ni n'ajoute aucune ligne — une sélection, un total, un export ou un lot se calculent
// sur la liste d'avant le tri, et le résultat de `trierLignes` ne sert qu'à dessiner les lignes et à donner à une
// fiche son « précédent / suivant » (la fiche suit la liste AFFICHÉE).
//
// L'ORDRE D'ORIGINE EST CELUI DE L'ÉCRAN, pas un tri neutre : une liste qui met des lignes en tête pour une raison
// métier (la pièce non lue en tête de « À valider ») le garde comme origine. Un tri choisi le remplace tant qu'il est
// actif ; le troisième clic, ou « Ordre d'origine » du sélecteur, le rétablit.

export type SensDuTri = 'croissant' | 'decroissant'

/** `null` : l'ordre d'origine de l'écran. */
export type EtatDuTri = { colonne: string; sens: SensDuTri } | null

type Base = { cle: string; libelle: string }

/**
 * Une colonne triable, par TYPE :
 * - `date` : une date civile en chaîne `AAAA-MM-JJ` (un instant `AAAA-MM-JJT…` se compare de même) — jamais un
 *   `new Date(...)` sur une valeur, qui ferait dépendre l'ordre du fuseau ; une chaîne d'une autre forme est vide ;
 * - `montant` : un nombre, un non-nombre est vide ;
 * - `texte` : une comparaison française, sans casse ni accent, les nombres dans l'ordre des nombres ;
 * - `rang` : une liste d'ordre fournie par l'écran (un statut) ; une valeur hors de la liste passe après les
 *   valeurs de la liste, avant les vides.
 */
export type ColonneTriable<T> =
  | (Base & { type: 'date'; valeur: (ligne: T) => string | null | undefined })
  | (Base & { type: 'montant'; valeur: (ligne: T) => number | null | undefined })
  | (Base & { type: 'texte'; valeur: (ligne: T) => string | null | undefined })
  | (Base & { type: 'rang'; valeur: (ligne: T) => string | null | undefined; ordre: readonly string[] })

/** Le cycle au clic : croissant, puis décroissant, puis l'ordre d'origine. Une autre colonne repart du croissant. */
export function triSuivant(etat: EtatDuTri, colonne: string): EtatDuTri {
  if (!etat || etat.colonne !== colonne) return { colonne, sens: 'croissant' }
  if (etat.sens === 'croissant') return { colonne, sens: 'decroissant' }
  return null
}

/** La valeur de `aria-sort` d'un en-tête. */
export function ariaSortDe(etat: EtatDuTri, colonne: string): 'ascending' | 'descending' | 'none' {
  if (!etat || etat.colonne !== colonne) return 'none'
  return etat.sens === 'croissant' ? 'ascending' : 'descending'
}

const FORME_DATE = /^\d{4}-\d{2}-\d{2}/

// Une clé comparable, ou `null` pour une valeur vide — qui ira en FIN dans les deux sens.
type Cle = { vide: true } | { vide: false; v: string | number }

function cleDe<T>(colonne: ColonneTriable<T>, ligne: T): Cle {
  switch (colonne.type) {
    case 'date': {
      const v = colonne.valeur(ligne)
      return typeof v === 'string' && FORME_DATE.test(v) ? { vide: false, v } : { vide: true }
    }
    case 'montant': {
      const v = colonne.valeur(ligne)
      return typeof v === 'number' && Number.isFinite(v) ? { vide: false, v } : { vide: true }
    }
    case 'texte': {
      const v = colonne.valeur(ligne)
      return typeof v === 'string' && v.trim() !== '' ? { vide: false, v: v.trim() } : { vide: true }
    }
    case 'rang': {
      const v = colonne.valeur(ligne)
      if (v == null || v === '') return { vide: true }
      const i = colonne.ordre.indexOf(v)
      return { vide: false, v: i === -1 ? colonne.ordre.length : i }
    }
  }
}

/**
 * Les lignes dans l'ordre du tri — une COPIE, jamais la liste reçue réordonnée en place. Sans tri, ou sur une
 * colonne inconnue, l'ordre d'origine. Le tri est STABLE : à égalité, l'ordre d'origine tient, dans les deux sens.
 */
export function trierLignes<T>(lignes: readonly T[], colonnes: readonly ColonneTriable<T>[], etat: EtatDuTri): T[] {
  const colonne = etat ? colonnes.find((c) => c.cle === etat.colonne) : undefined
  if (!etat || !colonne) return [...lignes]
  // Le collateur se crée ici, à chaque tri, jamais au chargement du module.
  const collateur = colonne.type === 'texte' ? new Intl.Collator('fr', { sensitivity: 'base', numeric: true }) : null
  const signe = etat.sens === 'croissant' ? 1 : -1
  const cles = lignes.map((ligne, rang) => ({ ligne, rang, cle: cleDe(colonne, ligne) }))
  cles.sort((a, b) => {
    // Les vides en fin, quel que soit le sens.
    if (a.cle.vide || b.cle.vide) {
      if (a.cle.vide && b.cle.vide) return a.rang - b.rang
      return a.cle.vide ? 1 : -1
    }
    const x = a.cle.v
    const y = b.cle.v
    let ordre: number
    if (collateur && typeof x === 'string' && typeof y === 'string') ordre = collateur.compare(x, y)
    else ordre = x < y ? -1 : x > y ? 1 : 0
    return ordre !== 0 ? signe * ordre : a.rang - b.rang
  })
  return cles.map((c) => c.ligne)
}

/** Les choix du sélecteur « Trier par » d'un tableau replié en fiches : l'origine, puis chaque colonne dans les deux sens. */
export function choixDuSelecteur<T>(colonnes: readonly ColonneTriable<T>[]): { valeur: string; libelle: string }[] {
  const sens = (type: ColonneTriable<T>['type']): [string, string] =>
    type === 'date' ? ['plus ancienne d’abord', 'plus récente d’abord']
      : type === 'montant' ? ['croissant', 'décroissant']
        : type === 'texte' ? ['A → Z', 'Z → A']
          : ['dans l’ordre', 'ordre inverse']
  return [
    { valeur: '', libelle: 'Ordre d’origine' },
    ...colonnes.flatMap((c) => {
      const [monte, descend] = sens(c.type)
      return [
        { valeur: `${c.cle}:croissant`, libelle: `${c.libelle} — ${monte}` },
        { valeur: `${c.cle}:decroissant`, libelle: `${c.libelle} — ${descend}` },
      ]
    }),
  ]
}

/** La valeur du sélecteur pour un état, et l'état d'une valeur choisie (une valeur inconnue rend l'origine). */
export function valeurDuSelecteur(etat: EtatDuTri): string {
  return etat ? `${etat.colonne}:${etat.sens}` : ''
}

export function etatDuSelecteur<T>(valeur: string, colonnes: readonly ColonneTriable<T>[]): EtatDuTri {
  const m = /^(.+):(croissant|decroissant)$/.exec(valeur)
  if (!m || !colonnes.some((c) => c.cle === m[1])) return null
  return { colonne: m[1], sens: m[2] as SensDuTri }
}
