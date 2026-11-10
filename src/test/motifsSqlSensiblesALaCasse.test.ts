import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LecturePerdue, lire, nommeUneDefinition, trouvailles, type Trouvaille } from './motifsSql'

// UN MOTIF QUI CHERCHE UNE DÉFINITION SQL EN MINUSCULES RELIT UNE ANCIENNE VERSION, SANS RIEN DIRE.
//
// SQL ne distingue pas `create or replace function` de `CREATE OR REPLACE FUNCTION`, ni un espace d'un retour à la
// ligne. La migration acomptes_des_devis (05/11/2026) écrit `enregistrer_facture` en capitales, recopiée de
// `pg_get_functiondef` : dix-neuf copies locales de « chercher la dernière définition », dans quatorze fichiers de
// test, cherchaient `create (or replace )?function` en minuscules seulement, et lisaient la version du 29/10/2026 —
// HISTORIQUE.md, « LES TESTS LISAIENT UNE ANCIENNE ENREGISTRER_FACTURE ». `src/test/schema.ts` en a pris la lecture
// (`motifDeDefinition`, `definitionsSql`, `derniereDefinitionSql`) ; ce contrôle empêche qu'une copie revienne.
//
// CE QU'IL LIT : TOUS les fichiers `src/**/*.test.ts(x)` et `src/test/**/*.ts`, par un petit lexeur (commentaires,
// chaînes, gabarits et littéraux d'expression régulière reconnus pour ce qu'ils sont), jamais par une expression
// régulière sur la ligne : un commentaire qui CITE un motif n'est pas un motif. Il juge l'EXPRESSION :
//   • un littéral `/…/` ou un `new RegExp(…)` dont le corps nomme une instruction de définition (`create`, `alter`
//     ou `drop` suivi de function, trigger, policy, table, view, index, type, schema, extension, constraint ou
//     column) et dont les drapeaux n'ont pas `i` ;
//   • un `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `split` ou `toContain` dont l'argument est un texte
//     fixe qui nomme la même instruction : une recherche de texte est toujours sensible à la casse.
// Une forme que le lexeur ne sait pas lire (une chaîne qui ne se ferme pas) est une faute, pas un silence.
//
// UNE EXCEPTION PORTE SA RAISON ET SON NOMBRE (`EXCEPTIONS`) : un nombre exact par fichier, de sorte qu'une
// recherche de plus, ou une de moins, fasse échouer le contrôle. Un PLANCHER sépare « zéro faute » d'« aveugle » :
// le contrôle doit voir au moins `PLANCHER_DE_MOTIFS_CONFORMES` motifs conformes (avec `i`) et `PLANCHER_DE_FICHIERS`
// fichiers.

// ─── Le dépôt ───────────────────────────────────────────────────────────────────────────────────────────────────────

const RACINE = new URL('../../', import.meta.url).pathname

function fichiersTs(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiersTs(chemin)
    return /\.tsx?$/.test(nom) ? [chemin] : []
  })
}

const ESSAI = relative(RACINE, new URL(import.meta.url).pathname)

/** TOUS les fichiers que le contrôle lit : les tests de `src/` et tout `src/test/`. Lui-même en est écarté (il cite ce qu'il interdit). */
export function fichiersLus(): string[] {
  const src = fichiersTs(join(RACINE, 'src')).map((c) => relative(RACINE, c))
  return src
    .filter((c) => /\.test\.tsx?$/.test(c) || c.startsWith('src/test/'))
    .filter((c) => c !== ESSAI)
    .sort()
}

// LES EXCEPTIONS : un fichier, un nombre exact de recherches, et pourquoi ce ne sont pas des recherches d'une
// DÉFINITION de l'export. Un fichier absent d'ici n'en a aucune ; un nombre qui ne tombe plus juste fait échouer le contrôle.
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'src/test/schema.test.ts': {
    nombre: 1,
    raison: 'affirme À DESSEIN que la dernière définition d\'enregistrer_facture est celle d\'acomptes_des_devis, écrite en capitales : le motif sans « i » est l\'assertion, pas une recherche',
  },
}

/** `trouvailles` d'un fichier du dépôt, la faute de lecture nommant son fichier. */
function lues(chemin: string, source: string): Trouvaille[] {
  try {
    return trouvailles(source, chemin.endsWith('.tsx'))
  } catch (e) {
    if (e instanceof LecturePerdue) throw new LecturePerdue(`${chemin} : ${e.message}`)
    throw e
  }
}

const PLANCHER_DE_MOTIFS_CONFORMES = 120 // 160 le 10/11/2026
const PLANCHER_DE_FICHIERS = 600 // 721 le 10/11/2026

/** Les fautes d'un ensemble de fichiers : chacun doit porter EXACTEMENT le nombre de recherches que `exceptions` lui permet (zéro par défaut). */
export function jugerLesFichiers(
  fichiers: { chemin: string; source: string }[],
  exceptions: Record<string, { nombre: number; raison: string }>,
): string[] {
  const fautes: string[] = []
  for (const { chemin, source } of fichiers) {
    const t = lues(chemin, source)
    const permis = exceptions[chemin]?.nombre ?? 0
    if (t.length !== permis) {
      fautes.push(`${chemin} : ${t.length} recherche(s), ${permis} permise(s)\n` + t.map((x) => `    ${x.ligne} [${x.genre}] ${x.extrait}`).join('\n'))
    }
  }
  return fautes
}

