import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './bornesStockage'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LA COPIE DU BLOC bornesDesPieces DANS receive-email (ligne 22.6). La fonction est auto-portée : elle décide du type
// d'une pièce jointe et de sa borne par une COPIE du bloc de src/lib/bornesStockage.ts. Une copie qui dériverait
// déposerait ce que l'application refuse — ou, la migration appliquée, se ferait refuser par le stockage une pièce
// jointe que l'application accepte, et la perdrait. Quatre questions (CLAUDE.md, « Une Edge Function auto-portée
// duplique du code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé seul ?
//   3. EXÉCUTÉE seule, rend-elle ce que rend le module — une référence extérieure à la copie —, sur une grille de noms et
//      de premiers octets ?
//   4. La fonction s'en SERT-elle, sans rien garder de l'ancien dépôt (le type déclaré par l'expéditeur, la borne en
//      dur) ? Et le garde mord-il ?

const MODULE = readFileSync(new URL('./bornesStockage.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')
const DEBUT = '// ── DÉBUT COPIE bornesDesPieces '
const FIN = '// ── FIN COPIE bornesDesPieces '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc bornesDesPieces introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc bornesDesPieces est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc bornesDesPieces n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'bornesStockage.ts')

type Copie = Pick<typeof module, 'typeDUnePiece' | 'TAILLE_MAX_PIECE'>

const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace('return parExtension ?? typeParSignature(debut)', 'return parExtension ?? typeDuNavigateur(debut)'),
}

// ── La grille ─────────────────────────────────────────────────────────────────────────────────────────────────────

const NOMS = [
  'a.pdf', 'a.PDF', 'a.jpg', 'a.jpeg', 'a.JPEG', 'a.png', 'a.csv', 'a.CSV', '.csv', 'a', 'a.', 'a.pdf.part', 'a.tif',
  'a.tiff', 'a.heic', 'a.svg', 'a.txt', 'a.xml', 'a.docx', 'a.xlsx', 'a.zip', 'a.constructor', 'a.__proto__', 'piece-pj-0',
]
const DEBUTS: number[][] = [
  [], [0x25, 0x50, 0x44, 0x46], [0x25, 0x50, 0x44], [0xff, 0xd8, 0xff], [0xff, 0xd8], [0x89, 0x50, 0x4e, 0x47],
  [0x89, 0x50, 0x4e, 0x48], [0x47, 0x49, 0x46, 0x38], [0x49, 0x49, 0x2a, 0], [0x3c, 0x73, 0x76, 0x67],
  [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70],
]

const lire = (m: Copie) => [m.TAILLE_MAX_PIECE, ...NOMS.flatMap((nom) => DEBUTS.map((d) => m.typeDUnePiece(nom, new Uint8Array(d))))]

// LE TYPE QUE DÉCLARE L'EXPÉDITEUR ne décide d'aucun dépôt. Depuis la ligne 22.92, receive-email le LIT pour un compte :
// celui des éléments de l'e-mail qui ne sont pas des pièces jointes, par famille de type déclaré, et ce compte ne va
// qu'au journal. Le type déclaré n'est donc admis que dans le corps de `compteDesElementsIntegres`, et ce corps n'est
// appelé qu'une fois, dans une ligne de journal ; partout ailleurs, il reste interdit.
const COMPTE = 'function compteDesElementsIntegres('
const APPEL_DU_COMPTE = 'console.log(`[receive-email] dossier ${dossier.id} : ${compteDesElementsIntegres(attachments ?? [])}`)'

/** Ce que la fonction fait du type déclaré hors du bloc copié : la liste des fautes, vide quand il ne sert qu'au compte. */
function typeDeclareHorsDuCompte(fonction: string): string[] {
  const horsBloc = fonction.replace(ORIGINE, '')
  const debut = horsBloc.indexOf(COMPTE)
  if (debut < 0) return horsBloc.includes('content_type') ? ['le type déclaré lu hors de tout compte'] : []
  const corps = horsBloc.slice(debut, horsBloc.indexOf('\n}\n', debut) + 3)
  const fautes: string[] = []
  if (horsBloc.replace(corps, '').includes('content_type')) fautes.push('le type déclaré lu hors du compte')
  if (horsBloc.split('compteDesElementsIntegres(').length - 1 !== 2) fautes.push('le compte appelé ailleurs qu’une fois')
  if (!horsBloc.includes(APPEL_DU_COMPTE)) fautes.push('le compte qui ne va pas au journal')
  return fautes
}

