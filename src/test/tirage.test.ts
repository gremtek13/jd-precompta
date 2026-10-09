import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from './encaissementsBatterie'

// UN TIRAGE « AU HASARD » SE FAIT PAR `tirage` (src/test/encaissementsBatterie.ts).
//
// Le générateur congruentiel qu'on écrit de mémoire — `x = (x × 1103515245 + 12345) mod 2³¹` — est faux en JavaScript :
// le produit passe 2⁵³, la virgule flottante en perd les derniers chiffres, et la suite retombe dans un cycle de 10 466
// valeurs presque toutes paires, quelle que soit la graine. La batterie des encaissements, tirée ainsi, ne comptait que
// 1 210 saisies distinctes sur 4 000 (08/10/2026) ; trois autres tests l'écrivaient de même (09/10/2026) — le report des
// soldes (501 exercices distincts sur 600), la liquidation de la TVA, et la TVA du relevé, dont les 20 000 « grands
// montants » n'en faisaient que 6 440, six seulement sur la borne du demi-centime que l'arrondi décide.
//
// Ce fichier garde le générateur (ses valeurs, sa période, l'entier qu'on en tire) et balaie TOUT le dépôt — src/,
// supabase/, outils/ — pour qu'aucun test ne réécrive l'autre forme : une multiplication par un littéral assez grand
// pour passer 2⁵³ suivie d'un modulo, ou l'un des multiplicateurs congruentiels connus ; et aucun `Math.random` dans
// un test, sauf là où sa valeur ne décide de rien.

// Le multiplicateur de l'ancienne forme, et `Math.random`, assemblés : ce fichier ne plante pas en lui-même ce qu'il
// refuse, et ce qu'il admet de lui se compte (`ADMIS`).
const MUL = ['1103', '515', '245'].join('')
const ALEA = ['Math', 'random()'].join('.')
const MULTIPLICATEUR = Number(MUL)

function ancienneForme(graine: number): () => number {
  let x = graine
  return () => (x = (x * MULTIPLICATEUR + 12345) % 2147483648)
}

describe('tirage', () => {
  it('rend la même suite pour la même graine, une autre pour une autre graine', () => {
    const a = tirage(20261009), b = tirage(20261009), c = tirage(20261010)
    const suite = (g: () => number) => Array.from({ length: 50 }, g)
    const sa = suite(a)
    expect(suite(b)).toEqual(sa)
    expect(suite(c)).not.toEqual(sa)
  })

  it('rend des flottants de [0, 1)', () => {
    const t = tirage(1)
    for (let i = 0; i < 100_000; i++) {
      const v = t()
      if (!(v >= 0 && v < 1)) throw new Error(`tirage ${i} : ${v}`)
    }
  })

  // 100 000 tirages sur 2³² valeurs : une collision attendue en moyenne (n² / 2³³). L'ancienne forme, mesurée ici sur
  // la même graine, n'en rend que sa queue (2 423 tirages) et son cycle (10 466).
  it('ne boucle pas : 100 000 tirages, presque autant de valeurs — l’ancienne forme n’en rendait que 12 889', () => {
    const t = tirage(1234567)
    const vues = new Set<number>()
    for (let i = 0; i < 100_000; i++) vues.add(t())
    expect(vues.size).toBeGreaterThanOrEqual(99_990)

    const ancien = ancienneForme(1234567)
    const anciennes = new Set<number>()
    for (let i = 0; i < 100_000; i++) anciennes.add(ancien())
    expect(anciennes.size).toBe(2423 + 10466)
  })

  it('ses bits bas varient : la moitié des entiers tirés sont impairs — l’ancienne forme était paire à 99,6 %', () => {
    const t = tirage(1234567)
    let impairs = 0
    for (let i = 0; i < 10_466; i++) if (entierTire(t, 2147483648) % 2 === 1) impairs++
    expect(impairs).toBeGreaterThan(5000)
    expect(impairs).toBeLessThan(5466)

    const ancien = ancienneForme(1234567)
    for (let i = 0; i < 2424; i++) ancien()
    let anciensImpairs = 0
    for (let i = 0; i < 10_466; i++) if (ancien() % 2 === 1) anciensImpairs++
    expect(anciensImpairs).toBe(44)
  })
})