/** Les fautes des exceptions elles-mêmes : un fichier encore lu, un nombre non nul, une raison qui dit quelque chose. */
export function fautesDesExceptions(exceptions: Record<string, { nombre: number; raison: string }>, lus: Set<string>): string[] {
  const fautes: string[] = []
  for (const [chemin, e] of Object.entries(exceptions)) {
    if (!lus.has(chemin)) fautes.push(`${chemin} n'est plus lu`)
    if (!(e.nombre > 0)) fautes.push(`${chemin} : un nombre d'exceptions nul ou absent`)
    if (e.raison.trim().length <= 30) fautes.push(`${chemin} : une raison trop courte pour en être une`)
  }
  return fautes
}

/** Les motifs CONFORMES que ces fichiers portent : des littéraux avec `i` qui nomment une définition. Le même lexeur les compte. */
export function motifsConformes(fichiers: { chemin: string; source: string }[]): number {
  let conformes = 0
  for (const { chemin, source } of fichiers) {
    for (const j of lire(source, chemin.endsWith('.tsx'))) {
      if (j.genre === 'regex' && j.drapeaux.includes('i') && nommeUneDefinition(j.corps)) conformes++
    }
  }
  return conformes
}

describe('les motifs de définition SQL ne distinguent pas les capitales', () => {
  const lus = fichiersLus().map((chemin) => ({ chemin, source: readFileSync(join(RACINE, chemin), 'utf8') }))

  it('aucun fichier du dépôt ne cherche une définition sans le drapeau « i » ni par un texte fixe, hors exceptions motivées', () => {
    const fautes = jugerLesFichiers(lus, EXCEPTIONS)
    expect(fautes, `Une recherche de définition en minuscules relit une ancienne version : passer par definitionsSql ou motifDeDefinition (src/test/schema.ts), ou ajouter /i.\n${fautes.join('\n')}`).toEqual([])
  })

  it('chaque exception existe, a une raison, et porte un nombre non nul', () => {
    expect(fautesDesExceptions(EXCEPTIONS, new Set(lus.map((l) => l.chemin)))).toEqual([])
  })

  it('le contrôle n\'est pas aveugle : il voit les fichiers du dépôt et des motifs conformes', () => {
    expect(lus.length).toBeGreaterThanOrEqual(PLANCHER_DE_FICHIERS)
    expect(motifsConformes(lus)).toBeGreaterThanOrEqual(PLANCHER_DE_MOTIFS_CONFORMES)
    // Il lit aussi les fichiers de `src/test/` et les `.tsx`.
    expect(lus.some((l) => l.chemin === 'src/test/schema.ts')).toBe(true)
    expect(lus.some((l) => l.chemin.endsWith('.test.tsx'))).toBe(true)
  })
})

describe('le décompte des exceptions est exact, dans les deux sens', () => {
  const fichier = (n: number) => ({ chemin: 'src/lib/faux.test.ts', source: Array.from({ length: n }, () => 'const m = /create table t/g\n').join('') })
  const permis = (nombre: number) => ({ 'src/lib/faux.test.ts': { nombre, raison: 'un fichier de cet essai, en mémoire' } })

  it('une recherche de plus que permis, ou de moins, est une faute ; le compte juste n\'en est pas une', () => {
    expect(jugerLesFichiers([fichier(2)], permis(2))).toEqual([])
    expect(jugerLesFichiers([fichier(3)], permis(2))).toHaveLength(1)
    expect(jugerLesFichiers([fichier(1)], permis(2))).toHaveLength(1)
    expect(jugerLesFichiers([fichier(1)], {})).toHaveLength(1)
    expect(jugerLesFichiers([fichier(0)], {})).toEqual([])
  })

  it('une exception doit viser un fichier lu, porter un nombre et une vraie raison', () => {
    const lus = new Set(['src/lib/faux.test.ts'])
    const bonne = { nombre: 1, raison: 'une raison qui dit pourquoi ce n\'est pas une définition de l\'export' }
    expect(fautesDesExceptions({ 'src/lib/faux.test.ts': bonne }, lus)).toEqual([])
    expect(fautesDesExceptions({ 'src/lib/disparu.test.ts': bonne }, lus)).toHaveLength(1)
    expect(fautesDesExceptions({ 'src/lib/faux.test.ts': { ...bonne, nombre: 0 } }, lus)).toHaveLength(1)
    expect(fautesDesExceptions({ 'src/lib/faux.test.ts': { ...bonne, raison: 'parce que' } }, lus)).toHaveLength(1)
    expect(fautesDesExceptions({ 'src/lib/faux.test.ts': { ...bonne, raison: ' '.repeat(40) } }, lus)).toHaveLength(1)
  })

  it('le plancher compte des motifs conformes, et seulement eux', () => {
    const conforme = { chemin: 'src/lib/x.test.ts', source: 'const m = /create table t/gi\nconst n = /create function f/g\n' }
    expect(motifsConformes([conforme])).toBe(1)
    expect(motifsConformes([])).toBe(0)
  })
})

