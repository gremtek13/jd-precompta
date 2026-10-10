import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE ÉCRITURE DU NAVIGATEUR EST VÉRIFIÉE, JAMAIS SUPPOSÉE RÉUSSIE — ET RIEN NE LE GARDAIT (09/10/2026).
//
// La règle est dans CLAUDE.md depuis le début (« `{ error }` lu »), et elle avait deux gardes voisins : les LECTURES du
// navigateur (`lecturesVerifiees.test.ts` — qui prend `data` prend `error`) et les ÉCRITURES des Edge Functions
// (`edgeFunctionsEcritures.test.ts`). Les écritures du navigateur n'en avaient aucun : on comptait sur la question
// « quelque chose recharge-t-il derrière ? », dont la réponse y est presque toujours oui. Or un rechargement après un
// refus ne DIT rien : il remet la ligne comme avant, et l'opérateur, qui vient de cliquer — souvent de CONFIRMER —,
// croit son geste accompli. C'est le défaut trouvé le 09/10/2026 sur la suppression d'une sélection de documents.
//
// MESURÉ en partant de toute la source, pas d'une liste : TREIZE écritures jetaient leur résultat, dans neuf gestes —
// retirer un repère annuel ou un poste (Estimation), un supplément ou un compte courant (Suppléments), une règle
// « toujours ignorer » (Banque), assigner un dossier à un comptable (Équipe, une écriture qui décide de QUI VOIT QUOI),
// changer la catégorie d'un document, cocher un justificatif (Checklist), attacher ou détacher l'avis d'une échéance
// (Cotisations), valider une sélection de pièces et appliquer les catégories suggérées (Pièces). Sept étaient connues,
// six ne l'étaient pas. Toutes lisent désormais leur erreur et la disent à l'écran, et chacune a son test d'écran rouge
// sur le code d'avant.
//
// CE QUI COMPTE COMME UNE ÉCRITURE, et pourquoi :
//   - une chaîne `.from(…)` qui porte `.insert(`, `.upsert(`, `.update(` ou `.delete(` ;
//   - TOUT `.rpc(` : la source ne dit pas si la fonction SQL écrit, et en tenir la liste à la main serait la liste
//     d'inclusion que la doctrine des scanners interdit. Une fonction qui lit doit de toute façon lire son erreur
//     (`lecturesVerifiees`) — la compter ne coûte que l'exception de lecture déjà connue ci-dessous ;
//   - TOUT `functions.invoke(`, pour la même raison : une Edge Function peut écrire, facturer ou appeler un tiers ;
//   - le stockage qui écrit (`upload`, `remove`, `move`, `copy`, `update`) ; ses lectures (`download`, `list`, les
//     adresses signées ou publiques) en sortent NOMMÉMENT, et une méthode inconnue est une faute ;
//   - les comptes, sauf la lecture de la session (`getUser`, `getSession`, `onAuthStateChange`), nommée.
//   Un `.insert(`, `.upsert(` ou `.update(` hors de toute chaîne `.from(` est une faute (un constructeur de requête
//   qu'on ne sait pas suivre) ; un `.delete(x)` avec un argument est celui d'un `Set` ou d'une `Map` — PostgREST n'en
//   prend aucun, sinon `{ count }`, qui reste une faute.
//
// CE QUI EST « LU » : le résultat destructuré avec `error` (`const { error } = await …`, la branche d'un ternaire
// destructuré, le rang d'un `Promise.all` destructuré, le paramètre d'un `.then(({ error }) => …)`, `(await …).error`) ;
// ou le résultat gardé ENTIER (`const r = await …`, un lot `Promise.all` gardé entier) — l'erreur y reste atteignable, et
// le compilateur (`noUnusedLocals`) dit qu'on la lit ; ou le résultat passé à une fonction NOMMÉE qui lit son erreur
// (`CONSOMMATEURS`, avec raison et nombre). Tout le reste est une faute, y compris le résultat RENDU à l'appelant, que
// ce garde ne suit pas : `const { error } = await …; return error` dit la même chose et se lit ici.
//
// CE QUE CE GARDE NE VOIT PAS, dit plutôt que laissé croire : ce qu'on FAIT de l'erreur (la dire, la journaliser,
// annuler une mise à jour optimiste) — c'est le test d'écran qui le tient ; et une écriture qui ne touche AUCUNE ligne
// sans erreur (PostgREST la rend comme un succès). Pour une SUPPRESSION suivie d'un retrait de fichier, ce dernier cas
// se lit dans la source, et la PORTE 2 l'exige : la ligne supprimée se lit (`.select(…)`) avant que le fichier parte.
// Pour une suppression suivie d'un autre effet (un compte, un message de succès), la source ne dit pas assez : c'est un
// test d'écran qui le tient (`DocumentsTab`, `PiecesTab`, `FichePiece.ecritures`).
//
// DEUX PIÈGES PAYÉS EN L'ÉCRIVANT, gardés par un cas planté chacun :
//   - `if (x) return` en fin de ligne, puis l'écriture à la ligne suivante : remonter les blancs fait lire
//     `return await supabase…`, une écriture RENDUE, alors que l'insertion automatique du point-virgule rend
//     `undefined` et JETTE l'écriture. Sept des treize fautes se cachaient derrière cette lecture ;
//   - `supabase.functions.invoke<{ … }>(…)` : l'argument de type entre le nom et la parenthèse faisait manquer dix-sept
//     appels sur vingt — c'est le plancher par porte qui l'a montré, la porte des fonctions n'en voyant que trois.

