import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE ANCRE DISPARUE NE PASSE PLUS POUR UNE DÉRIVE ATTRAPÉE (relecture adverse du 27/11/2026, HISTORIQUE.md, « LA RELECTURE
// ADVERSE DE PLUSIEURS COMPTES BANCAIRES »). Un garde qui « sait encore échouer » plante une dérive dans la vraie source —
// l'ancre `avant` remplacée par `apres` — et exige que sa comparaison lève. Quand la plantation se fait DANS la fermeture
// passée au « doit lever » (`echoue(() => … planter(…) …)`, `expect(() => … planter(…) …).toThrow()`), le contrôle de l'ancre,
// une assertion lui aussi, lève au même endroit : une ancre disparue de la source — renommée, déplacée — passait pour la
// dérive attrapée, et le garde ne prouvait plus rien. Trois fichiers le faisaient (agentComptableBanques, agentComptablePlan,
// agentComptableBalance : 26 dérives), aucun test ne rougissait.
//
// La règle : une fermeture d'un « doit lever » qui appelle une plantation est sûre quand chaque contrôle d'ancre du fichier
// est SOUPLE (`expect.soft` : le test est en faute sans que rien ne lève), ou, pour `echoue`, quand le fichier la tient pour
// une assertion de la comparaison (le nom `AssertionError` exigé, le message d'une ancre refusé — /introuvable ou ambigu/) et
// que chaque contrôle d'ancre le dit dans son message. `muter` (src/test/fonctionsEdge.ts) lève une `Error` : une `echoue`
// stricte la refuse, un `toThrow()` la prendrait. Le scanner part de TOUS les fichiers de test ; une forme non reconnue d'une
// plantation n'y entre pas — la sonde de la relecture (toutes les ancres rendues absentes, chaque dérive doit rougir) l'a
// vérifié sur les seize fichiers des gardes de l'assistant.

const RACINE = new URL('../../', import.meta.url)

function fichiersDesTests(dossier = 'src'): string[] {
  return readdirSync(new URL(dossier, RACINE)).flatMap((n) => {
    const chemin = `${dossier}/${n}`
    if (statSync(new URL(chemin, RACINE)).isDirectory()) return fichiersDesTests(chemin)
    return /\.test\.tsx?$/.test(n) ? [chemin] : []
  })
}

// La fin de l'appel dont la parenthèse ouvrante est à `i`, chaînes et gabarits sautés.
function finDeLAppel(texte: string, i: number): number {
  let profondeur = 0
  let chaine: string | null = null
  for (let j = i; j < texte.length; j++) {
    const c = texte[j]
    if (chaine !== null) {
      if (c === '\\') { j++; continue }
      if (c === chaine) chaine = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') chaine = c
    else if (c === '(') profondeur++
    else if (c === ')' && --profondeur === 0) return j
  }
  return texte.length
}

export interface AnalyseDesDerives {
  /** Les contrôles d'ancre d'une plantation : `x.split(a).length - 1` suivi, de près, de `x.replace(a, …)`. */
  controles: { souple: boolean; message: string }[]
  /** Les fermetures d'un « doit lever » qui appellent une plantation. */
  fermetures: number
  fautes: string[]
}

export function analyserLesDerives(nom: string, texte: string): AnalyseDesDerives {
  const controles: AnalyseDesDerives['controles'] = []
  const plantations = new Set<string>(['muter'])
  for (const m of texte.matchAll(/expect(\.soft)?\(\s*(\w+)\.split\((\w+)\)\.length - 1,?([^\n]*)/g)) {
    const suite = texte.slice(m.index, m.index + 400)
    if (!new RegExp(`\\.replace\\(${m[3]}, `).test(suite)) continue
    controles.push({ souple: m[1] !== undefined, message: m[4] })
    // L'aide qui plante : la définition juste au-dessus du contrôle, sans test ouvert entre elles (un contrôle écrit dans le
    // corps d'un test n'appartient à aucune aide).
    const avant = texte.slice(Math.max(0, m.index - 600), m.index)
    const definitions = [...avant.matchAll(/(?:function (\w+)\(|const (\w+) = (?:\([^)]*\)|\w+) =>)/g)]
    const derniere = definitions[definitions.length - 1]
    if (derniere && !/\b(?:it|describe|test)\(/.test(avant.slice(derniere.index))) plantations.add(derniere[1] ?? derniere[2])
  }
  // Les aides qui en appellent une, sur une ligne (`const deriver = (…) => extraire(planter(…))`).
  for (const m of texte.matchAll(/(?:const (\w+) = \([^)]*\) =>|function (\w+)\([^)]*\)[^{\n]*\{)[^\n]*\b(\w+)\(/g)) {
    const appelee = [...m[0].matchAll(/\b(\w+)\(/g)].map((x) => x[1])
    if (appelee.some((a) => plantations.has(a))) plantations.add(m[1] ?? m[2])
  }
  const tousSouples = controles.length > 0 && controles.every((c) => c.souple)
  const echoueStricte = /(?:const echoue = \([^)]*\) =>|function echoue\()[\s\S]{0,400}?toBe\('AssertionError'\)[\s\S]{0,300}?introuvable ou ambigu/.test(texte)
    && controles.every((c) => c.souple || /introuvable ou ambigu/.test(c.message))
  const appelle = new RegExp(`\\b(${[...plantations].join('|')})\\(`)
  const fautes: string[] = []
  let fermetures = 0
  for (const m of texte.matchAll(/\b(echoue)\s*\(|expect\s*\(\s*\(\)\s*=>/g)) {
    const ouverture = texte.indexOf('(', m.index)
    const fin = finDeLAppel(texte, ouverture)
    const corps = texte.slice(ouverture, fin + 1)
    const doitLever = m[1] === 'echoue' || /^\s*\.(?:toThrow|toThrowError)\(/.test(texte.slice(fin + 1, fin + 30))
    if (!doitLever || !appelle.test(corps)) continue
    fermetures++
    const avecMuter = /\bmuter\(/.test(corps)
    const sure = m[1] === 'echoue' ? (echoueStricte || (tousSouples && !avecMuter)) : tousSouples && !avecMuter
    if (!sure) {
      const ligne = texte.slice(0, m.index).split('\n').length
      fautes.push(`${nom}:${ligne} : une plantation dans la fermeture d'un « doit lever » dont le contrôle d'ancre lève`)
    }
  }
  return { controles, fermetures, fautes }
}

// Les tests DE `muter` lui-même : la fermeture attend sa levée sur une ancre absente ou en double, c'est ce qu'ils éprouvent.
const EXCEPTIONS: Readonly<Record<string, { raison: string; nombre: number }>> = {
  'src/test/fonctionsEdge.test.ts': { raison: 'les tests de muter : sa levée sur une ancre absente ou ambiguë est ce qu’ils éprouvent', nombre: 2 },
}

describe('une ancre disparue ne passe pas pour une dérive attrapée', () => {
  const analyses = fichiersDesTests().filter((f) => !f.endsWith('derivesPlanteesDansLesFermetures.test.ts'))
    .map((f) => ({ f, a: analyserLesDerives(f, readFileSync(new URL(f, RACINE), 'utf8')) }))

  it('aucune fermeture d’un « doit lever » ne plante une dérive sous un contrôle d’ancre qui lève', () => {
    const fautes = analyses.flatMap(({ f, a }) => {
      const exception = EXCEPTIONS[f]
      if (exception) {
        expect(a.fautes.length, `${f} : ${exception.raison}`).toBe(exception.nombre)
        return []
      }
      return a.fautes
    })
    expect(fautes).toEqual([])
  })

  it('n’est pas aveugle : il voit les plantations des gardes de l’assistant', () => {
    // Un plancher, pas un compte exact : « zéro faute » sur zéro fermeture vue ne dirait rien.
    expect(analyses.reduce((n, { a }) => n + a.fermetures, 0)).toBeGreaterThanOrEqual(40)
    expect(analyses.reduce((n, { a }) => n + a.controles.length, 0)).toBeGreaterThanOrEqual(20)
    for (const f of ['src/lib/agentComptableBanques.test.ts', 'src/lib/agentComptablePlan.test.ts', 'src/lib/agentComptableBalance.test.ts']) {
      const a = analyses.find((x) => x.f === f)?.a
      expect(a?.fermetures, f).toBeGreaterThan(0)
      expect(a?.controles.every((c) => c.souple), f).toBe(true)
    }
  })

  it('attrape une ancre contrôlée par un expect qui lève, dans la fermeture d’un toThrow ou d’une echoue lâche', () => {
    const aide = (souple: boolean) => `function planter(source: string, avant: string, apres: string): string {
  expect${souple ? '.soft' : ''}(source.split(avant).length - 1, \`ancre à planter introuvable ou ambiguë : \${avant}\`).toBe(1)
  return source.replace(avant, apres)
}
`
    const lache = 'const echoue = (f: () => void) => expect(f).toThrow()\n'
    const stricte = `const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name).toBe('AssertionError')
    expect(String(erreur)).not.toMatch(/introuvable ou ambigu/)
  }
`
    const appels = "echoue(() => memeBloc(planter(s, 'a', 'b')))\nexpect(() => memeBloc(planter(s, 'a', 'b'))).toThrow()\n"
    expect(analyserLesDerives('x', aide(false) + lache + appels).fautes).toHaveLength(2)
    expect(analyserLesDerives('x', aide(true) + lache + appels).fautes).toEqual([])
    // Une echoue stricte refuse le contrôle d'une ancre ; un toThrow, non.
    expect(analyserLesDerives('x', aide(false) + stricte + appels).fautes).toHaveLength(1)
    // `muter` lève une Error : un toThrow la prendrait, même sous des contrôles souples.
    expect(analyserLesDerives('x', `${aide(true)}expect(() => memeBloc(muter(s, [['a', 'b']]))).toThrow()\n`).fautes).toHaveLength(1)
    // Une plantation faite hors de la fermeture ne se juge pas.
    expect(analyserLesDerives('x', `${aide(false)}${lache}const d = planter(s, 'a', 'b')\necho${''}ue(() => memeBloc(d))\n`).fautes).toEqual([])
  })
})
