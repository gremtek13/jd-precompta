// LIRE LES REFUS D'UNE FONCTION PL/pgSQL DANS SON TEXTE EXPORTÉ (ligne 41, étape R4) : les messages de ses
// `raise exception`, leurs codes, leurs numéros et les valeurs de leurs « % », dans l'ordre du texte — pour confronter un
// module qui dit les refus avant le clic au texte que la base exécute. La lecture est celle de `revision.test.ts`
// (étape R2), réunie ici pour servir à plusieurs fonctions sans toucher au test de R2.

/** Les messages des `raise exception`, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple. */
export function messagesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

/**
 * Le numéro de chaque `raise exception`, dans le même ordre : le dernier commentaire « -- N. » qui le précède ;
 * « -- 6. et 7. » donne 6 au premier refus qui le suit, 7 au second.
 */
export function numerosSql(sql: string): number[] {
  const numeros: number[] = []
  let courants: number[] = []
  let rang = 0
  for (const m of sql.matchAll(/-- (\d+)\.(?: et (\d+)\.)?|raise exception/g)) {
    if (m[0] !== 'raise exception') {
      courants = m[2] === undefined ? [Number(m[1])] : [Number(m[1]), Number(m[2])]
      rang = 0
      continue
    }
    numeros.push(courants[Math.min(rang, courants.length - 1)])
    rang++
  }
  return numeros
}

/** Le code de chaque `raise exception`, dans le même ordre. */
export function codesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '(\w+)'/g)].map((m) => m[1])
}

/**
 * Ce qui suit le message d'un `raise exception`, jusqu'à `using errcode` : les valeurs qui remplissent ses « % »,
 * coupées sur les virgules de premier niveau, hors chaînes.
 */
export function argumentsSql(sql: string): string[][] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)].map((m) => {
    const texte = m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '')
    if (!texte) return []
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
  })
}

/** Le nombre de « % » d'un modèle de message, « %% » (un pour-cent écrit) mis à part. */
export const nombreDeValeurs = (modele: string) => modele.replace(/%%/g, '').split('%').length - 1
