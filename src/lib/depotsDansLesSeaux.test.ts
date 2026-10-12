import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { TYPES_DES_FICHIERS_DE_PIECE, TYPES_DES_LOGOS, typeSansParametres } from './bornesStockage'
import { bornesDeLaMigration, texteDeLaMigration, type BornesLues } from '../test/bornesStockage'

// TOUT DÉPÔT DANS UN SEAU ENVOIE UN TYPE QUE LA MIGRATION ADMET POUR CE SEAU (ligne 22.6).
//
// La migration `bornes_du_stockage` borne les trois seaux en types ; un dépôt qui enverrait un autre type serait refusé
// par le stockage, en production, et en anglais. Ce garde part de TOUTE la source — le navigateur (`src/`, hors tests) et
// les Edge Functions (`supabase/functions/`) —, lit l'ARBRE de chaque fichier qui nomme `storage` (TypeScript, jamais la
// ligne : une chaîne coupée sur trois lignes reste une chaîne), et juge chaque accès au stockage :
//   - une lecture (`download`, `list`, les adresses) et un retrait (`remove`) ne déposent rien : nommés, laissés ;
//   - un dépôt (`upload`, `update`) se juge : son seau doit être écrit en toutes lettres, et son corps d'une forme
//     reconnue, dont on sait quels types il peut porter :
//       · `<x>.corps`, `<x>` venant de `preparerPiece` (les types d'une pièce), `preparerLogo` (ceux d'un logo) ou
//         `preparerContenu('<seau>', …, <type>)` (le type, littéral ou constante faite de littéraux) — le préparateur
//         nomme le MÊME seau que le dépôt ;
//       · dans une Edge Function seulement, `new Blob([…], { type })` dont le type vient de `typeDUnePiece` (la copie
//         gardée du bloc des pièces), ou est un littéral — ce dernier compté en EXCEPTION, faute de borne de taille ;
//   - toute autre forme est une FAUTE, jamais un saut : un seau tenu dans une variable, `storage` déstructuré, une
//     méthode inconnue (`move`, `copy`, `uploadToSignedUrl`…), un corps qu'on ne sait pas suivre.
// Puis, seau par seau, l'union des types que les dépôts peuvent envoyer doit ÊTRE la liste de la migration : un type
// envoyé qu'elle n'admet pas serait refusé, un type admis que nul n'envoie élargit le seau pour rien — ni plus, ni moins.
//
// Ce qu'il ne voit pas, dit plutôt que laissé croire : la VALEUR d'un type à l'exécution (le compilateur la tient pour
// `preparerContenu`, la copie gardée de `typeDUnePiece` pour receive-email, et bornesStockage.test.ts la sortie des
// préparateurs) ; un dépôt fait par un autre chemin que le SDK (un `fetch` vers `/storage/v1/object`, que
// ecrituresVerifiees ne voit pas non plus — la source n'en porte aucun).

const RACINE = new URL('../../', import.meta.url).pathname

function lister(dossier: string, garder: (chemin: string) => boolean): string[] {
  const rendu: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) rendu.push(...lister(chemin, garder))
    else if (garder(chemin)) rendu.push(chemin)
  }
  return rendu
}

type Cote = 'navigateur' | 'fonction'

interface Source { chemin: string; texte: string; cote: Cote }

function sources(): Source[] {
  const navigateur = lister(join(RACINE, 'src'), (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c) && !c.includes('/src/test/'))
  const fonctions = lister(join(RACINE, 'supabase/functions'), (c) => /\.tsx?$/.test(c))
  return [
    ...navigateur.map((c) => ({ chemin: relative(RACINE, c), texte: readFileSync(c, 'utf8'), cote: 'navigateur' as const })),
    ...fonctions.map((c) => ({ chemin: relative(RACINE, c), texte: readFileSync(c, 'utf8'), cote: 'fonction' as const })),
  ]
}

const LECTURES = ['download', 'list', 'createSignedUrl', 'createSignedUrls', 'getPublicUrl', 'exists', 'info']
const RETRAITS = ['remove']
const DEPOTS = ['upload', 'update']

export interface Depot {
  chemin: string
  ligne: number
  seau: string
  forme: 'préparé' | 'copie des pièces' | 'littéral'
  types: string[]
}

export interface Analyse { depots: Depot[]; fautes: string[]; lus: number }

