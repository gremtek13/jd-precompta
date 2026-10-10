import { readFileSync, readdirSync } from 'node:fs'
import { posix } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

// LES ANCIENNES COLONNES DES NOTES NE S'ÉCRIVENT ET NE SE LISENT PLUS (espace client, étape P0, 09/10/2026).
//
// `pieces.notes` et `documents_divers.notes` portaient les « Notes internes » du cabinet dans des tables que le client du
// dossier LIT : aucun écran ne les lui montrait, son navigateur les recevait. Elles vivent désormais dans
// `notes_internes`, que le cabinet seul lit (migration notes_internes_du_cabinet) ; `dossiers.notes`, jamais remplie,
// attend avec elles sa suppression (EC-Q7). D'ici là, les trois colonnes existent : une écriture qui y reviendrait
// rendrait au client ce qu'on vient de lui retirer, et une lecture montrerait une note PÉRIMÉE — la reprise d'une note
// ne touche plus que `notes_internes`. Rien d'autre que ce test ne le verrait : les tests d'écran doublent Supabase.
//
// TROIS RÈGLES, qui ne se recouvrent pas :
//   E. Aucune écriture (`insert`, `update`, `upsert`) visant l'une des trois tables ne porte la clé `notes`. Le scanner
//      lit l'ARBRE SYNTAXIQUE, jamais la ligne : il suit l'objet écrit à travers les variables (à leur portée), les
//      déversements (`...x`), les conditions, `.map`, et les fonctions — celles du fichier comme celles qu'il importe
//      d'un autre module du dépôt —, un paramètre se lisant dans l'argument de l'appel qui y a mené, ou à défaut dans
//      tous les appels de sa fonction (`enregistrer('pieces', {…})`). Ce qu'il ne sait pas suivre — une table qu'il ne
//      sait pas nommer, une clé calculée, une méthode, une écriture hors d'une chaîne `.from(…)` — est une faute, sauf
//      exception qui porte sa raison et son NOMBRE.
//   K. Dans toute la source de production, la clé `notes` n'apparaît que dans les fichiers nommés ci-dessous, au nombre
//      près, chacun pour la note d'une AUTRE table. Elle ferme ce que la règle E laisse passer en exception, et
//      `Object.assign(ligne, { notes })`.
//   L. Aucune lecture `.notes` hors de ces fichiers, au nombre près — ce qui attrape aussi `ligne.notes = …` — ; et aucun
//      `select` des trois tables ne nomme la colonne. Un `select('*')` la rapporte encore, mais elle ne s'y lit plus.
//
// Ce que ce test ne voit pas : une fonction SQL qui écrirait la colonne (aucune ne le fait au 09/10/2026 : seules
// `enregistrer_facture`, pour la note d'une facture, et `garder_piece_validee`, qui la range parmi les colonnes libres
// d'une pièce validée, nomment `notes`) — la migration qui supprimera les colonnes le vérifie au catalogue.
//
// LA DOCTRINE DES SCANNERS (CLAUDE.md) : il part de TOUT `src/` et des Edge Functions, une forme non reconnue est une
// faute, une exception porte sa raison et son nombre, un plancher distingue « zéro faute » d'« aveugle », et il est
// éprouvé par des défauts plantés (plus bas).

export const TABLES_AUX_ANCIENNES_NOTES: readonly string[] = ['pieces', 'documents_divers', 'dossiers']
const COLONNE = 'notes'

/**
 * Les écritures des trois tables (ou d'une table que le scanner ne sait pas nommer) qu'il ne sait pas suivre jusqu'au
 * bout, par fichier : leur NOMBRE, et la raison pour laquelle elles ne portent pas la colonne. Une de plus est une
 * écriture nouvelle à juger ; une de moins, une raison morte.
 */
export const EXCEPTIONS_ECRITURES: Record<string, { nombre: number; raison: string }> = {
  'src/lib/sauvegardeDonnees.ts': {
    nombre: 2,
    raison: 'La restauration : l’insertion par lots de chaque table du plan, et la seconde passe des liens auto-référencés '
      + '(factures_emises seule). Les lignes viennent de la sauvegarde, et `planReinsertion` les écrit sans les anciennes '
      + 'colonnes des notes (`sansAnciennesNotes`, éprouvé dans sauvegarde.test.ts).',
  },
}

/** Les fichiers qui posent une clé `notes` — celle d'une autre table —, au nombre près (règle K). */
export const CLES_NOTES_ADMISES: Record<string, { nombre: number; table: string }> = {
  'src/lib/factures.ts': { nombre: 1, table: 'factures_emises (la note d’un avoir, par enregistrer_facture)' },
  'src/lib/informationsDossier.ts': { nombre: 1, table: 'informations_dossier' },
  'src/pages/ClientInformations.tsx': { nombre: 1, table: 'informations_dossier (la saisie du client)' },
  'src/pages/dossier/InformationsTab.tsx': { nombre: 1, table: 'informations_dossier (la saisie du cabinet)' },
  'src/pages/dossier/FactureFormModal.tsx': { nombre: 1, table: 'factures_emises (par enregistrer_facture)' },
  'src/pages/dossier/SupplementsTab.tsx': { nombre: 1, table: 'supplements' },
  'src/lib/devis.ts': { nombre: 1, table: 'devis (les notes PARTAGÉES d’un devis, par enregistrer_devis ; espace client P5)' },
}

/** Les fichiers qui lisent un `.notes` — celui d'une autre table —, au nombre près (règle L). */
export const LECTURES_NOTES_ADMISES: Record<string, { nombre: number; table: string }> = {
  'src/lib/informationsDossier.ts': { nombre: 1, table: 'informations_dossier (la saisie du formulaire)' },
  'src/pages/ClientInformations.tsx': { nombre: 1, table: 'informations_dossier' },
  'src/pages/dossier/InformationsTab.tsx': { nombre: 1, table: 'informations_dossier' },
  'src/pages/dossier/FactureFormModal.tsx': { nombre: 1, table: 'factures_emises' },
  'src/pages/dossier/SupplementsTab.tsx': { nombre: 1, table: 'supplements' },
  'src/lib/devis.ts': { nombre: 1, table: 'devis (la saisie du formulaire d’un devis ; espace client P5)' },
}

