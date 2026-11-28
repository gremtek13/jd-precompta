import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER — LE SCANNER (audit des courses du 28/11/2026, lib/derniereLecture.ts).
//
// Deux formes, et elles seules, se voient sans faux positif massif :
//   - un EFFET qui attend une lecture (`await`, `.then`) puis écrit un état : sa clé peut changer, ou l'écran se démonter,
//     pendant la lecture ; il porte un drapeau d'annulation (`let annule`, `fermee`, `estPerimee`) ou un numéro de lecture ;
//   - une FONCTION DE LECTURE qu'un effet appelle (`load`, `charger`, `relire…`), et qui attend puis écrit : un geste
//     l'appelle aussi, et deux appels se chevauchent sans que la clé de l'effet change. Elle porte un numéro de lecture —
//     `useDerniereLecture` ou un compteur `++x.current` comparé. (Comparer la clé lue à celle affichée, `dossierAffiche.current
//     ===`, ne suffit pas : deux lectures de la MÊME clé se chevauchent encore.) Avec `useDerniereLecture`, le scanner vérifie aussi la PLACE : chaque écriture d'état qui
//     suit une attente est précédée, depuis cette attente, d'un `if (!témoin()) return` (ou vit sous `if (témoin())`).
//
// Ce qu'il ne voit pas, et c'est dit : une fonction de lecture qu'aucun effet n'appelle (une relecture après un geste seulement,
// sérialisée par le verrou du geste — verrousEcritures.test.ts) ; la place d'un drapeau `let annule` dans un effet (la forme
// établie depuis le 21/09/2026, éprouvée par les tests de course des écrans) ; une écriture par un rappel passé en propriété.
//
// Il part de TOUTE la source de production (pages, composants, contextes, lib) ; une exception porte sa raison et le nombre
// d'endroits qu'elle couvre ; un plancher distingue « zéro faute » d'« aveugle » ; un défaut planté prouve qu'il voit.

type Source = { chemin: string; texte: string }
type Unite = {
  cle: string
  ligne: number
  genre: 'effet' | 'fonction'
  garde: 'drapeau' | 'temoin' | 'compteur' | null
  /** Les écritures d'état qu'aucune garde du témoin ne précède depuis la dernière attente (forme `useDerniereLecture`). */
  malPlacees: number[]
}

const GARDE_DRAPEAU = /\b(annule|annulee|fermee|cancelled|perimee|estPerimee)\b/
const GARDE_COMPTEUR = /\+\+[\w.]+\.current\b[\s\S]*[!=]==\s*[\w.]+\.current\b|[\w.]+\.current\s*[!=]==\s*(numero|no|jeton|sien|generation)\w*\b/

const estFonction = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)
const estSetter = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^set[A-Z]/.test(n.expression.text)
const estAttente = (n: ts.Node) =>
  ts.isAwaitExpression(n) || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'then')

/** Attend-elle, puis écrit-elle un état ? (Les rappels imbriqués comptent : `.then((r) => setX(r))`.) */
function attendPuisEcrit(corps: ts.Node): boolean {
  let premiere = Infinity
  let ecrit = false
  ;(function v(m: ts.Node) {
    if (estAttente(m)) premiere = Math.min(premiere, m.getStart())
    if (estSetter(m) && m.getStart() > premiere) ecrit = true
    ts.forEachChild(m, v)
  })(corps)
  return ecrit
}

