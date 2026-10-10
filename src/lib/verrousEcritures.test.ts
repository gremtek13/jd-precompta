import { readFileSync, readdirSync } from 'node:fs'
import { posix } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// CHAQUE GESTIONNAIRE QUI ÉCRIT PASSE UN VERROU `useRef`, OU DIT POURQUOI IL N'EN A PAS BESOIN.
//
// `verrousExecution.test.ts` part des verrous qui EXISTENT (`x.current = true`) et vérifie qu'ils se relâchent dans un
// `finally`. Un gestionnaire SANS verrou ne lui présente rien à examiner : « Nouveau dossier » (09/10/2026) n'avait que
// `disabled={saving}` — un état, qui ne prend effet qu'au rendu suivant —, et deux soumissions du même rendu créaient
// deux dossiers ; dix-sept jumeaux vivaient de même (HISTORIQUE.md, « N'AVAIT QU'UN ÉTAT POUR VERROU »
// et « LES GESTIONNAIRES D'ÉCRITURE SANS VERROU »). Ce garde part de l'autre bout : de TOUTE fonction d'écran qui écrit.
//
// CE QUI EST UNE ÉCRITURE (une « porte ») : sur une chaîne qui part du client `supabase` importé de `lib/supabase`,
// `.from(t).insert|upsert|update|delete`, `.storage.from(s).upload|update|move|copy|remove`, `.rpc(f)`,
// `.functions.invoke(f)` (avec son `action` quand elle est écrite en clair) et les méthodes de `.auth` qui ouvrent ou
// ferment une session ; ET l'appel d'une fonction de `src/lib` qui écrit — suivie d'appel en appel dans `src/lib`
// (imports relatifs et fonctions du même module, jusqu'au point fixe), parce qu'un écran qui génère un pack ou dépose
// un fichier ne touche pas `.insert(` lui-même (le balayage du 20/09/2026 en avait manqué deux pour cette raison).
// NE SONT PAS SUIVIS, et c'est dit plutôt que laissé croire : les méthodes d'un objet importé (aucune n'écrit
// aujourd'hui), une fonction passée en valeur à `src/lib`, et `fetch` (deux lectures publiques, comptées plus bas).
//
// CE QUI EST UN VERROU : dans la fonction, une LECTURE puis une POSE (`= …`, `.add(…)`) du `.current` d'un `useRef`,
// toutes deux avant son premier `await` et avant sa première porte. Ce qui le PROTÈGE sans qu'elle le porte : être
// passée à une « enveloppe » (une fonction à verrou propre qui appelle, ou transmet à une autre enveloppe, la fonction
// qu'on lui donne — `sousVerrou`, `agir`) ; être créée, ou appelée, dans une fonction après son verrou ; et pour une
// fonction nommée, n'être référencée QUE depuis de tels endroits. Sinon elle est « nue », et l'on dit d'où on l'atteint :
// un attribut JSX (le geste), une propriété, un effet, son exportation, le module — ou aucune référence.
//
// UNE FONCTION NUE N'EST PAS FORCÉMENT UNE FAUTE. Rejouée deux fois, une mise à jour par clé réécrit la même valeur, une
// suppression ne trouve plus rien : ces catégories se DÉCIDENT sur le texte, et chacune porte son nombre. Le reste — une
// création, un appel facturé ou extérieur — est une faute, sauf exception NOMMÉE, avec sa catégorie et sa raison, et
// chaque catégorie avec son nombre. Un plancher distingue « zéro faute » d'« aveugle ».
//
// CE QUE LE GARDE NE VOIT PAS : que le verrou soit posé AVANT le `try` plutôt que dedans (le cas à TROIS envois de chaque
// test d'écran le distingue), ni qu'il se relâche dans un `finally` (`verrousExecution.test.ts`), ni le moment du
// relâchement (après la relecture quand l'écran reste ouvert : les tests d'écran). Une branche qui écrit sans passer par
// le verrou posé dans une autre branche de la même fonction lui échappe aussi : il juge les positions, pas les chemins.
// Ni ce qu'une suppression rejouée DIT : la catégorie se décide sur les portes, et la suppression définitive d'un dossier,
// rejouée pendant la première, affirmait des fichiers « restés » sur un dossier proprement supprimé — trouvée en lisant,
// pas par ce garde. Une suppression qui compte ce qu'elle a fait et le dit se lit à la main.

export interface Source { chemin: string; texte: string }

type Famille = 'table' | 'stockage' | 'rpc' | 'fonction' | 'auth'
type Nature = 'lecture' | 'mise à jour' | 'suppression' | 'session' | 'création'

/**
 * Les portes dont la nature ne se lit pas sur leur forme : une fonction SQL ou une Edge Function peut lire, réécrire la
 * même ligne ou supprimer. Une entrée ici est une affirmation sur ce que la porte FAIT, vérifiée dans sa source ; une
 * entrée que plus aucun code n'emprunte est une faute (raison morte).
 */
const PORTES_DECLAREES: Record<string, { nature: Nature; raison: string }> = {
  'rpc:is_super_admin': {
    nature: 'lecture',
    raison: 'Lit le rôle de la session (fonction `security definer` sans écriture), au montage d’AuthContext.',
  },
  'rpc:couverture_du_releve': {
    nature: 'lecture',
    raison: 'Les mois du relevé d’un dossier (fonction `stable`, `security definer`, sans écriture ; migration '
      + '`banque_du_client`, espace client P7), au montage de l’Accueil et de « Mes pièces » du client.',
  },
  'rpc:droits_sur_le_dossier': {
    nature: 'lecture',
    raison: 'Les cases de l’appelant sur un dossier (fonction `stable`, `security definer`, sans écriture ; étape P1), '
      + 'au montage de « Ma simulation » (P7).',
  },
  'fonction:superpdp-credentials:status': {
    nature: 'lecture',
    raison: 'L’action « status » ne lit que `superpdp_credentials` en base : aucun appel à Super PDP.',
  },
  'fonction:superpdp-credentials:save': {
    nature: 'mise à jour',
    raison: 'Un `upsert` sur la clé primaire `dossier_id` : rejoué, il réécrit les mêmes identifiants.',
  },
  'fonction:superpdp-credentials:remove': {
    nature: 'suppression',
    raison: 'Un `delete` par `dossier_id` : rejoué, il ne trouve plus rien et répond sans erreur.',
  },
  'fonction:delete-cabinet': {
    nature: 'suppression',
    raison: 'Un `delete` par identifiant : rejoué, il ne supprime aucune ligne et rend `ok` (lu dans la fonction).',
  },
  'fonction:taux-change-bce': {
    nature: 'lecture',
    raison: 'Le cours publié par la BCE pour une devise et une date : rien d’écrit, rien de facturé.',
  },
  'lib:lireConnexionPlateforme': {
    nature: 'lecture',
    raison: 'Action « statut » de `plateforme-agreee` : elle ne lit que la base, sans appeler la plateforme.',
  },
  'auth:signInWithPassword': {
    nature: 'session',
    raison: 'Ouvre la session : rejouée, elle rend la même session, et rien du dossier n’est écrit.',
  },
  'auth:signOut': {
    nature: 'session',
    raison: 'Ferme la session : rejouée, elle ne trouve plus rien à fermer.',
  },
}