const PREPARATEURS_A_SEAU_FIXE: Record<string, { seau: string; types: readonly string[] }> = {
  preparerPiece: { seau: 'pieces', types: TYPES_DES_FICHIERS_DE_PIECE },
  preparerLogo: { seau: 'cabinet-logos', types: TYPES_DES_LOGOS },
}

function litteral(n: ts.Node | undefined): string | null {
  return n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null
}

function deballer(n: ts.Expression): ts.Expression {
  let e = n
  while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

/** La déclaration la plus proche, AVANT `depuis`, de la variable `nom` — dans la fonction qui l'englobe, ou le module. */
function declarationDe(nom: string, depuis: ts.Node): ts.VariableDeclaration | null {
  let portee: ts.Node = depuis
  while (portee.parent && !ts.isFunctionLike(portee) && !ts.isSourceFile(portee)) portee = portee.parent
  const candidates: ts.VariableDeclaration[] = []
  const chercher = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nom && n.pos < depuis.pos) candidates.push(n)
    ts.forEachChild(n, chercher)
  }
  chercher(portee)
  if (candidates.length > 0) return candidates[candidates.length - 1]
  return ts.isSourceFile(portee) ? null : declarationDe(nom, portee)
}

/** Les littéraux qu'une expression de type peut valoir : un littéral, une branche de `?:`, une constante qui en est faite. */
function typesLitteraux(e: ts.Expression, depuis: ts.Node): string[] | null {
  const n = deballer(e)
  const lit = litteral(n)
  if (lit !== null) return [lit]
  if (ts.isConditionalExpression(n)) {
    const a = typesLitteraux(n.whenTrue, depuis)
    const b = typesLitteraux(n.whenFalse, depuis)
    return a && b ? [...a, ...b] : null
  }
  if (ts.isIdentifier(n)) {
    const d = declarationDe(n.text, depuis)
    return d?.initializer ? typesLitteraux(d.initializer, d) : null
  }
  return null
}

/** Ce qu'un appel de préparateur donne : son seau et ses types — ou la raison pour laquelle on ne le suit pas. */
function preparation(appel: ts.Expression, depuis: ts.Node): { seau: string; types: string[] } | { faute: string } {
  const n = deballer(appel)
  if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return { faute: 'le corps ne vient pas d’un préparateur' }
  const nom = n.expression.text
  const fixe = PREPARATEURS_A_SEAU_FIXE[nom]
  if (fixe) return { seau: fixe.seau, types: [...fixe.types] }
  if (nom === 'preparerContenu') {
    const seau = litteral(n.arguments[0])
    if (seau === null) return { faute: 'preparerContenu sans seau littéral' }
    const types = n.arguments[2] ? typesLitteraux(n.arguments[2], depuis) : null
    if (types === null) return { faute: 'preparerContenu dont le type ne se lit pas en littéraux' }
    return { seau, types }
  }
  return { faute: `« ${nom} » n’est pas un préparateur des bornes` }
}

/** Les préparations d'où vient un `<x>.corps` : la déclaration de `<x>`, un appel ou les branches d'un `?:` (`null` admis). */
function preparationsDe(x: ts.Identifier): { seau: string; types: string[] }[] | { faute: string } {
  const d = declarationDe(x.text, x)
  if (!d?.initializer) return { faute: `« ${x.text} » n’a pas de déclaration lisible` }
  const init = deballer(d.initializer)
  const branches = ts.isConditionalExpression(init) ? [init.whenTrue, init.whenFalse] : [init]
  const rendu: { seau: string; types: string[] }[] = []
  for (const b of branches) {
    if (deballer(b).kind === ts.SyntaxKind.NullKeyword) continue
    const p = preparation(b, d)
    if ('faute' in p) return p
    rendu.push(p)
  }
  return rendu.length > 0 ? rendu : { faute: `« ${x.text} » ne vient d’aucun préparateur` }
}