export interface Source { chemin: string; texte: string }

function fichiers(dossier: URL, garder: (nom: string) => boolean): { chemin: string; texte: string }[] {
  const sortie: { chemin: string; texte: string }[] = []
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) sortie.push(...fichiers(new URL(`${e.name}/`, dossier), garder))
    else if (garder(e.name)) sortie.push({ chemin: new URL(e.name, dossier).pathname, texte: readFileSync(new URL(e.name, dossier), 'utf8') })
  }
  return sortie
}

/** Toute source de production : l'application (hors tests et outillage de test) et les Edge Functions. */
export function sourcesDeProduction(): Source[] {
  const racine = new URL('../../', import.meta.url)
  const appli = fichiers(new URL('src/', racine), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .filter((f) => !f.chemin.includes('/src/test/'))
  const fonctions = fichiers(new URL('supabase/functions/', racine), (n) => /\.(ts|tsx)$/.test(n))
  return [...appli, ...fonctions].map((f) => ({ chemin: f.chemin.replace(racine.pathname, ''), texte: f.texte }))
}

// ── L'arbre syntaxique ───────────────────────────────────────────────────────────────────────────────────────────

interface Fichier {
  chemin: string
  sf: ts.SourceFile
  /** Les appels d'une fonction par un simple nom, par ce nom. */
  appels: Map<string, ts.CallExpression[]>
  /** Les affectations `x = …` d'un nom (une variable `let` peut changer d'objet). */
  affectations: Map<string, ts.Expression[]>
  /** Les noms qu'il importe ou ré-exporte d'un module du dépôt : nom local → module et nom exporté. */
  imports: Map<string, { module: string; nom: string }>
}

function lire(source: Source): Fichier {
  const sf = ts.createSourceFile(source.chemin, source.texte, ts.ScriptTarget.ES2022, true,
    source.chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const f: Fichier = { chemin: source.chemin, sf, appels: new Map(), affectations: new Map(), imports: new Map() }
  const ajouter = <T>(m: Map<string, T[]>, cle: string, v: T) => m.set(cle, [...(m.get(cle) ?? []), v])
  const visiter = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) ajouter(f.appels, n.expression.text, n)
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
      ajouter(f.affectations, n.left.text, n.right)
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith('.')
      && n.importClause && !n.importClause.isTypeOnly) {
      const module = n.moduleSpecifier.text
      if (n.importClause.name) f.imports.set(n.importClause.name.text, { module, nom: 'default' })
      const liens = n.importClause.namedBindings
      if (liens && ts.isNamedImports(liens)) {
        for (const el of liens.elements) f.imports.set(el.name.text, { module, nom: (el.propertyName ?? el.name).text })
      }
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)
      && n.exportClause && ts.isNamedExports(n.exportClause)) {
      for (const el of n.exportClause.elements) {
        f.imports.set(el.name.text, { module: n.moduleSpecifier.text, nom: (el.propertyName ?? el.name).text })
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(sf)
  return f
}

/** Les sources, lues une fois chacune, et les modules du dépôt résolus par leur chemin relatif. */
export class Monde {
  private readonly textes = new Map<string, string>()
  private readonly lus = new Map<string, Fichier>()
  constructor(sources: readonly Source[]) {
    for (const s of sources) this.textes.set(s.chemin, s.texte)
  }
  get chemins(): string[] { return [...this.textes.keys()] }
  fichier(chemin: string): Fichier | null {
    const deja = this.lus.get(chemin)
    if (deja) return deja
    const texte = this.textes.get(chemin)
    if (texte === undefined) return null
    const f = lire({ chemin, texte })
    this.lus.set(chemin, f)
    return f
  }
  /** Le fichier et la déclaration de premier niveau que désigne un nom importé, ré-exportations nommées comprises. */
  importe(f: Fichier, nomLocal: string, profondeur = 0): { f: Fichier; decl: Declaration } | null {
    const imp = f.imports.get(nomLocal)
    if (!imp || profondeur > 8) return null
    const base = posix.normalize(posix.join(posix.dirname(f.chemin), imp.module))
    for (const chemin of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      const cible = this.fichier(chemin)
      if (!cible) continue
      const decl = declarationDeHaut(cible, imp.nom)
      if (decl) return { f: cible, decl }
      return cible.imports.has(imp.nom) ? this.importe(cible, imp.nom, profondeur + 1) : null
    }
    return null
  }
  /** Les appels, dans les AUTRES fichiers, d'une fonction de premier niveau qu'ils importent. */
  appelsAilleurs(f: Fichier, nom: string): { f: Fichier; appel: ts.CallExpression }[] {
    const sortie: { f: Fichier; appel: ts.CallExpression }[] = []
    for (const chemin of this.chemins) {
      const autre = this.fichier(chemin)!
      if (autre === f) continue
      for (const [local, imp] of autre.imports) {
        if (imp.nom !== nom) continue
        const vise = this.importe(autre, local)
        if (vise?.f === f) sortie.push(...(autre.appels.get(local) ?? []).map((appel) => ({ f: autre, appel })))
      }
    }
    return sortie
  }
}

/** Ce qu'un nom désigne à l'endroit où il est lu. */
type Declaration =
  | { genre: 'variable'; decl: ts.VariableDeclaration }
  | { genre: 'fonction'; decl: ts.FunctionLikeDeclaration }
  | { genre: 'parametre'; fonction: ts.SignatureDeclaration; rang: number; decl: ts.ParameterDeclaration }
  | { genre: 'importe' }
  | { genre: 'autre'; quoi: string }

function sansEnveloppe(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)
    || ts.isTypeAssertionExpression(e) || ts.isAwaitExpression(e)) e = e.expression
  return e
}