/** Les catégories que le garde décide sur le texte, avec leur raison et leur NOMBRE. */
type CategorieAutomatique = 'mise à jour' | 'suppression' | 'session'
const CATEGORIES_AUTOMATIQUES: Record<CategorieAutomatique, { nombre: number; raison: string }> = {
  'mise à jour': {
    nombre: 24,
    raison: 'Ne fait que des `update` par clé et des `upsert` à clé déclarée (`onConflict`), ou une porte déclarée '
      + 'comme telle : deux envois du même rendu écrivent la même valeur, calculée dans la même fermeture.',
  },
  suppression: {
    // 20 depuis que `PiecesTab.deleteSelection` porte son verrou (les écritures du navigateur, 09/10/2026) ; 19 depuis
    // que `FacturesTab.supprimer` porte le sien (espace client, étape P2 : la suppression d'un brouillon par la base).
    nombre: 19,
    raison: 'Ne fait que supprimer (ou réécrire par clé) : le second envoi ne trouve plus rien, sans erreur.',
  },
  session: {
    nombre: 2,
    raison: 'Ouvre ou ferme la session de l’utilisateur : rien du dossier n’est écrit.',
  },
}

type CategorieNommee = 'doublon refusé par la base' | 'dépôt parallèle voulu' | 'au montage'
/** Les catégories qu'une exception nommée peut invoquer, avec leur raison et leur NOMBRE. */
const CATEGORIES_NOMMEES: Record<CategorieNommee, { nombre: number; raison: string }> = {
  'doublon refusé par la base': {
    nombre: 3,
    raison: 'Une contrainte unique refuse le second envoi, et l’écran le dit juste ou relit sans rien perdre.',
  },
  'dépôt parallèle voulu': {
    nombre: 1,
    raison: 'Plusieurs dépôts partent ensemble exprès ; un verrou d’écran avalerait un second dépôt légitime.',
  },
  'au montage': {
    nombre: 1,
    raison: 'Aucun geste ne l’atteint hors d’un verrou : seul un effet l’appelle, et pour lire.',
  },
}

/** Les fonctions nues qui créent ou appellent l'extérieur sans verrou, nommément, chacune avec sa raison. */
const EXCEPTIONS: Record<string, { categorie: CategorieNommee; raison: string }> = {
  'src/pages/dossier/ImmobilisationsTab.tsx › ImmobilisationsTab › enregistrer': {
    categorie: 'doublon refusé par la base',
    raison: '`immobilisations_piece_id_unique` (piece_id) refuse le second envoi en 23505, que l’écran dit '
      + '(« déjà enregistrée comme immobilisation ») avant de relire.',
  },
  'src/pages/dossier/PiecesTab.tsx › PiecesTab › createSousDossier': {
    categorie: 'doublon refusé par la base',
    raison: '`window.prompt` bloque avant tout envoi, et `sous_dossiers (dossier_id, nom)` est unique : un second nom '
      + 'identique est refusé, et le message de la base le dit.',
  },
  'src/pages/EquipePage.tsx › EquipePage › toggleAssignation': {
    categorie: 'doublon refusé par la base',
    raison: 'Bascule calculée dans la fermeture : deux suppressions ne trouvent rien la seconde fois, deux insertions '
      + 'butent sur `dossier_assignations (dossier_id, user_id)` ; l’écran relit dans les deux cas.',
  },
  'src/pages/ClientUpload.tsx › ClientUpload › handleFiles › (argument de files.map)': {
    categorie: 'dépôt parallèle voulu',
    raison: 'Chaque fichier d’un dépôt suit son chemin en parallèle, et la zone reste ouverte pendant l’analyse ; '
      + 'l’empreinte réservée dans le lot arrête un fichier en double DANS un lot, pas entre deux lots en vol '
      + '(question au cabinet, HISTORIQUE.md du 09/10/2026).',
  },
  'src/pages/dossier/ConnexionBancaireCard.tsx › appeler': {
    categorie: 'au montage',
    raison: 'Porte générique de `banque-connexion` : toutes les actions qui écrivent partent sous `sousVerrou` ; '
      + 'hors de lui, seul `lireStatut` (action « statut ») part, d’un effet.',
  },
}

/** Les appels `fetch` de la source, par fichier : deux lectures publiques, qui n'écrivent rien. */
const FETCH_ADMIS: Record<string, { nombre: number; raison: string }> = {
  'src/lib/sirene.ts': { nombre: 1, raison: 'Recherche publique d’un SIRET (lecture, sur un clic).' },
  'src/lib/remplir2035.ts': { nombre: 1, raison: 'Le formulaire vierge de la 2035, servi par l’application.' },
}

// Les méthodes qu'une chaîne du client peut porter, en dehors des portes : un nom absent des deux listes est une forme
// inconnue — une écriture que le garde ne saurait pas classer, jusqu'à ce qu'on l'y range.
const METHODES_DE_LECTURE = new Set([
  'from', 'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'overlaps', 'textSearch', 'match', 'not', 'or', 'filter', 'order', 'range', 'limit', 'single', 'maybeSingle', 'csv',
  'returns', 'abortSignal', 'throwOnError', 'download', 'list', 'createSignedUrl', 'createSignedUrls', 'getPublicUrl',
  'getUser', 'getSession', 'onAuthStateChange', 'then', 'catch', 'finally',
])
const ECRITURES_TABLE = new Set(['insert', 'upsert', 'update', 'delete'])
const ECRITURES_STOCKAGE = new Set(['upload', 'update', 'move', 'copy', 'remove'])
const SESSIONS = new Set(['signInWithPassword', 'signOut', 'signUp', 'updateUser', 'resetPasswordForEmail', 'setSession'])

// ── L'analyse ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface PorteVue { cle: string; famille: Famille; operation: string; pos: number }

interface Fichier {
  chemin: string
  module: string
  sf: ts.SourceFile
  imports: Map<string, { module: string; nom: string; decl: ts.Identifier }>
  refs: Set<ts.Identifier>
  fonctions: Fonction[]
}

interface Fonction {
  fichier: Fichier
  noeud: ts.SignatureDeclaration & { body?: ts.Node }
  nom: string
  chaine: string
  portes: PorteVue[]
  appels: { id: ts.Identifier; appel: ts.CallExpression; pos: number }[]
  awaits: number[]
  courants: { id: ts.Identifier; pos: number; pose: boolean }[]
}

export type Etat = 'verrou' | 'protégée' | 'nue'

export interface Unite {
  cle: string
  ligne: number
  portes: string[]
  natures: Nature[]
  etat: Etat
  verrou: string | null
  entrees: string[]
}