/** Les écritures d'état d'une fonction à témoin qu'aucun `if (!témoin()) return` ne précède depuis la dernière attente. */
function ecrituresMalPlacees(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration, temoin: string): number[] {
  // Une attente dans un bloc qui finit par `return` (ou `throw`) ne précède que ce qui est dans ce bloc : la suite n'y passe pas.
  const attentes: { fin: number; bloc: ts.Block | null }[] = []
  const gardes: number[] = []
  const setters: ts.CallExpression[] = []
  const appelDuTemoin = (e: ts.Expression) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === temoin
  const blocQuiSort = (n: ts.Node): ts.Block | null => {
    for (let p = n.parent; p && p !== fn; p = p.parent) {
      if (ts.isBlock(p)) {
        const derniere = p.statements[p.statements.length - 1]
        return derniere && (ts.isReturnStatement(derniere) || ts.isThrowStatement(derniere)) ? p : null
      }
    }
    return null
  }
  ;(function v(m: ts.Node) {
    if (m !== fn && estFonction(m)) return
    if (ts.isAwaitExpression(m)) attentes.push({ fin: m.getEnd(), bloc: blocQuiSort(m) })
    if (ts.isIfStatement(m) && ts.isPrefixUnaryExpression(m.expression) && m.expression.operator === ts.SyntaxKind.ExclamationToken
      && appelDuTemoin(m.expression.operand) && /^\{?\s*return\b/.test(m.thenStatement.getText(sf))) gardes.push(m.getStart())
    if (estSetter(m)) setters.push(m)
    ts.forEachChild(m, v)
  })(fn)
  const sousLeTemoin = (s: ts.Node) => {
    for (let p = s.parent; p && p !== fn; p = p.parent) {
      if (ts.isIfStatement(p) && appelDuTemoin(p.expression) && p.thenStatement.getStart() <= s.getStart() && s.getEnd() <= p.thenStatement.getEnd()) return true
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && appelDuTemoin(p.left)) return true
    }
    return false
  }
  const fautes: number[] = []
  for (const s of setters) {
    const avant = attentes
      .filter((a) => a.fin <= s.getStart() && (a.bloc === null || (a.bloc.getStart() <= s.getStart() && s.getEnd() <= a.bloc.getEnd())))
      .map((a) => a.fin)
    if (avant.length === 0) continue
    const derniere = Math.max(...avant)
    if (gardes.some((g) => g >= derniere && g < s.getStart())) continue
    if (sousLeTemoin(s)) continue
    fautes.push(sf.getLineAndCharacterOfPosition(s.getStart()).line + 1)
  }
  return fautes
}

function gardeDe(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration, temoins: Set<string>): Pick<Unite, 'garde' | 'malPlacees'> {
  const texte = fn.getText(sf)
  // Le témoin d'une lecture : `const x = commencer…()` où `commencer…` vient de `useDerniereLecture()`.
  for (const d of texte.matchAll(/\bconst (\w+) = (\w+)\(\)/g)) {
    if (temoins.has(d[2])) return { garde: 'temoin', malPlacees: ecrituresMalPlacees(sf, fn, d[1]) }
  }
  if (GARDE_COMPTEUR.test(texte)) return { garde: 'compteur', malPlacees: [] }
  if (GARDE_DRAPEAU.test(texte)) return { garde: 'drapeau', malPlacees: [] }
  return { garde: null, malPlacees: [] }
}

export function analyser(sources: readonly Source[]): { fichiers: number; unites: Unite[] } {
  const unites: Unite[] = []
  for (const { chemin, texte } of sources) {
    const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const ligne = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
    // Les compteurs de `useDerniereLecture()` du fichier.
    const temoins = new Set<string>()
    for (const d of texte.matchAll(/\bconst (\w+) = useDerniereLecture\(\)/g)) temoins.add(d[1])
    // Les fonctions nommées du fichier (déclaration, constante, `useCallback`), et les noms qu'un effet appelle.
    const nommees = new Map<string, ts.FunctionLikeDeclaration[]>()
    const appelees = new Set<string>()
    ;(function v(n: ts.Node) {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) (nommees.get(n.name.text) ?? nommees.set(n.name.text, []).get(n.name.text)!).push(n)
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let init: ts.Node = n.initializer
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useCallback' && init.arguments[0]) init = init.arguments[0]
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) {
          (nommees.get(n.name.text) ?? nommees.set(n.name.text, []).get(n.name.text)!).push(init)
        }
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useEffect' && n.arguments[0] && estFonction(n.arguments[0])) {
        const effet = n.arguments[0]
        if (effet.body && attendPuisEcrit(effet.body)) {
          const g = gardeDe(sf, effet, temoins)
          unites.push({ cle: `${chemin} › effet :${ligne(n)}`, ligne: ligne(n), genre: 'effet', ...g })
        }
        ;(function appels(m: ts.Node) {
          if (ts.isCallExpression(m) && ts.isIdentifier(m.expression)) appelees.add(m.expression.text)
          ts.forEachChild(m, appels)
        })(effet)
      }
      ts.forEachChild(n, v)
    })(sf)
    for (const nom of appelees) {
      // Un composant ou un crochet n'est pas une fonction de lecture : ses effets sont jugés pour eux-mêmes.
      if (/^([A-Z]|use[A-Z]|set[A-Z])/.test(nom)) continue
      for (const fn of nommees.get(nom) ?? []) {
        if (!fn.body || !attendPuisEcrit(fn.body)) continue
        unites.push({ cle: `${chemin} › ${nom}`, ligne: ligne(fn), genre: 'fonction', ...gardeDe(sf, fn, temoins) })
      }
    }
  }
  return { fichiers: sources.length, unites }
}