const estFonction = (e: ts.Expression | undefined): e is ts.ArrowFunction | ts.FunctionExpression =>
  !!e && (ts.isArrowFunction(sansEnveloppe(e)) || ts.isFunctionExpression(sansEnveloppe(e)))

/** La déclaration d'un nom parmi des instructions d'une même portée. */
function declarationParmi(instructions: readonly ts.Statement[], nom: string): Declaration | null {
  for (const s of instructions) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === nom) return { genre: 'fonction', decl: s }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === nom) {
          return estFonction(d.initializer)
            ? { genre: 'fonction', decl: sansEnveloppe(d.initializer!) as ts.ArrowFunction | ts.FunctionExpression }
            : { genre: 'variable', decl: d }
        }
        if (!ts.isIdentifier(d.name) && nomsDuMotif(d.name).includes(nom)) return { genre: 'autre', quoi: `${nom} déstructuré` }
      }
    }
  }
  return null
}

function nomsDuMotif(motif: ts.BindingName): string[] {
  if (ts.isIdentifier(motif)) return [motif.text]
  return motif.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : nomsDuMotif(el.name)))
}

function declarationDeHaut(f: Fichier, nom: string): Declaration | null {
  return declarationParmi(f.sf.statements, nom)
}

/** La déclaration que désigne un identifiant, de la portée la plus proche à celle du fichier. */
function declarationDe(f: Fichier, id: ts.Identifier): Declaration {
  const nom = id.text
  for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) {
      const parametres = (p as ts.SignatureDeclaration).parameters
      const rang = parametres.findIndex((q) => nomsDuMotif(q.name).includes(nom))
      if (rang >= 0) {
        return ts.isIdentifier(parametres[rang].name)
          ? { genre: 'parametre', fonction: p as ts.SignatureDeclaration, rang, decl: parametres[rang] }
          : { genre: 'autre', quoi: `${nom}, paramètre déstructuré` }
      }
    }
    const instructions = ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)
      ? p.statements : null
    if (instructions) {
      const trouvee = declarationParmi(instructions, nom)
      if (trouvee) return trouvee
    }
    if ((ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer
      && ts.isVariableDeclarationList(p.initializer)) {
      for (const d of p.initializer.declarations) {
        if (nomsDuMotif(d.name).includes(nom)) return { genre: 'autre', quoi: `${nom}, variable d’une boucle` }
      }
    }
    if (ts.isCatchClause(p) && p.variableDeclaration && nomsDuMotif(p.variableDeclaration.name).includes(nom)) {
      return { genre: 'autre', quoi: `${nom}, erreur attrapée` }
    }
  }
  return f.imports.has(nom) ? { genre: 'importe' } : { genre: 'autre', quoi: `${nom}, nom sans déclaration` }
}

/** Le nom sous lequel une fonction s'appelle, s'il y en a un. */
function nomDeLaFonction(fn: ts.SignatureDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text
  let p: ts.Node = fn.parent
  while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) p = p.parent
  return ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null
}

/**
 * Les appels d'une fonction : ceux de son fichier dont le nom la désigne bien (à sa portée), et, si elle est de premier
 * niveau, ceux des fichiers qui l'importent.
 */
function appelsDe(monde: Monde, f: Fichier, fn: ts.SignatureDeclaration): { f: Fichier; appel: ts.CallExpression }[] {
  const nom = nomDeLaFonction(fn)
  if (nom === null) return []
  const ici = (f.appels.get(nom) ?? []).filter((appel) => {
    const d = declarationDe(f, appel.expression as ts.Identifier)
    return d.genre === 'fonction' && d.decl === fn
  }).map((appel) => ({ f, appel }))
  const haut = declarationDeHaut(f, nom)
  return haut?.genre === 'fonction' && haut.decl === fn ? [...ici, ...monde.appelsAilleurs(f, nom)] : ici
}

/** Les expressions qu'une fonction rend. */
function retoursDe(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return []
  if (!ts.isBlock(fn.body)) return [fn.body as ts.Expression]
  const retours: ts.Expression[] = []
  const chercher = (n: ts.Node) => {
    if (n !== fn.body && ts.isFunctionLike(n)) return
    if (ts.isReturnStatement(n) && n.expression) retours.push(n.expression)
    ts.forEachChild(n, chercher)
  }
  chercher(fn.body)
  return retours
}

const ligneDe = (f: Fichier, n: ts.Node) => f.sf.getLineAndCharacterOfPosition(n.getStart(f.sf)).line + 1
const texteDe = (f: Fichier, n: ts.Node) => n.getText(f.sf).replace(/\s+/g, ' ').slice(0, 60)

// ── Suivre une valeur ────────────────────────────────────────────────────────────────────────────────────────────

/** Où l'on lit : le fichier, et les appels qui ont mené ici (le paramètre d'une fonction suivie se lit dans CET appel). */
interface Contexte {
  monde: Monde
  f: Fichier
  liaisons: ReadonlyMap<ts.SignatureDeclaration, { appel: ts.CallExpression; ctx: Contexte }>
  profondeur: number
}

const PROFONDEUR_MAX = 40

/** Le contexte d'une fonction suivie depuis un appel : ses paramètres sont liés aux arguments de cet appel. */
function entrer(ctx: Contexte, f: Fichier, fn: ts.SignatureDeclaration, appel: ts.CallExpression, appelant: Contexte): Contexte {
  return { monde: ctx.monde, f, liaisons: new Map(ctx.liaisons).set(fn, { appel, ctx: appelant }), profondeur: ctx.profondeur + 1 }
}

/**
 * Les valeurs qu'un paramètre peut recevoir : l'argument de l'appel qui a mené ici, sinon celui de chaque appel de sa
 * fonction (dans son fichier, et dans ceux qui l'importent) ; null quand aucun appel ne se lit.
 */