export interface Analyse {
  fichiers: number
  unites: Unite[]
  /** Les écrivains de `src/lib`, par nom, avec leurs natures. */
  ecrivainsLib: Map<string, Nature[]>
  /** Les portes vues, par famille (le plancher). */
  portesParFamille: Record<Famille, number>
  /** Les portes déclarées qu'un code emprunte encore. */
  declareesEmpruntees: Set<string>
  /** Les fautes de FORME : méthode inconnue, porte hors fonction, nom ambigu, `fetch` non admis. */
  formes: string[]
  /** Les appels `fetch`, par fichier. */
  fetchs: Map<string, number>
}

const estFonction = (n: ts.Node): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)

function deballer(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isAwaitExpression(x)
    || ts.isSatisfiesExpression(x)) x = x.expression
  return x
}

const litteral = (a: ts.Expression | undefined): string | null =>
  a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null

/** La racine d'une chaîne d'accès et d'appels, et ses appels, du plus extérieur au plus intérieur. */
function chaineDe(expression: ts.Expression): { appels: ts.CallExpression[]; racine: ts.Expression } {
  const appels: ts.CallExpression[] = []
  let e = deballer(expression)
  for (;;) {
    if (ts.isCallExpression(e)) { appels.push(e); e = deballer(e.expression); continue }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) { e = deballer(e.expression); continue }
    return { appels, racine: e }
  }
}

const membre = (appel: ts.CallExpression): string | null => {
  const c = deballer(appel.expression)
  return ts.isPropertyAccessExpression(c) ? c.name.text : null
}

// ── Portées : à quelle déclaration un identifiant se résout ──────────────────────────────────────────────────────

function nomsLies(nom: ts.BindingName, sortie: ts.Identifier[]) {
  if (ts.isIdentifier(nom)) sortie.push(nom)
  else for (const el of nom.elements) if (!ts.isOmittedExpression(el)) nomsLies(el.name, sortie)
}

function declarationsDesInstructions(instructions: readonly ts.Statement[]): ts.Identifier[] {
  const d: ts.Identifier[] = []
  for (const st of instructions) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) d.push(st.name)
    else if (ts.isVariableStatement(st)) for (const v of st.declarationList.declarations) nomsLies(v.name, d)
    else if (ts.isImportDeclaration(st) && st.importClause) {
      if (st.importClause.name) d.push(st.importClause.name)
      const liaisons = st.importClause.namedBindings
      if (liaisons && ts.isNamedImports(liaisons)) for (const el of liaisons.elements) d.push(el.name)
      if (liaisons && ts.isNamespaceImport(liaisons)) d.push(liaisons.name)
    }
  }
  return d
}

// Une portée se relit à chaque identifiant qu'on y résout : gardée une fois lue (la source entière en compte des
// dizaines de milliers).
const portees = new WeakMap<ts.Node, ts.Identifier[] | null>()
function declarationsDeLaPortee(n: ts.Node): ts.Identifier[] | null {
  if (!portees.has(n)) portees.set(n, lireLaPortee(n))
  return portees.get(n)!
}

function lireLaPortee(n: ts.Node): ts.Identifier[] | null {
  if (ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n)) return declarationsDesInstructions(n.statements)
  if (ts.isCaseBlock(n)) return declarationsDesInstructions(n.clauses.flatMap((c) => [...c.statements]))
  if (estFonction(n)) {
    const d: ts.Identifier[] = []
    for (const p of n.parameters) nomsLies(p.name, d)
    if (ts.isFunctionExpression(n) && n.name) d.push(n.name)
    return d
  }
  if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer
    && ts.isVariableDeclarationList(n.initializer)) {
    const d: ts.Identifier[] = []
    for (const v of n.initializer.declarations) nomsLies(v.name, d)
    return d
  }
  if (ts.isCatchClause(n) && n.variableDeclaration) {
    const d: ts.Identifier[] = []
    nomsLies(n.variableDeclaration.name, d)
    return d
  }
  return null
}

/** L'identifiant de déclaration auquel `id` se résout, ou null (un global, un nom inconnu). */
const resolus = new WeakMap<ts.Identifier, ts.Identifier | null>()
function resoudre(id: ts.Identifier): ts.Identifier | null {
  if (resolus.has(id)) return resolus.get(id)!
  let trouvee: ts.Identifier | null = null
  for (let n: ts.Node | undefined = id.parent; n && !trouvee; n = n.parent) {
    trouvee = declarationsDeLaPortee(n)?.find((d) => d.text === id.text) ?? null
  }
  resolus.set(id, trouvee)
  return trouvee
}

function enPositionDeType(id: ts.Identifier): boolean {
  for (let n: ts.Node = id.parent; n && !ts.isStatement(n) && !estFonction(n) && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTypeNode(n) || ts.isExpressionWithTypeArguments(n)) return true
  }
  return false
}

/** Vrai pour un identifiant qui désigne une VALEUR (pas un nom de propriété, de déclaration, d'attribut ou de type). */
function estUneReference(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p))
    && p.name === id) return false
  if (ts.isJsxAttribute(p) || ts.isJsxClosingElement(p)) return false
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isParameter(p)
    || ts.isClassDeclaration(p)) && p.name === id) return false
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false
  if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p) || ts.isQualifiedName(p)) return false
  return !enPositionDeType(id)
}

// ── Lecture d'un fichier ───────────────────────────────────────────────────────────────────────────────────────────

const MODULE_CLIENT = 'src/lib/supabase'

function nomDe(n: ts.Node): string {
  const f = n as ts.FunctionLikeDeclaration
  if (f.name && ts.isIdentifier(f.name)) return f.name.text
  const p = n.parent
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return `<${p.parent.name.getText()}>`
  if (ts.isCallExpression(p)) {
    // `const x = useCallback(async () => …, [])` : la fonction porte le nom de la variable.
    if (ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name) && /^use(Callback|Memo)$/.test(p.expression.getText())) {
      return p.parent.name.text
    }
    return `(argument de ${p.expression.getText().replace(/\s+/g, '').slice(0, 40)})`
  }
  return '(anonyme)'
}