// ─── Les défauts PLANTÉS : des chaînes en mémoire, jamais un fichier du dépôt ───────────────────────────────────────

describe('le contrôle voit chaque forme plantée', () => {
  const ligne = (...morceaux: string[]) => morceaux.join('')
  const g = (...m: string[]) => trouvailles(ligne(...m))

  it('un littéral sans « i »', () => {
    expect(g('const m = /create (or replace )?function public\\.f\\(/g')).toHaveLength(1)
    expect(g('const m = /create\\s+table\\s+public\\.t\\b/')).toHaveLength(1)
    expect(g('x.match(/alter table public\\.(\\w+)\\s+add column/g)')).toHaveLength(1)
    expect(g('x.test(/create policy p on t/)')).toHaveLength(1)
  })

  it('un `new RegExp` sans « i », corps en chaîne ou en gabarit, drapeaux absents ou sans « i »', () => {
    expect(g('new RegExp(`create (?:or replace )?function public\\\\.${nom}\\\\(`, \'g\')')).toHaveLength(1)
    expect(g('new RegExp(`create or replace function public\\\\.${nom}\\\\(`)')).toHaveLength(1)
    expect(g('new RegExp("create trigger t on public\\\\.x", "gm")')).toHaveLength(1)
  })

  it('une recherche de texte fixe, au gabarit comme à la chaîne', () => {
    expect(g('texte.indexOf(`create or replace function public.${nom}(`)')).toHaveLength(1)
    expect(g("texte.indexOf('create or replace function')")).toHaveLength(1)
    expect(g("t.lastIndexOf('create policy pieces_storage_delete')")).toHaveLength(1)
    expect(g("f.texte.includes('create table public.statuts_factures_recus (')")).toHaveLength(1)
    expect(g("expect(sql).toContain('alter table public.t add column c')")).toHaveLength(0) // une assertion sur un texte exact, pas une recherche
    expect(g("sql.split('create function ')")).toHaveLength(1)
    expect(g("sql.startsWith('drop function public.f')")).toHaveLength(1)
  })

  it('une recherche dont la casse se choisit dans un ternaire du gabarit', () => {
    expect(g('texte.indexOf(`${reprise ? \'create or replace\' : \'create\'} function public.${nom}(`)')).toHaveLength(1)
  })

  it('le début d\'une instruction quelconque, `\\ncreate `', () => {
    expect(g("texte.indexOf('\\ncreate ')")).toHaveLength(1)
  })

  it('un motif nu dans un appel qui n\'est pas une recherche de texte n\'est pas compté (sans mutation de la liste)', () => {
    expect(g("x.push('create function public.f(')")).toHaveLength(0)
  })

  it('ce qui est conforme ne se signale pas', () => {
    expect(g('const m = /create\\s+(or\\s+replace\\s+)?function\\s+public\\.f\\(/i')).toHaveLength(0)
    expect(g('new RegExp(`create (or replace )?function public\\\\.${nom}\\\\(`, \'gi\')')).toHaveLength(0)
    expect(g('new RegExp(`create function`, "ig")')).toHaveLength(0)
    expect(g('const m = /create\\s+table\\s+x/gi')).toHaveLength(0)
  })

  it('ce qui ne cherche pas une définition ne se signale pas', () => {
    expect(g("texte.indexOf('begin')")).toHaveLength(0)
    expect(g('const m = /raise exception/g')).toHaveLength(0)
    expect(g('const m = /\\bdrop\\b[^;]*;/gi')).toHaveLength(0)
    expect(g("texte.indexOf('as $$')")).toHaveLength(0)
  })

  it('un commentaire ou une chaîne qui CITE un motif n\'est pas un motif', () => {
    expect(g('// const m = /create function public\\.f\\(/g\nconst x = 1')).toHaveLength(0)
    expect(g('/* texte.indexOf("create function") */ const x = 1')).toHaveLength(0)
    expect(g("const phrase = 'chercher /create function/ à la main'")).toHaveLength(0)
    expect(g("const a = 4 / 2, b = 6 / 3; texte.indexOf('begin')")).toHaveLength(0)
  })

  it('une division après une parenthèse n\'ouvre pas un littéral : le motif qui suit se lit', () => {
    expect(g('const n = (a) / 2; const m = /create function/g; const o = 3 / 1')).toHaveLength(1)
    expect(g('const n = a[0] / 2; const m = /create function/g; const o = 3 / 1')).toHaveLength(1)
  })

  it('le numéro de ligne est celui du motif', () => {
    expect(trouvailles("const a = 1\n\nconst b = /create trigger t/g")[0]?.ligne).toBe(3)
  })

  it('une forme illisible lève plutôt que de passer', () => {
    expect(() => trouvailles("const a = 'ouverte")).toThrow(LecturePerdue)
    expect(() => trouvailles('const a = `ouvert')).toThrow(LecturePerdue)
    expect(() => trouvailles('/* ouvert')).toThrow(LecturePerdue)
  })
})