function argumentsDu(ctx: Contexte, p: Extract<Declaration, { genre: 'parametre' }>): { ctx: Contexte; arg: ts.Expression | 'illisible' }[] | null {
  const lie = ctx.liaisons.get(p.fonction)
  const appels = lie
    ? [{ appel: lie.appel, ctx: lie.ctx }]
    : appelsDe(ctx.monde, ctx.f, p.fonction)
      .map(({ f, appel }) => ({ appel, ctx: { ...ctx, f, liaisons: new Map(), profondeur: ctx.profondeur + 1 } }))
  if (appels.length === 0) return null
  return appels.map(({ appel, ctx: c }) => {
    const arg = appel.arguments[p.rang]
    const deverse = appel.arguments.slice(0, p.rang + 1).some(ts.isSpreadElement)
    return { ctx: c, arg: deverse ? 'illisible' : (arg ?? p.decl.initializer ?? 'illisible') }
  })
}

/** Ce qu'une expression écrite porte : ses clés, et ce qui ne se suit pas. */
interface Analyse { cles: Set<string>; illisibles: string[] }

function clesEcrites(ctx: Contexte, e0: ts.Expression, analyse: Analyse, enCours: Set<ts.Node>): void {
  const e = sansEnveloppe(e0)
  if (enCours.has(e)) return
  if (ctx.profondeur > PROFONDEUR_MAX) { analyse.illisibles.push(`trop profond : ${texteDe(ctx.f, e)}`); return }
  enCours.add(e)
  try {
    suivre(ctx, e, analyse, enCours)
  } finally {
    enCours.delete(e)
  }
}

function suivre(ctx: Contexte, e: ts.Expression, analyse: Analyse, enCours: Set<ts.Node>): void {
  const f = ctx.f
  const recurser = (x: ts.Expression, c: Contexte = ctx) => clesEcrites(c, x, analyse, enCours)
  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isShorthandPropertyAssignment(p)) analyse.cles.add(p.name.text)
      else if (ts.isSpreadAssignment(p)) recurser(p.expression)
      else if (ts.isPropertyAssignment(p)) {
        const nom = p.name
        if (ts.isIdentifier(nom) || ts.isStringLiteral(nom) || ts.isNumericLiteral(nom) || ts.isNoSubstitutionTemplateLiteral(nom)) {
          analyse.cles.add(nom.text)
        } else if (ts.isComputedPropertyName(nom) && (ts.isStringLiteral(nom.expression) || ts.isNoSubstitutionTemplateLiteral(nom.expression))) {
          analyse.cles.add(nom.expression.text)
        } else analyse.illisibles.push(`clé calculée ${texteDe(f, nom)}`)
      } else analyse.illisibles.push(`membre ${texteDe(f, p)}`)
    }
    return
  }
  if (ts.isArrayLiteralExpression(e)) {
    for (const el of e.elements) recurser(ts.isSpreadElement(el) ? el.expression : el)
    return
  }
  if (ts.isConditionalExpression(e)) {
    recurser(e.whenTrue)
    recurser(e.whenFalse)
    return
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) { recurser(e.left); recurser(e.right); return }
    // `ok && { … }` : la gauche n'est déversée que fausse, donc sans clé.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) { recurser(e.right); return }
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isIdentifier(e) && e.text === 'undefined')) return
  if (ts.isIdentifier(e)) {
    const d = declarationDe(f, e)
    if (d.genre === 'variable') {
      if (d.decl.initializer) recurser(d.decl.initializer)
      const changeante = (d.decl.parent.flags & ts.NodeFlags.Const) === 0
      if (changeante) for (const a of f.affectations.get(e.text) ?? []) recurser(a)
      if (!d.decl.initializer && !(changeante && f.affectations.has(e.text))) analyse.illisibles.push(`variable ${e.text} sans valeur lisible`)
      return
    }
    if (d.genre === 'parametre') {
      const args = argumentsDu(ctx, d)
      if (args === null) { analyse.illisibles.push(`paramètre ${e.text} d’une fonction dont aucun appel ne se lit`); return }
      for (const { ctx: c, arg } of args) {
        if (arg === 'illisible') analyse.illisibles.push(`argument déversé ou absent pour ${e.text}`)
        else recurser(arg, c)
      }
      return
    }
    if (d.genre === 'importe') {
      const vise = ctx.monde.importe(f, e.text)
      if (vise?.decl.genre === 'variable' && vise.decl.decl.initializer) {
        recurser(vise.decl.decl.initializer, { ...ctx, f: vise.f, liaisons: new Map(), profondeur: ctx.profondeur + 1 })
      } else analyse.illisibles.push(`${e.text}, importé sans valeur lisible`)
      return
    }
    analyse.illisibles.push(d.genre === 'autre' ? d.quoi : `${e.text}, une fonction et non un objet`)
    return
  }
  if (ts.isCallExpression(e)) {
    const appele = sansEnveloppe(e.expression)
    if (ts.isIdentifier(appele)) {
      const d = declarationDe(f, appele)
      const cible = d.genre === 'fonction' ? { f, decl: d }
        : d.genre === 'importe' ? ctx.monde.importe(f, appele.text) : null
      if (cible?.decl.genre === 'fonction') {
        const fn = cible.decl.decl
        const dedans = entrer(ctx, cible.f, fn, e, ctx)
        const retours = retoursDe(fn)
        if (retours.length === 0) analyse.illisibles.push(`${appele.text}() ne rend rien de lisible`)
        for (const r of retours) recurser(r, dedans)
        return
      }
      analyse.illisibles.push(`appel de ${appele.text}()`)
      return
    }
    // `lignes.map((l) => ({ … }))` : ce que rend le rappel ; `.filter`, `.slice`, `.concat` : les éléments qu'on avait.
    if (ts.isPropertyAccessExpression(appele) && appele.name.text === 'map' && e.arguments.length >= 1
      && (ts.isArrowFunction(e.arguments[0]) || ts.isFunctionExpression(e.arguments[0]))) {
      const rappel = e.arguments[0]
      const retours = retoursDe(rappel)
      if (retours.length === 0) analyse.illisibles.push('rappel de .map() qui ne rend rien de lisible')
      for (const r of retours) recurser(r)
      return
    }
    if (ts.isPropertyAccessExpression(appele) && ['filter', 'slice', 'concat'].includes(appele.name.text)) {
      recurser(appele.expression)
      if (appele.name.text === 'concat') for (const a of e.arguments) recurser(ts.isSpreadElement(a) ? a.expression : a)
      return
    }
    analyse.illisibles.push(`appel de ${texteDe(f, appele)}()`)
    return
  }
  analyse.illisibles.push(`expression ${texteDe(f, e)}`)
}

