import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as module from './nomDeLEmetteur'
import { ceQueLaFactureImprime } from './mentionsFigeesVue'
import { diagnosticsSeuls, executerModule } from '../test/compilationSeparee'
import { facture, ligne } from '../test/facturesCii'

// LA COPIE DU BLOC nomDeLEmetteur DANS send-email (FACT-Q2 (B), réponse du cabinet du 27/11/2026). L'e-mail d'une facture —
// son objet, sa signature, son expéditeur — et celui de sa relance nomment ce que la facture imprime : la dénomination figée
// d'une facture figée, sinon son `emetteur_nom`. La fonction est auto-portée : elle suit la règle par une COPIE du bloc de
// src/lib/nomDeLEmetteur.ts, que l'aperçu emploie (`ceQueLaFactureImprime`). Quatre questions (CLAUDE.md, « Une Edge
// Function auto-portée duplique du code ») : la copie est-elle au caractère près le bloc ? se compile-t-elle seule ?
// exécutée seule, rend-elle ce que rendent le module ET l'aperçu ? la fonction s'en sert-elle partout où elle nomme ?

const MODULE = readFileSync(new URL('./nomDeLEmetteur.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/send-email/index.ts', import.meta.url), 'utf8')

function blocDe(source: string, ou: string): string {
  const debut = '// ── DÉBUT COPIE nomDeLEmetteur '
  const fin = '// ── FIN COPIE nomDeLEmetteur '
  const d = source.indexOf(debut)
  const f = source.indexOf(fin)
  expect(d, `bornes du bloc introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut, d + 1), `le bloc est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'nomDeLEmetteur.ts')
const COPIE = blocDe(FONCTION, 'send-email')
type Copie = Pick<typeof module, 'nomDeLEmetteur'>

// Les formes qu'une ligne lue peut prendre : figée ou non, drapeau absent ou nul, dénomination présente, blanche, vide,
// nulle, absente, entourée de blancs ; `emetteur_nom` présent ou nul.
const DRAPEAUX = [true, false, null, undefined] as const
const DENOMINATIONS = ['Cabinet Démo EI', '  Cabinet Démo  ', '', '   ', null, undefined] as const
const NOMS = ['nom-interne', null] as const
const CAS = DRAPEAUX.flatMap((mentions_figees) => DENOMINATIONS.flatMap((denomination_imprimee) =>
  NOMS.map((emetteur_nom) => ({ mentions_figees, denomination_imprimee, emetteur_nom }))))

describe('la copie du bloc nomDeLEmetteur dans send-email (FACT-Q2)', () => {
  it('send-email : au caractère près le bloc de src/lib/nomDeLEmetteur.ts', () => {
    expect(COPIE).toBe(ORIGINE)
  })

  it('se compile seule, sans rien emprunter', () => {
    expect(diagnosticsSeuls(ORIGINE, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })).toEqual([])
  })

  it('exécutée seule, la copie rend ce que rend le module, sur toutes les formes', () => {
    const copie = executerModule<Copie>(COPIE)
    expect(CAS.map((c) => copie.nomDeLEmetteur(c))).toEqual(CAS.map((c) => module.nomDeLEmetteur(c)))
    // Les formes ne sont pas aveugles : la dénomination l'emporte, et le nom recopié revient.
    const rendus = CAS.map((c) => module.nomDeLEmetteur(c))
    expect(rendus.filter((r) => r === 'Cabinet Démo EI').length).toBe(2)
    expect(rendus.filter((r) => r === 'nom-interne').length).toBeGreaterThan(10)
  })

  it('le module rend le nom que l’aperçu d’une facture figée imprime', () => {
    for (const c of CAS.filter((x) => x.mentions_figees === true)) {
      const f = facture([ligne()], { mentions_figees: true, denomination_imprimee: c.denomination_imprimee ?? null, emetteur_nom: c.emetteur_nom })
      expect(ceQueLaFactureImprime(f)?.nom, JSON.stringify(c)).toBe(module.nomDeLEmetteur(f))
    }
  })

  // FACT-Q5 (A), 27/11/2026 : les deux fonctions qui transmettent la facture électronique portent le bloc aussi, à côté du
  // générateur, qui nomme le vendeur (BT-27) par lui ; copiesFacturation.test.ts les exécute seuls contre src/lib.
  it.each(['superpdp-emit', 'plateforme-agreee'])('%s : au caractère près le bloc, lu par la dénomination figée', (fonction) => {
    const source = readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
    expect(blocDe(source, fonction)).toBe(ORIGINE)
    expect(source).toContain('      nom: nomDeLEmetteur(facture),\n')
    expect(source).toMatch(/const COLONNES_FACTURE = [^;]*"denomination_imprimee"/)
  })

  it('la fonction s’en sert partout où elle nomme l’émetteur d’une facture, et ne lit plus `emetteur_nom` à la place', () => {
    const horsDuBloc = FONCTION.replace(COPIE, '')
    expect(horsDuBloc.match(/nomDeLEmetteur\((facture|f|factureData as FactureRow)\)/g)).toHaveLength(4)
    expect(horsDuBloc).not.toMatch(/(facture|f|factureData)\.emetteur_nom \?\?/)
  })
})