/** La porte que forme un appel sur une chaîne du client, ou une faute de forme, ou rien (une lecture). */
function porteDe(appel: ts.CallExpression, clients: Set<ts.Identifier>, sf: ts.SourceFile): PorteVue | string | null {
  const m = membre(appel)
  if (!m) return null
  const recepteur = deballer((deballer(appel.expression) as ts.PropertyAccessExpression).expression)
  const { appels, racine } = chaineDe(recepteur)
  if (!ts.isIdentifier(racine)) return null
  const decl = resoudre(racine)
  if (!decl || !clients.has(decl)) return null
  const pos = appel.getStart(sf)
  const from = appels.find((a) => membre(a) === 'from')
  if (from) {
    const objetFrom = deballer((deballer(from.expression) as ts.PropertyAccessExpression).expression)
    const stockage = ts.isPropertyAccessExpression(objetFrom) && objetFrom.name.text === 'storage'
    const cible = litteral(from.arguments[0]) ?? '?'
    if (stockage && ECRITURES_STOCKAGE.has(m)) return { cle: `stockage:${cible}.${m}`, famille: 'stockage', operation: m, pos }
    if (!stockage && ECRITURES_TABLE.has(m)) {
      const operation = m === 'upsert' && appel.arguments[1]?.getText(sf).includes('onConflict') ? 'upsert-cle' : m
      return { cle: `table:${cible}.${operation}`, famille: 'table', operation, pos }
    }
  }
  if (m === 'rpc' && appels.length === 0) {
    return { cle: `rpc:${litteral(appel.arguments[0]) ?? '?'}`, famille: 'rpc', operation: 'rpc', pos }
  }
  if (m === 'invoke' && ts.isPropertyAccessExpression(recepteur) && recepteur.name.text === 'functions') {
    const options = appel.arguments[1]?.getText(sf) ?? ''
    const action = /\baction\s*:\s*['"]([\w-]+)['"]/.exec(options)?.[1]
    const suffixe = action ? `:${action}` : /\baction\b/.test(options) ? ':(variable)' : ''
    return { cle: `fonction:${litteral(appel.arguments[0]) ?? '?'}${suffixe}`, famille: 'fonction', operation: 'invoke', pos }
  }
  if (SESSIONS.has(m) && ts.isPropertyAccessExpression(recepteur) && recepteur.name.text === 'auth') {
    return { cle: `auth:${m}`, famille: 'auth', operation: m, pos }
  }
  if (METHODES_DE_LECTURE.has(m) || m === 'storage' || m === 'functions' || m === 'auth') return null
  return `méthode « ${m} » du client sans nature connue (lecture ou écriture ?)`
}

function lireFichier(source: Source): Fichier {
  const sf = ts.createSourceFile(source.chemin, source.texte, ts.ScriptTarget.Latest, true,
    source.chemin.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const module = source.chemin.replace(/\.tsx?$/, '')
  const fichier: Fichier = { chemin: source.chemin, module, sf, imports: new Map(), refs: new Set(), fonctions: [] }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const specifiant = st.moduleSpecifier.text
    if (!specifiant.startsWith('.')) continue
    const cible = posix.join(posix.dirname(source.chemin), specifiant)
    const liaisons = st.importClause.namedBindings
    if (liaisons && ts.isNamedImports(liaisons)) {
      for (const el of liaisons.elements) fichier.imports.set(el.name.text, { module: cible, nom: (el.propertyName ?? el.name).text, decl: el.name })
    }
  }
  ;(function visiter(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer)) {
      const c = n.initializer.expression
      if ((ts.isIdentifier(c) && c.text === 'useRef') || (ts.isPropertyAccessExpression(c) && c.name.text === 'useRef')) fichier.refs.add(n.name)
    }
    if (estFonction(n) && n.body) {
      const noms: string[] = []
      for (let p: ts.Node | undefined = n; p; p = p.parent) if (estFonction(p)) noms.unshift(nomDe(p))
      fichier.fonctions.push({ fichier, noeud: n, nom: nomDe(n), chaine: noms.join(' › '), portes: [], appels: [], awaits: [], courants: [] })
    }
    ts.forEachChild(n, visiter)
  })(sf)
  return fichier
}