/**
 * Les fichiers dont des écritures ont le droit de ne pas lire leur erreur, avec la raison ET LE NOMBRE — une de plus
 * est une rechute, une de moins une raison morte (leçon de `datesUtc.test.ts`).
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'context/AuthContext.tsx': {
    nombre: 1,
    raison:
      'ce n’est pas une écriture : `est_super_admin` LIT un rôle, et l’échec tombe du côté FERMÉ — sans réponse, ' +
      'personne n’est super-admin. C’est l’une des quatre lectures de rôle que `lecturesVerifiees` dispense pour la ' +
      'même raison ; elle passe ici parce que tout `.rpc(` y est compté',
  },
}

/**
 * Les fonctions qui reçoivent une écriture ENTIÈRE en argument et lisent son erreur elles-mêmes, avec la raison et le
 * nombre d'écritures qu'elles reçoivent dans toute la source.
 */
const CONSOMMATEURS: Record<string, { nombre: number; raison: string }> = {
  memoriser: {
    nombre: 2,
    raison:
      '`FichePiece.memoriser` attend la requête, lit `{ error }` et le journalise : apprendre la règle « tiers → ' +
      'catégorie » est un confort, son échec ne doit pas faire échouer l’enregistrement de la pièce',
  },
  lireLaCouverture: {
    nombre: 2,
    raison:
      'ce n’est pas une écriture : `couverture_du_releve` LIT les mois du relevé (espace client, étape P7), pour ' +
      'l’Accueil et « Mes pièces » du client. `lib/couvertureReleve.ts` attend la requête et lit son erreur : un refus ' +
      'ou une réponse illisible rendent une lecture INCOMPLÈTE, que l’écran dit, jamais un relevé vide',
  },
  lireLeDroitBanque: {
    nombre: 1,
    raison:
      'ce n’est pas une écriture : `droits_sur_le_dossier` LIT les cases de l’appelant (étape P1), pour « Ma ' +
      'simulation » (P7). `lib/couvertureReleve.ts` attend la requête et lit son erreur : un refus FERME la simulation, ' +
      'avec son motif',
  },
}

function sources(): { chemin: string; texte: string }[] {
  const racine = new URL('../', import.meta.url)
  const trouves: { chemin: string; texte: string }[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, '')
  return trouves
}

/** Voir `retraitsStockage.test.ts` : ce dépôt CITE ses défauts dans ses commentaires, à commencer par ce fichier. */
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')
}

const ligneDe = (code: string, index: number) => code.slice(0, index).split('\n').length

/** L'index qui suit le groupe ouvert à `depart` (`(`, `[` ou `{`), chaînes de caractères sautées, ou -1. */
function finDeGroupe(code: string, depart: number): number {
  const paires: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const pile: string[] = []
  for (let i = depart; i < code.length; i++) {
    const c = code[i]
    if (c === '\'' || c === '"' || c === '`') {
      // Une chaîne : sa fermante, échappements compris. Les `${…}` d'un gabarit ne contiennent jamais, dans ce dépôt,
      // de quoi déséquilibrer un appel Supabase.
      let j = i + 1
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (paires[c]) pile.push(paires[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (pile.pop() !== c) return -1
      if (pile.length === 0) return i + 1
    }
  }
  return -1
}

/** L'index qui suit les chevrons d'un argument de type ouvert à `depart` (`invoke<{ … }>(`), ou -1. */
function finDesChevrons(code: string, depart: number): number {
  let profondeur = 0
  for (let i = depart; i < code.length; i++) {
    if (code[i] === '<') profondeur++
    else if (code[i] === '>' && code[i - 1] !== '=') { profondeur--; if (profondeur === 0) return i + 1 }
    else if (code[i] === ';' || code[i] === '\n') return -1
  }
  return -1
}

/**
 * Les maillons `.nom(…)` ou `.nom` de la chaîne qui commence à `depart` (la tête, ou un `.`), la position de la
 * parenthèse de chaque appel, et l'index où la chaîne s'arrête. Un argument de type (`invoke<T>(`) est traversé.
 */
function maillonsApres(code: string, depart: number): { noms: string[]; appels: Map<string, number>; fin: number } {
  const noms: string[] = []
  const appels = new Map<string, number>()
  let i = depart
  while (i < code.length && /[\w$]/.test(code[i])) i++
  for (;;) {
    let j = i
    while (j < code.length && /\s/.test(code[j])) j++
    if (code[j] === '?' && code[j + 1] === '.') j++
    if (code[j] !== '.') break
    j++
    while (j < code.length && /\s/.test(code[j])) j++
    const nom = /^[A-Za-z_$][\w$]*/.exec(code.slice(j, j + 60))
    if (!nom) break
    j += nom[0].length
    let k = j
    while (k < code.length && /\s/.test(code[k])) k++
    if (code[k] === '<') {
      const fermante = finDesChevrons(code, k)
      if (fermante > 0) { k = fermante; while (k < code.length && /\s/.test(code[k])) k++ }
    }
    noms.push(nom[0])
    if (code[k] === '(') {
      if (!appels.has(nom[0])) appels.set(nom[0], k)
      const fin = finDeGroupe(code, k)
      if (fin < 0) { i = code.length; break }
      i = fin
    } else {
      i = j
    }
  }
  return { noms, appels, fin: i }
}

/** Remonte les enveloppes TRANSPARENTES devant `depart` — blancs, `await`, `void` — jusqu'au premier signe qui compte. */
function caractereAmont(code: string, depart: number): number {
  let i = depart - 1
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0) return -1
    const mot = /\b(await|void)$/.exec(code.slice(0, i + 1))
    if (mot && mot.index + mot[0].length === i + 1) { i = mot.index - 1; continue }
    return i
  }
}

