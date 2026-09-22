import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// LES EDGE FUNCTIONS NE SONT TYPE-VÉRIFIÉES PAR RIEN — mesuré le 22/09/2026, et c'est structurel :
// `tsconfig.app.json` n'inclut que `src`, `tsconfig.node.json` que `vite.config.ts`. Les 4 419
// lignes de `supabase/functions/` n'ont jamais rencontré un compilateur, et le déploiement ne
// type-vérifie pas non plus (il regroupe, il ne contrôle pas).
//
// CE QUE ÇA COÛTE EXACTEMENT, ET C'EST PLUS ÉTROIT QU'IL N'Y PARAÎT. Ce dépôt garde déjà de ce
// côté-là les lectures, les écritures, la pagination, les régions AWS, la surface IAM et les copies
// dupliquées — tous par des scanners qui lisent la SOURCE comme du texte. Il manquait la couche que
// seul un compilateur porte, et CLAUDE.md la nomme depuis le 22/09/2026 sur les trois couches d'un
// drapeau de lecture partielle : « le scanner voit qu'on CALCULE le drapeau, le compilateur qu'on le
// LIT ». Côté `src/`, `noUnusedLocals` s'en charge. Côté Edge Functions, personne.
//
// LE CAS QUI LE MONTRE, ET QUI EST DANS CE FICHIER SOUS FORME DE TEST :
//
//     const lectureDossiers = await lireTout(...)
//     const incomplet = !lectureDossiers.complete   // le drapeau EST lu → `lecturesSignalees` vert
//     ...                                           // et `incomplet` n'atteint rien
//
// Aucun scanner de texte ne peut voir ça : le drapeau est bien lu, la liaison est bien couverte.
// Seul un compilateur sait qu'une valeur calculée ne va nulle part.

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI EST GARDÉ, ET CE QUI NE L'EST PAS — écrit plutôt que laissé deviner.
//
// GARDÉ : le CODE MORT. Une variable, un import, un paramètre, une branche que rien n'atteint. Ces
// diagnostics-là sont VERTS aujourd'hui sur les quatorze fonctions, donc le garde se pose sans
// toucher une seule ligne de production — et c'est la condition pour qu'il se pose du tout.
//
// PAS GARDÉ : le typage complet. Mesuré le même jour, il rend 53 erreurs sous les réglages par
// défaut de TypeScript 6 (qui active `strict`), et 26 en le désactivant. **Aucune n'est un défaut** :
// elles se répartissent entre les SDK tiers non installés (voir `supabase/types/npm.d.ts`) et le
// typage générique d'`Uint8Array` de la lib DOM. Les fermer demanderait soit d'installer cinq SDK
// que `package.json` ne porte pas — payé par chaque `npm ci` de la CI —, soit une LISTE de noms de
// types tenue à la main, c'est-à-dire la liste d'inclusion dont ce dépôt connaît la panne sous cinq
// autres noms. Et corriger les sources demanderait sept redéploiements, chacun avec son `verify_jwt`
// à relire, sa comparaison avant écrasement et son aller-retour : c'est mot pour mot l'arbitrage
// écrit pour les huit ternaires interdits, et il penche du même côté.
//
// On garde donc ce qui est vrai et vérifiable, et on NOMME le reste — plutôt que de promettre « les
// Edge Functions sont type-vérifiées », ce qui serait la vérification qui prouve une chose plus
// faible que celle qu'on lui prête.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const RACINE = new URL('../../', import.meta.url).pathname

/** Les diagnostics de CODE MORT, et eux seuls. Tout le reste est hors du périmètre annoncé. */
const CODE_MORT = new Map<number, string>([
  [6133, 'déclaré, jamais lu'],
  [6138, 'propriété déclarée, jamais lue'],
  [6192, 'tous les imports de cette déclaration sont inutilisés'],
  [6196, 'déclaré, jamais utilisé'],
  [6198, 'tous les éléments déstructurés sont inutilisés'],
  [6199, 'toutes les variables sont inutilisées'],
  [7027, 'code inatteignable'],
  [7028, 'étiquette inutilisée'],
  [7029, 'cas de `switch` qui déborde sur le suivant'],
])

