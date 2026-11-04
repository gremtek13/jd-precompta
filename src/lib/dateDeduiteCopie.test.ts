import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './dateDeduite'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LA COPIE DU BLOC dateDeduite DANS receive-email (relecture du 04/11/2026 ; PIECES-Q1, option (A)). La pièce jointe reçue
// par e-mail est le quatrième chemin qui écrit une extraction : elle écrivait la confiance d'extract-piece telle quelle,
// « haute » sur une date déduite de la mise en page, là où les trois autres la plafonnent à « moyenne ». La fonction est
// auto-portée : elle applique le plafond par une COPIE du bloc de src/lib/dateDeduite.ts. Quatre questions (CLAUDE.md,
// « Une Edge Function auto-portée duplique du code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé seul ?
//   3. EXÉCUTÉE seule, rend-elle ce que rend le module, sur toute la grille ?
//   4. La fonction s'en SERT-elle pour la confiance qu'elle écrit, et plus de la confiance brute ? Et le garde mord-il ?

const MODULE = readFileSync(new URL('./dateDeduite.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')
const DEBUT = '// ── DÉBUT COPIE dateDeduite '
const FIN = '// ── FIN COPIE dateDeduite '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc dateDeduite introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc dateDeduite est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc dateDeduite n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'dateDeduite.ts')

type Copie = Pick<typeof module, 'dateDeduite' | 'confianceDeLExtraction'>

const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace("extraction._date_deduite === true && !!extraction.date_piece", 'estDeduite(extraction)'),
}

const CONFIANCES = ['haute', 'moyenne', 'basse'] as const
const DATES = [null, '', '2023-05-15']
const MARQUES = [undefined, false, true]

function lire(m: Copie): unknown[] {
  const rendus: unknown[] = []
  for (const confiance of CONFIANCES) {
    for (const date_piece of DATES) {
      for (const _date_deduite of MARQUES) {
        const extraction = _date_deduite === undefined ? { confiance, date_piece } : { confiance, date_piece, _date_deduite }
        rendus.push(m.dateDeduite(extraction), m.confianceDeLExtraction(extraction))
      }
    }
  }
  return rendus
}

describe('la copie du bloc dateDeduite dans receive-email', () => {
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('receive-email : au caractère près le bloc de src/lib/dateDeduite.ts', () => {
    expect(blocDe(FONCTION, 'receive-email')).toBe(ORIGINE)
  })

  it('le bloc commence et finit à ses bornes : rien de ce que le module importe n’y entre', () => {
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(MODULE).not.toMatch(/^import /m)
  })

  it('se compile seul, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/estDeduite/)
  })

  it('exécutée seule, la copie rend ce que rend le module, sur toute la grille — dont le plafond', () => {
    const rendus = lire(module)
    expect(lire(executerModule<Copie>(blocDe(FONCTION, 'receive-email')))).toEqual(rendus)
    // La grille voit le plafond : « haute » redescend une fois, sur une date rendue et marquée.
    expect(module.confianceDeLExtraction({ confiance: 'haute', date_piece: '2023-05-15', _date_deduite: true })).toBe('moyenne')
    expect(rendus.filter((r) => r === 'moyenne').length).toBeGreaterThan(9)
  })

  it('receive-email écrit la confiance plafonnée, plus jamais la confiance brute', () => {
    const horsBloc = FONCTION.replace(ORIGINE, '')
    expect(horsBloc).toMatch(/confiance: extraction \? confianceDeLExtraction\(extraction\) : null,/)
    expect(horsBloc).not.toMatch(/confiance: extraction\?\.confiance/)
    expect(horsBloc).toMatch(/_date_deduite\?: boolean/)
    for (const nom of ['dateDeduite', 'confianceDeLExtraction']) {
      expect(horsBloc, nom).not.toMatch(new RegExp(`function ${nom}\\b`))
    }
  })

  it('le garde mord : la copie sans le plafond, en texte et à l’exécution', () => {
    const copie = blocDe(FONCTION, 'receive-email')
    const sansPlafond = copie.replace("extraction.confiance === 'haute' ? 'moyenne' : extraction.confiance", 'extraction.confiance')
    expect(sansPlafond).not.toBe(copie)
    expect(lire(executerModule<Copie>(sansPlafond))).not.toEqual(lire(module))
  })
})