/** Les tables qu'une expression `.from(…)` peut viser ; null : illisible. */
function tablesDe(ctx: Contexte, e0: ts.Expression, profondeur = 0): string[] | null {
  const e = sansEnveloppe(e0)
  if (profondeur > PROFONDEUR_MAX) return null
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text]
  if (ts.isConditionalExpression(e)) {
    const a = tablesDe(ctx, e.whenTrue, profondeur + 1)
    const b = tablesDe(ctx, e.whenFalse, profondeur + 1)
    return a && b ? [...a, ...b] : null
  }
  if (!ts.isIdentifier(e)) return null
  const d = declarationDe(ctx.f, e)
  if (d.genre === 'variable') {
    return d.decl.initializer && (d.decl.parent.flags & ts.NodeFlags.Const) !== 0
      ? tablesDe(ctx, d.decl.initializer, profondeur + 1) : null
  }
  if (d.genre === 'parametre') {
    // Un type fait de chaînes littérales nomme toutes les tables possibles, sans lire un appel.
    const type = d.decl.type
    const membres = type && ts.isUnionTypeNode(type) ? type.types : type ? [type] : []
    const litteraux = membres.map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null))
    if (litteraux.length > 0 && litteraux.every((t) => t !== null)) return litteraux as string[]
    const args = argumentsDu(ctx, d)
    if (args === null) return null
    const tables: string[] = []
    for (const { ctx: c, arg } of args) {
      const t = arg === 'illisible' ? null : tablesDe(c, arg, profondeur + 1)
      if (t === null) return null
      tables.push(...t)
    }
    return tables
  }
  if (d.genre === 'importe') {
    const vise = ctx.monde.importe(ctx.f, e.text)
    return vise?.decl.genre === 'variable' && vise.decl.decl.initializer
      ? tablesDe({ ...ctx, f: vise.f, liaisons: new Map() }, vise.decl.decl.initializer, profondeur + 1) : null
  }
  return null
}

/** La tête d'une chaîne d'appels : son `.from(…)` de table, le stockage, ou rien de reconnu. */
type Chaine = { genre: 'table'; from: ts.CallExpression; ctx: Contexte } | { genre: 'stockage' } | { genre: 'aucune' }

function chaineDe(ctx: Contexte, e: ts.Expression, profondeur = 0): Chaine {
  for (let x: ts.Expression = e; ;) {
    x = sansEnveloppe(x)
    if (ts.isCallExpression(x)) {
      const appele = sansEnveloppe(x.expression)
      if (ts.isPropertyAccessExpression(appele) && appele.name.text === 'from') {
        const recepteur = sansEnveloppe(appele.expression)
        return ts.isPropertyAccessExpression(recepteur) && recepteur.name.text === 'storage'
          ? { genre: 'stockage' } : { genre: 'table', from: x, ctx }
      }
      x = appele
    } else if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression
    else if (ts.isIdentifier(x) && profondeur < 8) {
      // `const requete = supabase.from('pieces')` puis `requete.update(…)` : la chaîne continue dans la variable.
      const d = declarationDe(ctx.f, x)
      return d.genre === 'variable' && d.decl.initializer ? chaineDe(ctx, d.decl.initializer, profondeur + 1) : { genre: 'aucune' }
    } else return { genre: 'aucune' }
  }
}

/** Une écriture : `.<insert|update|upsert>(<objet>)` au bout d'une chaîne `.from(<table>)`, ou hors de toute chaîne reconnue. */
export interface SiteEcriture {
  chemin: string
  ligne: number
  ecriture: 'insert' | 'update' | 'upsert'
  tables: string[] | null
  cles: string[]
  illisibles: string[]
}

