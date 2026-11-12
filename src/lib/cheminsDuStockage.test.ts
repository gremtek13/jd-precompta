import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { cheminDuDossier } from './cheminDuDossier'

// LE CHEMIN D'UNE LIGNE VÉRIFIÉ AVANT TOUT APPEL AU STOCKAGE (CFCS-Q1, 12/11/2026).
//
// La base ne lie pas le premier segment de `pieces.storage_path`, `pieces.lisible_path` ni `documents_divers.storage_path`
// au dossier de la ligne, et le client en insère. Ce scanner part de TOUT appel au stockage de `src/` (`….storage.from(…)
// .méthode(…)`, lu dans l'arbre syntaxique, jamais à la ligne) et exige, pour chacun, que la fonction qui le contient
// appelle `cheminDuDossier(` AVANT lui — sinon une exception, comptée au nombre près, qui porte sa raison. Une autre forme
// d'accès au stockage (`const s = supabase.storage`) est une faute : il ne la verrait pas. Les points d'entrée communs
// (`ouvrirApercu`, `retirerFichiers`) vérifient eux-mêmes, sur une racine qu'ils EXIGENT : leurs appelants n'y échappent pas.

interface AppelAuStockage { fichier: string; methode: string; verifie: boolean }
interface Scan { appels: AppelAuStockage[]; formesInconnues: string[] }

