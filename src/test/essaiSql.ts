// LIRE UN ESSAI SQL ÉCRIT SUR LE MOTEUR D'ÉTAPES (supabase/essais/piecesHorsDeFrance.sql, regimesEreporting.sql) : ses
// étapes, les appels de fonction qu'elles portent et leurs valeurs, les lignes que le jeu insère, et le message que la base
// a rendu (un motif LIKE quand il porte un « % »). La lecture est celle de piecesHorsDeFrance.test.ts (étape e2), réunie
// ici pour l'essai d'e5a sans toucher au test d'e2 : un module qui dit les refus avant le clic se confronte à ce que la
// base a RÉPONDU, appel par appel, sur le même jeu et dans le même ordre.

/** Une étape : `array['controle', '15. …', 'chef', $q$…$q$, '22023', 'message']` — son genre, son titre (son numéro, ou le
 * nom qu'elle retient), son profil, sa requête, le code attendu (« OK » pour un appel qui doit passer) et le message
 * attendu de la base, l'apostrophe doublée rendue simple. */
export interface Etape {
  genre: string
  titre: string
  numero: string
  profil: string
  appel: string
  code: string
  attendu: string
}

const GENRES = 'jeu|controle|fait|valeur|retenir|lecture'

export function etapesDe(essai: string): Etape[] {
  return [...essai.matchAll(new RegExp(`array\\['(${GENRES})', '((?:[^']|'')*)', '(\\w+)', \\$q\\$([\\s\\S]*?)\\$q\\$,\\s*'(\\w*)',\\s*'((?:[^']|'')*)'`, 'g'))]
    .map(([, genre, titre, profil, appel, code, attendu]) => ({
      genre, titre: titre.replace(/''/g, "'"), numero: /^(\w+)\./.exec(titre)?.[1] ?? '', profil, appel, code,
      attendu: attendu.replace(/''/g, "'"),
    }))
}

/** Un texte SQL coupé sur ses virgules de premier niveau, hors chaînes (une apostrophe doublée ouvre et referme). */
export function decouper(texte: string): string[] {
  const valeurs: string[] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (const car of texte) {
    if (car === "'") chaine = !chaine
    if (!chaine && car === '(') profondeur++
    if (!chaine && car === ')') profondeur--
    if (!chaine && profondeur === 0 && car === ',') {
      valeurs.push(courant.trim())
      courant = ''
    } else courant += car
  }
  valeurs.push(courant.trim())
  return valeurs
}

/** Les appels d'une étape `select f(…), g(…)` : chaque fonction et ses arguments, dans l'ordre. Null : l'étape n'est pas
 * faite que d'appels (une écriture directe, une lecture). */
export function appelsDe(appel: string): { fonction: string; arguments: string[] }[] | null {
  if (!appel.startsWith('select ')) return null
  const appels: { fonction: string; arguments: string[] }[] = []
  for (const morceau of decouper(appel.slice('select '.length))) {
    const m = /^(\w+)\(([\s\S]*)\)$/.exec(morceau)
    if (!m) return null
    appels.push({ fonction: m[1], arguments: decouper(m[2]) })
  }
  return appels
}

/**
 * Une valeur SQL de l'essai : null, un booléen, un nombre, `repeat(…)`, un JSON, un texte — un identifiant jetable entre
 * accolades rendu par son nom (ou sa valeur retenue) ; une sous-requête, par `sousRequete` quand l'appelant sait la lire.
 */
export function valeurSql(expression: string, noms: ReadonlyMap<string, string>, sousRequete?: (texte: string) => unknown): unknown {
  if (expression === 'null') return null
  if (expression === 'true' || expression === 'false') return expression === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression)
  const repete = /^repeat\('(\w)', (\d+)\)$/.exec(expression)
  if (repete) return repete[1].repeat(Number(repete[2]))
  const json = /^'([\s\S]*)'::jsonb$/.exec(expression)
  if (json) return JSON.parse(json[1].replace(/''/g, "'")) as unknown
  if (expression.startsWith('(select ') && sousRequete) return sousRequete(remplacerLesNoms(expression, noms))
  const texte = /^'([\s\S]*)'$/.exec(expression)
  if (!texte) throw new Error(`Valeur SQL que le test ne sait pas lire : ${expression}`)
  const valeur = texte[1].replace(/''/g, "'")
  const nom = /^\{(\w+)\}$/.exec(valeur)
  if (!nom) return valeur
  const resolu = noms.get(nom[1])
  if (resolu === undefined) throw new Error(`Identifiant jetable inconnu : ${valeur}`)
  return resolu
}

/** Les identifiants jetables d'un texte, rendus par leur nom (ou leur valeur retenue). */
export function remplacerLesNoms(texte: string, noms: ReadonlyMap<string, string>): string {
  return texte.replace(/\{(\w+)\}/g, (m, nom: string) => noms.get(nom) ?? m)
}

/** Les n-uplets d'un `values (…), (…)`, chacun coupé sur ses virgules de premier niveau, hors chaînes. */
export function nUplets(texte: string): string[][] {
  const sortie: string[][] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (const car of texte) {
    if (car === "'") chaine = !chaine
    if (!chaine && car === '(' && ++profondeur === 1) {
      courant = ''
      continue
    }
    if (!chaine && car === ')' && --profondeur === 0) {
      sortie.push(decouper(courant))
      continue
    }
    if (profondeur > 0) courant += car
  }
  return sortie
}

/** Les lignes qu'une étape `jeu` insère dans une table, colonne par colonne. */
export function lignesInserees(appel: string, table: string, noms: ReadonlyMap<string, string>): Record<string, unknown>[] {
  const lignes: Record<string, unknown>[] = []
  for (const m of appel.matchAll(new RegExp(String.raw`insert into ${table} \(([^)]*)\) values([^;]*)`, 'g'))) {
    const colonnes = m[1].split(',').map((c) => c.trim())
    for (const valeurs of nUplets(m[2])) {
      if (valeurs.length !== colonnes.length) throw new Error(`${table} : ${valeurs.join(', ')}`)
      lignes.push(Object.fromEntries(colonnes.map((c, i) => [c, valeurSql(valeurs[i], noms)])))
    }
  }
  return lignes
}

/** Le message que la base a rendu — celui que l'essai attend : égal, ou conforme à son motif LIKE (« % » pour toute
 * suite, « _ » pour un caractère). */
export function commeLaBase(attendu: string, recu: string | null | undefined): boolean {
  if (!/[%_]/.test(attendu)) return recu === attendu
  const motif = attendu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '.')
  return new RegExp(`^${motif}$`).test(recu ?? '')
}