describe('entierTire', () => {
  it('rend un entier de [0, n), et atteint les deux bornes', () => {
    for (const n of [1, 2, 6, 7, 16]) {
      const t = tirage(n)
      const vus = new Set<number>()
      for (let i = 0; i < 2000; i++) {
        const v = entierTire(t, n)
        if (!Number.isInteger(v) || v < 0 || v >= n) throw new Error(`${n} : ${v}`)
        vus.add(v)
      }
      expect(vus.size, `n = ${n}`).toBe(n)
    }
  })

  it('est le tirage, ramené à la plage : la batterie, dont la base a jugé l’empreinte, le tire ainsi', () => {
    const a = tirage(42), b = tirage(42)
    for (let i = 0; i < 1000; i++) expect(entierTire(a, 1000)).toBe(Math.floor(b() * 1000))
  })

  // Ce que la TVA du relevé tire : des centimes jusqu'à dix millions d'euros. Chaque résidu modulo 6 doit sortir, le 3
  // compris — c'est là que tombe le demi-centime exact à 20 %.
  it('couvre une grande plage : 20 000 montants jusqu’à 10⁹ centimes, presque tous distincts, tous les résidus modulo 6', () => {
    const t = tirage(1234567)
    const vus = new Set<number>()
    const residus = new Set<number>()
    for (let i = 0; i < 20_000; i++) {
      const c = entierTire(t, 1_000_000_000)
      vus.add(c)
      residus.add(c % 6)
    }
    expect(vus.size).toBeGreaterThanOrEqual(19_990)
    expect([...residus].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('refuse une plage qui n’est pas un entier positif', () => {
    const t = tirage(1)
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => entierTire(t, n), String(n)).toThrow(RangeError)
  })
})

// ── Le balayage du dépôt ─────────────────────────────────────────────────────────────────────────────────────────────

interface Source {
  chemin: string
  texte: string
}

const EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|py|sql)$/
// Ce qui n'est pas une source du dépôt : les dépendances, les images du banc de capture, le cache du CLI Supabase.
const DOSSIERS_IGNORES = new Set(['node_modules', 'sorties', '.temp', 'dist'])

function sourcesDuDepot(): Source[] {
  const trouves: Source[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(entree.name)) parcourir(new URL(`${entree.name}/`, dossier), `${prefixe}${entree.name}/`)
        continue
      }
      if (EXTENSIONS.test(entree.name)) {
        trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(new URL(entree.name, dossier), 'utf8') })
      }
    }
  }
  for (const racine of ['src', 'supabase', 'outils']) parcourir(new URL(`../../${racine}/`, import.meta.url), `${racine}/`)
  return trouves
}

// Les lignes ENTIÈREMENT en commentaire ne comptent pas : ce dépôt explique le défaut en citant sa forme. Un
// commentaire de fin de ligne n'est jamais coupé — le code fautif serait avant lui, donc toujours vu.
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => {
      const t = l.trimStart()
      return /^(\/\/|\*|\/\*|#|--)/.test(t) ? '' : l
    })
    .join('\n')
}

