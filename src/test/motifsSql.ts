// LE LEXEUR DU CONTRÔLE `motifsSqlSensiblesALaCasse.test.ts` : il lit une source TypeScript en jetons (commentaires,
// chaînes, gabarits et littéraux d'expression régulière reconnus pour ce qu'ils sont) et rend les recherches de
// définition SQL qui distinguent les capitales. Un module à part, sans vitest, pour que ce que le contrôle juge puisse
// aussi se réécrire (les positions des trouvailles sont celles de la source).

export type Jeton =
  | { genre: 'regex'; corps: string; drapeaux: string; ligne: number; debut: number; fin: number }
  | { genre: 'texte'; valeur: string; ligne: number; debut: number; fin: number }
  // Un gabarit : ses morceaux fixes, et les chaînes littérales qui apparaissent dans ses `${…}` (un ternaire
  // `${x ? 'create or replace' : 'create'}` ne s'écrit que là).
  | { genre: 'gabarit'; valeur: string; ligne: number; debut: number; fin: number }
  | { genre: 'mot'; valeur: string; ligne: number; debut: number; fin: number }
  | { genre: 'signe'; valeur: string; ligne: number; debut: number; fin: number }

/** Une forme que ce lexeur ne sait pas lire : on s'arrête plutôt que de la juger de travers. */
export class LecturePerdue extends Error {}

// Après ces mots, une barre oblique ouvre un littéral d'expression régulière ; après toute autre valeur, c'est une division.
const MOTS_AVANT_UNE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'])