/** Le contenu EN PROPRE de chaque fonction (les fonctions imbriquées sont des entrées à part), et les fautes de forme. */
function lireLesCorps(fichier: Fichier, formes: string[], fetchs: Map<string, number>) {
  const clients = new Set<ts.Identifier>()
  for (const imp of fichier.imports.values()) if (imp.module === MODULE_CLIENT && imp.nom === 'supabase') clients.add(imp.decl)
  const parNoeud = new Map<ts.Node, Fonction>(fichier.fonctions.map((f) => [f.noeud, f]))
  const { sf } = fichier
  ;(function visiter(n: ts.Node, f: Fonction | null) {
    const ici = estFonction(n) && parNoeud.get(n) ? parNoeud.get(n)! : f
    if (ts.isAwaitExpression(n) && ici) ici.awaits.push(n.getStart(sf))
    if (ts.isCallExpression(n)) {
      const porte = porteDe(n, clients, sf)
      const ligne = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      if (typeof porte === 'string') formes.push(`${fichier.chemin}:${ligne} — ${porte}`)
      else if (porte) {
        if (ici) ici.portes.push(porte)
        else formes.push(`${fichier.chemin}:${ligne} — ${porte.cle} hors de toute fonction`)
      }
      const appele = deballer(n.expression)
      if (ts.isIdentifier(appele)) {
        if (ici) ici.appels.push({ id: appele, appel: n, pos: n.getStart(sf) })
        if (appele.text === 'fetch' && !resoudre(appele)) fetchs.set(fichier.chemin, (fetchs.get(fichier.chemin) ?? 0) + 1)
      }
    }
    if (ici && ts.isPropertyAccessExpression(n) && n.name.text === 'current' && ts.isIdentifier(n.expression)) {
      const p = n.parent
      const pose = (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        || (ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === 'add'
          && ts.isCallExpression(p.parent) && p.parent.expression === p)
      ici.courants.push({ id: n.expression, pos: n.getStart(sf), pose })
    }
    ts.forEachChild(n, (enfant) => visiter(enfant, ici))
  })(sf, null)
}

/** Le verrou de `f` qui précède `position` : la LECTURE puis la POSE d'un `useRef`, avant son premier `await`. */
function verrouAvant(f: Fonction, position: number): string | null {
  const borne = Math.min(position, ...f.awaits)
  const avant = f.courants.filter((c) => {
    if (c.pos >= borne) return false
    const decl = resoudre(c.id)
    return decl !== null && f.fichier.refs.has(decl)
  })
  for (const lecture of avant) {
    if (lecture.pose) continue
    if (avant.some((pose) => pose.pose && pose.id.text === lecture.id.text && pose.pos > lecture.pos)) return lecture.id.text
  }
  return null
}

export function analyser(sources: readonly Source[]): Analyse {
  const formes: string[] = []
  const fetchs = new Map<string, number>()
  const fichiers = sources.map(lireFichier)
  for (const f of fichiers) lireLesCorps(f, formes, fetchs)
  const parModule = new Map(fichiers.map((f) => [f.module, f]))
  const parNoeud = new Map<ts.Node, Fonction>()
  for (const f of fichiers) for (const g of f.fonctions) parNoeud.set(g.noeud, g)

  const fonctionDeclaree = (decl: ts.Identifier | null): Fonction | null => {
    if (!decl) return null
    const p = decl.parent
    if (ts.isFunctionDeclaration(p)) return parNoeud.get(p) ?? null
    if (ts.isVariableDeclaration(p) && p.initializer) return parNoeud.get(deballer(p.initializer)) ?? null
    return null
  }

  // ── Les écrivains de src/lib : une fonction de premier niveau, ses fonctions imbriquées comprises ──
  const estLib = (f: Fichier) => f.chemin.startsWith('src/lib/')
  const declareesEmpruntees = new Set<string>()
  const naturesDePorte = (p: PorteVue): Nature => {
    const declaree = PORTES_DECLAREES[p.cle]
    if (declaree) { declareesEmpruntees.add(p.cle); return declaree.nature }
    if (p.famille === 'table') return p.operation === 'delete' ? 'suppression' : p.operation === 'update' || p.operation === 'upsert-cle' ? 'mise à jour' : 'création'
    if (p.famille === 'stockage') return p.operation === 'remove' ? 'suppression' : p.operation === 'update' ? 'mise à jour' : 'création'
    return 'création'
  }
  // Une déclaration de niveau module : `function f` ou `const f = …` posés directement dans le fichier.
  const dePremierNiveau = (decl: ts.Identifier): boolean => {
    const p = decl.parent
    if (ts.isFunctionDeclaration(p)) return ts.isSourceFile(p.parent)
    return ts.isVariableDeclaration(p) && ts.isVariableStatement(p.parent.parent) && ts.isSourceFile(p.parent.parent.parent)
  }
  const premierNiveau = (g: Fonction): ts.Identifier | null => {
    let haut: ts.Node = g.noeud
    for (let p: ts.Node | undefined = g.noeud; p; p = p.parent) if (estFonction(p)) haut = p
    if (ts.isFunctionDeclaration(haut) && haut.name && dePremierNiveau(haut.name)) return haut.name
    const v = haut.parent
    if (ts.isVariableDeclaration(v) && ts.isIdentifier(v.name) && dePremierNiveau(v.name)) return v.name
    return null
  }
  // Ce qu'un appel par identifiant désigne dans src/lib : `module#nom`.
  const cibleLib = (fichier: Fichier, id: ts.Identifier): string | null => {
    const decl = resoudre(id)
    if (!decl) return null
    const imp = fichier.imports.get(id.text)
    if (imp && imp.decl === decl) {
      const module = parModule.has(imp.module) ? imp.module : `${imp.module}/index`
      return module.startsWith('src/lib/') ? `${module}#${imp.nom}` : null
    }
    return estLib(fichier) && dePremierNiveau(decl) ? `${fichier.module}#${decl.text}` : null
  }
  const naturesLib = new Map<string, Set<Nature>>()
  const nomDeCible = (cible: string) => cible.slice(cible.indexOf('#') + 1)
  const naturesDeLAppel = (cible: string): Set<Nature> | null => {
    const cle = `lib:${nomDeCible(cible)}`
    const declaree = PORTES_DECLAREES[cle]
    if (declaree && naturesLib.has(cible)) { declareesEmpruntees.add(cle); return new Set([declaree.nature]) }
    return naturesLib.get(cible) ?? null
  }
  for (let change = true; change;) {
    change = false
    for (const fichier of fichiers) {
      if (!estLib(fichier)) continue
      for (const g of fichier.fonctions) {
        const haut = premierNiveau(g)
        if (!haut) {
          for (const p of g.portes) formes.push(`${fichier.chemin} — ${p.cle} dans une fonction qui n’est pas de premier niveau`)
          continue
        }
        const cle = `${fichier.module}#${haut.text}`
        const natures = naturesLib.get(cle) ?? new Set<Nature>()
        const avant = natures.size
        for (const p of g.portes) natures.add(naturesDePorte(p))
        for (const a of g.appels) {
          const cible = cibleLib(fichier, a.id)
          const n = cible && cible !== cle ? naturesDeLAppel(cible) : null
          if (n) for (const x of n) natures.add(x)
        }
        if (natures.size > 0 && (!naturesLib.has(cle) || natures.size !== avant)) { naturesLib.set(cle, natures); change = true }
      }
    }
  }
  // Un nom d'écrivain porté par deux modules rendrait les déclarations ambiguës.
  const parNom = new Map<string, string>()
  for (const cle of naturesLib.keys()) {
    const nom = nomDeCible(cle)
    if (parNom.has(nom) && parNom.get(nom) !== cle) formes.push(`écrivain de src/lib au nom ambigu : ${nom} (${parNom.get(nom)}, ${cle})`)
    parNom.set(nom, cle)
  }

  // ── Les enveloppes : verrou propre, puis la fonction reçue appelée ou transmise à une autre enveloppe ──
  const enveloppes = new Set<ts.Node>()
  for (let change = true; change;) {
    change = false
    for (const fichier of fichiers) {
      for (const g of fichier.fonctions) {
        if (enveloppes.has(g.noeud) || g.noeud.parameters.length === 0) continue
        const parametres = new Set<ts.Identifier>()
        for (const p of g.noeud.parameters) if (ts.isIdentifier(p.name)) parametres.add(p.name)
        const appelle = g.appels.some((a) => { const d = resoudre(a.id); return d !== null && parametres.has(d) && verrouAvant(g, a.pos) !== null })
        const transmet = g.appels.some((a) => {
          const cible = fonctionDeclaree(resoudre(a.id))
          return cible !== null && enveloppes.has(cible.noeud) && a.appel.arguments.some((x) => {
            const d = ts.isIdentifier(x) ? resoudre(x) : null
            return d !== null && parametres.has(d)
          })
        })
        if (appelle || transmet) { enveloppes.add(g.noeud); change = true }
      }
    }
  }
  const appelDEnveloppe = (appel: ts.CallExpression): boolean => {
    const c = deballer(appel.expression)
    if (!ts.isIdentifier(c)) return false
    const g = fonctionDeclaree(resoudre(c))
    return g !== null && enveloppes.has(g.noeud)
  }
  const estEffet = (appel: ts.CallExpression) => /^(React\.)?use(Layout)?Effect$/.test(appel.expression.getText())

  // ── Les références des fonctions nommées, par déclaration ──
  const references = new Map<ts.Identifier, ts.Identifier[]>()
  for (const fichier of fichiers) {
    const noms = new Set(fichier.fonctions.map((g) => g.nom))
    ;(function visiter(n: ts.Node) {
      if (ts.isIdentifier(n) && noms.has(n.text) && estUneReference(n)) {
        const decl = resoudre(n)
        if (decl && decl !== n) references.set(decl, [...(references.get(decl) ?? []), n])
      }
      ts.forEachChild(n, visiter)
    })(fichier.sf)
  }

  const fonctionEnglobante = (n: ts.Node): Fonction | null => {
    for (let p = n.parent; p; p = p.parent) if (estFonction(p)) return parNoeud.get(p) ?? null
    return null
  }
  const attributEntre = (n: ts.Node, borne: ts.Node): ts.JsxAttribute | null => {
    for (let p = n.parent; p && p !== borne; p = p.parent) if (ts.isJsxAttribute(p)) return p
    return null
  }
  const declarationDe = (g: Fonction): ts.Identifier | null => {
    const n = g.noeud
    if (ts.isFunctionDeclaration(n) && n.name) return n.name
    const p = n.parent
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name
    if (ts.isCallExpression(p) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)
      && /^use(Callback|Memo)$/.test(p.expression.getText())) return p.parent.name
    return null
  }

  // D'où l'on atteint une position sans verrou : la liste des entrées (vide = protégée sur tous les chemins).
  function entreesDeLaPosition(n: ts.Node, pile: Set<Fonction>): string[] {
    const g = fonctionEnglobante(n)
    if (!g) return ['le module']
    if (verrouAvant(g, n.getStart(g.fichier.sf))) return []
    const attribut = attributEntre(n, g.noeud)
    if (attribut) return [`geste ${attribut.name.getText()} (${g.nom})`]
    return entreesDeLaFonction(g, pile)
  }
  function entreesDeLaFonction(g: Fonction, pile: Set<Fonction>): string[] {
    if (pile.has(g)) return []
    pile.add(g)
    const sortie: string[] = []
    const n = g.noeud
    const p = n.parent
    const decl = declarationDe(g)
    if (!decl) {
      if (ts.isCallExpression(p) && p.arguments.some((a) => a === n)) {
        if (!appelDEnveloppe(p)) sortie.push(...(estEffet(p) ? [`effet (${fonctionEnglobante(n)?.nom ?? 'module'})`] : entreesDeLaPosition(n, pile)))
      } else if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
        sortie.push(`geste ${p.parent.name.getText()} (${fonctionEnglobante(n)?.nom ?? 'module'})`)
      } else if (ts.isPropertyAssignment(p)) {
        sortie.push(`propriété ${p.name.getText()} (${fonctionEnglobante(n)?.nom ?? 'module'})`)
      } else sortie.push(...entreesDeLaPosition(n, pile))
    } else {
      const instruction = ts.isFunctionDeclaration(n) ? n : decl.parent.parent?.parent
      const exportee = instruction !== undefined && ts.canHaveModifiers(instruction)
        && (ts.getModifiers(instruction) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      const refs = references.get(decl) ?? []
      if (exportee) sortie.push('exportée')
      else if (refs.length === 0) sortie.push('aucune référence')
      for (const r of refs) {
        const q = r.parent
        if (ts.isCallExpression(q) && q.arguments.some((a) => a === r)) {
          if (appelDEnveloppe(q)) continue
          if (estEffet(q)) { sortie.push(`effet (${fonctionEnglobante(r)?.nom ?? 'module'})`); continue }
        }
        sortie.push(...entreesDeLaPosition(r, pile))
      }
    }
    pile.delete(g)
    return [...new Set(sortie)]
  }

  // ── Les unités : les fonctions d'écran qui écrivent EN PROPRE ──
  const unites: Unite[] = []
  const portesParFamille: Record<Famille, number> = { table: 0, stockage: 0, rpc: 0, fonction: 0, auth: 0 }
  for (const fichier of fichiers) for (const g of fichier.fonctions) for (const p of g.portes) portesParFamille[p.famille]++
  for (const fichier of fichiers) {
    if (estLib(fichier)) continue
    const vues = new Map<string, number>()
    for (const g of fichier.fonctions) {
      const portes: { cle: string; pos: number; natures: Nature[] }[] = g.portes.map((p) => ({ cle: p.cle, pos: p.pos, natures: [naturesDePorte(p)] }))
      for (const a of g.appels) {
        const cible = cibleLib(fichier, a.id)
        const natures = cible ? naturesDeLAppel(cible) : null
        if (cible && natures) portes.push({ cle: `lib:${nomDeCible(cible)}`, pos: a.pos, natures: [...natures] })
      }
      const natures = [...new Set(portes.flatMap((p) => p.natures))].filter((x) => x !== 'lecture').sort()
      if (natures.length === 0) continue
      const premiere = Math.min(...portes.map((p) => p.pos))
      const verrou = verrouAvant(g, premiere)
      const entrees = verrou ? [] : entreesDeLaFonction(g, new Set())
      const base = `${fichier.chemin} › ${g.chaine}`
      const rang = (vues.get(base) ?? 0) + 1
      vues.set(base, rang)
      unites.push({
        cle: rang === 1 ? base : `${base} #${rang}`,
        ligne: fichier.sf.getLineAndCharacterOfPosition(g.noeud.getStart(fichier.sf)).line + 1,
        portes: [...new Set(portes.map((p) => p.cle))].sort(),
        natures,
        etat: verrou ? 'verrou' : entrees.length === 0 ? 'protégée' : 'nue',
        verrou,
        entrees,
      })
    }
  }
  for (const [chemin, nombre] of fetchs) {
    if (FETCH_ADMIS[chemin]?.nombre !== nombre) formes.push(`${chemin} — ${nombre} appel(s) fetch, admis : ${FETCH_ADMIS[chemin]?.nombre ?? 0}`)
  }
  const ecrivainsLib = new Map([...naturesLib].map(([cle, n]) => [nomDeCible(cle), [...n].sort()]))
  return { fichiers: fichiers.length, unites, ecrivainsLib, portesParFamille, declareesEmpruntees, formes, fetchs }
}