function analyserDepot(appel: ts.CallExpression, seau: string, cote: Cote): Omit<Depot, 'chemin' | 'ligne' | 'seau'> | { faute: string } {
  const corps = appel.arguments[1] ? deballer(appel.arguments[1]) : undefined
  if (!corps) return { faute: 'dépôt sans corps' }
  if (ts.isPropertyAccessExpression(corps) && corps.name.text === 'corps' && ts.isIdentifier(corps.expression)) {
    const preps = preparationsDe(corps.expression)
    if ('faute' in preps) return preps
    const autre = preps.find((p) => p.seau !== seau)
    if (autre) return { faute: `préparé pour le seau « ${autre.seau} », déposé dans « ${seau} »` }
    return { forme: 'préparé', types: preps.flatMap((p) => p.types) }
  }
  if (cote === 'fonction' && ts.isNewExpression(corps) && ts.isIdentifier(corps.expression) && corps.expression.text === 'Blob') {
    const options = corps.arguments?.[1]
    if (!options || !ts.isObjectLiteralExpression(options)) return { faute: 'un Blob sans type' }
    const propriete = options.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'type')
    if (!propriete) return { faute: 'un Blob sans type' }
    const valeur = ts.isShorthandPropertyAssignment(propriete) ? propriete.name : ts.isPropertyAssignment(propriete) ? propriete.initializer : null
    if (!valeur) return { faute: 'un type de Blob illisible' }
    const lit = litteral(deballer(valeur))
    if (lit !== null) return { forme: 'littéral', types: [lit] }
    if (ts.isIdentifier(valeur)) {
      const d = declarationDe(valeur.text, valeur)
      const init = d?.initializer ? deballer(d.initializer) : null
      if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'typeDUnePiece') {
        if (seau !== 'pieces') return { faute: `le type d’une pièce déposé dans « ${seau} »` }
        return { forme: 'copie des pièces', types: [...TYPES_DES_FICHIERS_DE_PIECE] }
      }
    }
    return { faute: 'un Blob dont le type ne vient ni d’un littéral ni de typeDUnePiece' }
  }
  return { faute: 'un corps que le garde ne sait pas suivre (ni `<x>.corps` d’un préparateur, ni un Blob typé d’une Edge Function)' }
}