export function sitesEcriture(monde: Monde, chemin: string): SiteEcriture[] {
  const f = monde.fichier(chemin)!
  const sites: SiteEcriture[] = []
  const visiter = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && ['insert', 'update', 'upsert'].includes(n.expression.name.text)) {
      const ctx: Contexte = { monde, f, liaisons: new Map(), profondeur: 0 }
      const chaine = chaineDe(ctx, n.expression.expression)
      if (chaine.genre !== 'stockage') {
        const tables = chaine.genre === 'table' && chaine.from.arguments[0] ? tablesDe(chaine.ctx, chaine.from.arguments[0]) : null
        const analyse: Analyse = { cles: new Set(), illisibles: [] }
        if (chaine.genre === 'aucune') analyse.illisibles.push('écriture hors d’une chaîne .from(…)')
        if (n.arguments[0]) clesEcrites(ctx, n.arguments[0], analyse, new Set())
        else analyse.illisibles.push('écriture sans objet')
        sites.push({
          chemin, ligne: ligneDe(f, n), ecriture: n.expression.name.text as SiteEcriture['ecriture'],
          tables, cles: [...analyse.cles].sort(), illisibles: analyse.illisibles,
        })
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(f.sf)
  return sites
}

export function tousLesSites(sources: readonly Source[]): SiteEcriture[] {
  const monde = new Monde(sources)
  return sources.flatMap((s) => sitesEcriture(monde, s.chemin))
}

/** Règle E : les écritures des trois tables, contre la colonne et contre l'illisible. */
export function fautesDEcriture(
  sources: readonly Source[],
  exceptions: Record<string, { nombre: number; raison: string }> = EXCEPTIONS_ECRITURES,
): string[] {
  const fautes: string[] = []
  const illisiblesParFichier = new Map<string, number>()
  for (const site of tousLesSites(sources)) {
    const visees = site.tables === null ? null : site.tables.filter((t) => TABLES_AUX_ANCIENNES_NOTES.includes(t))
    if (visees !== null && visees.length === 0) continue
    const lieu = `${site.chemin}:${site.ligne}`
    if (site.cles.includes(COLONNE)) {
      fautes.push(`${lieu} — .${site.ecriture}() écrit l’ancienne colonne « ${COLONNE} » de ${visees?.join(' ou ') ?? 'une table illisible'}`)
    }
    if (site.tables === null || site.illisibles.length > 0) {
      illisiblesParFichier.set(site.chemin, (illisiblesParFichier.get(site.chemin) ?? 0) + 1)
      if (!exceptions[site.chemin]) {
        fautes.push(`${lieu} — .${site.ecriture}() que le scanner ne sait pas suivre : `
          + [...(site.tables === null ? ['table illisible'] : []), ...site.illisibles].join(' ; '))
      }
    }
  }
  for (const [chemin, { nombre }] of Object.entries(exceptions)) {
    const reel = illisiblesParFichier.get(chemin) ?? 0
    if (reel !== nombre) fautes.push(`exception « ${chemin} » annonce ${nombre} écriture(s) illisible(s), il y en a ${reel}`)
  }
  return fautes
}

/** Ce qui nomme la colonne dans une source : les clés posées, les lectures, et les `select` des trois tables. */
export function mentionsDeLaColonne(monde: Monde, chemin: string): { cles: number[]; lectures: number[]; selections: number[] } {
  const f = monde.fichier(chemin)!
  const cles: number[] = []
  const lectures: number[] = []
  const selections: number[] = []
  const visiter = (n: ts.Node) => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n))
      && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === COLONNE) cles.push(ligneDe(f, n))
    if (ts.isPropertyAssignment(n) && ts.isComputedPropertyName(n.name) && ts.isStringLiteral(n.name.expression)
      && n.name.expression.text === COLONNE) cles.push(ligneDe(f, n))
    if (ts.isPropertyAccessExpression(n) && n.name.text === COLONNE) lectures.push(ligneDe(f, n))
    if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === COLONNE) {
      lectures.push(ligneDe(f, n))
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'select') {
      const ctx: Contexte = { monde, f, liaisons: new Map(), profondeur: 0 }
      const chaine = chaineDe(ctx, n.expression.expression)
      const arg = n.arguments[0] ? sansEnveloppe(n.arguments[0]) : null
      const tables = chaine.genre === 'table' && chaine.from.arguments[0] ? tablesDe(chaine.ctx, chaine.from.arguments[0]) : null
      if (chaine.genre !== 'stockage' && arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
        && /\bnotes\b/.test(arg.text) && (tables === null || tables.some((t) => TABLES_AUX_ANCIENNES_NOTES.includes(t)))) {
        selections.push(ligneDe(f, n))
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(f.sf)
  return { cles, lectures, selections }
}

/** Règles K et L : la colonne nommée hors des fichiers admis, ou au-delà de leur nombre. */
export function fautesDeMention(
  sources: readonly Source[],
  clesAdmises: Record<string, { nombre: number }> = CLES_NOTES_ADMISES,
  lecturesAdmises: Record<string, { nombre: number }> = LECTURES_NOTES_ADMISES,
): string[] {
  const monde = new Monde(sources)
  const fautes: string[] = []
  const vues = { cles: new Map<string, number>(), lectures: new Map<string, number>() }
  for (const source of sources) {
    const m = mentionsDeLaColonne(monde, source.chemin)
    for (const l of m.selections) fautes.push(`${source.chemin}:${l} — un select des tables aux anciennes notes nomme la colonne « ${COLONNE} »`)
    for (const [genre, lignes, admises] of [['cles', m.cles, clesAdmises], ['lectures', m.lectures, lecturesAdmises]] as const) {
      if (lignes.length === 0) continue
      vues[genre].set(source.chemin, lignes.length)
      if (!admises[source.chemin]) {
        fautes.push(`${source.chemin}:${lignes.join(',')} — ${genre === 'cles' ? 'une clé' : 'une lecture'} « ${COLONNE} » hors des fichiers admis`)
      }
    }
  }
  for (const [genre, admises] of [['cles', clesAdmises], ['lectures', lecturesAdmises]] as const) {
    for (const [chemin, { nombre }] of Object.entries(admises)) {
      const reel = vues[genre].get(chemin) ?? 0
      if (reel !== nombre) fautes.push(`« ${chemin} » admis pour ${nombre} ${genre === 'cles' ? 'clé(s)' : 'lecture(s)'} « ${COLONNE} », il y en a ${reel}`)
    }
  }
  return fautes
}

// ── Les gardes ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('les anciennes colonnes des notes internes ne s’écrivent ni ne se lisent plus', () => {
  const sources = sourcesDeProduction()
  const sites = tousLesSites(sources)
  const surLesTrois = sites.filter((s) => s.tables === null || s.tables.some((t) => TABLES_AUX_ANCIENNES_NOTES.includes(t)))
  // Les deux balayages relisent tout le dépôt : ils se paient une fois, dans un crochet au délai déclaré, jamais
  // dans le corps d'un test, où la charge leur faisait passer les 5 s de Vitest. Nuls tant que le crochet n'a rien
  // rendu : un balayage qui n'aurait pas tourné ne passe pas pour « aucune faute ».
  let fautesDesEcritures: string[] | null = null
  let fautesDesMentions: string[] | null = null
  beforeAll(() => {
    fautesDesEcritures = fautesDEcriture(sources)
    fautesDesMentions = fautesDeMention(sources)
  }, 60_000)

  it('le scanner a tout lu : les sources, et les écritures des trois tables (le plancher)', () => {
    // « Zéro faute » et « aveugle » se ressemblent trop : un balayage qui ne verrait plus rien passerait au vert.
    expect(sources.length).toBeGreaterThan(200)
    expect(sources.filter((s) => s.chemin.startsWith('supabase/functions/')).length).toBeGreaterThan(10)
    expect(sites.length).toBeGreaterThanOrEqual(100)
    expect(surLesTrois.length).toBeGreaterThanOrEqual(20)
    for (const table of TABLES_AUX_ANCIENNES_NOTES) {
      expect(surLesTrois.filter((s) => s.tables?.includes(table)).length, table).toBeGreaterThan(0)
    }
    // Les écrans d'où la colonne est partie : la fiche d'une pièce, et l'import par la plateforme du client ; et les
    // écritures qui passent par une fonction d'un autre module (le statut de TVA, les montants d'une pièce déposée).
    expect(surLesTrois.filter((s) => s.chemin === 'src/pages/dossier/FichePiece.tsx').length).toBeGreaterThanOrEqual(3)
    const reception = surLesTrois.find((s) => s.chemin === 'src/lib/receptionPlateforme.ts' && s.ecriture === 'insert')
    expect(reception?.cles).toEqual(expect.arrayContaining(['montant_ttc', 'devise', 'identite_numero', 'storage_path']))
    expect(surLesTrois.find((s) => s.chemin === 'src/pages/dossier/StatutTvaCard.tsx')?.cles)
      .toEqual(['article_exoneration', 'numero_tva_attribue', 'statut_tva'])
    expect(surLesTrois.find((s) => s.chemin === 'src/lib/depot.ts')?.cles).toEqual(expect.arrayContaining(['montant_ttc', 'conversion_source']))
  })

  it('règle E : aucune écriture des trois tables ne porte la colonne, et ce qui ne se suit pas est nommé', () => {
    expect(fautesDesEcritures).toEqual([])
  })

  it('règles K et L : la colonne n’est nommée que pour la note d’une autre table, au nombre près', () => {
    expect(fautesDesMentions).toEqual([])
  })

  it('la fiche d’une pièce et l’import écrivent la note interne, pas la pièce', () => {
    const fiche = sources.find((s) => s.chemin === 'src/pages/dossier/FichePiece.tsx')!
    const reception = sources.find((s) => s.chemin === 'src/lib/receptionPlateforme.ts')!
    expect(fiche.texte).toContain('enregistrerNoteInterne(dossierId, { type: \'piece\', id: piece.id }, notes)')
    expect(reception.texte).toContain('enregistrerNoteInterne(ctx.dossierId, { type: \'piece\', id: pieceId }, note)')
  })
})

