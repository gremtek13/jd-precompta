import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { diagnosticsSepares, diagnosticsSeuls, executerModule } from './compilationSeparee'

// LE PROGRAMME COMMUN DES GARDES DE COPIE SE CONFRONTE AU CHEMIN D'AVANT : chaque source compilée seule, dans son propre
// programme. Sans ce test, une source qui recevrait le diagnostic de sa voisine — ou qui perdrait celui de la
// bibliothèque — rendrait les trois gardes verts ou rouges pour une raison fausse, sans que rien ne le dise.

// La plus petite bibliothèque standard : la confrontation éprouve le PARTAGE d'un programme, pas une bibliothèque, et
// chaque programme séparé qu'elle bâtit la relit entière.
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
  noUnusedParameters: true, lib: ['lib.es5.d.ts'], types: [],
}

// Une source saine, et une par défaut qu'un garde de copie existe pour voir : un nom emprunté, un nom déclaré deux
// fois, un nom inutilisé, une faute de syntaxe. Deux clés portent le même texte.
const SOURCES = {
  saine: 'export function suivant(n: number): number { return n + 1 }\n',
  emprunte: "export const date = () => formatDate('2027-01-01')\n",
  doublon: 'function echapper() {}\nfunction echapper() {}\nexport const e = echapper\n',
  inutilise: 'export function u(): number { const v = 1; return 2 }\n',
  syntaxe: 'export const s = (\n',
  memeTexte: 'export function suivant(n: number): number { return n + 1 }\n',
}
type Cle = keyof typeof SOURCES

// Sans bibliothèque, le compilateur rend des diagnostics qui ne sont à AUCUNE source (les types globaux introuvables) :
// chaque source doit les recevoir, comme son propre programme les lui rendrait.
const SANS_BIBLIOTHEQUE: ts.CompilerOptions = { noLib: true, noEmit: true, types: [] }
const SOURCES_SANS_BIBLIOTHEQUE = { a: 'export const a = 1\n', b: 'export const b = [1]\n' }

describe('un programme commun rend à chaque source ce que lui rendrait le sien', { timeout: 60_000 }, () => {
  // Un programme par source, puis un commun : la confrontation coûte ce que les gardes ne paient plus, une fois.
  let seuls: Record<Cle, string[]>
  let communs: Record<Cle, string[]>
  beforeAll(() => {
    seuls = Object.fromEntries(Object.entries(SOURCES).map(([cle, code]) => [cle, diagnosticsSeuls(code, OPTIONS)])) as Record<Cle, string[]>
    communs = diagnosticsSepares(SOURCES, OPTIONS)
  }, 60_000)

  it('source par source, les mêmes diagnostics', () => {
    expect(communs).toEqual(seuls)
  })

  it('et ces diagnostics disent quelque chose : la saine passe, chaque défaut se voit chez lui seul', () => {
    // Le plancher : une confrontation de deux listes vides ne prouverait rien.
    expect(seuls.saine).toEqual([])
    expect(seuls.memeTexte).toEqual([])
    expect(seuls.emprunte.join(' ')).toContain('formatDate')
    expect(seuls.doublon.join(' ')).toMatch(/Duplicate function implementation/)
    expect(seuls.inutilise.join(' ')).toContain("'v'")
    expect(seuls.syntaxe).not.toEqual([])
  })

  it('les diagnostics qui ne sont à aucune source vont à chacune', () => {
    const communsSansBibliotheque = diagnosticsSepares(SOURCES_SANS_BIBLIOTHEQUE, SANS_BIBLIOTHEQUE)
    for (const [cle, code] of Object.entries(SOURCES_SANS_BIBLIOTHEQUE)) {
      const seul = diagnosticsSeuls(code, SANS_BIBLIOTHEQUE)
      expect(seul.join(' '), cle).toMatch(/Cannot find global type/)
      expect(communsSansBibliotheque[cle as keyof typeof SOURCES_SANS_BIBLIOTHEQUE], cle).toEqual(seul)
    }
  })

  it('refuse une source qui n’est pas un module : sa portée serait celle des autres', () => {
    // Un script déclare dans la portée globale : `formatDate` déclaré par l'un servirait l'emprunt de l'autre.
    expect(() => diagnosticsSepares({ script: 'function formatDate(x: string) { return x }\n', ...SOURCES }, OPTIONS))
      .toThrow(/« script » n'est pas un module/)
  })
})

describe('un bloc exécuté seul', () => {
  it('est rebâti à chaque appel : aucun appel ne reçoit l’état d’un autre', () => {
    const code = 'let n = 0\nexport function compter(): number { n += 1; return n }\n'
    const premier = executerModule<{ compter: () => number }>(code)
    expect([premier.compter(), premier.compter()]).toEqual([1, 2])
    expect(executerModule<{ compter: () => number }>(code).compter()).toBe(1)
  })

  it('lève sur un nom emprunté hors de lui', () => {
    const code = "export const date = () => formatDate('2027-01-01')\n"
    expect(() => executerModule<{ date: () => string }>(code).date()).toThrow(/formatDate is not defined/)
  })
})