// LES OPTIONS NE SONT PAS RETAPÉES ICI — elles sont LUES dans `tsconfig.edge.json`, qui est la
// source unique. Deux copies d'un réglage finissent par diverger, et ce test tiendrait alors une
// barre différente de celle que l'éditeur et la ligne de commande montrent. C'est la règle de ce
// dépôt sur les copies, appliquée à une configuration plutôt qu'à du code.
const CONFIG = `${RACINE}tsconfig.edge.json`

function options(): ts.CompilerOptions {
  // On LÈVE plutôt qu'on n'`expect` : ceci tourne au chargement du module, donc hors de tout test,
  // et un `expect` qui échoue là rend un message qui ne dit pas d'où il vient.
  const lu = ts.readConfigFile(CONFIG, ts.sys.readFile)
  if (lu.error) throw new Error(`tsconfig.edge.json illisible : ${ts.flattenDiagnosticMessageText(lu.error.messageText, ' ')}`)
  const analyse = ts.parseJsonConfigFileContent(lu.config, ts.sys, RACINE)
  const fautes = analyse.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)
  if (fautes.length) {
    throw new Error(`tsconfig.edge.json invalide : ${fautes.map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join(' ; ')}`)
  }
  return analyse.options
}

const OPTIONS = options()

function fonctions(): string[] {
  const base = `${RACINE}supabase/functions/`
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${base}${e.name}/index.ts`)
    .sort()
}

const CACHE = new Map<string, ts.SourceFile>()

const PROTHESES = [`${RACINE}supabase/types/deno.d.ts`, `${RACINE}supabase/types/npm.d.ts`]

/**
 * Les diagnostics de code mort du programme formé par TOUTES les Edge Functions, plus les sources
 * VIRTUELLES qu'on lui donne — celles-ci servent à prouver que le garde n'est pas aveugle, sans
 * écrire quoi que ce soit dans le dépôt.
 */
export function codeMort(virtuelles: Record<string, string> = {}): string[] {
  const racines = [...fonctions(), ...PROTHESES, ...Object.keys(virtuelles)]
  const hote = ts.createCompilerHost(OPTIONS)
  const lireVrai = hote.getSourceFile.bind(hote)
  // Les fichiers RÉELS (dont `lib.dom.d.ts`) sont analysés une fois pour toutes : cinq programmes
  // qui relisent cinq fois la bibliothèque standard, c'est cinq secondes à chaque `npm test`, donc
  // vingt sous les quatre fuseaux. Les fichiers VIRTUELS, eux, ne sont jamais mis en cache.
  hote.getSourceFile = (nom, version, ...reste) => {
    if (nom in virtuelles) return ts.createSourceFile(nom, virtuelles[nom], version, true)
    const deja = CACHE.get(nom)
    if (deja) return deja
    const lu = lireVrai(nom, version, ...reste)
    if (lu) CACHE.set(nom, lu)
    return lu
  }
  const existeVrai = hote.fileExists.bind(hote)
  hote.fileExists = (nom) => nom in virtuelles || existeVrai(nom)
  const luVrai = hote.readFile.bind(hote)
  hote.readFile = (nom) => (nom in virtuelles ? virtuelles[nom] : luVrai(nom))

  return ts
    .createProgram(racines, OPTIONS, hote)
    .getSemanticDiagnostics()
    .filter((d) => CODE_MORT.has(d.code))
    .map((d) => {
      const ligne = d.file && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
        : 0
      const chemin = d.file?.fileName.replace(RACINE, '') ?? '?'
      return `${chemin}:${ligne} — ${CODE_MORT.get(d.code)} : ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
    })
}

// ── Les sources VIRTUELLES qui prouvent que le garde mord ────────────────────────────────────────

// LE DÉFAUT QUE CE GARDE EXISTE POUR ATTRAPER, et le seul qu'aucun scanner de texte ne peut voir :
// le drapeau de lecture partielle est bien LU — `lecturesSignalees` le compte donc comme couvert —
// et la valeur calculée n'atteint rien. La fonction répond alors « tout va bien » sur une lecture
// tronquée, exactement ce que ce drapeau existe pour empêcher.
const DRAPEAU_LU_MAIS_INERTE = `
declare function lireTout<T>(f: unknown): Promise<{ lignes: T[]; complete: boolean; motif: string | null }>
export async function compter() {
  const lecture = await lireTout<{ id: string }>(null)
  const incomplet = !lecture.complete
  return lecture.lignes.length
}
`