/** La catégorie d'une unité nue : automatique, nommée, ou null (une faute). */
export function categorieDe(u: Unite): CategorieAutomatique | CategorieNommee | null {
  const exception = EXCEPTIONS[u.cle]
  if (exception) return exception.categorie
  const n = new Set(u.natures)
  if (n.has('création')) return null
  if ([...n].every((x) => x === 'mise à jour')) return 'mise à jour'
  if ([...n].every((x) => x === 'mise à jour' || x === 'suppression')) return 'suppression'
  if ([...n].every((x) => x === 'session')) return 'session'
  return null
}

export function fautesDe(analyse: Analyse): string[] {
  const fautes = [...analyse.formes]
  for (const u of analyse.unites) {
    if (u.etat !== 'nue') continue
    const exception = EXCEPTIONS[u.cle]
    if (exception && !u.natures.includes('création')) {
      fautes.push(`${u.cle} — exception « ${exception.categorie} » sans objet : la fonction ne crée rien (${u.natures.join(', ')})`)
    }
    if (categorieDe(u) === null) {
      fautes.push(`${u.cle} :${u.ligne} — ${u.portes.join(', ')} sans verrou useRef, atteinte par ${u.entrees.join(' | ')}`)
    }
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

let memo: Analyse | null = null
const analyseDuDepot = () => (memo ??= analyser(sourcesDeProduction()))

// L'analyse lit TOUTE la source (deux cents fichiers, chacun parcouru par l'analyseur de TypeScript) : sous la charge de
// la machine, la première lecture dépasse les cinq secondes par défaut — comme le garde du code mort des Edge Functions.
describe('chaque écriture d’écran passe un verrou, ou dit pourquoi elle n’en a pas besoin', { timeout: 120_000 }, () => {
  it('parcourt toute la source de production — plancher : sinon « zéro faute » se confondrait avec « aveugle »', () => {
    const a = analyseDuDepot()
    expect(a.fichiers).toBeGreaterThan(180)
    expect(a.unites.length).toBeGreaterThanOrEqual(150)
    expect(a.ecrivainsLib.size).toBeGreaterThanOrEqual(30)
    expect(a.portesParFamille.table).toBeGreaterThanOrEqual(90)
    expect(a.portesParFamille.rpc).toBeGreaterThanOrEqual(40)
    expect(a.portesParFamille.fonction).toBeGreaterThanOrEqual(15)
    expect(a.portesParFamille.stockage).toBeGreaterThanOrEqual(8)
    expect(a.portesParFamille.auth).toBeGreaterThanOrEqual(2)
    expect(a.unites.filter((u) => u.etat === 'verrou').length).toBeGreaterThanOrEqual(60)
  })

  it('reconnaît les trois façons d’être gardé, sur des fonctions qu’on connaît', () => {
    const etat = (cle: string) => analyseDuDepot().unites.find((u) => u.cle === cle)?.etat
    // Un verrou propre, sur une porte directe…
    expect(etat('src/pages/DossiersList.tsx › NewDossierModal › handleSubmit')).toBe('verrou')
    // … et sur une fonction de src/lib qui écrit (l'import de documents).
    expect(etat('src/pages/dossier/AjouterDocumentsModal.tsx › AjouterDocumentsModal › lancerImport')).toBe('verrou')
    // Une enveloppe à deux étages (`agirSurMouvement` transmet à `sousVerrou`).
    expect(etat('src/pages/dossier/BanqueTab.tsx › BanqueTab › rapprocher')).toBe('protégée')
    // Une fonction appelée seulement après le verrou de son appelant.
    expect(etat('src/pages/dossier/FichePiece.tsx › FichePiece › uploadFile')).toBe('protégée')
  })

  it('n’en laisse aucune créer ou appeler l’extérieur sans verrou, hors exception nommée', () => {
    expect(fautesDe(analyseDuDepot()).join('\n'), 'deux envois du même rendu écriraient deux fois').toBe('')
  })

  it('compte chaque catégorie : une de plus est une écriture nouvelle à juger, une de moins une raison morte', () => {
    const nues = analyseDuDepot().unites.filter((u) => u.etat === 'nue')
    const comptes: Record<string, number> = {}
    for (const u of nues) {
      const c = categorieDe(u)
      if (c) comptes[c] = (comptes[c] ?? 0) + 1
    }
    const attendus: Record<string, number> = Object.fromEntries([
      ...Object.entries(CATEGORIES_AUTOMATIQUES).map(([c, { nombre }]) => [c, nombre]),
      ...Object.entries(CATEGORIES_NOMMEES).map(([c, { nombre }]) => [c, nombre]),
    ])
    const obtenus = Object.fromEntries(Object.keys(attendus).map((c) => [c, comptes[c] ?? 0]))
    // Ce qui a changé se nomme : la liste de chaque catégorie dont le compte a bougé.
    const ecarts = Object.keys(attendus).filter((c) => obtenus[c] !== attendus[c]).map((c) =>
      `${c} :\n${nues.filter((u) => categorieDe(u) === c).map((u) => `  ${u.cle}`).join('\n')}`)
    expect(obtenus, ecarts.join('\n')).toEqual(attendus)
  })

  it('n’admet que des exceptions et des portes déclarées qu’un code emprunte encore', () => {
    const a = analyseDuDepot()
    const nues = new Set(a.unites.filter((u) => u.etat === 'nue').map((u) => u.cle))
    for (const cle of Object.keys(EXCEPTIONS)) expect(nues, `exception morte : ${cle}`).toContain(cle)
    for (const cle of Object.keys(PORTES_DECLAREES)) expect(a.declareesEmpruntees, `porte déclarée que rien n’emprunte : ${cle}`).toContain(cle)
    for (const [chemin, { nombre }] of Object.entries(FETCH_ADMIS)) expect(a.fetchs.get(chemin), chemin).toBe(nombre)
  })
})

// ── Le garde lui-même : des défauts PLANTÉS, et leurs voisins corrects ───────────────────────────────────────────────

const CLIENT: Source = { chemin: 'src/lib/supabase.ts', texte: 'export const supabase = createClient()' }
const ecran = (texte: string): Source => ({ chemin: 'src/pages/Ecran.tsx', texte: `import { supabase } from '../lib/supabase'\n${texte}` })
const unite = (sources: Source[], fin: string) => {
  const u = analyser([CLIENT, ...sources]).unites.find((x) => x.cle.endsWith(fin))
  if (!u) throw new Error(`unité introuvable : ${fin}`)
  return u
}

describe('le garde des verrous d’écriture — défauts plantés', () => {
  it('attrape le défaut d’origine : un état pour seul garde', () => {
    const u = unite([ecran(`
      export default function Ecran() {
        const [saving, setSaving] = useState(false)
        async function creer(e) {
          e.preventDefault()
          setSaving(true)
          await supabase.from('dossiers').insert({ nom: 'x' })
          setSaving(false)
        }
        return <form onSubmit={creer}><button disabled={saving}>Créer</button></form>
      }`)], 'creer')
    expect(u).toMatchObject({ etat: 'nue', natures: ['création'], entrees: ['geste onSubmit (Ecran)'] })
    expect(categorieDe(u)).toBeNull()
  })

  it('reconnaît le verrou posé avant le premier await', () => {
    expect(unite([ecran(`
      export default function Ecran() {
        const enCours = useRef(false)
        async function creer() {
          if (enCours.current) return
          enCours.current = true
          try { await supabase.from('dossiers').insert({}) } finally { enCours.current = false }
        }
        return <button onClick={creer}>Créer</button>
      }`)], 'creer')).toMatchObject({ etat: 'verrou', verrou: 'enCours' })
  })

  it('refuse un verrou posé APRÈS un await, ou lu sans être posé, ou posé sans être lu', () => {
    const apres = unite([ecran(`
      function Ecran() {
        const enCours = useRef(false)
        async function creer() {
          await preparer()
          if (enCours.current) return
          enCours.current = true
          await supabase.rpc('creer_x')
        }
        return <button onClick={creer} />
      }`)], 'creer')
    const luSeul = unite([ecran(`
      function Ecran() {
        const enCours = useRef(false)
        async function creer() {
          if (enCours.current) return
          await supabase.functions.invoke('facturee', { body: {} })
        }
        return <button onClick={creer} />
      }`)], 'creer')
    const poseSeule = unite([ecran(`
      function Ecran() {
        const enCours = useRef(false)
        async function creer() {
          enCours.current = true
          await supabase.storage.from('pieces').upload('p', f)
        }
        return <button onClick={creer} />
      }`)], 'creer')
    expect([apres.etat, luSeul.etat, poseSeule.etat]).toEqual(['nue', 'nue', 'nue'])
  })

  it('ne prend pas pour un verrou le `.current` d’autre chose qu’un useRef (un champ qu’on focalise, un objet)', () => {
    const u = unite([ecran(`
      function Ecran({ boite }) {
        const champ = useRef(null)
        const faux = { current: false }
        async function creer() {
          if (boite.current) return
          boite.current = true
          if (faux.current) return
          faux.current = true
          champ.current?.focus()
          await supabase.from('t').insert({})
        }
        return <button onClick={creer} />
      }`)], 'creer')
    expect(u.etat).toBe('nue')
  })

  it('protège ce qu’une enveloppe à verrou reçoit, même à deux étages, et pas ce qu’un geste appelle aussi', () => {
    const sources = [ecran(`
      function Ecran() {
        const verrou = useRef(false)
        async function sousVerrou(ecrire) {
          if (verrou.current) return
          verrou.current = true
          try { await ecrire() } finally { verrou.current = false }
        }
        function agir(ecrire) { return sousVerrou(ecrire) }
        async function rapprocher() { await supabase.rpc('rapprocher') }
        async function ignorer() { await supabase.from('l').insert({}) }
        return <>
          <button onClick={() => agir(() => rapprocher())} />
          <button onClick={() => agir(ignorer)} />
          <button onClick={() => ignorer()} />
          <button onClick={() => sousVerrou(async () => { await supabase.from('m').insert({}) })} />
        </>
      }`)]
    expect(unite(sources, 'rapprocher').etat).toBe('protégée')
    expect(unite(sources, '(argument de sousVerrou)').etat).toBe('protégée')
    const ignorer = unite(sources, 'ignorer')
    expect(ignorer.etat).toBe('nue')
    expect(ignorer.entrees).toEqual(['geste onClick (Ecran)'])
  })

  it('protège ce qu’on appelle après son propre verrou, et voit le chemin qui le contourne', () => {
    const sources = [ecran(`
      function Ecran() {
        const verrou = useRef(false)
        async function deposer() { await supabase.storage.from('pieces').upload('p', f) }
        async function enregistrer() {
          if (verrou.current) return
          verrou.current = true
          try { await deposer() } finally { verrou.current = false }
        }
        async function brouillon() { await deposer() }
        return <><button onClick={enregistrer} /><button onClick={brouillon} /></>
      }`)]
    expect(unite(sources, 'deposer').entrees).toEqual(['geste onClick (Ecran)'])
  })

  it('suit les écrivains de src/lib d’appel en appel, et ignore un nom masqué', () => {
    const lib: Source = { chemin: 'src/lib/depot.ts', texte: `
      import { supabase } from './supabase'
      async function inserer() { await supabase.from('pieces').insert({}) }
      export async function deposer() { await inserer() }
      export async function lire() { return supabase.from('pieces').select('*') }` }
    const sources = [lib, ecran(`
      import { deposer, lire } from '../lib/depot'
      function Ecran() {
        async function envoyer() { await deposer() }
        async function relire() { await lire() }
        function interne() { const deposer = () => 1; return deposer() }
        return <><button onClick={envoyer} /><button onClick={relire} /><button onClick={interne} /></>
      }`)]
    const a = analyser([CLIENT, ...sources])
    expect(a.ecrivainsLib.get('deposer')).toEqual(['création'])
    expect(a.unites.map((u) => u.cle)).toEqual(['src/pages/Ecran.tsx › Ecran › envoyer'])
    expect(a.unites[0].entrees).toEqual(['geste onClick (Ecran)'])
  })

  it('ne compte pas une position de type pour une référence (la promesse gardée de RetourBanque)', () => {
    const u = unite([ecran(`
      async function finaliser() { return supabase.functions.invoke('banque-connexion', { body: { action: 'finaliser' } }) }
      export default function Ecran() {
        const appel = useRef<ReturnType<typeof finaliser> | null>(null)
        useEffect(() => { if (!appel.current) appel.current = finaliser() }, [])
        return null
      }`)], 'finaliser')
    expect(u).toMatchObject({ etat: 'protégée', portes: ['fonction:banque-connexion:finaliser'] })
  })

  it('ne prend pas `Set.delete` ni `el.remove()` pour des portes, mais dit une méthode du client qu’il ne connaît pas', () => {
    const a = analyser([CLIENT, ecran(`
      function Ecran() {
        async function basculer(s, el) { s.delete(1); el.remove(); await supabase.from('t').select('*').explain() }
        return <button onClick={basculer} />
      }`)])
    expect(a.unites).toEqual([])
    expect(a.formes).toEqual([expect.stringContaining('méthode « explain »')])
  })

  it('décide sur le texte : mise à jour, suppression ; un upsert sans clé déclarée est une création', () => {
    const sources = [ecran(`
      function Ecran() {
        async function maj() { await supabase.from('t').update({ a: 1 }).eq('id', 1) }
        async function cle() { await supabase.from('t').upsert({ a: 1 }, { onConflict: 'dossier_id' }) }
        async function retirer() { await supabase.from('t').delete().eq('id', 1); await supabase.storage.from('s').remove(['x']) }
        async function sansCle() { await supabase.from('t').upsert({ a: 1 }) }
        return <><button onClick={maj} /><button onClick={cle} /><button onClick={retirer} /><button onClick={sansCle} /></>
      }`)]
    expect(categorieDe(unite(sources, 'maj'))).toBe('mise à jour')
    expect(categorieDe(unite(sources, 'cle'))).toBe('mise à jour')
    expect(categorieDe(unite(sources, 'retirer'))).toBe('suppression')
    expect(categorieDe(unite(sources, 'sansCle'))).toBeNull()
  })

  it('dit une écriture d’effet, et un fetch qui n’est pas admis', () => {
    const a = analyser([CLIENT, ecran(`
      function Ecran() {
        useEffect(() => { void supabase.rpc('marquer_vu') }, [])
        async function envoyer() { await fetch('https://ailleurs', { method: 'POST' }) }
        return <button onClick={envoyer} />
      }`)])
    expect(a.unites.map((u) => [u.etat, u.entrees])).toEqual([['nue', ['effet (Ecran)']]])
    expect(a.formes).toEqual([expect.stringContaining('src/pages/Ecran.tsx — 1 appel(s) fetch, admis : 0')])
  })

  it('distingue bien les deux issues — sinon il ne prouverait rien', () => {
    const sources = [ecran(`
      function Ecran() {
        const v = useRef(false)
        async function garde() { if (v.current) return; v.current = true; try { await supabase.rpc('a') } finally { v.current = false } }
        async function nue() { await supabase.rpc('b') }
        return <><button onClick={garde} /><button onClick={nue} /></>
      }`)]
    const a = analyser([CLIENT, ...sources])
    expect(a.unites.map((u) => u.etat).sort()).toEqual(['nue', 'verrou'])
    expect(fautesDe(a)).toHaveLength(1)
  })
})