/** Le texte lu en jetons, commentaires écartés. Lève `LecturePerdue` sur une chaîne, un gabarit ou un littéral ouvert. */
export function lire(source: string, jsx = false): Jeton[] {
  const jetons: Jeton[] = []
  let i = 0
  let ligne = 1

  // Lit un gabarit à partir du caractère qui suit l'accent grave ouvrant ; rend ses morceaux fixes, les chaînes de ses
  // `${…}` et la position qui suit l'accent grave fermant.
  function gabarit(debut: number): { valeur: string; fin: number } {
    let valeur = ''
    let k = debut
    while (k < source.length) {
      const c = source[k]
      if (c === '\\') { valeur += source.slice(k, k + 2); if (source[k + 1] === '\n') ligne++; k += 2; continue }
      if (c === '`') return { valeur, fin: k + 1 }
      if (c === '$' && source[k + 1] === '{') {
        const dedans = lireExpression(k + 2)
        for (const j of dedans.jetons) {
          if (j.genre === 'texte' || j.genre === 'gabarit') valeur += ` ${j.valeur} `
        }
        valeur += '${}'
        k = dedans.fin
        continue
      }
      if (c === '\n') ligne++
      valeur += c
      k++
    }
    throw new LecturePerdue(`ligne ${ligne} : un gabarit ne se ferme pas`)
  }

  // Lit le code d'un `${…}` jusqu'à son `}` : les accolades s'apparient, les chaînes et gabarits s'y lisent comme ailleurs.
  function lireExpression(debut: number): { jetons: Jeton[]; fin: number } {
    const reste = source.slice(debut)
    let profondeur = 0
    const sousJetons: Jeton[] = []
    const sauveI = i
    i = debut
    const sauveJetons = jetons.splice(0, jetons.length)
    try {
      while (i < source.length) {
        const c = source[i]
        if (c === '{') profondeur++
        if (c === '}') {
          if (profondeur === 0) { const fin = i + 1; sousJetons.push(...jetons); return { jetons: sousJetons, fin } }
          profondeur--
        }
        pas()
      }
    } finally {
      jetons.splice(0, jetons.length, ...sauveJetons)
      i = sauveI
    }
    throw new LecturePerdue(`ligne ${ligne} : un « \${ » ne se ferme pas (${reste.slice(0, 30)})`)
  }

  // Un seul pas du lexeur : avance `i` d'au moins un caractère.
  function pas(): void {
    const d = i
    const c = source[i]
    const suivant = source[i + 1]
    if (c === '\n') { ligne++; i++; return }
    if (/\s/.test(c)) { i++; return }
    if (c === '/' && suivant === '/') { while (i < source.length && source[i] !== '\n') i++; return }
    if (c === '/' && suivant === '*') {
      const fin = source.indexOf('*/', i + 2)
      if (fin < 0) throw new LecturePerdue(`ligne ${ligne} : un commentaire ne se ferme pas`)
      for (const x of source.slice(i, fin)) if (x === '\n') ligne++
      i = fin + 2
      return
    }
    if (c === "'" || c === '"') {
      let k = i + 1
      let valeur = ''
      let ouverte = false
      while (k < source.length && source[k] !== c) {
        if (source[k] === '\n') { ouverte = true; break }
        if (source[k] === '\\') { valeur += source.slice(k, k + 2); k += 2; continue }
        valeur += source[k]
        k++
      }
      if (k >= source.length) ouverte = true
      if (ouverte) {
        // Dans un `.tsx`, une apostrophe du TEXTE d'un élément (`<p>l'adresse</p>`) n'ouvre aucune chaîne.
        if (jsx) { jetons.push({ genre: 'signe', valeur: c, ligne, debut: d, fin: d + 1 }); i++; return }
        throw new LecturePerdue(`ligne ${ligne} : une chaîne ne se ferme pas`)
      }
      jetons.push({ genre: 'texte', valeur: decoder(valeur), ligne, debut: d, fin: k + 1 })
      i = k + 1
      return
    }
    if (c === '`') {
      const debutLigne = ligne
      const g = gabarit(i + 1)
      jetons.push({ genre: 'gabarit', valeur: decoder(g.valeur), ligne: debutLigne, debut: d, fin: g.fin })
      i = g.fin
      return
    }
    if (c === '/') {
      const dernier = jetons[jetons.length - 1]
      // `</p>` et `<br />` (JSX) : la barre n'ouvre rien après un `<`, ni devant un `>`.
      const peutOuvrir = suivant !== '>' && !(dernier?.genre === 'signe' && dernier.valeur === '<') && (dernier === undefined ||
        (dernier.genre === 'signe' && dernier.valeur !== ')' && dernier.valeur !== ']') ||
        (dernier.genre === 'mot' && MOTS_AVANT_UNE_REGEX.has(dernier.valeur)))
      if (peutOuvrir) {
        let k = i + 1
        let dansClasse = false
        let corps = ''
        while (k < source.length) {
          const x = source[k]
          if (x === '\n') throw new LecturePerdue(`ligne ${ligne} : un littéral d'expression régulière ne se ferme pas`)
          if (x === '\\') { corps += source.slice(k, k + 2); k += 2; continue }
          if (x === '[') dansClasse = true
          else if (x === ']') dansClasse = false
          else if (x === '/' && !dansClasse) break
          corps += x
          k++
        }
        if (k >= source.length) throw new LecturePerdue(`ligne ${ligne} : un littéral d'expression régulière ne se ferme pas`)
        k++
        let drapeaux = ''
        while (k < source.length && /[a-z]/.test(source[k])) { drapeaux += source[k]; k++ }
        jetons.push({ genre: 'regex', corps, drapeaux, ligne, debut: d, fin: k })
        i = k
        return
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let k = i + 1
      while (k < source.length && /[\w$]/.test(source[k])) k++
      jetons.push({ genre: 'mot', valeur: source.slice(i, k), ligne, debut: d, fin: k })
      i = k
      return
    }
    if (/[0-9]/.test(c)) {
      let k = i + 1
      while (k < source.length && /[\w.]/.test(source[k])) k++
      jetons.push({ genre: 'mot', valeur: source.slice(i, k), ligne, debut: d, fin: k })
      i = k
      return
    }
    jetons.push({ genre: 'signe', valeur: c, ligne, debut: d, fin: d + 1 })
    i++
  }

  while (i < source.length) pas()
  return jetons
}

/** Les échappements que le texte d'une chaîne porte, rendus tels que la chaîne les lit (`\n`, `\\`, `\'`…). */
function decoder(brut: string): string {
  return brut.replace(/\\(n|t|r|\\|'|"|`|\$)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c))
}

const OBJETS = 'function|trigger|policy|table|view|index|type|schema|extension|constraint|column'

// Le texte d'un motif ou d'une chaîne, ramené à ce qu'il CHERCHE : un `\s+`, un `\s` ou un `\\s+` (le même, écrit dans une
// chaîne) est un blanc, les groupes et les `?` s'effacent, et `or replace` ne gêne pas la lecture.
function normalise(texte: string): string {
  return texte
    .replace(/\\\\s[+*]?/g, ' ')
    .replace(/\\s[+*]?/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\(\?[:=!]/g, '(')
    .replace(/[()?]/g, '')
    .replace(/\s+/g, ' ')
}

/** Ce texte nomme-t-il une instruction de définition (ou le début d'une, `\ncreate `) ? */
export function nommeUneDefinition(texte: string): boolean {
  const t = normalise(texte)
  return new RegExp(String.raw`\b(?:create|alter|drop)\b[^;]{0,40}?\b(?:${OBJETS})\b`, 'i').test(t) ||
    /(?:^|\n| )(?:create|alter|drop) ?$/i.test(t)
}

export interface Trouvaille {
  ligne: number
  /** `regex` : un motif sans `i` ; `texte` : une recherche de texte, toujours sensible à la casse. */
  genre: 'regex' | 'texte'
  extrait: string
  /** Où la source se répare : un `i` à insérer (`regex`), ou l'appel `<recepteur>.verbe(` à réécrire (`texte`). */
  reparation:
    | { genre: 'inserer'; position: number; texte: string }
    | { genre: 'appel'; verbe: string; point: number; ouvrante: number }
}

// Une recherche de TEXTE FIXE : sensible à la casse, et son échec est silencieux quand un autre candidat la suit. Un
// `toContain` n'en est pas : c'est une ASSERTION sur le texte exact d'une migration nommée, rouge quand elle manque.
const RECHERCHES_DE_TEXTE = new Set(['indexOf', 'lastIndexOf', 'includes', 'startsWith', 'split'])

/** Les jetons d'un argument d'appel : de la parenthèse ouvrante (à `debut`) à la virgule de premier niveau. */
function premierArgument(jetons: Jeton[], debut: number): Jeton[] {
  const arg: Jeton[] = []
  let profondeur = 0
  for (let k = debut + 1; k < jetons.length; k++) {
    const j = jetons[k]
    if (j.genre === 'signe') {
      if (j.valeur === '(' || j.valeur === '[' || j.valeur === '{') profondeur++
      if (j.valeur === ')' || j.valeur === ']' || j.valeur === '}') { if (profondeur === 0) break; profondeur-- }
      if (j.valeur === ',' && profondeur === 0) break
    }
    arg.push(j)
  }
  return arg
}

/** Le deuxième argument d'un appel (les drapeaux d'un `new RegExp`), s'il est une chaîne ; sinon `null`. */
function deuxiemeArgument(jetons: Jeton[], debut: number): Jeton[] | null {
  let profondeur = 0
  let virgule = -1
  for (let k = debut + 1; k < jetons.length; k++) {
    const j = jetons[k]
    if (j.genre !== 'signe') continue
    if (j.valeur === '(' || j.valeur === '[' || j.valeur === '{') profondeur++
    else if (j.valeur === ')' || j.valeur === ']' || j.valeur === '}') { if (profondeur === 0) break; profondeur-- }
    else if (j.valeur === ',' && profondeur === 0) { virgule = k; break }
  }
  if (virgule < 0) return null
  return premierArgument(jetons, virgule)
}

/** La parenthèse fermante qui répond à celle d'indice `ouvrante` dans les jetons. */
function fermante(jetons: Jeton[], ouvrante: number): Jeton {
  let profondeur = 0
  for (let k = ouvrante; k < jetons.length; k++) {
    const j = jetons[k]
    if (j.genre !== 'signe') continue
    if (j.valeur === '(' || j.valeur === '[' || j.valeur === '{') profondeur++
    else if (j.valeur === ')' || j.valeur === ']' || j.valeur === '}') { profondeur--; if (profondeur === 0) return j }
  }
  throw new LecturePerdue(`ligne ${jetons[ouvrante].ligne} : une parenthèse ne se ferme pas`)
}

/** Les recherches de définition sensibles à la casse d'une source TypeScript. Lève `LecturePerdue` sur une forme illisible. */
export function trouvailles(source: string, jsx = false): Trouvaille[] {
  const jetons = lire(source, jsx)
  const trouvees: Trouvaille[] = []
  const signaler = (j: Jeton, genre: Trouvaille['genre'], extrait: string, reparation: Trouvaille['reparation']) =>
    trouvees.push({ ligne: j.ligne, genre, extrait: extrait.replace(/\s+/g, ' ').slice(0, 90), reparation })
  const valeurs = (arg: Jeton[]) =>
    arg.filter((x) => x.genre === 'texte' || x.genre === 'gabarit').map((x) => (x as { valeur: string }).valeur).join(' ')

  for (let k = 0; k < jetons.length; k++) {
    const j = jetons[k]
    if (j.genre === 'regex') {
      if (!j.drapeaux.includes('i') && nommeUneDefinition(j.corps)) {
        signaler(j, 'regex', `/${j.corps}/${j.drapeaux}`, { genre: 'inserer', position: j.fin, texte: 'i' })
      }
      continue
    }
    // new RegExp(<corps>, '<drapeaux>')
    if (j.genre === 'mot' && j.valeur === 'RegExp' && jetons[k - 1]?.genre === 'mot' && (jetons[k - 1] as { valeur: string }).valeur === 'new') {
      const ouvrante = jetons[k + 1]
      if (ouvrante?.genre !== 'signe' || ouvrante.valeur !== '(') continue
      const texte = valeurs(premierArgument(jetons, k + 1))
      // Un corps passé par une variable (`new RegExp(motif, 'g')`) ne se lit pas ici : la variable est née d'un littéral
      // ou d'un gabarit que ce lexeur juge là où il est écrit, ou, à défaut, d'un appel que `schema.ts` garde.
      const second = deuxiemeArgument(jetons, k + 1)
      const drapeaux = second?.filter((x) => x.genre === 'texte').map((x) => (x as { valeur: string }).valeur).join('') ?? ''
      if (!drapeaux.includes('i') && nommeUneDefinition(texte)) {
        const drapeau = second?.find((x) => x.genre === 'texte')
        const reparation: Trouvaille['reparation'] = drapeau
          ? { genre: 'inserer', position: drapeau.fin - 1, texte: 'i' }
          : { genre: 'inserer', position: fermante(jetons, k + 1).debut, texte: ", 'i'" }
        signaler(j, 'regex', `new RegExp(${texte}, '${drapeaux}')`, reparation)
      }
      continue
    }
    // <texte>.indexOf('create function …') et ses semblables
    if (j.genre === 'mot' && RECHERCHES_DE_TEXTE.has(j.valeur) && jetons[k - 1]?.genre === 'signe' && (jetons[k - 1] as { valeur: string }).valeur === '.') {
      const ouvrante = jetons[k + 1]
      if (ouvrante?.genre !== 'signe' || ouvrante.valeur !== '(') continue
      const arg = premierArgument(jetons, k + 1)
      const texte = valeurs(arg)
      if (nommeUneDefinition(texte)) {
        signaler(j, 'texte', `.${j.valeur}(${texte})`, { genre: 'appel', verbe: j.valeur, point: jetons[k - 1].debut, ouvrante: ouvrante.debut })
      }
    }
  }
  return trouvees
}