const IMPORT_MORT = `
import { createClient } from 'npm:@supabase/supabase-js@2'
export function rien() { return 1 }
`

const PARAMETRE_MORT = `
export function servir(requete: Request, contexte: string) { return new Response(requete.url) }
`

const INATTEIGNABLE = `
export function repondre() {
  return new Response('ok')
  console.log('jamais')
}
`

// Le garde SYMÉTRIQUE : sans lui, « aucun code mort » serait aussi ce que rend un garde qui ne voit
// plus rien. Une source correcte, et une qui utilise le `_` conventionnel, doivent passer.
const SOURCE_SAINE = `
declare function lireTout<T>(f: unknown): Promise<{ lignes: T[]; complete: boolean; motif: string | null }>
export async function compter() {
  const lecture = await lireTout<{ id: string }>(null)
  if (!lecture.complete) throw new Error(lecture.motif ?? 'lecture partielle')
  return lecture.lignes.length
}
export function servir(_requete: Request) { return new Response('ok') }
`

describe('aucun code mort dans les Edge Functions', () => {
  const trouvees = fonctions()

  it('balaie TOUTES les fonctions du dossier, jamais une liste tenue à la main', () => {
    // Comme `rls.sql` part de `pg_class` : une fonction ajoutée demain est examinée sans que
    // personne ait à l'inscrire quelque part.
    expect(trouvees.length).toBeGreaterThanOrEqual(13)
    for (const nom of ['agent-comptable', 'extract-piece', 'receive-email', 'superpdp-emit']) {
      expect(trouvees.some((f) => f.includes(`/${nom}/`)), `fonction absente du balayage : ${nom}`).toBe(true)
    }
    // Et elles sont réellement lues : un chemin qui n'existe pas ne rendrait aucun diagnostic, ce
    // qui ressemble exactement au succès.
    for (const f of trouvees) expect(readFileSync(f, 'utf8').length).toBeGreaterThan(200)
  })

  it('n’en laisse aucun, sur aucune fonction', () => {
    expect(
      codeMort(),
      'Code mort dans une Edge Function. Une variable calculée qui n’atteint rien est le cas que ' +
        'AUCUN scanner de source ne peut voir — voir l’en-tête de ce fichier.',
    ).toEqual([])
  })

  it('attrape le drapeau LU mais inerte — le cas qui justifie ce garde', () => {
    const trouve = codeMort({ '/virtuel/drapeau.ts': DRAPEAU_LU_MAIS_INERTE })
    expect(trouve).toHaveLength(1)
    expect(trouve[0]).toContain('incomplet')
  })

  it('attrape un import, un paramètre et une ligne inatteignable', () => {
    expect(codeMort({ '/virtuel/import.ts': IMPORT_MORT })).toHaveLength(1)
    expect(codeMort({ '/virtuel/param.ts': PARAMETRE_MORT })).toHaveLength(1)
    expect(codeMort({ '/virtuel/mort.ts': INATTEIGNABLE })).toHaveLength(1)
  })

  it('ne crie pas au loup sur du code correct', () => {
    expect(codeMort({ '/virtuel/sain.ts': SOURCE_SAINE })).toEqual([])
  })

  it('ne met JAMAIS en cache une source virtuelle', () => {
    // Le cache existe pour ne pas relire `lib.dom.d.ts` cinq fois. S'il prenait aussi les sources
    // virtuelles, le deuxième appel sur un même chemin rendrait le verdict du PREMIER — un test
    // vert pour une raison fausse, et la panne ressemblerait exactement au succès. La règle est
    // donc portée par ce test plutôt que par le commentaire qui l'annonce.
    expect(codeMort({ '/virtuel/meme.ts': DRAPEAU_LU_MAIS_INERTE })).toHaveLength(1)
    expect(codeMort({ '/virtuel/meme.ts': SOURCE_SAINE })).toEqual([])
  })
})
