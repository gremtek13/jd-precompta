import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './devises'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LA COPIE DU BLOC deviseDuTexte DANS receive-email (relecture adverse du chemin d'une pièce, 28/11/2026). La pièce jointe reçue
// par e-mail écrivait en euros les montants que la lecture rend dans la monnaie du document — une facture en dollars entrait au
// dossier comme si ses dollars étaient des euros —, là où les trois autres dépôts convertissent (`montantsPourPiece`,
// lib/tauxChange.ts). La fonction est auto-portée : elle lit la devise par une COPIE du bloc de src/lib/devises.ts. Quatre
// questions (CLAUDE.md, « Une Edge Function auto-portée duplique du code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé seul ?
//   3. EXÉCUTÉE seule, rend-elle ce que rend le module, sur toute la grille ?
//   4. La fonction s'en SERT-elle pour les montants qu'elle écrit ? Et le garde mord-il ?

const MODULE = readFileSync(new URL('./devises.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')
const DEBUT = '// ── DÉBUT COPIE deviseDuTexte '
const FIN = '// ── FIN COPIE deviseDuTexte '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc deviseDuTexte introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc deviseDuTexte est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc deviseDuTexte n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'devises.ts')

type Copie = Pick<typeof module, 'deviseDuTexte' | 'DEVISE_PIVOT'>

const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace('const majuscules = texte.toUpperCase()', 'const majuscules = enMajuscules(texte)'),
}

const TEXTES = [
  null, undefined, '', 'Total TTC 987,65 €', 'Total 987.65 EUR', 'Total $987.65', 'Amount due USD 120', 'US$ 12',
  '£ 40.00', 'Total 40 GBP', 'CHF 12', '¥ 1200', 'CA$ 15', 'AU$ 15', 'SEK 100', 'NOK 100', 'DKK 100', 'PLN 100',
  'Total $ 99 — soit 92 €', 'Prix : 12 dollars', 'aud 3', 'usd 3', 'pas de monnaie',
]

const lire = (m: Copie): unknown[] => [m.DEVISE_PIVOT, ...TEXTES.map((t) => m.deviseDuTexte(t))]

describe('la copie du bloc deviseDuTexte dans receive-email', () => {
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('receive-email : au caractère près le bloc de src/lib/devises.ts', () => {
    expect(blocDe(FONCTION, 'receive-email')).toBe(ORIGINE)
  })

  it('le bloc commence et finit à ses bornes : devises.ts n’importe rien', () => {
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(MODULE).not.toMatch(/^import /m)
  })

  it('se compile seul, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/enMajuscules/)
  })

  it('exécutée seule, la copie rend ce que rend le module, sur toute la grille — dont l’euro qui l’emporte', () => {
    const rendus = lire(module)
    expect(lire(executerModule<Copie>(blocDe(FONCTION, 'receive-email')))).toEqual(rendus)
    expect(module.deviseDuTexte('Total $ 99 — soit 92 €')).toBe('EUR')
    expect(new Set(rendus).size).toBeGreaterThan(8)
  })

  it('receive-email écrit les montants d’une pièce en devise comme le taux introuvable : nuls en euros, la devise gardée', () => {
    const horsBloc = FONCTION.replace(ORIGINE, '')
    expect(horsBloc).toMatch(/const deviseLue = extraction \? deviseDuTexte\(extraction\.texte_ocr\) : null/)
    expect(horsBloc).toMatch(/const enDevise = deviseLue !== null && deviseLue !== DEVISE_PIVOT/)
    for (const champ of ['montant_ht', 'montant_tva', 'montant_ttc']) {
      expect(horsBloc, champ).toMatch(new RegExp(`${champ}: enDevise \\? null : extraction\\?\\.${champ} \\?\\? null,`))
      expect(horsBloc, champ).not.toMatch(new RegExp(`${champ}: extraction\\?\\.${champ} \\?\\? null,`))
    }
    expect(horsBloc).toMatch(/\.\.\.\(enDevise \? \{ devise: deviseLue, montant_devise: extraction\?\.montant_ttc \?\? null \} : \{\}\),/)
    expect(horsBloc).toMatch(/texte_ocr\?: string \| null/)
    expect(horsBloc).not.toMatch(/function deviseDuTexte\b/)
  })

  it('le garde mord : la copie qui ne voit plus le dollar, en texte et à l’exécution', () => {
    const copie = blocDe(FONCTION, 'receive-email')
    const sansDollar = copie.replace("[/\\bUSD\\b|\\$(?=\\s?\\d)|\\bUS\\$/, 'USD'],", '')
    expect(sansDollar).not.toBe(copie)
    expect(lire(executerModule<Copie>(sansDollar))).not.toEqual(lire(module))
  })
})