// Les exceptions : une clé (`fichier › nom` ou `fichier › effet`), sa raison, et le nombre d'unités qu'elle couvre.
const EXCEPTIONS: Record<string, { raison: string; nombre: number }> = {
  // La session de l'application : le fournisseur racine ne se démonte jamais et n'a pas de clé ; `getSession` donne la
  // session du départ, `onAuthStateChange` ses changements, et l'un comme l'autre la pose ENTIÈRE (rien ne se mêle). Un
  // événement arrivé avant la réponse de `getSession` serait recouvert par elle : le domaine de l'authentification, hors de
  // l'audit des écrans (rapport du 28/11/2026), à juger à part plutôt qu'à garder ici en passant.
  'src/context/AuthContext.tsx › effet': { raison: 'la session et ses événements, hors des écrans', nombre: 1 },
}

export function fautesDe(a: ReturnType<typeof analyser>, exceptions: typeof EXCEPTIONS): string[] {
  const fautes: string[] = []
  for (const u of a.unites) {
    const exception = Object.keys(exceptions).find((cle) => u.cle.startsWith(cle))
    const ou = u.genre === 'effet' ? u.cle : `${u.cle} :${u.ligne}`
    if (u.garde === null && !exception) fautes.push(`${ou} — ${u.genre} qui attend puis écrit, sans garde`)
    for (const l of u.malPlacees) fautes.push(`${u.cle} :${l} — écriture d'état après une attente, sans « if (!témoin()) return » depuis`)
  }
  for (const [cle, { nombre }] of Object.entries(exceptions)) {
    const couvertes = a.unites.filter((u) => u.cle.startsWith(cle) && u.garde === null).length
    if (couvertes !== nombre) fautes.push(`exception ${cle} : ${couvertes} unités sans garde au lieu de ${nombre}`)
  }
  return fautes
}

// ── Le dépôt ───────────────────────────────────────────────────────────────────────────────────────────────────────

const RACINE = new URL('../../', import.meta.url)

function sourcesDeProduction(): Source[] {
  const sortie: Source[] = []
  ;(function parcourir(dossier: string) {
    for (const e of readdirSync(new URL(dossier, RACINE), { withFileTypes: true })) {
      const chemin = `${dossier}${e.name}`
      if (e.isDirectory()) { if (chemin !== 'src/test') parcourir(`${chemin}/`) }
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) sortie.push({ chemin, texte: readFileSync(new URL(chemin, RACINE), 'utf8') })
    }
  })('src/')
  return sortie
}

let memo: ReturnType<typeof analyser> | null = null
const analyseDuDepot = () => (memo ??= analyser(sourcesDeProduction()))