/** Les dépôts et les fautes d'une source. */
export function analyser(source: Source): Analyse {
  const depots: Depot[] = []
  const fautes: string[] = []
  if (!/\bstorage\b/.test(source.texte)) return { depots, fautes, lus: 0 }
  const fichier = ts.createSourceFile(source.chemin, source.texte, ts.ScriptTarget.Latest, true,
    source.chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const ou = (n: ts.Node) => `${source.chemin}:${fichier.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
  const visiter = (n: ts.Node) => {
    if (ts.isBindingElement(n) && (n.propertyName ?? n.name).getText() === 'storage') fautes.push(`${ou(n)} : « storage » déstructuré`)
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'storage') {
      const from = n.parent
      const appelFrom = from?.parent
      if (!ts.isPropertyAccessExpression(from) || from.name.text !== 'from' || !appelFrom || !ts.isCallExpression(appelFrom) || appelFrom.expression !== from) {
        fautes.push(`${ou(n)} : un accès au stockage d’une forme non reconnue (autre chose que « .storage.from(…) »)`)
      } else {
        const methode = appelFrom.parent
        const appel = methode?.parent
        if (!methode || !ts.isPropertyAccessExpression(methode) || methode.expression !== appelFrom || !appel || !ts.isCallExpression(appel) || appel.expression !== methode) {
          fautes.push(`${ou(n)} : un seau tenu dans une variable, ou une méthode qu’on n’appelle pas`)
        } else if (DEPOTS.includes(methode.name.text)) {
          const seau = litteral(appelFrom.arguments[0])
          if (seau === null) {
            fautes.push(`${ou(n)} : un dépôt dans un seau qui n’est pas écrit en toutes lettres`)
          } else {
            const r = analyserDepot(appel, seau, source.cote)
            if ('faute' in r) fautes.push(`${ou(n)} : ${r.faute}`)
            else depots.push({ chemin: source.chemin, ligne: fichier.getLineAndCharacterOfPosition(n.getStart()).line + 1, seau, ...r })
          }
        } else if (!LECTURES.includes(methode.name.text) && !RETRAITS.includes(methode.name.text)) {
          fautes.push(`${ou(n)} : la méthode de stockage « ${methode.name.text} » n’est pas reconnue`)
        }
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(fichier)
  return { depots, fautes, lus: 1 }
}

/**
 * Seau par seau, l'écart entre ce que les dépôts envoient et ce que la migration admet — vide quand ils coïncident.
 * Un seau que nul dépôt n'atteint, ou qu'aucune borne ne nomme, est un écart lui aussi.
 */
export function ecarts(depots: Depot[], bornes: BornesLues[]): string[] {
  const rendu: string[] = []
  const seaux = new Set([...depots.map((d) => d.seau), ...bornes.map((b) => b.seau)])
  for (const seau of [...seaux].sort()) {
    const admis = new Set(bornes.find((b) => b.seau === seau)?.types ?? [])
    const envoyes = new Set(depots.filter((d) => d.seau === seau).flatMap((d) => d.types.map(typeSansParametres)))
    for (const t of envoyes) if (!admis.has(t)) rendu.push(`${seau} : « ${t} » est envoyé, la migration ne l’admet pas`)
    for (const t of admis) if (!envoyes.has(t)) rendu.push(`${seau} : « ${t} » est admis, nul dépôt ne l’envoie`)
  }
  return rendu
}

/** Les dépôts au type littéral (sans borne de taille), par fichier, avec leur raison ET leur nombre. */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'supabase/functions/superpdp-sync/index.ts': {
    nombre: 1,
    raison:
      'le résumé texte d’une facture de Super PDP, que la fonction écrit elle-même : son type est le littéral ' +
      '`text/plain` (admis), et il pèse quelques Kio — aucune borne de taille à dire. La fonction n’a pas été touchée ' +
      'par la ligne 22.6 : la redéployer pour cela seul n’apporterait rien',
  },
}

describe('tout dépôt dans un seau envoie un type que la migration admet pour ce seau', () => {
  let analyses: (Analyse & { source: Source })[] = []
  let tout: Source[] = []
  beforeAll(() => {
    tout = sources()
    analyses = tout.map((source) => ({ source, ...analyser(source) }))
  }, 60_000)
  const depots = () => analyses.flatMap((a) => a.depots)
  const bornes = bornesDeLaMigration(texteDeLaMigration())

  it('part de toute la source — et le plancher distingue « zéro faute » d’« aveugle »', () => {
    expect(tout.filter((s) => s.cote === 'navigateur').length).toBeGreaterThan(250)
    expect(tout.filter((s) => s.cote === 'fonction').length).toBeGreaterThanOrEqual(16)
    expect(analyses.reduce((n, a) => n + a.lus, 0)).toBeGreaterThanOrEqual(20)
    // Onze dépôts : les sept chemins du navigateur (deux pour une facture reçue, deux pour un pack) et les deux fonctions.
    // Un dépôt de plus se juge ici comme les autres ; ce nombre dit seulement qu'on les voit tous.
    expect(depots().map((d) => `${d.chemin} → ${d.seau}`).sort()).toEqual([
      'src/lib/depot.ts → pieces',
      'src/lib/importFichiers.ts → pieces',
      'src/lib/packGenerator.ts → packs',
      'src/lib/packGenerator.ts → packs',
      'src/lib/receptionPlateforme.ts → pieces',
      'src/lib/receptionPlateforme.ts → pieces',
      'src/pages/CabinetBrandingPage.tsx → cabinet-logos',
      'src/pages/dossier/CotisationsTab.tsx → pieces',
      'src/pages/dossier/FichePiece.tsx → pieces',
      'supabase/functions/receive-email/index.ts → pieces',
      'supabase/functions/superpdp-sync/index.ts → pieces',
    ])
  })

  it('aucune forme non reconnue', () => {
    expect(analyses.flatMap((a) => a.fautes)).toEqual([])
  })

  it('seau par seau, ce que les dépôts envoient est exactement ce que la migration admet', () => {
    expect(ecarts(depots(), bornes)).toEqual([])
  })

  it('le seau public des logos ne reçoit que des logos préparés — et jamais un SVG', () => {
    const logos = depots().filter((d) => d.seau === 'cabinet-logos')
    expect(logos.map((d) => d.forme)).toEqual(['préparé'])
    expect(logos.flatMap((d) => d.types)).not.toContain('image/svg+xml')
  })

  it('les dépôts au type littéral sont ceux des exceptions, au nombre près', () => {
    const parFichier: Record<string, number> = {}
    for (const d of depots().filter((x) => x.forme === 'littéral')) parFichier[d.chemin] = (parFichier[d.chemin] ?? 0) + 1
    expect(parFichier).toEqual(Object.fromEntries(Object.entries(EXCEPTIONS).map(([f, e]) => [f, e.nombre])))
  })
})

describe('le garde mord (défauts plantés)', () => {
  const plante = (texte: string, cote: Cote = 'navigateur', chemin = 'src/plante.ts') => analyser({ chemin, texte, cote })
  const bornes = bornesDeLaMigration(texteDeLaMigration())

  it('un fichier déposé tel quel, comme avant la ligne 22.6', () => {
    const a = plante("async function f(file: File) { const { error } = await supabase.storage.from('pieces').upload('p', file) }")
    expect(a.fautes).toEqual([expect.stringMatching(/un corps que le garde ne sait pas suivre/)])
  })

  it('une pièce préparée déposée dans le seau des packs', () => {
    const a = plante("async function f(file: File) { const pret = await preparerPiece(file); await supabase.storage.from('packs').upload('p', pret.corps) }")
    expect(a.fautes).toEqual([expect.stringMatching(/préparé pour le seau « pieces », déposé dans « packs »/)])
  })

  it('un type que la migration n’admet pas — et un type admis que nul n’envoie', () => {
    const a = plante(`async function f(o: Uint8Array, xml: boolean) {
      const type = xml ? 'text/html' : 'application/pdf'
      const pret = preparerContenu('pieces', o, type)
      await supabase.storage.from('pieces').upload('p', pret.corps)
    }`)
    expect(a.fautes).toEqual([])
    expect(a.depots[0].types).toEqual(['text/html', 'application/pdf'])
    expect(ecarts(a.depots, bornes.filter((b) => b.seau === 'pieces'))).toEqual([
      'pieces : « text/html » est envoyé, la migration ne l’admet pas',
      'pieces : « image/jpeg » est admis, nul dépôt ne l’envoie',
      'pieces : « image/png » est admis, nul dépôt ne l’envoie',
      'pieces : « text/csv » est admis, nul dépôt ne l’envoie',
      'pieces : « text/plain » est admis, nul dépôt ne l’envoie',
    ])
  })

  it('un SVG déposé par une Edge Function dans le seau public', () => {
    const a = plante('const r = await admin.storage.from("cabinet-logos").upload(p, new Blob([t], { type: "image/svg+xml" }))', 'fonction', 'supabase/functions/x/index.ts')
    expect(ecarts(a.depots, bornes.filter((b) => b.seau === 'cabinet-logos'))).toContain('cabinet-logos : « image/svg+xml » est envoyé, la migration ne l’admet pas')
  })

  it('un Blob littéral dans le navigateur : pas de borne de taille, donc une faute', () => {
    const a = plante("await supabase.storage.from('pieces').upload('p', new Blob([t], { type: 'text/plain' }))")
    expect(a.fautes).toHaveLength(1)
  })

  it('le type déclaré par l’expéditeur d’un e-mail, comme receive-email le faisait', () => {
    const a = plante('await supabase.storage.from("pieces").upload(path, bytes, { contentType: fichier.content_type || "application/octet-stream" })', 'fonction')
    expect(a.fautes).toEqual([expect.stringMatching(/un corps que le garde ne sait pas suivre/)])
  })

  it.each([
    ['un seau tenu dans une variable', "const seau = supabase.storage.from('pieces'); await seau.upload('p', f)", /seau tenu dans une variable/],
    ['un seau qui n’est pas littéral', "await supabase.storage.from(nom).upload('p', pret.corps)", /pas écrit en toutes lettres/],
    ['storage déstructuré', 'const { storage } = supabase', /déstructuré/],
    ['une méthode qui dépose autrement', "await supabase.storage.from('pieces').uploadToSignedUrl('p', jeton, f)", /n’est pas reconnue/],
    ['un déplacement', "await supabase.storage.from('pieces').move('a', 'b')", /n’est pas reconnue/],
    ['une gestion des seaux', "await supabase.storage.updateBucket('pieces', { public: true })", /forme non reconnue/],
    ['un Blob typé d’ailleurs dans une fonction', 'await s.storage.from("pieces").upload(p, new Blob([b], { type: fichier.type }))', /ni d’un littéral ni de typeDUnePiece/],
  ])('%s', (_quoi, texte, motif) => {
    const a = plante(texte, texte.includes('"') ? 'fonction' : 'navigateur')
    expect(a.fautes.join('\n')).toMatch(motif)
  })

  it('une migration à qui il manque un type envoyé, ou qui en admet un de trop', () => {
    const texte = texteDeLaMigration()
    const sansCsv = bornesDeLaMigration(texte.replace("'text/csv', ", ''))
    const avecGif = bornesDeLaMigration(texte.replace("'image/webp']", "'image/webp', 'image/gif']"))
    const reels = sources().map(analyser).flatMap((a) => a.depots)
    expect(ecarts(reels, sansCsv)).toEqual(['pieces : « text/csv » est envoyé, la migration ne l’admet pas'])
    expect(ecarts(reels, avecGif)).toEqual(['cabinet-logos : « image/gif » est admis, nul dépôt ne l’envoie'])
  }, 60_000)
})