describe('la copie du bloc bornesDesPieces dans receive-email', () => {
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('receive-email : au caractère près le bloc de src/lib/bornesStockage.ts', () => {
    expect(blocDe(FONCTION, 'receive-email')).toBe(ORIGINE)
  })

  it('le bloc commence et finit à ses bornes : rien de ce que le module importe n’y entre', () => {
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(ORIGINE).not.toMatch(/^import /m)
  })

  it('se compile seul, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/typeDuNavigateur/)
  })

  it('exécutée seule, la copie rend ce que rend le module, sur toute la grille', () => {
    expect(lire(executerModule<Copie>(blocDe(FONCTION, 'receive-email')))).toEqual(lire(module))
  })

  it('la grille n’est pas aveugle : chaque type d’une pièce, et des refus', () => {
    const lus = lire(module).slice(1)
    expect(new Set(lus.filter((t) => t !== null))).toEqual(new Set(module.TYPES_DES_FICHIERS_DE_PIECE))
    expect(lus.filter((t) => t === null).length).toBeGreaterThan(50)
  })

  it('receive-email s’en sert : le type décidé et la borne, avant le dépôt — et plus rien de l’ancien', () => {
    const horsBloc = FONCTION.replace(ORIGINE, '')
    expect(horsBloc).toMatch(/const type = typeDUnePiece\(nomFichier, bytes\.subarray\(0, 16\)\)/)
    expect(horsBloc).toMatch(/if \(type === null\) \{/)
    expect(horsBloc).toMatch(/if \(bytes\.byteLength > TAILLE_MAX_PIECE\) \{/)
    expect(horsBloc).toMatch(/\.upload\(path, new Blob\(\[bytes\], \{ type \}\)\)/)
    // Ni le type que déclare l'expéditeur — hors du seul compte au journal (ligne 22.92) —, ni la borne écrite en dur.
    expect(typeDeclareHorsDuCompte(FONCTION)).toEqual([])
    expect(horsBloc).not.toMatch(/20 \* 1024 \* 1024/)
    for (const nom of ['typeDUnePiece', 'typeParSignature', 'TYPES_PAR_EXTENSION', 'TAILLE_MAX_PIECE']) {
      expect(horsBloc, nom).not.toMatch(new RegExp(`(?:function|const|let|var) ${nom}\\b`))
    }
    // Les deux jugements AVANT le dépôt.
    const depot = horsBloc.indexOf('.upload(path')
    expect(horsBloc.indexOf('typeDUnePiece(nomFichier')).toBeLessThan(depot)
    expect(horsBloc.indexOf('> TAILLE_MAX_PIECE')).toBeLessThan(depot)
  })

  it('le garde mord : un caractère changé dans la copie, ou une extension de plus, se voit — en texte et à l’exécution', () => {
    const copie = blocDe(FONCTION, 'receive-email')
    const tiff = copie.replace("['csv', 'text/csv'],", "['csv', 'text/csv'], ['tif', 'image/tiff'],")
    expect(tiff).not.toBe(ORIGINE)
    expect(lire(executerModule<Copie>(tiff))).not.toEqual(lire(module))
    const borne = copie.replace('export const TAILLE_MAX_PIECE = 20 * 1024 * 1024', 'export const TAILLE_MAX_PIECE = 25 * 1024 * 1024')
    expect(borne).not.toBe(copie)
    expect(lire(executerModule<Copie>(borne))).not.toEqual(lire(module))
  })

  it('le garde du type déclaré mord : lu pour un dépôt, ou le compte tiré hors du journal, se voit', () => {
    const pourLeDepot = FONCTION.replace('const type = typeDUnePiece(nomFichier, bytes.subarray(0, 16))',
      'const type = fichier.content_type ?? typeDUnePiece(nomFichier, bytes.subarray(0, 16))')
    expect(pourLeDepot).not.toBe(FONCTION)
    expect(typeDeclareHorsDuCompte(pourLeDepot)).toEqual(['le type déclaré lu hors du compte'])
    const horsDuJournal = FONCTION.replace(APPEL_DU_COMPTE, 'const compte = compteDesElementsIntegres(attachments ?? [])')
    expect(horsDuJournal).not.toBe(FONCTION)
    expect(typeDeclareHorsDuCompte(horsDuJournal)).toEqual(['le compte qui ne va pas au journal'])
    const deuxFois = FONCTION.replace('  let nbImportees = 0\n', '  const encore = compteDesElementsIntegres(fichiers)\n  let nbImportees = 0\n')
    expect(deuxFois).not.toBe(FONCTION)
    expect(typeDeclareHorsDuCompte(deuxFois)).toEqual(['le compte appelé ailleurs qu’une fois'])
  })
})