/**
 * La TÊTE de la chaîne dont `point` est un maillon : la question « le résultat est-il pris ? » se pose là, jamais au
 * milieu (`deps.client.from(…)` commence à `deps`) — la leçon de `edgeFunctionsEcritures`.
 */
function teteDeChaine(code: string, point: number): number {
  let j = point - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  if (j < 0 || !/[\w$]/.test(code[j])) return point
  while (j >= 0 && /[\w$]/.test(code[j])) j--
  let tete = j + 1
  for (;;) {
    let i = tete - 1
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0 || code[i] !== '.') return tete
    let k = i - 1
    while (k >= 0 && /\s/.test(code[k])) k--
    if (k < 0 || !/[\w$]/.test(code[k])) return tete
    while (k >= 0 && /[\w$]/.test(code[k])) k--
    tete = k + 1
  }
}

const MOTS_CLES = new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'typeof', 'await', 'void', 'new', 'in', 'of'])

/** Un `=` d'affectation, et non `==`, `===`, `!=`, `<=`, `>=` ou la flèche `=>`. */
function estAffectation(code: string, i: number): boolean {
  return code[i] === '=' && !'=!<>'.includes(code[i - 1]) && !'=>'.includes(code[i + 1])
}

/** L'ouvrante appariée de la fermante `)`, `]` ou `}` située à `i`, en remontant. */
function ouvranteDe(code: string, i: number): number {
  let profondeur = 0
  for (let k = i; k >= 0; k--) {
    if (')]}'.includes(code[k])) profondeur++
    else if ('([{'.includes(code[k])) { profondeur--; if (profondeur === 0) return k }
  }
  return -1
}

/** L'ouvrante NON appariée qui contient `depart` : la parenthèse d'un appel, le crochet d'un tableau, un bloc. */
function ouvranteEnglobante(code: string, depart: number): number {
  for (let k = depart - 1; k >= 0; k--) {
    if (')]}'.includes(code[k])) { k = ouvranteDe(code, k); if (k < 0) return -1; continue }
    if ('([{'.includes(code[k])) return k
  }
  return -1
}

/**
 * Le signe qui ARRÊTE l'expression conditionnelle contenant `i` (son `?` ou son `:`), en remontant par-dessus les
 * groupes : c'est lui qui dit le sort de l'expression entière, donc de ses deux branches.
 */
function arretDeLExpression(code: string, i: number): number {
  for (let k = i - 1; k >= 0; k--) {
    if (')]}'.includes(code[k])) { k = ouvranteDe(code, k); if (k < 0) return -1; continue }
    if ('([{;,'.includes(code[k]) || estAffectation(code, k)) return k
    if (code[k] === '>' && code[k - 1] === '=') return k
    if (/\breturn$/.test(code.slice(0, k + 1))) return k
  }
  return -1
}

/** Les éléments de premier niveau de l'intérieur d'un groupe `[ … ]`. */
function elementsDe(interieur: string): string[] {
  const elements: string[] = []
  let profondeur = 0
  let debut = 0
  for (let k = 0; k < interieur.length; k++) {
    const c = interieur[k]
    if ('([{'.includes(c)) profondeur++
    else if (')]}'.includes(c)) profondeur--
    else if (c === ',' && profondeur === 0) { elements.push(interieur.slice(debut, k)); debut = k + 1 }
  }
  elements.push(interieur.slice(debut))
  return elements.map((e) => e.trim())
}

function motAvant(code: string, i: number): { mot: string; debut: number } | null {
  let j = i - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  const m = /[A-Za-z_$][\w$]*$/.exec(code.slice(0, j + 1))
  return m ? { mot: m[0], debut: m.index } : null
}

/** L'index de `Promise` quand la parenthèse à `parenthese` est celle d'un `Promise.all(` ou `allSettled(`, ou -1. */
function promiseAllDe(code: string, parenthese: number): number {
  let j = parenthese - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  const m = /\bPromise\s*\.\s*(?:all|allSettled)$/.exec(code.slice(0, j + 1))
  return m ? m.index : -1
}

function motifObjet(champs: string): string {
  return /\berror\b/.test(champs) ? 'ok: error lu' : `faute: destructuré sans error ${champs.replace(/\s+/g, ' ')}`
}

/** Le sort d'un lot `Promise.all([…])` dont l'écriture est l'élément `rang` (null : le tableau vient d'un `.map`). */
function sortDuLot(code: string, tetePromise: number, rang: number | null): string {
  const i = caractereAmont(code, tetePromise)
  if (i >= 0 && estAffectation(code, i)) {
    let j = i - 1
    while (j >= 0 && /\s/.test(code[j])) j--
    if (code[j] !== ']') return 'ok: lot gardé entier'
    if (rang === null) return 'faute: non reconnue (lot d’un map destructuré)'
    const element = elementsDe(code.slice(ouvranteDe(code, j) + 1, j))[rang] ?? ''
    if (element === '') return 'faute: résultat sauté dans la destructuration du lot'
    if (element.startsWith('{')) return motifObjet(element)
    return 'ok: entier'
  }
  return sortDe(code, i, tetePromise)
}

