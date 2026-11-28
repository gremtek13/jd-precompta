import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { bordereauFictifEnPdf } from '../test/bordereauFictif'
import * as forme from './bordereauDeTeletransmission'
import * as texte from './texteDUnPdf'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LES DEUX COPIES DE BOR6, SECONDE PARTIE, DANS receive-email : la forme d'un bordereau (`formeDUnBordereau`, de
// src/lib/bordereauDeTeletransmission.ts) et la couche de texte d'un PDF (`texteDUnPdf`, de src/lib/texteDUnPdf.ts). La fonction
// est auto-portée (CLAUDE.md, « Une Edge Function auto-portée duplique du code ») : chaque bloc est-il AU CARACTÈRE PRÈS celui
// de src/lib ? Se compile-t-il seul ? Exécuté seul, rend-il ce que rend le module ? La fonction s'en sert-elle, et le garde
// mord-il ?

const FONCTION = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')
const SOURCES = {
  formeDUnBordereau: readFileSync(new URL('./bordereauDeTeletransmission.ts', import.meta.url), 'utf8'),
  texteDUnPdf: readFileSync(new URL('./texteDUnPdf.ts', import.meta.url), 'utf8'),
}
type NomDuBloc = keyof typeof SOURCES

function blocDe(source: string, nom: NomDuBloc, ou: string): string {
  const debut = `// ── DÉBUT COPIE ${nom} `
  const fin = `// ── FIN COPIE ${nom} `
  const d = source.indexOf(debut)
  const f = source.indexOf(fin)
  expect(d, `bornes du bloc ${nom} introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut, d + 1), `le bloc ${nom} est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc ${nom} n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINES = {
  formeDUnBordereau: blocDe(SOURCES.formeDUnBordereau, 'formeDUnBordereau', 'bordereauDeTeletransmission.ts'),
  texteDUnPdf: blocDe(SOURCES.texteDUnPdf, 'texteDUnPdf', 'texteDUnPdf.ts'),
}

type CopieForme = Pick<typeof forme, 'porteLaFormeDUnBordereau' | 'lignesDesFragments'>
type CopieTexte = Pick<typeof texte, 'lireLeTexteDUnPdf'>

const PAGES: forme.PageDeTexte[][] = [
  [{ lignes: ['Bordereau de Teletransmission'] }],
  [{ lignes: ['  BORDEREAU DE TÉLÉTRANSMISSION '] }],
  [{ lignes: ['Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré'] }],
  [{ lignes: ['Option : impression du bordereau de télétransmission 5,00'] }],
  [{ lignes: ['18/11/2026 1/2 Réalisé par Televitale', 'Bordereau de Teletransmission'] }],
  [{ fragments: [{ texte: 'Bordereau de', x: 240, y: 800, largeur: 40 }, { texte: 'Teletransmission', x: 281, y: 800, largeur: 60 }] }],
  [{ fragments: [{ texte: 'Bordereau', x: 240, y: 800 }, { texte: 'de', x: 280, y: 800.5 }, { texte: 'Teletransmission', x: 300, y: 799.4 }] }],
  [{ lignes: [] }],
]

describe('les copies de BOR6 dans receive-email', () => {
  let compiles: Record<string, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares({
      forme: ORIGINES.formeDUnBordereau,
      texte: ORIGINES.texteDUnPdf,
      formeEmprunte: ORIGINES.formeDUnBordereau.replace('normaliserLaLigne(originale)', 'normaliserAilleurs(originale)'),
    }, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [],
    })
  }, 60_000)

  it.each(['formeDUnBordereau', 'texteDUnPdf'] as const)('%s : au caractère près le bloc de src/lib', (nom) => {
    expect(blocDe(FONCTION, nom, 'receive-email')).toBe(ORIGINES[nom])
  })

  it('le module de la couche de texte n’importe rien, et chaque bloc se compile seul — le garde voit un emprunt', () => {
    expect(SOURCES.texteDUnPdf).not.toMatch(/^import /m)
    expect(SOURCES.formeDUnBordereau).not.toMatch(/^import /m)
    expect(compiles.forme).toEqual([])
    expect(compiles.texte).toEqual([])
    expect(compiles.formeEmprunte.join('\n')).toMatch(/normaliserAilleurs/)
  })

  it('exécutée seule, la forme rend ce que rend le module, page après page — et le garde mord', () => {
    const copie = executerModule<CopieForme>(blocDe(FONCTION, 'formeDUnBordereau', 'receive-email'))
    const verdicts = (m: CopieForme) => PAGES.map((p) => m.porteLaFormeDUnBordereau(p))
    expect(verdicts(copie)).toEqual(verdicts(forme))
    expect(verdicts(forme), JSON.stringify(verdicts(forme))).toEqual([true, true, true, false, true, true, true, false])
    const mutee = executerModule<CopieForme>(blocDe(FONCTION, 'formeDUnBordereau', 'receive-email')
      .replace("l.normalisee === TITRE || ", ''))
    expect(verdicts(mutee)).not.toEqual(verdicts(forme))
  })

  it('exécutée seule, la couche de texte rend ce que rend le module, sur le bordereau fictif — et le garde mord', async () => {
    const octets = await bordereauFictifEnPdf({ pages: 2 })
    const bornes = { octetsDecompressesMax: 1 << 26, dureeMaxMs: 60_000, maintenant: () => performance.now() }
    const lignes = async (m: CopieTexte) => {
      const pages: string[][] = []
      const lu = await m.lireLeTexteDUnPdf(octets, bornes, (p) => { pages.push(forme.lignesDesFragments(p.fragments)); return false })
      return { lu, pages }
    }
    const attendu = await lignes(texte)
    expect(attendu.pages[0][0]).toBe('Bordereau de Teletransmission')
    expect(await lignes(executerModule<CopieTexte>(blocDe(FONCTION, 'texteDUnPdf', 'receive-email')))).toEqual(attendu)
    const mutee = executerModule<CopieTexte>(blocDe(FONCTION, 'texteDUnPdf', 'receive-email')
      .replace("case 'Tj': montrer(operandes.slice(-1)); break", "case 'Tj': break"))
    expect(await lignes(mutee)).not.toEqual(attendu)
  })

  it('receive-email s’en sert : une lecture du texte, jugée par la forme, sur un PDF seulement, avant le doublon et le stockage', () => {
    const horsBlocs = FONCTION.replace(ORIGINES.formeDUnBordereau, '').replace(ORIGINES.texteDUnPdf, '')
    for (const nom of ['porteLaFormeDUnBordereau', 'lireLeTexteDUnPdf', 'lignesDesFragments', 'normaliserLaLigne']) {
      expect(horsBlocs, nom).not.toMatch(new RegExp(`function ${nom}\\b`))
    }
    expect(horsBlocs).toContain('(page) => porteLaFormeDUnBordereau([page]),')
    // Un PDF à son type ou à ses premiers octets : une extension qui ment (« .csv », « .jpg ») ne le soustrait plus (28/11/2026).
    expect(horsBlocs).toContain(
      'if (BORDEREAUX_ECARTES_A_LA_RECEPTION && (type === "application/pdf" || typeParSignature(bytes.subarray(0, 16)) === "application/pdf")) {',
    )
    const jugement = horsBlocs.indexOf('await formeDUnBordereauDansLePdf(bytes, finDesLecturesMs)')
    expect(jugement).toBeGreaterThan(horsBlocs.indexOf('bytes.byteLength > TAILLE_MAX_PIECE'))
    expect(jugement).toBeLessThan(horsBlocs.indexOf('const hash = await hashBytes(bytes)'))
    expect(jugement).toBeLessThan(horsBlocs.indexOf('.upload(path,'))
    expect(jugement).toBeLessThan(horsBlocs.indexOf('await classifierEtExtraire(bytes'))
  })
})
