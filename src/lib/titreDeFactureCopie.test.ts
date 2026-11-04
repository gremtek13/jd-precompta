import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './titreDeFacture'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LA COPIE DU BLOC titreDeFacture DANS extract-piece (relecture du 04/11/2026, D4 ; PIECES-Q3). La fonction est auto-portée :
// elle juge le titre d'un document par une COPIE du bloc de src/lib/titreDeFacture.ts, que l'onglet Documents applique au
// texte lu d'un document déjà rangé. Une copie qui dériverait classerait une facture d'un côté et la dirait « probable » de
// l'autre. Quatre questions (CLAUDE.md, « Une Edge Function auto-portée duplique du code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé seul ?
//   3. EXÉCUTÉE seule, rend-elle ce que rend le module, sur une grille de textes ?
//   4. La fonction s'en SERT-elle, à sa place dans `classifieDocument` ? Et le garde mord-il ?

const MODULE = readFileSync(new URL('./titreDeFacture.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')
const DEBUT = '// ── DÉBUT COPIE titreDeFacture '
const FIN = '// ── FIN COPIE titreDeFacture '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc titreDeFacture introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc titreDeFacture est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc titreDeFacture n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'titreDeFacture.ts')

type Copie = Pick<typeof module, 'titreDeFacture' | 'LIGNES_DU_TITRE'>

const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace('ligne.trim().toUpperCase()', 'sansAccents(ligne).toUpperCase()'),
}

// La grille : des titres, des places, des montants, et les libellés d'un relevé de banque.
const TITRES = ['FACTURE N° 1', 'Facture du 05/03/2025', 'Votre facture', 'Note d’honoraires', "NOTE D'HONORAIRES",
  'Note dhonoraires', 'FACTURE CARTE DU 12/03', 'FACTURE CB 14/03', 'FACTURES CARTES', 'Facture', 'LOT de 2 Factures',
  'paiement de la facture', 'Facturation', 'AVOIR N° 3', '  facture n° 9', 'Votre  facture', 'RELEVE DE COMPTE']
const MONTANTS = ['Total TTC 412,50 €', 'Montant 75.00', 'Total 1 200,00', 'sans montant', 'Réf. 12,345', '']
const PLACES = [0, 3, 9, 10, 14]

function lire(m: Copie): unknown[] {
  const rendus: unknown[] = [m.LIGNES_DU_TITRE]
  for (const titre of TITRES) {
    for (const montant of MONTANTS) {
      for (const place of PLACES) {
        const lignes = Array.from({ length: place }, (_, i) => `en-tête ${i}`)
        rendus.push(m.titreDeFacture([...lignes, titre, montant]))
      }
    }
  }
  return rendus
}

describe('la copie du bloc titreDeFacture dans extract-piece', () => {
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('extract-piece : au caractère près le bloc de src/lib/titreDeFacture.ts', () => {
    expect(blocDe(FONCTION, 'extract-piece')).toBe(ORIGINE)
  })

  it('le bloc commence et finit à ses bornes, et le module n’a rien hors d’elles', () => {
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(MODULE.trim()).toBe(ORIGINE.trim())
  })

  it('se compile seul, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/sansAccents/)
  })

  it('exécutée seule, la copie rend ce que rend le module, sur toute la grille', () => {
    expect(lire(executerModule<Copie>(blocDe(FONCTION, 'extract-piece')))).toEqual(lire(module))
  })

  it('la grille n’est pas aveugle : des titres reconnus, et des refus', () => {
    const rendus = lire(module).slice(1)
    expect(rendus.filter((r) => r === true).length).toBeGreaterThan(30)
    expect(rendus.filter((r) => r === false).length).toBeGreaterThan(200)
  })

  it('extract-piece s’en sert : après le bordereau et le nom d’un compte, avant le solde, la cotisation et l’attestation', () => {
    const horsBloc = FONCTION.replace(ORIGINE, '')
    for (const nom of ['titreDeFacture', 'LIGNE_DE_TITRE_FACTURE', 'MONTANT_IMPRIME', 'LIGNES_DU_TITRE']) {
      expect(horsBloc, nom).not.toMatch(new RegExp(`(?:function|const|let|var) ${nom}\\b`))
    }
    const corps = horsBloc.slice(horsBloc.indexOf('function classifieDocument('))
    const rang = (motif: string) => corps.indexOf(motif)
    expect(rang('if (titreDeFacture(lignes))')).toBeGreaterThan(rang('MARQUEURS_RECETTE.some'))
    expect(rang('if (titreDeFacture(lignes))')).toBeGreaterThan(rang('MARQUEURS_RELEVE_BANCAIRE.some'))
    expect(rang('if (titreDeFacture(lignes))')).toBeLessThan(rang('MARQUEURS_SOLDE.some'))
    expect(rang('if (titreDeFacture(lignes))')).toBeLessThan(rang('ORGANISMES_SOCIAUX.test'))
    expect(rang('if (titreDeFacture(lignes))')).toBeLessThan(rang('ATTESTATION|'))
  })

  it('le garde mord : un caractère changé dans la copie, ou une ligne de titre de plus, se voit — en texte et à l’exécution', () => {
    const copie = blocDe(FONCTION, 'extract-piece')
    const sansCb = copie.replace('(?!\\s+(CARTE|CB)\\b)', '(?!\\s+CARTE\\b)')
    expect(sansCb).not.toBe(copie)
    expect(sansCb).not.toBe(ORIGINE)
    expect(lire(executerModule<Copie>(sansCb))).not.toEqual(lire(module))
    const onze = copie.replace('export const LIGNES_DU_TITRE = 10', 'export const LIGNES_DU_TITRE = 11')
    expect(onze).not.toBe(copie)
    expect(lire(executerModule<Copie>(onze))).not.toEqual(lire(module))
  })
})