/** Le sort de l'expression dont la tête est `tete`, lu au signe `i` qui la précède. */
function sortDe(code: string, i: number, tete: number): string {
  if (i < 0) return 'faute: résultat jeté'
  const c = code[i]
  if (/\b(return|yield)$/.test(code.slice(0, i + 1))) {
    // `return` seul en fin de ligne rend `undefined` (insertion automatique du point-virgule) : l'écriture de la ligne
    // suivante est une instruction de plus, dont le résultat part.
    if (code.slice(i + 1, tete).includes('\n')) return 'faute: résultat jeté'
    return 'rendu'
  }
  if (estAffectation(code, i)) {
    let j = i - 1
    while (j >= 0 && /\s/.test(code[j])) j--
    if (code[j] === '}') return motifObjet(code.slice(ouvranteDe(code, j), j + 1))
    if (code[j] === ']') return 'faute: non reconnue (destructuration en tableau)'
    return 'ok: entier'
  }
  if (c === '>' && code[i - 1] === '=') return sortDeLaFleche(code, i - 1)
  if (c === '(') {
    const promise = promiseAllDe(code, i)
    if (promise >= 0) return sortDuLot(code, promise, null)
    const appelant = motAvant(code, i)
    if (appelant && !MOTS_CLES.has(appelant.mot)) return `argument: ${appelant.mot}`
    if (appelant) return `faute: non reconnue (${appelant.mot} (…))`
    const fin = finDeGroupe(code, i)
    const apres = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(code.slice(fin))
    if (apres) return apres[1] === 'error' ? 'ok: error lu' : `faute: lit .${apres[1]} sans error`
    return sortDe(code, caractereAmont(code, i), i)
  }
  if (c === '[' || c === ',') {
    const ouvrante = ouvranteEnglobante(code, tete)
    if (ouvrante < 0) return 'faute: non reconnue'
    if (code[ouvrante] === '(') {
      const appelant = motAvant(code, ouvrante)
      if (appelant && !MOTS_CLES.has(appelant.mot)) return `argument: ${appelant.mot}`
      return 'faute: non reconnue (liste d’arguments)'
    }
    if (code[ouvrante] === '[') {
      const rang = elementsDe(code.slice(ouvrante + 1, tete)).length - 1
      let j = ouvrante - 1
      while (j >= 0 && /\s/.test(code[j])) j--
      const promise = code[j] === '(' ? promiseAllDe(code, j) : -1
      if (promise >= 0) return sortDuLot(code, promise, rang)
      return 'faute: non reconnue (élément d’un tableau)'
    }
    return 'faute: non reconnue'
  }
  if (c === '?' || c === ':') {
    const arret = arretDeLExpression(code, i)
    return sortDe(code, arret, arret + 1)
  }
  return 'faute: résultat jeté'
}

/**
 * Le sort d'une écriture rendue par une flèche. Seul le rappel d'un `.map(…)` se suit — jusqu'au sort du tableau ;
 * toute autre flèche (un gestionnaire `onClick={() => supabase…}`, un `useEffect`) est une forme non reconnue.
 */
function sortDeLaFleche(code: string, egal: number): string {
  let p = egal - 1
  while (p >= 0 && /\s/.test(code[p])) p--
  if (code[p] === ')') p = ouvranteDe(code, p)
  else { while (p > 0 && /[\w$]/.test(code[p - 1])) p--; if (code[p - 1] === '(') p-- }
  const mot = motAvant(code, p)
  if (mot?.mot === 'async') p = mot.debut
  let q = p - 1
  while (q >= 0 && /\s/.test(code[q])) q--
  if (code[q] !== '(') return 'faute: non reconnue (flèche)'
  const map = /\.\s*map\s*$/.exec(code.slice(0, q))
  if (!map) return 'faute: non reconnue (flèche hors d’un map)'
  const tete = teteDeChaine(code, map.index)
  if (maillonsApres(code, tete).fin !== finDeGroupe(code, q)) return 'faute: non reconnue (map suivi d’autres maillons)'
  return sortDe(code, caractereAmont(code, tete), tete)
}