/** Le scanner, sur un texte : les appels au stockage, et pour chacun si `cheminDuDossier(` le précède dans sa fonction. */
export function scanner(fichier: string, texte: string): Scan {
  const source = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true, fichier.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const appels: AppelAuStockage[] = []
  const formesInconnues: string[] = []
  const ligne = (n: ts.Node) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1
  const fonctionDe = (n: ts.Node): ts.Node => {
    let p: ts.Node | undefined = n.parent
    while (p && !ts.isFunctionLike(p)) p = p.parent
    return p ?? source
  }
  const visiter = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'storage') {
      // La seule forme reconnue : `X.storage.from(…).méthode(…)`.
      const from = n.parent
      const appelFrom = from?.parent
      const methode = appelFrom?.parent
      const appel = methode?.parent
      if (from && ts.isPropertyAccessExpression(from) && from.name.text === 'from' && appelFrom && ts.isCallExpression(appelFrom)
        && methode && ts.isPropertyAccessExpression(methode) && appel && ts.isCallExpression(appel) && appel.expression === methode) {
        const fonction = fonctionDe(appel)
        const avant = texte.slice(fonction.getStart(source), appel.getStart(source))
        appels.push({ fichier, methode: methode.name.text, verifie: /\bcheminDuDossier\s*\(/.test(avant) })
      } else {
        formesInconnues.push(`${fichier}:${ligne(n)}`)
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(source)
  return { appels, formesInconnues }
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

const DEPOT = 'un dépôt : le chemin est composé ici, du dossier ouvert, jamais lu d’une ligne'

/** Les appels qui ne vérifient pas, fichier et méthode, au nombre près, chacun avec sa raison. */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'pages/dossier/FichePiece.tsx:upload': { nombre: 1, raison: DEPOT },
  'pages/dossier/CotisationsTab.tsx:upload': { nombre: 1, raison: DEPOT },
  'pages/CabinetBrandingPage.tsx:upload': { nombre: 1, raison: DEPOT },
  'pages/CabinetBrandingPage.tsx:getPublicUrl': { nombre: 1, raison: 'le logo PUBLIC du cabinet : une adresse, aucun octet lu, sur une colonne de `cabinets` que le chef seul écrit' },
  'lib/branding.ts:getPublicUrl': { nombre: 1, raison: 'le logo PUBLIC du cabinet : une adresse, aucun octet lu, sur une colonne de `cabinets` que le chef seul écrit' },
  'lib/importDesFacturesLecture.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/depotDesHonorairesLecture.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/receptionPlateforme.ts:upload': { nombre: 2, raison: DEPOT },
  'lib/packGenerator.ts:upload': { nombre: 2, raison: DEPOT },
  'lib/depot.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/logoDesFacturesEcriture.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/documentsEtDemandesEcriture.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/importFichiers.ts:upload': { nombre: 1, raison: DEPOT },
  'lib/suppressionDossier.ts:list': { nombre: 1, raison: 'liste le préfixe du dossier supprimé lui-même, aucun chemin lu d’une ligne' },
  'lib/suppressionDossier.ts:remove': { nombre: 1, raison: 'retire ce que `list` a rendu sous le préfixe du dossier, aucun chemin lu d’une ligne' },
  'lib/copieDesFichiersLecture.ts:download': { nombre: 1, raison: 'la copie : `inventaireDuDossier` a jugé chaque chemin par `cheminDuDossier` et le téléchargement refuse `horsDuDossier` (INAL6)' },
  'lib/logoDesFacturesLecture.ts:download': { nombre: 1, raison: 'la contrainte `parametres_facturation_logo_chemin_forme` lie en base le chemin du logo au dossier de sa version' },
}

describe('chaque appel au stockage vérifie le chemin d’une ligne avant de le demander (CFCS-Q1)', () => {
  const scans = sources().map((s) => scanner(s.chemin, s.texte))
  const appels = scans.flatMap((s) => s.appels)

  it('voit tout le stockage de src/ : un plancher qui distingue « zéro faute » d’« aveugle »', () => {
    expect(appels.length).toBeGreaterThanOrEqual(30)
    expect(appels.filter((a) => a.verifie).length).toBeGreaterThanOrEqual(11)
    expect(new Set(appels.map((a) => a.methode))).toEqual(new Set(['download', 'createSignedUrl', 'upload', 'remove', 'list', 'getPublicUrl']))
  })

  it('aucune forme d’accès au stockage qu’il ne sait pas lire', () => {
    expect(scans.flatMap((s) => s.formesInconnues)).toEqual([])
  })

  it('tout appel qui ne vérifie pas est une exception comptée, au nombre près', () => {
    const nonVerifies = new Map<string, number>()
    for (const a of appels.filter((x) => !x.verifie)) {
      const cle = `${a.fichier}:${a.methode}`
      nonVerifies.set(cle, (nonVerifies.get(cle) ?? 0) + 1)
    }
    expect(Object.fromEntries(nonVerifies)).toEqual(Object.fromEntries(Object.entries(EXCEPTIONS).map(([k, v]) => [k, v.nombre])))
    for (const { raison } of Object.values(EXCEPTIONS)) expect(raison.length).toBeGreaterThan(20)
  })

  it('tout téléchargement, toute URL signée et tout retrait qui n’est pas une exception vérifie', () => {
    const lecteurs = appels.filter((a) => ['download', 'createSignedUrl', 'remove'].includes(a.methode) && !EXCEPTIONS[`${a.fichier}:${a.methode}`])
    expect(lecteurs.length).toBeGreaterThanOrEqual(11)
    expect(lecteurs.filter((a) => !a.verifie)).toEqual([])
  })
})

describe('le scanner, éprouvé par des défauts plantés', () => {
  it('voit un téléchargement sans vérification', () => {
    const { appels } = scanner('x.ts', `export async function f(p: { storage_path: string }) {
      const { data } = await supabase.storage
        .from('pieces')
        .download(p.storage_path)
      return data
    }`)
    expect(appels).toEqual([{ fichier: 'x.ts', methode: 'download', verifie: false }])
  })

  it('refuse une vérification APRÈS l’appel, ou dans une autre fonction', () => {
    expect(scanner('x.ts', `async function f(c: string, d: string) {
      await supabase.storage.from('pieces').download(c)
      if (!cheminDuDossier(c, d)) return
    }`).appels[0].verifie).toBe(false)
    expect(scanner('x.ts', `function g(c: string, d: string) { return cheminDuDossier(c, d) }
    async function f(c: string) { await supabase.storage.from('pieces').createSignedUrl(c, 60) }`).appels[0].verifie).toBe(false)
  })

  it('accepte une vérification qui précède l’appel dans sa fonction', () => {
    expect(scanner('x.tsx', `const f = async (c: string, d: string) => {
      if (!cheminDuDossier(c, d)) return
      await supabase.storage.from('pieces').download(c)
    }`).appels).toEqual([{ fichier: 'x.tsx', methode: 'download', verifie: true }])
  })

  it('dit une forme qu’il ne sait pas lire', () => {
    expect(scanner('x.ts', `const s = supabase.storage
    export const f = (c: string) => s.from('pieces').download(c)`).formesInconnues).toEqual(['x.ts:1'])
  })
})

describe('cheminDuDossier, la règle commune', () => {
  const D = '11111111-1111-4111-8111-111111111111'
  it('le premier segment est le dossier, aucun segment vide, « . » ni « .. »', () => {
    expect(cheminDuDossier(`${D}/a.pdf`, D)).toBe(true)
    expect(cheminDuDossier(`${D}/logos/x.png`, D)).toBe(true)
    expect(cheminDuDossier(`autre/a.pdf`, D)).toBe(false)
    expect(cheminDuDossier(`${D}/../autre/a.pdf`, D)).toBe(false)
    expect(cheminDuDossier(`${D}`, D)).toBe(false)
    expect(cheminDuDossier(`${D}/`, D)).toBe(false)
    expect(cheminDuDossier(`${D}x/a.pdf`, D)).toBe(false)
  })
})
