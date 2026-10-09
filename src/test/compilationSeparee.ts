import ts from 'typescript'

// LES GARDES DE COPIE COMPILENT DES BLOCS SEULS, et chaque compilation bâtissait un programme entier : la bibliothèque
// standard relue, liée et vérifiée à chaque appel. Trois fichiers (cdarRecuCopie, cdarEncaisseeCopie,
// copiesFacturation) en bâtissaient huit, d'une demi-seconde à deux secondes chacun ; sous la charge de la barrière, un
// seul test passait les 5 s de Vitest (5,3 s mesurées) et la barrière le rejouait. Ce module les bâtit en UN programme
// par fichier de test, appelé depuis un `beforeAll` : la bibliothèque n'est lue et vérifiée qu'une fois, chaque source
// l'est toujours entière.
//
// Ce que la mise en commun ne doit PAS changer, et qui est tenu ici plutôt qu'espéré :
//   - chaque source reste un fichier à elle : un nom qu'elle emprunte ne se trouve pas chez une voisine, un nom qu'elle
//     déclare deux fois se voit chez elle seule. C'est vrai d'un MODULE (sa portée est à lui), pas d'un script, dont les
//     déclarations rejoindraient la portée globale commune — une source qui n'est pas un module est donc REFUSÉE, jamais
//     compilée avec les autres ;
//   - chaque source reçoit ce que lui rendrait son propre programme : ses diagnostics, plus ceux qui ne sont à aucune
//     source (les options, le global, la bibliothèque standard), qui valent pour toutes.
// `compilationSeparee.test.ts` confronte les deux chemins, source par source.

/** Le texte d'un diagnostic tel que les gardes le comparent : son code et son message, sans le nom du fichier. */
function texteDe(d: ts.Diagnostic): string {
  return `${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
}

/** Un hôte qui sert les sources VIRTUELLES par leur nom de fichier, et lit le reste (la bibliothèque) sur le disque. */
function hoteVirtuel(options: ts.CompilerOptions, virtuelles: ReadonlyMap<string, string>): ts.CompilerHost {
  const hote = ts.createCompilerHost(options)
  const lire = hote.getSourceFile.bind(hote)
  hote.getSourceFile = (nom, version, ...reste) => {
    const code = virtuelles.get(nom)
    return code === undefined ? lire(nom, version, ...reste) : ts.createSourceFile(nom, code, version)
  }
  const existe = hote.fileExists.bind(hote)
  hote.fileExists = (nom) => virtuelles.has(nom) || existe(nom)
  return hote
}

/**
 * Les diagnostics de chaque source comme si elle était compilée SEULE sous `options` — en un seul programme.
 *
 * Deux clés au même texte partagent un fichier : le compilateur est déterministe, et vérifier deux fois le même texte
 * ne prouverait rien de plus. Lève si une source n'est pas un module : compilée avec les autres, elle partagerait leur
 * portée, et un nom qu'elle emprunte pourrait se trouver chez une voisine — le défaut même que ces gardes attrapent.
 */
export function diagnosticsSepares<Cle extends string>(sources: Record<Cle, string>, options: ts.CompilerOptions): Record<Cle, string[]> {
  const cles = Object.keys(sources) as Cle[]
  // Un nom de fichier par TEXTE, tiré de son rang : une clé n'a pas à être un nom de fichier valable.
  const textes = [...new Set(cles.map((cle) => sources[cle]))]
  const fichierDe = new Map(textes.map((texte, rang) => [texte, `/copies/source-${rang}.ts`]))
  const virtuelles = new Map(textes.map((texte) => [fichierDe.get(texte) as string, texte]))
  const programme = ts.createProgram([...virtuelles.keys()], options, hoteVirtuel(options, virtuelles))
  for (const cle of cles) {
    const fichier = programme.getSourceFile(fichierDe.get(sources[cle]) as string)
    if (!fichier || !ts.isExternalModule(fichier)) {
      throw new Error(`la source « ${cle} » n'est pas un module : compilée avec les autres, elle partagerait leur portée`)
    }
  }
  const tous = ts.getPreEmitDiagnostics(programme)
  const rendu = {} as Record<Cle, string[]>
  for (const cle of cles) {
    const sien = fichierDe.get(sources[cle])
    rendu[cle] = tous.filter((d) => !d.file || !virtuelles.has(d.file.fileName) || d.file.fileName === sien).map(texteDe)
  }
  return rendu
}

/**
 * Les diagnostics d'une source compilée seule, dans SON programme : le chemin d'avant, gardé pour que
 * `compilationSeparee.test.ts` confronte l'autre à lui.
 */
export function diagnosticsSeuls(code: string, options: ts.CompilerOptions): string[] {
  const fichier = '/copies/seule.ts'
  const programme = ts.createProgram([fichier], options, hoteVirtuel(options, new Map([[fichier, code]])))
  return ts.getPreEmitDiagnostics(programme).map(texteDe)
}

const TRANSPILES = new Map<string, string>()

/**
 * Les exports d'une source transpilée puis exécutée SEULE : tout nom qu'elle emprunterait au reste d'un fichier lève.
 *
 * Le JavaScript se transpile une fois par texte (les gardes exécutent plusieurs fois les mêmes blocs) ; le module, lui,
 * est rebâti à chaque appel par `new Function`, comme avant : aucun test ne reçoit l'état laissé par un autre.
 */
export function executerModule<T>(code: string): T {
  let js = TRANSPILES.get(code)
  if (js === undefined) {
    js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    TRANSPILES.set(code, js)
  }
  const exports: Record<string, unknown> = {}
  new Function('exports', js)(exports)
  return exports as unknown as T
}