/** Le verdict d'une écriture dont la chaîne commence à `tete`. */
function verdict(code: string, tete: number): string {
  const then = maillonsApres(code, tete).appels.get('then')
  if (then !== undefined) {
    const args = code.slice(then + 1, then + 200)
    if (/^\s*(async\s*)?\(\s*\)/.test(args)) return 'faute: then sans paramètre'
    const groupe = /^\s*(async\s*)?\(?\s*\{/.exec(args)
    if (groupe) {
      const debut = then + 1 + groupe[0].length - 1
      return motifObjet(code.slice(debut, finDeGroupe(code, debut)))
    }
    if (/^\s*(async\s*)?\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>/.test(args)) return 'ok: then entier'
    return 'faute: non reconnue (then)'
  }
  return sortDe(code, caractereAmont(code, tete), tete)
}

const METHODES_TABLE = ['insert', 'upsert', 'update', 'delete']
const ECRITURES_STOCKAGE = ['upload', 'remove', 'move', 'copy', 'update', 'uploadToSignedUrl']
const LECTURES_STOCKAGE = ['download', 'list', 'createSignedUrl', 'createSignedUrls', 'getPublicUrl']
const LECTURES_AUTH = ['getUser', 'getSession', 'onAuthStateChange']

interface Site {
  index: number
  ligne: number
  porte: string
  verdict: string
}

/** Toutes les écritures d'une source, chacune avec son verdict — une seule fois par chaîne, repérée par sa TÊTE. */
function ecrituresDe(texte: string): Site[] {
  const code = sansCommentairesPleins(texte)
  const sites = new Map<number, Site>()
  const methodesVues = new Set<number>()
  const ajouter = (ancre: number, porte: string, impose?: string) => {
    const tete = teteDeChaine(code, ancre)
    if (sites.has(tete)) return
    sites.set(tete, { index: tete, ligne: ligneDe(code, tete), porte, verdict: impose ?? verdict(code, tete) })
  }
  for (const m of code.matchAll(/\.\s*from\s*(?=[(<])/g)) {
    const { noms, appels } = maillonsApres(code, m.index)
    const ecriture = noms.find((n) => METHODES_TABLE.includes(n))
    if (!ecriture) continue
    for (const n of METHODES_TABLE) if (appels.has(n)) methodesVues.add(appels.get(n)!)
    if (/storage\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue
    ajouter(m.index, `table.${ecriture}`)
  }
  for (const m of code.matchAll(/\.\s*storage\s*\.\s*from\b/g)) {
    const methode = maillonsApres(code, m.index).noms[2] ?? '?'
    if (LECTURES_STOCKAGE.includes(methode)) continue
    ajouter(m.index, `stockage.${methode}`,
      ECRITURES_STOCKAGE.includes(methode) ? undefined : `faute: non reconnue (méthode de stockage « ${methode} »)`)
  }
  for (const m of code.matchAll(/\.\s*rpc\b/g)) ajouter(m.index, 'rpc')
  for (const m of code.matchAll(/\.\s*functions\s*\.\s*invoke\b/g)) ajouter(m.index, 'invoke')
  for (const m of code.matchAll(/\.\s*auth\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (!LECTURES_AUTH.includes(m[1])) ajouter(m.index, `auth.${m[1]}`)
  }
  for (const m of code.matchAll(/\.\s*(insert|upsert|update|delete)\s*\(/g)) {
    const parenthese = m.index + m[0].length - 1
    if (methodesVues.has(parenthese)) continue
    const argument = code.slice(parenthese + 1, finDeGroupe(code, parenthese) - 1).trim()
    if (m[1] === 'delete' && argument !== '' && !argument.startsWith('{')) continue
    sites.set(m.index, {
      index: m.index, ligne: ligneDe(code, m.index), porte: `orpheline.${m[1]}`,
      verdict: 'faute: non reconnue (méthode d’écriture hors d’une chaîne .from)',
    })
  }
  return [...sites.values()].sort((a, b) => a.index - b.index)
}

/** Une écriture dont le verdict est une faute — un argument passé à une fonction que `CONSOMMATEURS` ne nomme pas en est une. */
function enFaute(site: Site): boolean {
  if (site.verdict.startsWith('ok:')) return false
  const consommateur = /^argument: (.+)$/.exec(site.verdict)?.[1]
  return !(consommateur && consommateur in CONSOMMATEURS)
}

/**
 * PORTE 2 — une SUPPRESSION suivie, dans son bloc, d'un retrait de fichier, et qui ne lit pas les lignes supprimées.
 *
 * PostgREST rend une suppression qui ne touche aucune ligne comme un succès : retirer le fichier sur la seule absence
 * d'erreur laisse une ligne bien visible qui désigne un fichier disparu — pire qu'un orphelin. Le bloc est celui qui
 * contient la suppression (le corps de la fonction, d'un `try`, d'une boucle) : c'est là que l'effet suit.
 */
function suppressionsSansLecture(texte: string): number[] {
  const code = sansCommentairesPleins(texte)
  const fautes: number[] = []
  for (const site of ecrituresDe(texte)) {
    if (site.porte !== 'table.delete') continue
    const { noms, fin } = maillonsApres(code, site.index)
    if (noms.includes('select')) continue
    let bloc = ouvranteEnglobante(code, site.index)
    while (bloc >= 0 && code[bloc] !== '{') bloc = ouvranteEnglobante(code, bloc)
    const finBloc = bloc < 0 ? code.length : finDeGroupe(code, bloc)
    const suite = code.slice(fin, finBloc < 0 ? code.length : finBloc)
    if (/\bretirerFichiers\s*\(|\.\s*storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*remove\s*\(/.test(suite)) fautes.push(site.ligne)
  }
  return fautes
}

describe('les écritures du navigateur lisent leur erreur', () => {
  const tout = sources()
  const parFichier = tout.map((f) => ({ ...f, sites: ecrituresDe(f.texte) }))

  it('parcourt bien toute la source du navigateur', () => {
    // La borne qui empêche « zéro faute » de vouloir dire « je ne lis plus rien ».
    expect(tout.length).toBeGreaterThan(150)
    expect(tout.map((f) => f.chemin)).toEqual(expect.arrayContaining([
      'pages/dossier/PiecesTab.tsx', 'pages/EquipePage.tsx', 'lib/encaissementsFactures.ts', 'context/AuthContext.tsx',
    ]))
  })

  it('voit chaque porte en nombre — un plancher par porte, pas un seul pour toutes', () => {
    // Un seul plancher global laissait une porte s'éteindre sous le nombre des autres : c'est ce qui a caché les
    // dix-sept appels de fonctions écrits avec un argument de type (`invoke<T>(`) pendant l'écriture de ce garde.
    const compte = (prefixe: string) => parFichier.reduce((n, f) => n + f.sites.filter((s) => s.porte.startsWith(prefixe)).length, 0)
    expect(compte('table.')).toBeGreaterThan(100)
    expect(compte('rpc')).toBeGreaterThan(35)
    expect(compte('invoke')).toBeGreaterThan(15)
    expect(compte('stockage.')).toBeGreaterThan(8)
    expect(compte('auth.')).toBeGreaterThanOrEqual(2)
  })

  it('voit chaque appel de fonction, argument de type compris', () => {
    // Le décompte brut des `functions.invoke` de la source, comparé aux sites : une forme qui échapperait à l'ancre
    // ferait diverger les deux.
    for (const f of parFichier) {
      const bruts = [...sansCommentairesPleins(f.texte).matchAll(/functions\s*\.\s*invoke\b/g)].length
      expect(f.sites.filter((s) => s.porte === 'invoke').length, f.chemin).toBe(bruts)
    }
  })

  it('n’en laisse aucune jeter son erreur', () => {
    const fautes: string[] = []
    for (const f of parFichier) {
      const trouvees = f.sites.filter(enFaute)
      const exception = EXCEPTIONS[f.chemin]
      if (exception && trouvees.length === exception.nombre) continue
      const surplus = exception ? ` (exception déclarée pour ${exception.nombre}, trouvé ${trouvees.length})` : ''
      for (const s of trouvees) fautes.push(`${f.chemin}:${s.ligne} [${s.porte}] ${s.verdict}${surplus}`)
    }
    expect(fautes.join('\n'), 'une écriture refusée doit se DIRE : relue sans un mot, elle passe pour accomplie').toBe('')
  })

  it('n’a ni exception ni consommateur mort, et chacun porte sa raison et son nombre exact', () => {
    const connus = new Map(parFichier.map((f) => [f.chemin, f]))
    for (const [chemin, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${chemin} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
      const f = connus.get(chemin)
      expect(f, `exception sur un fichier introuvable : ${chemin}`).toBeDefined()
      expect(f!.sites.filter(enFaute).length, `${chemin} : l’exception annonce ${nombre} écriture(s)`).toBe(nombre)
    }
    for (const [nom, { nombre, raison }] of Object.entries(CONSOMMATEURS)) {
      expect(raison.length, `${nom} : un consommateur sans raison est une dette muette`).toBeGreaterThan(80)
      const recues = parFichier.reduce((n, f) => n + f.sites.filter((s) => s.verdict === `argument: ${nom}`).length, 0)
      expect(recues, `${nom} : le consommateur annonce ${nombre} écriture(s) reçue(s)`).toBe(nombre)
    }
  })

  it('PORTE 2 — aucune suppression suivie d’un retrait de fichier ne retire le fichier sans avoir lu la ligne supprimée', () => {
    const fautes = parFichier.flatMap((f) => suppressionsSansLecture(f.texte).map((l) => `${f.chemin}:${l}`))
    expect(fautes, 'zéro ligne supprimée n’est pas une erreur pour PostgREST : le fichier partirait seul').toEqual([])
  })

  it('PORTE 2 — en voit bien en production, sinon elle ne garderait rien', () => {
    // Le plancher de la porte : les suppressions suivies d'un retrait de fichier qu'elle examine (et qui lisent leur
    // ligne) — DocumentsTab, PiecesTab, FichePiece.
    const examinees = parFichier.filter((f) => /\bretirerFichiers\s*\(/.test(f.texte)
      && f.sites.some((s) => s.porte === 'table.delete')).map((f) => f.chemin)
    expect(examinees).toEqual(expect.arrayContaining([
      'pages/dossier/DocumentsTab.tsx', 'pages/dossier/PiecesTab.tsx', 'pages/dossier/FichePiece.tsx',
    ]))
  })
})

describe('le garde lui-même — défauts PLANTÉS, pas espérés', () => {
  const fautes = (source: string) => ecrituresDe(source).filter(enFaute)

  // ── Les formes FAUTIVES, une par une.
  const jete = `
    async function retirer(id) {
      await supabase.from('regles').delete().eq('id', id)
      load()
    }
  `
  const multiLigne = `
    async function retirer(id) {
      await supabase
        .from('supplements')
        .delete()
        .eq('id', id)
    }
  `
  const flottante = `function f() { supabase.from('a').insert({}) }`
  const parVoid = `function f() { void supabase.from('a').insert({}) }`
  const thenSansParametre = `function f() { supabase.from('a').update({}).eq('id', 1).then(() => load()) }`
  const thenSansErreur = `function f() { supabase.from('a').update({}).eq('id', 1).then(({ data }) => setX(data)) }`
  const destructureSansErreur = `async function f() { const { data } = await supabase.from('a').insert({}).select().single() }`
  const lotJete = `
    async function f() {
      await Promise.all([
        supabase.from('a').insert({}),
        supabase.from('b').insert({}),
      ])
    }
  `
  const lotSauteAuRang = `
    async function f() {
      const [{ error: erreurA }, { data }] = await Promise.all([
        supabase.from('a').insert({}),
        supabase.from('b').insert({}).select(),
      ])
    }
  `
  const lotDUnMapJete = `
    async function f(ids) {
      await Promise.all(ids.map((id) => supabase.from('pieces').update({ statut: 'validee' }).eq('id', id)))
    }
  `
  // Le piège de l'insertion automatique du point-virgule : `return` seul en fin de ligne JETTE l'écriture qui suit.
  const retourSeul = `
    async function basculer(info) {
      if (!info) return
      await supabase.from('informations_dossier').update({ coche: true }).eq('id', info.id)
    }
  `
  const parenthesesSansErreur = `async function f() { const lignes = (await supabase.from('a').delete().select()).data }`
  const parRpc = `async function f() { await supabase.rpc('valider_exercice', { p_annee: 2025 }) }`
  const parFonction = `async function f() { await supabase.functions.invoke('send-email', { body: {} }) }`
  // L'argument de type entre le nom et la parenthèse : la forme qui cachait dix-sept appels sur vingt.
  const parFonctionTypee = `async function f() { await supabase.functions.invoke<{ ok: boolean }>('send-email', { body: {} }) }`
  const parStockage = `async function f() { await supabase.storage.from('pieces').upload(chemin, fichier) }`
  const parCompte = `async function f() { await supabase.auth.signOut() }`
  const stockageInconnu = `async function f() { const { error } = await supabase.storage.from('pieces').renommerTout() }`
  const constructeurOrphelin = `async function f(requete) { const { error } = await requete.delete() }`
  const rendu = `function retirer(id) { return supabase.from('a').delete().eq('id', id) }`
  const argumentInconnu = `async function f() { await journaliser(supabase.from('a').insert({})) }`
  const gestionnaire = `const bouton = <button onClick={() => supabase.from('a').delete().eq('id', 1)}>×</button>`
  // Une flèche passée à un autre appel qu'un `.map` : personne ne lit ce qu'elle rend.
  const rappelHorsMap = `useEffect(() => supabase.from('journal').insert({ vu: true }), [])`
  // Un ternaire dont l'expression entière est jetée : ses DEUX branches le sont.
  const ternaireJete = `
    async function enregistrer(compte, payload) {
      compte
        ? await supabase.from('comptes').update(payload).eq('id', compte.id)
        : await supabase.from('comptes').insert(payload)
    }
  `

  // ── Les formes CORRECTES, qu'il ne doit pas signaler.
  const lue = `
    async function retirer(id) {
      const { error } = await supabase.from('regles').delete().eq('id', id)
      if (error) window.alert(messageErreur(error))
    }
  `
  const lueMultiLigne = `
    async function retirer(id) {
      const { data: retire, error: erreurRetrait } = await supabase
        .from('documents_divers')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
    }
  `
  const ternaire = `
    async function enregistrer(compte, payload) {
      const { error } = compte
        ? await supabase.from('comptes').update(payload).eq('id', compte.id)
        : await supabase.from('comptes').insert(payload)
    }
  `
  const lotLu = `
    async function f() {
      const [{ error: erreurA }, resultatB] = await Promise.all([
        supabase.from('a').insert({}),
        supabase.from('b').insert({}),
      ])
    }
  `
  const lotDUnMapGarde = `
    async function f(ids) {
      const resultats = await Promise.all(ids.map((id) => supabase.from('pieces').update({}).eq('id', id)))
      const echecs = resultats.filter((r) => r.error)
    }
  `
  const thenLu = `function f() { supabase.from('a').update({}).eq('id', 1).then(({ error }) => { if (error) dire(error) }) }`
  const parenthesesLues = `async function f() { const erreur = (await supabase.from('a').insert({})).error }`
  const gardeEntier = `async function f() { const r = await supabase.rpc('lire_quelque_chose'); if (r.error) dire(r.error) }`
  const fonctionTypeeLue = `
    async function f() {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean }>('send-email', { body: {} })
    }
  `
  const consommateurNomme = `async function f() { await memoriser('la règle', supabase.from('tiers').upsert({})) }`
  // L'argument de type traversé jusqu'au `.then` : sans lui, la chaîne s'arrêterait à `invoke` et la forme correcte
  // passerait pour jetée.
  const fonctionTypeeThenLue = `
    function f() { supabase.functions.invoke<{ ok: boolean }>('x', { body: {} }).then(({ error }) => dire(error)) }
  `
  const lectures = `
    async function f() {
      const { data, error } = await supabase.from('pieces').select('*')
      const { data: fichier, error: e2 } = await supabase.storage.from('pieces').download(chemin)
      const { data: { user } } = await supabase.auth.getUser()
      selection.delete(id)
      empreintes.delete(hash)
    }
  `

  it('attrape une écriture dont le résultat part, quel que soit son formatage', () => {
    expect(fautes(jete)).toHaveLength(1)
    expect(fautes(multiLigne)).toHaveLength(1)
    expect(fautes(flottante)).toHaveLength(1)
    expect(fautes(parVoid)).toHaveLength(1)
  })

  it('attrape un `.then` qui ne prend pas l’erreur', () => {
    expect(fautes(thenSansParametre)).toHaveLength(1)
    expect(fautes(thenSansErreur)).toHaveLength(1)
  })

  it('attrape une destructuration sans `error`, et `(await …).data`', () => {
    expect(fautes(destructureSansErreur)).toHaveLength(1)
    expect(fautes(parenthesesSansErreur)).toHaveLength(1)
  })

  it('attrape un lot jeté, le rang d’un lot dont l’erreur est sautée, et un lot d’un `.map` jeté', () => {
    expect(fautes(lotJete)).toHaveLength(2)
    const sautee = fautes(lotSauteAuRang)
    expect(sautee).toHaveLength(1)
    expect(lotSauteAuRang.split('\n')[sautee[0].ligne - 1]).toContain("from('b')")
    expect(fautes(lotDUnMapJete)).toHaveLength(1)
  })

  it('attrape l’écriture qui suit un `return` seul en fin de ligne', () => {
    // Sept des treize fautes de la mesure du 09/10/2026 se cachaient derrière la lecture « `return await …` ».
    expect(fautes(retourSeul)).toHaveLength(1)
    expect(fautes(retourSeul)[0].verdict).toBe('faute: résultat jeté')
  })

  it('attrape les autres portes : fonction SQL, Edge Function — argument de type compris —, stockage, compte', () => {
    expect(fautes(parRpc)).toHaveLength(1)
    expect(fautes(parFonction)).toHaveLength(1)
    expect(fautes(parFonctionTypee)).toHaveLength(1)
    expect(fautes(parStockage)).toHaveLength(1)
    expect(fautes(parCompte)).toHaveLength(1)
  })

  it('tient pour faute une forme qu’il ne sait pas lire, jamais pour un saut', () => {
    expect(fautes(stockageInconnu)).toHaveLength(1)
    expect(fautes(constructeurOrphelin)).toHaveLength(1)
    expect(fautes(rendu)).toHaveLength(1)
    expect(fautes(argumentInconnu)).toHaveLength(1)
    expect(fautes(gestionnaire)).toHaveLength(1)
    expect(fautes(rappelHorsMap)).toHaveLength(1)
  })

  it('suit le sort d’un ternaire jusqu’à l’expression entière : jetée, ses deux branches le sont', () => {
    expect(fautes(ternaireJete)).toHaveLength(2)
  })

  it('ne crie pas au loup sur les formes qui lisent leur erreur ou gardent le résultat entier', () => {
    for (const source of [lue, lueMultiLigne, ternaire, lotLu, lotDUnMapGarde, thenLu, parenthesesLues, gardeEntier, fonctionTypeeLue, consommateurNomme, fonctionTypeeThenLue]) {
      expect(fautes(source), source).toEqual([])
    }
  })

  it('ne compte ni les lectures ni les `delete` d’un `Set`', () => {
    expect(ecrituresDe(lectures)).toEqual([])
  })

  it('compte chaque écriture une fois, repérée par sa tête', () => {
    // `supabase.storage.from(…).upload(…)` porte deux ancres (`.storage` et `.from(`) : un garde qui compte double
    // finit par ne plus être lu.
    expect(ecrituresDe(parStockage)).toHaveLength(1)
    expect(ecrituresDe(ternaire)).toHaveLength(2)
  })

  it('distingue bien les deux issues — le compte exact sur toutes les sources mêlées', () => {
    const fautives = [jete, multiLigne, flottante, parVoid, thenSansParametre, thenSansErreur, destructureSansErreur,
      lotJete, lotSauteAuRang, lotDUnMapJete, retourSeul, parenthesesSansErreur, parRpc, parFonction, parFonctionTypee,
      parStockage, parCompte, stockageInconnu, constructeurOrphelin, rendu, argumentInconnu, gestionnaire, rappelHorsMap, ternaireJete]
    const correctes = [lue, lueMultiLigne, ternaire, lotLu, lotDUnMapGarde, thenLu, parenthesesLues, gardeEntier,
      fonctionTypeeLue, consommateurNomme, fonctionTypeeThenLue, lectures]
    expect(fautes([...fautives, ...correctes].join('\n'))).toHaveLength(26)
  })

  it('ne voit rien dans une ligne entièrement en commentaire', () => {
    expect(ecrituresDe("    // await supabase.from('a').delete().eq('id', 1)\n")).toEqual([])
  })

  // ── PORTE 2 : la suppression suivie d'un retrait de fichier.
  const fichierSansLecture = `
    async function supprimer(piece) {
      const { error } = await supabase.from('pieces').delete().eq('id', piece.id)
      if (error) return messageErreur(error)
      await retirerFichiers('pieces', [piece.storage_path], 'Écran')
    }
  `
  const fichierParLeStockage = `
    async function supprimer(doc) {
      const { error } = await supabase.from('documents_divers').delete().eq('id', doc.id)
      if (!error) await supabase.storage.from('pieces').remove([doc.storage_path])
    }
  `
  const fichierApresLecture = `
    async function supprimer(piece) {
      const { data, error } = await supabase.from('pieces').delete().eq('id', piece.id).select('id').maybeSingle()
      if (error) return messageErreur(error)
      if (!data) return AUCUNE_PIECE_SUPPRIMEE
      await retirerFichiers('pieces', [piece.storage_path], 'Écran')
    }
  `
  const sansFichier = `
    async function retirer(id) {
      const { error } = await supabase.from('regles').delete().eq('id', id)
      if (error) window.alert(messageErreur(error))
    }
    async function autre(doc) {
      await retirerFichiers('pieces', [doc.storage_path], 'Écran')
    }
  `

  it('PORTE 2 — attrape le fichier retiré sur la seule absence d’erreur, par les deux chemins de retrait', () => {
    expect(suppressionsSansLecture(fichierSansLecture)).toHaveLength(1)
    expect(suppressionsSansLecture(fichierParLeStockage)).toHaveLength(1)
  })

  it('PORTE 2 — laisse passer la ligne lue avant le fichier, et le retrait d’un AUTRE bloc', () => {
    expect(suppressionsSansLecture(fichierApresLecture)).toEqual([])
    expect(suppressionsSansLecture(sansFichier)).toEqual([])
  })
})