describe('le scanner des anciennes notes voit un défaut planté', () => {
  const s = (texte: string, chemin = 'src/pages/Plante.tsx'): Source => ({ chemin, texte })
  const ecrit = (texte: string) => fautesDEcriture([s(texte)], {})
  const nomme = (texte: string, chemin?: string) => fautesDeMention([s(texte, chemin)], {}, {})

  it('une clé écrite en clair, entre guillemets, en raccourci ou calculée en littéral', () => {
    expect(ecrit("supabase.from('pieces').update({ notes: 'x' }).eq('id', id)")).toHaveLength(1)
    expect(ecrit("supabase.from('documents_divers').insert({ 'notes': 'x' })")).toHaveLength(1)
    expect(ecrit("const notes = 'x'\nsupabase.from('dossiers').upsert({ id: 'i', notes })")).toHaveLength(1)
    expect(ecrit("supabase.from('pieces').update({ ['notes']: 'x' })")).toHaveLength(1)
  })

  it('une clé arrivée par une variable, un déversement, une condition, un .map ou une fonction du fichier', () => {
    expect(ecrit("const p = { a: 1, notes: 'n' }\nsupabase.from('pieces').update(p)")).toHaveLength(1)
    expect(ecrit("const p = { notes: 'n' }\nsupabase.from('pieces').insert({ ...p, b: 2 })")).toHaveLength(1)
    expect(ecrit("const ok = true\nsupabase.from('pieces').update({ ...(ok ? { notes: 'n' } : {}) })")).toHaveLength(1)
    expect(ecrit("const ok = true\nsupabase.from('pieces').update({ ...(ok && { notes: 'n' }) })")).toHaveLength(1)
    expect(ecrit("function extra() { return { notes: 'x' } }\nsupabase.from('pieces').insert({ ...extra() })")).toHaveLength(1)
    expect(ecrit("const extra = () => ({ notes: 'x' })\nsupabase.from('pieces').insert([{ ...extra() }])")).toHaveLength(1)
    expect(ecrit("const ids = ['a']\nsupabase.from('pieces').insert(ids.map((id) => ({ id, notes: 'x' })))")).toHaveLength(1)
    expect(ecrit("let p = { a: 1 }\np = { ...p, notes: 'x' }\nsupabase.from('pieces').update(p)")).toHaveLength(1)
  })

  it('une variable se lit à SA portée : le même nom ailleurs ne la remplace pas', () => {
    const texte = "function a() { const p = { notes: 'x' }; return p }\n"
      + "function b() { const p = { statut: 'v' }; return supabase.from('pieces').update(p) }"
    expect(ecrit(texte)).toEqual([])
    expect(ecrit(texte.replace("{ statut: 'v' }", "{ ...a() }"))).toHaveLength(1)
  })

  it('une clé passée à un assistant qui reçoit sa table et sa ligne, ou qui la rend', () => {
    const assistant = "const enregistrer = async (table: 'pieces' | 'documents_divers', ligne: Record<string, unknown>) => {\n"
      + '  const { error } = await supabase.from(table).insert(ligne).select(\'id\').single()\n}\n'
    expect(ecrit(`${assistant}await enregistrer('pieces', { a: 1, notes: 'x' })`)).toHaveLength(1)
    expect(ecrit(`${assistant}await enregistrer('pieces', { a: 1 })`)).toEqual([])
    // Le paramètre se lit dans l'argument de l'appel suivi : un autre appel de la même fonction ne le remplace pas.
    const ligneDe = "const ligneDe = (extra: object) => ({ a: 1, ...extra })\n"
    expect(ecrit(`${ligneDe}supabase.from('pieces').insert(ligneDe({ b: 2 }))\nconst autre = ligneDe({ notes: 'x' })`)).toEqual([])
    expect(ecrit(`${ligneDe}supabase.from('pieces').insert(ligneDe({ notes: 'x' }))`)).toHaveLength(1)
  })

  it('une clé qui vient d’un autre module du dépôt, importée ou ré-exportée', () => {
    const module = s("export function ligneDeLaPiece(s: string) { return { statut: s, notes: 'x' } }\n"
      + "export const LIGNE = { notes: 'x' }\nexport const TABLE = 'pieces'", 'src/lib/module.ts')
    const relais = s("export { ligneDeLaPiece as ligne } from './module'", 'src/lib/relais.ts')
    const ecran = (texte: string) => fautesDEcriture([module, relais, s(texte)], {})
    expect(ecran("import { ligneDeLaPiece } from '../lib/module'\nsupabase.from('pieces').insert(ligneDeLaPiece('a'))")).toHaveLength(1)
    expect(ecran("import { LIGNE } from '../lib/module'\nsupabase.from('pieces').insert({ ...LIGNE })")).toHaveLength(1)
    expect(ecran("import { ligne } from '../lib/relais'\nsupabase.from('pieces').insert(ligne('a'))")).toHaveLength(1)
    expect(ecran("import { TABLE } from '../lib/module'\nsupabase.from(TABLE).update({ notes: 'x' })")).toHaveLength(1)
    expect(ecran("import { TABLE } from '../lib/module'\nsupabase.from(TABLE).update({ statut: 'x' })")).toEqual([])
  })

  it('une requête gardée dans une variable avant d’écrire', () => {
    expect(ecrit("const requete = supabase.from('pieces')\nrequete.update({ notes: 'x' })")).toHaveLength(1)
  })

  it('la chaîne coupée par le formatage, ou par une lecture intercalée', () => {
    expect(ecrit("supabase\n  .from('pieces')\n  .update({\n    notes: 'n',\n  })\n  .eq('id', id)")).toHaveLength(1)
    expect(ecrit("supabase.from('pieces').update({ notes: 'n' }).eq('id', id).select('id').maybeSingle()")).toHaveLength(1)
  })

  it('ce qui ne se suit pas est une faute, sauf exception au nombre près', () => {
    expect(ecrit("supabase.from(table).insert(lignes)").join('\n')).toContain('table illisible')
    expect(ecrit("const colonne = 'a'\nsupabase.from('pieces').update({ [colonne]: 1 })").join('\n')).toContain('clé calculée')
    expect(ecrit("import { f } from 'ailleurs'\nsupabase.from('pieces').insert({ ...f() })").join('\n')).toContain('appel de f()')
    expect(ecrit("import { f } from './absent'\nsupabase.from('pieces').insert({ ...f() })").join('\n')).toContain('appel de f()')
    expect(ecrit("import { L } from './absent'\nsupabase.from('pieces').insert({ ...L })").join('\n')).toContain('importé sans valeur lisible')
    expect(ecrit("supabase.from('pieces').insert({ ...objet.ligne() })").join('\n')).toContain('appel de objet.ligne()')
    expect(ecrit("const { ligne } = x\nsupabase.from('pieces').insert(ligne)").join('\n')).toContain('ligne déstructuré')
    expect(ecrit("export function f(ligne: object) { return supabase.from('pieces').insert(ligne) }").join('\n'))
      .toContain('paramètre ligne d’une fonction dont aucun appel ne se lit')
    expect(ecrit("hachage.update({ a: 1 })").join('\n')).toContain('écriture hors d’une chaîne .from(…)')
    expect(fautesDEcriture([s("supabase.from(table).insert(lignes)")], { 'src/pages/Plante.tsx': { nombre: 1, raison: 'essai' } })).toEqual([])
    expect(fautesDEcriture([s("supabase.from(table).insert(lignes)")], { 'src/pages/Plante.tsx': { nombre: 2, raison: 'essai' } }))
      .toEqual(['exception « src/pages/Plante.tsx » annonce 2 écriture(s) illisible(s), il y en a 1'])
  })

  it('n’accuse ni une autre table, ni le stockage, ni un commentaire, ni une lecture de la clé', () => {
    expect(ecrit("supabase.from('factures_emises').update({ notes: 'n' })")).toEqual([])
    expect(ecrit("supabase.storage.from('pieces').update(chemin, fichier)")).toEqual([])
    expect(ecrit("// supabase.from('pieces').update({ notes: n })\nsupabase.from('pieces').update({ statut: 'validee' })")).toEqual([])
    expect(ecrit("supabase.from('pieces').update({ statut: x.notes ? 'a' : 'b' })")).toEqual([])
  })

  it('règles K et L : une clé, une lecture, une affectation ou un select hors des fichiers admis, et un compte faux', () => {
    expect(nomme('const ligne = { notes: x }')).toHaveLength(1)
    expect(nomme('Object.assign(ligne, { notes })')).toHaveLength(1)
    expect(nomme('const n = piece.notes')).toHaveLength(1)
    expect(nomme('ligne.notes = n')).toHaveLength(1)
    expect(nomme("const n = piece['notes']")).toHaveLength(1)
    expect(nomme("const n = piece?.notes ?? ''")).toHaveLength(1)
    expect(nomme("supabase.from('pieces').select('id, notes').eq('dossier_id', d)")).toHaveLength(1)
    expect(nomme("supabase.from('factures_emises').select('id, notes')")).toEqual([])
    expect(nomme("// piece.notes\nconst texte = 'les notes de frais'")).toEqual([])
    expect(fautesDeMention([s('const a = { notes: x }; const b = f.notes', 'src/lib/admis.ts')],
      { 'src/lib/admis.ts': { nombre: 2 } }, { 'src/lib/admis.ts': { nombre: 1 } }))
      .toEqual(['« src/lib/admis.ts » admis pour 2 clé(s) « notes », il y en a 1'])
  })
})