// Deux cents fichiers parcourus par l'analyseur de TypeScript : la première lecture dépasse les cinq secondes sous la charge.
describe('une lecture plus lente n’écrit pas en dernier : chaque effet et chaque fonction de lecture qu’il appelle est gardé', { timeout: 120_000 }, () => {
  it('parcourt toute la source de production — plancher : sinon « zéro faute » se confondrait avec « aveugle »', () => {
    const a = analyseDuDepot()
    expect(a.fichiers).toBeGreaterThan(400)
    expect(a.unites.filter((u) => u.genre === 'effet').length).toBeGreaterThanOrEqual(120)
    expect(a.unites.filter((u) => u.genre === 'fonction').length).toBeGreaterThanOrEqual(35)
    expect(a.unites.filter((u) => u.garde === 'temoin').length).toBeGreaterThanOrEqual(25)
    expect(a.unites.filter((u) => u.garde === 'compteur').length).toBeGreaterThanOrEqual(5)
  })

  it('reconnaît les formes de garde, sur des unités qu’on connaît', () => {
    const garde = (cle: string) => analyseDuDepot().unites.find((u) => u.cle === cle)?.garde
    expect(garde('src/pages/dossier/CotisationsTab.tsx › load')).toBe('temoin')
    expect(garde('src/pages/dossier/PiecesTab.tsx › load')).toBe('compteur')
    expect(garde('src/pages/dossier/PacksTab.tsx › loadPreview')).toBe('drapeau')
    expect(garde('src/pages/dossier/TransmissionFactureModal.tsx › lireCanaux')).toBe('temoin')
    expect(garde('src/pages/dossier/EreportingModal.tsx › effet :182')).toBe('drapeau')
  })

  it('ne trouve aucune faute', () => {
    expect(fautesDe(analyseDuDepot(), EXCEPTIONS)).toEqual([])
  })
})

describe('le scanner des courses voit un défaut planté', () => {
  const juger = (texte: string) => fautesDe(analyser([{ chemin: 'src/pages/Plante.tsx', texte }]), {})
  const LOAD_NU = `
    function Ecran({ id }: { id: string }) {
      const [x, setX] = useState(0)
      async function load() { const r = await lire(id); setX(r) }
      useEffect(() => { load() }, [id])
      return null
    }`

  it('une fonction de lecture qu’un effet appelle, sans garde, est une faute', () => {
    expect(juger(LOAD_NU)).toEqual(['src/pages/Plante.tsx › load :4 — fonction qui attend puis écrit, sans garde'])
  })

  it('un effet qui écrit après une lecture, sans drapeau, est une faute', () => {
    expect(juger(`function E({ id }) { const [x, setX] = useState(0)
      useEffect(() => { lire(id).then((r) => setX(r)) }, [id]) }`)).toEqual(['src/pages/Plante.tsx › effet :2 — effet qui attend puis écrit, sans garde'])
  })

  it('le témoin posé, mais une écriture après une seconde attente sans sa garde : la place est une faute', () => {
    expect(juger(`function E({ id }) {
      const commencer = useDerniereLecture()
      const [x, setX] = useState(0)
      async function load() {
        const courante = commencer()
        const a = await lire(id)
        if (!courante()) return
        setX(a)
        const b = await lire(id)
        setX(b)
      }
      useEffect(() => { load() }, [id]) }`)).toEqual(["src/pages/Plante.tsx › load :10 — écriture d'état après une attente, sans « if (!témoin()) return » depuis"])
  })

  it('les gardes symétriques : le témoin bien placé, le drapeau, le compteur ne sont pas des fautes', () => {
    expect(juger(`function E({ id }) {
      const commencer = useDerniereLecture()
      const [x, setX] = useState(0)
      async function load() {
        const courante = commencer()
        const a = await lire(id)
        if (!courante()) return
        setX(a)
        const b = await lire(id)
        if (courante()) setX(b)
      }
      useEffect(() => { load() }, [id]) }`)).toEqual([])
    expect(juger(`function E({ id }) { const [x, setX] = useState(0)
      useEffect(() => { let annule = false; lire(id).then((r) => { if (!annule) setX(r) }); return () => { annule = true } }, [id]) }`)).toEqual([])
    expect(juger(`function E({ id }) { const no = useRef(0); const [x, setX] = useState(0)
      async function load() { const n = ++no.current; const r = await lire(id); if (n !== no.current) return; setX(r) }
      useEffect(() => { load() }, [id]) }`)).toEqual([])
  })
})
