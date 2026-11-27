import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as forme from './bordereauDeTeletransmission'
import { executerModule } from '../test/compilationSeparee'

// LA COPIE DE BOR6, TROISIÈME PARTIE, DANS extract-piece (27/11/2026) : la forme d'un bordereau (`formeDUnBordereau`, de
// src/lib/bordereauDeTeletransmission.ts), qui juge la LECTURE de Textract — une photo, un PDF numérisé — avant que rien ne parte
// au modèle de citation ni ne revienne à l'appelant. La fonction est auto-portée : le bloc est-il AU CARACTÈRE PRÈS celui de
// src/lib, exécuté seul rend-il ce que rend le module, et la fonction s'en sert-elle au bon endroit ? Que le bloc se compile seul
// est gardé par bordereauALaReceptionCopie.test.ts, sur le même texte d'origine. Le comportement en HTTP (422 `bordereau`, aucun
// modèle, rien de lu) : edgeFunctionsHttp.test.ts.

const FONCTION = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')
const SOURCE = readFileSync(new URL('./bordereauDeTeletransmission.ts', import.meta.url), 'utf8')

function blocDe(source: string, ou: string): string {
  const debut = '// ── DÉBUT COPIE formeDUnBordereau '
  const fin = '// ── FIN COPIE formeDUnBordereau '
  const d = source.indexOf(debut)
  const f = source.indexOf(fin)
  expect(d, `bornes du bloc introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut, d + 1), `le bloc est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

type CopieForme = Pick<typeof forme, 'porteLaFormeDUnBordereau'>

// Des lignes comme Textract les rend (une seule page : toutes les lignes du document, dans l'ordre de lecture).
const LECTURES: string[][] = [
  ['Bordereau de Teletransmission', 'Lot : 412 créé le 03/11/2026'],
  ['CABINET FICTIF', 'BORDEREAU DE TÉLÉTRANSMISSION'],
  ['Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré'],
  ['FACTURE N° 25-118', 'Option : impression du bordereau de télétransmission 5,00'],
  ['Relevé de compte', 'VIR SEPA CPAM 23,00'],
  [],
]

describe('la copie de la forme d’un bordereau dans extract-piece', () => {
  it('au caractère près le bloc de src/lib', () => {
    expect(blocDe(FONCTION, 'extract-piece')).toBe(blocDe(SOURCE, 'bordereauDeTeletransmission.ts'))
  })

  it('exécutée seule, elle rend ce que rend le module sur des lectures de Textract — et le garde mord', () => {
    const copie = executerModule<CopieForme>(blocDe(FONCTION, 'extract-piece'))
    const verdicts = (m: CopieForme) => LECTURES.map((lignes) => m.porteLaFormeDUnBordereau([{ lignes }]))
    expect(verdicts(forme)).toEqual([true, true, true, false, false, false])
    expect(verdicts(copie)).toEqual(verdicts(forme))
    const mutee = executerModule<CopieForme>(
      blocDe(FONCTION, 'extract-piece').replace(' || l.normalisee.includes(ENTETE_DES_COLONNES)', ''))
    expect(verdicts(mutee)).not.toEqual(verdicts(forme))
  })

  it('extract-piece s’en sert sur sa lecture, avant le modèle, et refuse sous le code que lit le navigateur', () => {
    const horsBloc = FONCTION.replace(blocDe(FONCTION, 'extract-piece'), '')
    expect(horsBloc).not.toMatch(/function porteLaFormeDUnBordereau\b/)
    const lecture = horsBloc.indexOf('const lignes = lignesOcr(blocks)')
    const jugement = horsBloc.indexOf('if (porteLaFormeDUnBordereau([{ lignes }])) {')
    expect(lecture).toBeGreaterThan(-1)
    expect(jugement).toBeGreaterThan(lecture)
    expect(jugement).toBeLessThan(horsBloc.indexOf('await citerChamps(lignes.join("\\n")'))
    expect(horsBloc).toContain('return json({ error: REFUS_D_UN_BORDEREAU_LU, code: CODE_D_UN_BORDEREAU_LU }, 422)')
    // Le même code que lib/extraction.ts (`CODE_D_UN_BORDEREAU_LU`), que lectureAuDepot.test.ts lit.
    expect(horsBloc).toContain('const CODE_D_UN_BORDEREAU_LU = "bordereau"')
  })
})