// Une multiplication par un littéral, suivie (après un éventuel incrément et une parenthèse) d'un modulo. Les blancs
// sont tolérés partout, retours à la ligne compris : le formatage coupe les expressions.
const MULTIPLICATION_PUIS_MODULO = /\*\s*(0x[0-9a-fA-F]+|\d[\d_]*)\s*(?:[+-]\s*[\w.]+\s*)?\)?\s*%(?!=)/g
// Au-delà, un état de 31 bits multiplié par le littéral passe 2⁵³ : la virgule flottante perd ses derniers chiffres.
const LITTERAL_TROP_GRAND = 2 ** 22
// Les multiplicateurs congruentiels qu'on recopie de mémoire (glibc, Numerical Recipes, Borland, Microsoft, Knuth,
// Marsaglia, Turbo Pascal) : nommés par une constante, ils échapperaient à la forme précédente.
const MULTIPLICATEURS_CONNUS = /(?<![\w.])(1103515245|1664525|22695477|214013|6364136223846793005|69069|134775813)(?![\w.])/g
const MATH_RANDOM = /Math\s*\.\s*random\s*\(/g

const estUnTest = (chemin: string) => /\.test\.tsx?$/.test(chemin) || /^(src\/test|supabase\/essais|outils)\//.test(chemin)

/** Ce que le balayage admet, par fichier et par forme, avec son NOMBRE : une de plus est une rechute, une de moins une
 * raison morte. */
const ADMIS: { chemin: string; forme: TirageFautif['forme']; nombre: number; raison: string }[] = [
  {
    chemin: 'src/context/AuthContext.test.tsx', forme: 'Math.random dans un test', nombre: 1,
    raison: 'un jeton DISTINCT par copie de session (Supabase en rend une neuve à chaque retour sur l’onglet) ; aucune ' +
      'assertion ne lit sa valeur',
  },
  {
    chemin: 'src/test/tirage.test.ts', forme: 'multiplicateur congruentiel', nombre: 7,
    raison: 'la liste des multiplicateurs que ce balayage cherche, dans son expression régulière',
  },
]

export interface TirageFautif {
  chemin: string
  ligne: number
  forme: 'congruentiel en virgule flottante' | 'multiplicateur congruentiel' | 'Math.random dans un test'
  extrait: string
}

export function tiragesFautifs(sources: Source[]): TirageFautif[] {
  const trouves: TirageFautif[] = []
  for (const { chemin, texte } of sources) {
    const propre = sansCommentairesPleins(texte)
    const noter = (forme: TirageFautif['forme'], m: RegExpExecArray) => trouves.push({
      chemin, forme, ligne: propre.slice(0, m.index).split('\n').length, extrait: m[0].replace(/\s+/g, ' ').trim(),
    })
    let m: RegExpExecArray | null
    const multiplication = new RegExp(MULTIPLICATION_PUIS_MODULO.source, 'g')
    while ((m = multiplication.exec(propre)) !== null) {
      if (Number(m[1].replace(/_/g, '')) >= LITTERAL_TROP_GRAND) noter('congruentiel en virgule flottante', m)
    }
    const connus = new RegExp(MULTIPLICATEURS_CONNUS.source, 'g')
    while ((m = connus.exec(propre)) !== null) noter('multiplicateur congruentiel', m)
    if (estUnTest(chemin)) {
      const hasard = new RegExp(MATH_RANDOM.source, 'g')
      while ((m = hasard.exec(propre)) !== null) noter('Math.random dans un test', m)
    }
  }
  return trouves
}

// Les trois formes qui vivaient dans le dépôt jusqu'au 09/10/2026, recopiées sous leur formatage, et la même coupée
// par un retour à la ligne.
const SOURCES_FAUTIVES: Source[] = [
  { chemin: 'src/lib/a.test.ts', texte: `x = (x * ${MUL} + 12345) % 2147483648\nreturn x / 2147483648` },
  { chemin: 'src/lib/b.test.ts', texte: `const hasard = () => (graine = (graine * ${MUL} + 12345) % 2147483648)` },
  { chemin: 'src/lib/c.test.ts', texte: `x = (x *\n  ${MUL}\n  + 12345)\n  % 2147483648` },
  { chemin: 'src/lib/d.ts', texte: `const A = ${MUL}\nx = (x * A + 1) % M` },
  { chemin: 'src/lib/e.test.ts', texte: `const graine = ${ALEA}` },
]
// Ses voisines saines : le générateur exact, la clé du numéro de TVA, une multiplication sans modulo, et la forme
// fautive citée dans un commentaire ; et `Math.random` hors d'un test.
const SOURCES_SAINES: Source[] = [
  { chemin: 'src/test/t.ts', texte: 'let t = Math.imul(a ^ (a >>> 15), 1 | a)\nt = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t' },
  { chemin: 'src/lib/tva.ts', texte: 'const cle = (12 + 3 * (siren % 97)) % 97\nconst centimes = Math.round(montant * 100) % 100' },
  { chemin: 'src/lib/f.ts', texte: 'const grand = montant * 1000000000\nconst reste = grand % 7' },
  { chemin: 'src/lib/g.test.ts', texte: `// Jamais x = (x * ${MUL} + 12345) % 2147483648 : il boucle.\n  * Ni ${ALEA} dans un test.` },
  { chemin: 'src/pages/Depot.tsx', texte: `const id = \`\${Date.now()}-\${${ALEA}}\`` },
]

describe('aucun autre générateur « au hasard » dans le dépôt', () => {
  const toutes = sourcesDuDepot()

  it('balaie src/, supabase/ et outils/', () => {
    for (const racine of ['src/lib/', 'src/pages/', 'src/test/', 'supabase/functions/', 'supabase/essais/', 'outils/']) {
      expect(toutes.some((s) => s.chemin.startsWith(racine)), racine).toBe(true)
    }
    // Assez de fichiers pour qu'un balayage qui ne lirait rien se distingue d'un dépôt sain.
    expect(toutes.length).toBeGreaterThan(500)
  })

  it('attrape les formes plantées, sous leur formatage, et ne prend pas leurs voisines saines', () => {
    const fautes = tiragesFautifs(SOURCES_FAUTIVES)
    expect(fautes.map((f) => `${f.chemin}:${f.ligne} ${f.forme}`)).toEqual([
      'src/lib/a.test.ts:1 congruentiel en virgule flottante', 'src/lib/a.test.ts:1 multiplicateur congruentiel',
      'src/lib/b.test.ts:1 congruentiel en virgule flottante', 'src/lib/b.test.ts:1 multiplicateur congruentiel',
      'src/lib/c.test.ts:1 congruentiel en virgule flottante', 'src/lib/c.test.ts:2 multiplicateur congruentiel',
      'src/lib/d.ts:1 multiplicateur congruentiel',
      'src/lib/e.test.ts:1 Math.random dans un test',
    ])
    expect(tiragesFautifs(SOURCES_SAINES)).toEqual([])
  })

  it('l’ancienne forme plantée boucle bien : c’est elle que le balayage refuse', () => {
    const g = ancienneForme(7) // la graine du report des soldes en société : 4 003 tirages de queue
    const vues = new Set<number>()
    for (let i = 0; i < 20_000; i++) vues.add(g())
    expect(vues.size).toBe(4003 + 10466)
  })

  it('ne trouve aucun générateur congruentiel, et aucun Math.random de test hors des admis — au compte près', () => {
    const fautes = tiragesFautifs(toutes)
    const admise = (f: TirageFautif) => ADMIS.some((a) => a.chemin === f.chemin && a.forme === f.forme)
    expect(fautes.filter((f) => !admise(f)).map((f) => `${f.chemin}:${f.ligne} — ${f.forme} — ${f.extrait}`)).toEqual([])
    for (const a of ADMIS) {
      expect(fautes.filter((f) => f.chemin === a.chemin && f.forme === a.forme).length, `${a.chemin} — ${a.forme}`).toBe(a.nombre)
    }
  })
})
